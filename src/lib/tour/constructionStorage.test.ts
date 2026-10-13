import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import {
  constructionFileType,
  constructionPublicPath,
} from './constructionStorage'

const admin = createClient('https://example.supabase.co', 'test-key')
const name = '123e4567-e89b-42d3-a456-426614174000'
const publicUrl = (path: string) => admin.storage.from(TYPOLOGY_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl

test('solo acepta formatos de foto y video compatibles', () => {
  assert.equal(constructionFileType('obra.jpg', 'image/jpeg'), 'image')
  assert.equal(constructionFileType('obra.mov', 'video/quicktime'), 'video')
  assert.equal(constructionFileType('obra.exe', 'application/octet-stream'), null)
  assert.equal(constructionFileType('obra.mp4', 'image/png'), null)
})

test('una entrada solo puede referenciar archivos publicados en su propio bucket', () => {
  const image = { type: 'image' as const, url: publicUrl(`obra/${name}.webp`), caption: '' }
  assert.equal(constructionPublicPath(admin, image), `obra/${name}.webp`)
  assert.equal(constructionPublicPath(admin, { ...image, type: 'video' }), null)
  assert.equal(constructionPublicPath(admin, { ...image, url: publicUrl(`obra/_original/${name}.webp`) }), null)
  assert.equal(constructionPublicPath(admin, { ...image, url: publicUrl(`amenidades/${name}.webp`) }), null)
  assert.equal(constructionPublicPath(admin, { ...image, url: `${image.url}?download=1` }), null)
  assert.equal(constructionPublicPath(admin, { ...image, url: 'https://otro.example/obra/foto.webp' }), null)
})
