/**
 * Re-procesa typology_assets ya subidos.
 * Ambientes 360: WebP q92 y variantes 2048, 4096 y 8192.
 * Renders: lado mayor 3200, WebP q88.
 * Planos: WebP q90.
 *
 *   node scripts/reencode-existing-assets.mjs
 *   node scripts/reencode-existing-assets.mjs --apply --scene=1A:dormitorio_nogal_dia
 *
 * --apply sin --scene no toca Storage.
 */
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const apply = process.argv.includes('--apply')
const scenes = new Set(
  process.argv.filter((arg) => arg.startsWith('--scene=')).map((arg) => arg.slice('--scene='.length)),
)
const env = {}
for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    const key = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in env)) env[key] = value
  }
}
const serviceKey =
  String(env.SUPABASE_SERVICE_ROLE_KEY || '').match(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  )?.[0] || env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const WIDTHS = [4096, 2048]
const SHARP_OPTS = { limitInputPixels: 268_402_689, failOn: 'none' }
sharp.concurrency(1)

function sceneBase(fileName) {
  return fileName.replace(/\.[^.]+$/, '').replace(/-r\d+$/i, '').replace(/_(2048|4096|8192)$/i, '')
}

async function toWebp(buffer, mode) {
  let pipeline = sharp(buffer, SHARP_OPTS).rotate()
  if (mode === 'quality') {
    pipeline = pipeline.resize(3200, 3200, { fit: 'inside', withoutEnlargement: true })
    return pipeline.webp({ quality: 88, effort: 4, smartSubsample: true }).toBuffer()
  }
  if (mode === 'plan') {
    return pipeline.webp({ quality: 90, effort: 4, smartSubsample: true }).toBuffer()
  }
  pipeline = pipeline.resize(8192, null, { fit: 'inside', withoutEnlargement: true })
  return pipeline.webp({ quality: 92, effort: 4, smartSubsample: true }).toBuffer()
}

async function variant(buffer, width) {
  return sharp(buffer, SHARP_OPTS)
    .rotate()
    .resize(width, null, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 92, effort: 4, smartSubsample: true })
    .toBuffer()
}

const { data: rows, error } = await supabase
  .from('typology_assets')
  .select('id, typology_code, kind, file_name, storage_path, created_at')
  .order('created_at', { ascending: false })
if (error) {
  console.error(error.message)
  process.exit(1)
}

const groups = new Map()
for (const row of rows ?? []) {
  const key = `${row.typology_code}:${row.kind}:${sceneBase(row.file_name)}`
  const list = groups.get(key) ?? []
  list.push(row)
  groups.set(key, list)
}

if (apply && scenes.size === 0) {
  console.error('Falta --scene=CODIGO:base. --apply sin escenas no modifica Storage.')
  process.exit(1)
}

let planned = 0
for (const [key, list] of groups) {
  const [code, , baseName] = key.split(':')
  if (scenes.size > 0 && !scenes.has(`${code}:${baseName}`)) continue
  const unsized = list.filter((row) => !/_(2048|4096|8192)(-r\d+)?\./i.test(row.file_name))
  const master =
    unsized.find((row) => /\.(png|jpe?g)$/i.test(row.file_name)) ?? unsized[0] ?? list[0]
  if (!master?.storage_path) continue
  const panorama = /^(sala|dormitorio(?:-\d+)?)_/.test(baseName)
  const mode = panorama || master.kind === 'ambiente' ? 'lossless' : master.kind === 'plano' ? 'plan' : 'quality'
  planned += 1
  console.log(`${apply ? 'procesa' : 'pendiente'} ${key} ← ${master.file_name} (${mode})`)
  if (!apply) continue

  const { data: blob, error: dlErr } = await supabase.storage.from('typology-assets').download(master.storage_path)
  if (dlErr || !blob) {
    console.error('descarga', master.storage_path, dlErr?.message)
    continue
  }
  const source = Buffer.from(await blob.arrayBuffer())
  const revision = Date.now()
  const base = sceneBase(master.file_name)
  const folder = master.storage_path.split('/').slice(0, -1).join('/')
  const keep = new Set()
  const publish = async (name, buffer) => {
    const path = `${folder}/${name}`
    const { error: upErr } = await supabase.storage.from('typology-assets').upload(path, buffer, {
      upsert: true,
      contentType: 'image/webp',
      cacheControl: '31536000',
    })
    if (upErr) throw new Error(upErr.message || name)
    const { error: insErr } = await supabase.from('typology_assets').insert({
      typology_code: master.typology_code,
      kind: master.kind,
      file_name: name,
      storage_path: path,
    })
    if (insErr) throw new Error(insErr.message || name)
    keep.add(name)
  }
  try {
    const baseBuffer = await toWebp(source, mode)
    await publish(`${base}-r${revision}.webp`, baseBuffer)
    if (mode === 'lossless') {
      for (const width of WIDTHS) {
        await publish(`${base}_${width}-r${revision}.webp`, await variant(source, width))
      }
      await publish(`${base}_8192-r${revision}.webp`, baseBuffer)
    }
  } catch (error) {
    console.error('pendiente', key, error instanceof Error ? error.message : error)
    continue
  }
  for (const row of list) {
    if (keep.has(row.file_name)) continue
    await supabase.storage.from('typology-assets').remove([row.storage_path])
    await supabase.from('typology_assets').delete().eq('id', row.id)
  }
}
console.log(apply ? `grupos procesados: ${planned}` : `${planned} grupos. Sin --apply no se modificó nada.`)
