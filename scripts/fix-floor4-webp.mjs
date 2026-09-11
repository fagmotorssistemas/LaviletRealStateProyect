/**
 * Convierte floor-4-plan.jpg → webp alta calidad y actualiza zones.json.
 * El JPEG 6k+ colgaba el decode() del showroom.
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

const { data: jpg, error: dlErr } = await sb.storage
  .from(BUCKET)
  .download('edificio/floor-4-plan.jpg')
if (dlErr || !jpg) throw new Error(dlErr?.message || 'no jpg')

const input = Buffer.from(await jpg.arrayBuffer())
console.log('jpg bytes', input.length)

const meta = await sharp(input, { limitInputPixels: false }).metadata()
console.log('meta', meta.width, meta.height, meta.format)

// WebP calidad alta (casi visualmente lossless para planos).
const webp = await sharp(input, { limitInputPixels: false })
  .webp({ quality: 92, effort: 4, smartSubsample: true })
  .toBuffer()
console.log('webp bytes', webp.length)

const webpPath = 'edificio/floor-4-plan.webp'
const { error: upErr } = await sb.storage.from(BUCKET).upload(webpPath, webp, {
  upsert: true,
  contentType: 'image/webp',
  cacheControl: '86400',
})
if (upErr) throw new Error(upErr.message)

const webpUrl = `${PUBLIC}/${webpPath}`
const zonesPath = 'edificio/floor-4-zones.json'
const { data: zonesFile, error: zErr } = await sb.storage.from(BUCKET).download(zonesPath)
if (zErr || !zonesFile) throw new Error(zErr?.message || 'no zones')
const doc = JSON.parse(await zonesFile.text())
doc.imageUrl = webpUrl
doc.imageWidth = meta.width || doc.imageWidth
doc.imageHeight = meta.height || doc.imageHeight
doc.variants = {
  '2d': {
    imageUrl: webpUrl,
    imageWidth: meta.width || doc.imageWidth,
    imageHeight: meta.height || doc.imageHeight,
  },
  '3d': doc.variants?.['3d'] || { imageUrl: null, imageWidth: 1, imageHeight: 1 },
}
doc.updatedAt = new Date().toISOString()

const { error: zUp } = await sb.storage.from(BUCKET).upload(
  zonesPath,
  Buffer.from(JSON.stringify(doc), 'utf8'),
  { upsert: true, contentType: 'image/webp', cacheControl: '300' },
)
if (zUp) throw new Error(zUp.message)

// Quitar jpg viejo para no confundir.
await sb.storage.from(BUCKET).remove(['edificio/floor-4-plan.jpg'])

const verify = await fetch(webpUrl, { method: 'HEAD' })
console.log('webp HEAD', verify.status, verify.headers.get('content-type'))
console.log('zones image', doc.variants['2d'].imageUrl)
console.log('done')
