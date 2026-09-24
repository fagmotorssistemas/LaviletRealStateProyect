import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('fixtures locales cumplen el sobre y las fuentes de los seis eventos', () => {
  const rows = JSON.parse(readFileSync('docs/CAPI_LOCAL_TEST_PAYLOADS.json', 'utf8')) as Array<Record<string, unknown>>
  const events = new Set(rows.map((row) => row.event_name))
  for (const name of ['ViewContent', 'Lead', 'AddToWishlist', 'Schedule', 'LeadSubmitted', 'Purchase']) assert.ok(events.has(name))
  for (const row of rows) {
    assert.match(String(row.event_id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    assert.equal(row.delivery_lane, 'test')
    assert.equal(typeof row.event_time, 'number')
    assert.ok(Number(row.event_time) > 0)
  }
  const bm = rows.find((row) => row.event_name === 'LeadSubmitted')!
  assert.equal(bm.action_source, 'business_messaging')
  assert.equal(bm.messaging_channel, 'whatsapp')
  assert.notEqual(bm.whatsapp_business_account_id, bm.messaging_dataset_id)
  const purchase = rows.find((row) => row.event_name === 'Purchase')!
  assert.equal(purchase.action_source, 'system_generated')
  assert.equal(purchase.event_time, Math.floor(Date.parse(String(purchase.sale_at)) / 1000))
})

test('Purchase no sustituye fechas persistidas por la hora actual', () => {
  const source = readFileSync('src/lib/meta/purchaseCapture.ts', 'utf8')
  assert.match(source, /from\('unit_sales_closings'\)/)
  assert.doesNotMatch(source, /Date\.now\(|new Date\(\)\.toISOString/)
  assert.match(source, /purchase_registered_at_required/)
  assert.match(source, /purchase_sale_at_required/)
})
