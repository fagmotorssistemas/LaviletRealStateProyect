import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('Lead se persiste únicamente después de confirmar tour_info_requests', () => {
  const source = readFileSync('src/app/api/tour/lead/route.ts', 'utf8')
  assert.match(source, /emitLead:\s*false/)
  const registered = source.indexOf('await rpcRegisterTourInfoRequest')
  const verified = source.indexOf(".from('tour_info_requests')", registered)
  const persisted = source.indexOf('await persistMetaConversion', verified)
  assert.ok(registered >= 0 && verified > registered && persisted > verified)
  assert.match(source, /idempotencyKey:\s*`lead:\$\{leadId\}`/)
})

test('AddToWishlist exige evidencia durable, contacto y unidad del proyecto', () => {
  const source = readFileSync('src/app/api/meta/wishlist/route.ts', 'utf8')
  assert.match(source, /\.from\('tour_events'\)/)
  assert.match(source, /\.contains\('metadata', \{ action: 'save', unit_id: unitId \}\)/)
  assert.match(source, /\.eq\('project_id', TOUR_PROJECT_ID\)/)
  assert.match(source, /\.eq\('lead_id', resolvedLeadId\)/)
})

test('Pixel espera el event_id canónico del servidor', () => {
  for (const file of [
    'src/components/marketing/MetaViewContentUnit.tsx',
    'src/components/marketing/MetaViewContentShowroom.tsx',
    'src/lib/meta/wishlistBrowser.ts',
  ]) {
    const source = readFileSync(file, 'utf8')
    const fetchAt = source.indexOf("fetch('/api/meta/")
    const pixelAt = source.indexOf("trackMetaPixelEvent(", fetchAt)
    assert.ok(fetchAt >= 0 && pixelAt > fetchAt, file)
  }
})
