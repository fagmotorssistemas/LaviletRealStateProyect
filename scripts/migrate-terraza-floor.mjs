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

const path = 'edificio/floor-terraza-zones.json'
const { data, error } = await sb.storage.from('typology-assets').download(path)
if (error || !data) {
  console.log('no terraza zones yet', error?.message)
  process.exit(0)
}
const doc = JSON.parse(await data.text())
console.log('before floor=', doc.floor, 'zones=', doc.zones?.length ?? 0)
if (doc.floor !== 7) {
  doc.floor = 7
  doc.updatedAt = new Date().toISOString()
  const { error: upErr } = await sb.storage.from('typology-assets').upload(
    path,
    Buffer.from(JSON.stringify(doc), 'utf8'),
    { upsert: true, contentType: 'image/webp', cacheControl: '0' },
  )
  if (upErr) throw new Error(upErr.message)
  console.log('updated terraza doc floor → 7')
} else {
  console.log('already floor 7')
}
