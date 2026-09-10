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

const { data: before, error: getErr } = await sb.storage.getBucket('typology-assets')
if (getErr) {
  console.error('getBucket', getErr)
  process.exit(1)
}
console.log('before', {
  public: before.public,
  allowedMimeTypes: before.allowed_mime_types,
  fileSizeLimit: before.file_size_limit,
})

const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/jpg',
]

const { data: after, error: upErr } = await sb.storage.updateBucket('typology-assets', {
  public: true,
  allowedMimeTypes,
  fileSizeLimit: before.file_size_limit ?? 52428800,
})
if (upErr) {
  console.error('updateBucket', upErr)
  process.exit(1)
}
console.log('after', {
  public: after?.public ?? '(ok)',
  allowedMimeTypes: after?.allowed_mime_types ?? allowedMimeTypes,
})

// Verify with a tiny jpeg upload/remove
const tinyJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
  'base64',
)
const testPath = 'edificio/_mime-test.jpg'
const { error: upFileErr } = await sb.storage.from('typology-assets').upload(testPath, tinyJpeg, {
  upsert: true,
  contentType: 'image/jpeg',
})
console.log('jpeg upload test', upFileErr?.message || 'ok')
await sb.storage.from('typology-assets').remove([testPath])
