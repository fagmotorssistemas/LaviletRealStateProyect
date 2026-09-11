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
const MAX_W = 2400

const { data, error } = await sb.storage.from(BUCKET).download('edificio/floor-4-plan.webp')
if (error || !data) throw new Error(error?.message || 'no webp')
const buf = Buffer.from(await data.arrayBuffer())
const out = await sharp(buf, { limitInputPixels: false })
  .resize({ width: MAX_W, withoutEnlargement: true })
  .webp({ quality: 90 })
  .toBuffer()
const meta = await sharp(out, { limitInputPixels: false }).metadata()

const path = 'edificio/floor-4-plan.webp'
const { error: up } = await sb.storage.from(BUCKET).upload(path, out, {
  upsert: true,
  contentType: 'image/webp',
  cacheControl: '86400',
})
if (up) throw new Error(up.message)

const url = `${PUBLIC}/${path}`
const zonesPath = 'edificio/floor-4-zones.json'
const { data: zf } = await sb.storage.from(BUCKET).download(zonesPath)
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
const { error: zonesUp } = await sb.storage.from(BUCKET).upload(
  zonesPath,
  Buffer.from(JSON.stringify(doc), 'utf8'),
  {
    upsert: true,
    // El bucket solo admite imágenes; mismo truco que saveFloorPlanZones.
    contentType: 'image/webp',
    cacheControl: '60',
  },
)
if (zonesUp) throw new Error(`zones: ${zonesUp.message}`)

const h = await fetch(url + '?t=' + Date.now())
const imgBuf = Buffer.from(await h.arrayBuffer())
const check = await sharp(imgBuf, { limitInputPixels: false }).metadata()
console.log('ok', check.width, check.height, imgBuf.length, doc.updatedAt)
