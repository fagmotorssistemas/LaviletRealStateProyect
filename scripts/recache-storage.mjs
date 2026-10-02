/**
 * Vuelve a subir los objetos de typology-assets y video-lavilet
 * con Cache-Control de un año, sin re-encodear.
 * El JSON que se pisa en la misma ruta queda en 60 segundos.
 *
 *   node scripts/recache-storage.mjs          lista
 *   node scripts/recache-storage.mjs --apply  reescribe metadatos
 */
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const apply = process.argv.includes('--apply')
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

const BUCKETS = ['typology-assets', 'video-lavilet']

function hasVersion(name) {
  return (
    /-r\d{6,}/i.test(name) ||
    /-v\d{6,}/i.test(name) ||
    /_v\d{6,}/i.test(name) ||
    /(?:^|\/)\d{10,}-/.test(name)
  )
}

function cacheControl(path) {
  const name = path.split('/').pop() || path
  if (/\.json$/i.test(name) || /tour-hotspots\.webp$/i.test(name)) return '60'
  if (!hasVersion(name)) return '86400'
  return '31536000'
}

function contentType(path, fallback) {
  if (fallback) return fallback
  if (/\.mp4$/i.test(path)) return 'video/mp4'
  if (/\.m3u8$/i.test(path)) return 'application/vnd.apple.mpegurl'
  if (/\.m4s$/i.test(path)) return 'video/iso.segment'
  if (/\.webp$/i.test(path)) return 'image/webp'
  if (/\.png$/i.test(path)) return 'image/png'
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg'
  if (/\.json$/i.test(path)) return 'application/json'
  return 'application/octet-stream'
}

async function walk(bucket, prefix) {
  const files = []
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`)
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name
    if (!item.id) {
      files.push(...(await walk(bucket, path)))
      continue
    }
    files.push({
      path,
      type: item.metadata?.mimetype || contentType(path),
      cache: cacheControl(path),
    })
  }
  return files
}

let touched = 0
for (const bucket of BUCKETS) {
  const files = await walk(bucket, '')
  console.log(`${bucket}: ${files.length} objetos`)
  for (const file of files) {
    const name = file.path.split('/').pop() || ''
    if (!/^vista-/i.test(name)) continue
    console.log(`${apply ? 'sube' : 'pendiente'} ${bucket}/${file.path} cache=${file.cache}`)
    if (!apply) continue
    const { data, error } = await supabase.storage.from(bucket).download(file.path)
    if (error || !data) {
      console.error('descarga', file.path, error?.message)
      continue
    }
    const body = Buffer.from(await data.arrayBuffer())
    const { error: upErr } = await supabase.storage.from(bucket).upload(file.path, body, {
      upsert: true,
      contentType: file.type,
      cacheControl: file.cache,
    })
    if (upErr) console.error('subida', file.path, upErr.message)
    else touched += 1
  }
}
console.log(apply ? `listo: ${touched} objetos` : 'sin --apply no se modificó Storage')
