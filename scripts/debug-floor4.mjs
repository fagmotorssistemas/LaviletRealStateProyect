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

async function check(floor) {
  const path = `edificio/floor-${floor}-zones.json`
  const { data, error } = await sb.storage.from('typology-assets').download(path)
  if (error) {
    console.log(floor, 'DOWNLOAD ERR', error.message)
    return
  }
  const text = await data.text()
  let doc
  try {
    doc = JSON.parse(text)
  } catch (e) {
    console.log(floor, 'JSON ERR', e.message, 'bytes', text.length, 'head', text.slice(0, 80))
    return
  }
  console.log('\n=== floor', floor, '===')
  console.log('floor field', doc.floor)
  console.log('typologyCode', doc.typologyCode)
  console.log('imageUrl', doc.imageUrl)
  console.log('2d', doc.variants?.['2d']?.imageUrl)
  console.log('dims', doc.imageWidth, doc.imageHeight, '2d', doc.variants?.['2d']?.imageWidth, doc.variants?.['2d']?.imageHeight)
  console.log('zones', doc.zones?.length, (doc.zones || []).map((z) => z.id).join(','))
  const img = doc.variants?.['2d']?.imageUrl || doc.imageUrl
  if (img) {
    const clean = String(img).split('?')[0]
    const res = await fetch(clean, { method: 'HEAD' })
    console.log('image HEAD', res.status, res.headers.get('content-type'), clean)
  }
}

for (const f of [3, 4, 5]) await check(f)

const { data: list } = await sb.storage.from('typology-assets').list('edificio', { limit: 100 })
console.log('\nfiles', (list || []).map((x) => x.name).filter((n) => /floor-4|floor-3/.test(n)).sort().join(', '))
