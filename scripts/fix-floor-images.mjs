import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

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

async function downloadText(path) {
  const { data, error } = await sb.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(error?.message || 'no data')
  return await data.text()
}

const source = JSON.parse(await downloadText('edificio/floor-3-zones.json'))
const w = source.imageWidth || 1
const h = source.imageHeight || 1

for (const floor of [4, 5]) {
  const path = `edificio/floor-${floor}-zones.json`
  const current = JSON.parse(await downloadText(path))
  const planUrl = `${PUBLIC}/edificio/floor-${floor}-plan.webp?v=${Date.now()}`
  const cleanUrl = `${PUBLIC}/edificio/floor-${floor}-plan.webp`

  const doc = {
    ...current,
    floor,
    typologyCode: 'edificio',
    imageUrl: cleanUrl,
    imageWidth: w,
    imageHeight: h,
    variants: {
      '2d': { imageUrl: cleanUrl, imageWidth: w, imageHeight: h },
      '3d': { imageUrl: null, imageWidth: 1, imageHeight: 1 },
    },
    zones: current.zones,
    updatedAt: new Date().toISOString(),
    _marker: `fixed-images-${floor}-${Date.now()}`,
  }

  // Remove then upload to avoid stale upsert quirks
  const { error: delErr } = await sb.storage.from(BUCKET).remove([path])
  console.log('remove', path, delErr?.message || 'ok')

  const payload = Buffer.from(JSON.stringify(doc), 'utf8')
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, payload, {
    upsert: true,
    contentType: 'image/webp',
    cacheControl: '0',
  })
  if (upErr) throw new Error(upErr.message)

  const raw = await downloadText(path)
  const verify = JSON.parse(raw)
  console.log(`floor ${floor}`)
  console.log('  marker', verify._marker)
  console.log('  zones', verify.zones.map((z) => z.id).join(', '))
  console.log('  image', verify.imageUrl)
  console.log('  2d', verify.variants?.['2d']?.imageUrl)
  console.log('  contains floor-3?', raw.includes('floor-3-plan'))
}
