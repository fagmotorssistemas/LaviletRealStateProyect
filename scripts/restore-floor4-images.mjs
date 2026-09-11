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

const { data: webpFile, error } = await sb.storage.from(BUCKET).download('edificio/floor-4-plan.webp')
if (error || !webpFile) throw new Error(error?.message || 'no webp')
const webpBuf = Buffer.from(await webpFile.arrayBuffer())
const meta = await sharp(webpBuf, { limitInputPixels: false }).metadata()

// Restaurar JPG por si el browser/CDN cacheó la URL vieja.
const jpg = await sharp(webpBuf, { limitInputPixels: false })
  .jpeg({ quality: 92, mozjpeg: true })
  .toBuffer()

for (const [path, buf, type] of [
  ['edificio/floor-4-plan.webp', webpBuf, 'image/webp'],
  ['edificio/floor-4-plan.jpg', jpg, 'image/jpeg'],
]) {
  const { error: up } = await sb.storage.from(BUCKET).upload(path, buf, {
    upsert: true,
    contentType: type,
    cacheControl: '86400',
  })
  if (up) throw new Error(`${path}: ${up.message}`)
  console.log('ok', path, buf.length)
}

const webpUrl = `${PUBLIC}/edificio/floor-4-plan.webp`
const zonesPath = 'edificio/floor-4-zones.json'
const { data: zonesFile } = await sb.storage.from(BUCKET).download(zonesPath)
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
await sb.storage.from(BUCKET).upload(zonesPath, Buffer.from(JSON.stringify(doc), 'utf8'), {
  upsert: true,
  contentType: 'image/webp',
  cacheControl: '60',
})

for (const u of [webpUrl, `${PUBLIC}/edificio/floor-4-plan.jpg`]) {
  const h = await fetch(u, { method: 'HEAD' })
  console.log(h.status, h.headers.get('content-type'), u)
}
console.log('zones updatedAt', doc.updatedAt)
