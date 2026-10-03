// Initial La Vilet catalog index. Preview: node scripts/generate-unit-embeddings.mjs
// Generate and persist: node scripts/generate-unit-embeddings.mjs --write
// This is a manual operation; it does not enable retrieval in the bot or auto-sync.
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import nextEnv from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '../src/lib/integrations/lavilet.ts'

export const MODEL = 'text-embedding-3-small'
export const DIMENSIONS = 1536
const INDEX_VERSION = 'unit-facts-v1'
const SCOPE = { project_id: LAVILET_PROJECT_ID, tenant_id: LAVILET_TENANT_ID }
const PAGE_SIZE = 100
const BATCH_SIZE = 16
const fields = {
  category: 'Tipo de inmueble', unit_number: 'Unidad', unit_subtype: 'Subtipo',
  floor: 'Planta', floor_number: 'Número de planta', bedrooms: 'Dormitorios',
  bathrooms: 'Baños registrados', bathrooms_full: 'Baños completos', bathrooms_half: 'Medios baños',
  area_internal_m2: 'Superficie interior (m²)', area_exterior_m2: 'Superficie exterior (m²)',
  area_total_m2: 'Superficie total registrada (m²)', area_terrace_m2: 'Terraza registrada (m²)',
  area_terrace_covered_m2: 'Terraza cubierta (m²)', area_terrace_open_m2: 'Terraza abierta (m²)',
  parking_assigned: 'Parqueaderos asignados', orientation: 'Orientación',
  typology_code: 'Código de tipología', description: 'Descripción', spaces: 'Espacios',
}
const UNIT_SELECT = ['id', 'tenant_id', 'project_id', 'updated_at', 'status', 'is_published', ...Object.keys(fields)].join(',')
const hash = value => createHash('sha256').update(value).digest('hex')

// Stable primary key permits retrying writes without duplicating a unit. No
// UNIQUE(unit_id) constraint is assumed on the existing units_embeddings table.
function rowId(unitId) {
  const bytes = createHash('sha256').update(`lavilet:units_embeddings:${unitId}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function buildDocument(unit, project) {
  if (!unit.id || unit.project_id !== SCOPE.project_id || unit.tenant_id !== SCOPE.tenant_id ||
    unit.status !== 'disponible' || unit.is_published !== true ||
    project.id !== unit.project_id || project.tenant_id !== unit.tenant_id) {
    throw new Error('Unidad fuera del catálogo publicado y disponible de La Vilet.')
  }
  const facts = Object.fromEntries(Object.keys(fields).map(key => [key, unit[key] ?? null]))
  const lines = [`Proyecto: ${project.name}`]
  for (const [key, label] of Object.entries(fields)) {
    const value = facts[key]
    if (value !== null && value !== '' && (!Array.isArray(value) || value.length)) {
      lines.push(`${label}: ${Array.isArray(value) ? value.join(', ') : value}`)
    }
  }
  const content = lines.join('\n')
  // Conservative byte ceiling also bounds tokens for each input; don't silently
  // truncate descriptions or discard properties when a document is too long.
  if (Buffer.byteLength(content, 'utf8') > 8000) throw new Error(`Ficha demasiado larga: ${unit.unit_number}`)
  return {
    id: rowId(unit.id), unit_id: unit.id, content,
    metadata: {
      ...SCOPE, unit_id: unit.id, ...facts,
      source_table: 'units', source_updated_at: unit.updated_at,
      project_name: project.name, index_version: INDEX_VERSION,
      embedding_model: MODEL, embedding_dimensions: DIMENSIONS, content_hash: hash(content),
      // Prices and current availability must be read from units when retrieving.
      // These physical facts are a snapshot, not an independent source of truth.
    },
  }
}

export function validVector(value) {
  return Array.isArray(value) && value.length === DIMENSIONS &&
    value.every(n => typeof n === 'number' && Number.isFinite(n)) && value.some(n => n !== 0)
}

function storedVector(row) {
  try { return typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding }
  catch { return null }
}

export function canReuse(row, document) {
  return row?.unit_id === document.unit_id && row.content === document.content &&
    row.metadata?.content_hash === document.metadata.content_hash &&
    row.metadata?.embedding_model === MODEL && row.metadata?.embedding_dimensions === DIMENSIONS &&
    row.metadata?.index_version === INDEX_VERSION && validVector(storedVector(row))
}

export function validateResponse(response, count) {
  if (response.model !== MODEL || !Array.isArray(response.data) || response.data.length !== count) {
    throw new Error('OpenAI no devolvió el modelo o la cantidad de vectores esperados.')
  }
  const vectors = new Map()
  for (const item of response.data) {
    if (!Number.isInteger(item.index) || item.index < 0 || item.index >= count ||
      vectors.has(item.index) || !validVector(item.embedding)) {
      throw new Error('OpenAI devolvió un vector inválido o un índice duplicado.')
    }
    vectors.set(item.index, item.embedding)
  }
  return Array.from({ length: count }, (_, i) => vectors.get(i))
}

async function readAll(query) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query().range(from, from + PAGE_SIZE - 1)
      .abortSignal(AbortSignal.timeout(30000))
    if (error) throw new Error(`Lectura de catálogo: ${error.message}`)
    rows.push(...data)
    if (data.length < PAGE_SIZE) return rows
  }
}

async function readCatalog(db) {
  return readAll(() => db.from('units').select(UNIT_SELECT).match(SCOPE)
    .eq('is_published', true).eq('status', 'disponible').order('id'))
}

async function readIndex(db) {
  return readAll(() => db.from('units_embeddings')
    .select('id,unit_id,content,metadata,embedding,units!inner(tenant_id,project_id)')
    .eq('units.tenant_id', SCOPE.tenant_id).eq('units.project_id', SCOPE.project_id).order('id'))
}

function byUnit(rows) {
  const map = new Map()
  for (const row of rows) {
    if (map.has(row.unit_id)) throw new Error(`Hay varias fichas para la unidad ${row.unit_id}; no se sobrescribieron.`)
    map.set(row.unit_id, row)
  }
  return map
}

async function generate(documents, apiKey) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: documents.map(d => d.content), dimensions: DIMENSIONS, encoding_format: 'float' }),
  })
  if (!response.ok) {
    // Do not dump request headers, credentials or upstream bodies into logs.
    const body = await response.json().catch(() => null)
    const rawCode = body?.error?.code
    const code = typeof rawCode === 'string' && /^[a-z_]{1,80}$/.test(rawCode) ? ` (${rawCode})` : ''
    throw new Error(`OpenAI embeddings HTTP ${response.status}${code}. Puede reejecutar: los lotes guardados se reutilizan.`)
  }
  const data = await response.json()
  return { vectors: validateResponse(data, documents.length), tokens: data.usage?.total_tokens ?? 0 }
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--write')) throw new Error('Uso: node scripts/generate-unit-embeddings.mjs [--write]')
  const write = args.includes('--write')
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  nextEnv.loadEnvConfig(root, true, { info() {}, error() {} })
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', ...(write ? ['OPENAI_API_KEY'] : [])]) {
    if (!process.env[name]) throw new Error(`Falta ${name}`)
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
  const projectResult = await db.from('projects').select('id,tenant_id,name')
    .eq('id', SCOPE.project_id).eq('tenant_id', SCOPE.tenant_id).single()
    .abortSignal(AbortSignal.timeout(30000))
  if (projectResult.error) throw new Error(projectResult.error.message)
  const project = projectResult.data
  const units = await readCatalog(db)
  const documents = units.map(unit => buildDocument(unit, project))
  const existing = byUnit(await readIndex(db))
  const pending = documents.filter(doc => !canReuse(existing.get(doc.unit_id), doc))
  console.log(JSON.stringify({ mode: write ? 'write' : 'preview', table: 'units_embeddings',
    units: units.length, generate: pending.length, reuse: documents.length - pending.length,
    model: MODEL, dimensions: DIMENSIONS,
    categories: units.reduce((counts, u) => ({ ...counts, [u.category]: (counts[u.category] ?? 0) + 1 }), {}) }))
  if (!write) return

  let tokens = 0
  let generated = 0
  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    const batch = pending.slice(offset, offset + BATCH_SIZE)
    const result = await generate(batch, process.env.OPENAI_API_KEY)
    const rows = batch.map((doc, i) => ({ ...doc,
      id: existing.get(doc.unit_id)?.id ?? doc.id,
      metadata: { ...doc.metadata, generated_at: new Date().toISOString() },
      embedding: JSON.stringify(result.vectors[i]),
    }))
    const { error } = await db.from('units_embeddings').upsert(rows, { onConflict: 'id' })
      .abortSignal(AbortSignal.timeout(30000))
    if (error) throw new Error(`Guardado de embeddings: ${error.message}`)
    tokens += result.tokens
    generated += batch.length
    console.log(JSON.stringify({ saved: generated, total_to_generate: pending.length, tokens }))
  }

  // Read back the real vectors, and re-read the source to detect a catalog edit
  // during generation. This never marks stale content as verified.
  const freshUnits = await readCatalog(db)
  const saved = byUnit(await readIndex(db))
  const invalid = freshUnits.map(unit => buildDocument(unit, project))
    .filter(doc => !canReuse(saved.get(doc.unit_id), doc))
  if (invalid.length) throw new Error(`No se pudieron verificar ${invalid.length} fichas; reejecute para actualizar.`)
  console.log(JSON.stringify({ verified: freshUnits.length, generated, reused: documents.length - pending.length,
    tokens, model: MODEL, dimensions: DIMENSIONS }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
