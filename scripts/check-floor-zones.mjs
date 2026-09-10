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
  auth: { persistSession: false },
})

const { data, error } = await sb.storage.from('typology-assets').list('edificio', { limit: 200 })
if (error) {
  console.error(error)
  process.exit(1)
}
console.log(
  data
    .map((x) => x.name)
    .sort()
    .join('\n'),
)

for (const floor of [4, 5]) {
  const path = `edificio/floor-${floor}-zones.json`
  const { data: file, error: dlErr } = await sb.storage.from('typology-assets').download(path)
  if (dlErr) {
    console.log(path, dlErr.message)
    continue
  }
  const doc = JSON.parse(await file.text())
  console.log(
    `\nfloor ${floor}: zones=${doc.zones.map((z) => z.id).join(',')}`,
  )
  console.log('  image', doc.imageUrl)
  console.log('  2d', doc.variants?.['2d']?.imageUrl)
}
