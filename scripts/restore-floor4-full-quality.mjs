/**
 * Restaura floor-4-plan.webp a resolución completa (misma calidad que piso 3).
 * El montaje solo del piso activo evita el OOM; no hace falta bajar a 2400px.
 */
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const env = {}
for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(k in env)) env[k] = v
  }
}
const key =
  String(env.SUPABASE_SERVICE_ROLE_KEY || '').match(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  )?.[0] || env.SUPABASE_SERVICE_ROLE_KEY
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const BUCKET = 'typology-assets'
const PUBLIC = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}`

const { data: src, error: dlErr } = await sb.storage.from(BUCKET).download('edificio/floor-3-plan.webp')
if (dlErr || !src) throw new Error(dlErr?.message || 'no floor-3 webp')
const input = Buffer.from(await src.arrayBuffer())
const meta = await sharp(input, { limitInputPixels: false }).metadata()
console.log('source', meta.width, meta.height, input.length)

// Re-encode a calidad alta sin bajar resolución.
const webp = await sharp(input, { limitInputPixels: false })
  .webp({ quality: 92, effort: 4, smartSubsample: true })
  .toBuffer()

const path = 'edificio/floor-4-plan.webp'
const { error: up } = await sb.storage.from(BUCKET).upload(path, webp, {
  upsert: true,
  contentType: 'image/webp',
  cacheControl: '86400',
})
if (up) throw new Error(up.message)

const url = `${PUBLIC}/${path}`
const zonesPath = 'edificio/floor-4-zones.json'
const { data: zf, error: zErr } = await sb.storage.from(BUCKET).download(zonesPath)
if (zErr || !zf) throw new Error(zErr?.message || 'no zones')
const doc = JSON.parse(await zf.text())
doc.imageUrl = url
doc.imageWidth = meta.width || doc.imageWidth
doc.imageHeight = meta.height || doc.imageHeight
doc.variants = {
  '2d': {
    imageUrl: url,
    imageWidth: meta.width || doc.imageWidth,
    imageHeight: meta.height || doc.imageHeight,
  },
  '3d': doc.variants?.['3d'] || { imageUrl: null, imageWidth: 1, imageHeight: 1 },
}
doc.updatedAt = new Date().toISOString()
const { error: zUp } = await sb.storage.from(BUCKET).upload(
  zonesPath,
  Buffer.from(JSON.stringify(doc), 'utf8'),
  { upsert: true, contentType: 'image/webp', cacheControl: '60' },
)
if (zUp) throw new Error(zUp.message)

const check = await sharp(webp, { limitInputPixels: false }).metadata()
console.log('restored', check.width, check.height, webp.length, doc.updatedAt)
