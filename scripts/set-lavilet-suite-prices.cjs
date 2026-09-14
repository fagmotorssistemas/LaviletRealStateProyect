// One-time price scale requested on 2026-09-13. No valuation or automatic repricing.
// Preview: node scripts/set-lavilet-suite-prices.cjs
// Apply:   node scripts/set-lavilet-suite-prices.cjs --apply
// Only fills blank prices; never replaces an existing different price.
require('@next/env').loadEnvConfig(process.cwd())
const { createClient } = require('@supabase/supabase-js')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const assert = require('node:assert/strict')
const scope = { tenant_id: 'a1b2c3d4-0001-4000-8000-000000000001', project_id: 'b1b2c3d4-0001-4000-8000-000000000001' }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const columns = 'id,unit_number,category,floor_number,published_commercial_price,is_published,status,updated_at'
const amounts = { 0: 210000, 2: 250000, 3: 270000, 4: 290000, 5: 310000, 6: 550000 }
const expectedCounts = { 0: 2, 2: 10, 3: 8, 4: 8, 5: 8, 6: 6 }
const apply = process.argv.includes('--apply')
const applied = []
const load = async () => {
  const { data, error } = await db.from('units').select(columns).match(scope).order('unit_number').limit(1000).abortSignal(AbortSignal.timeout(15000))
  if (error) throw Error(error.message)
  assert.ok(data.length < 1000, 'Catalog exceeds the bounded operation; review scope first')
  return data
}
async function main() {
  const before = await load()
  const targets = before.filter(unit => unit.category === 'suite' || (unit.category === 'departamento' && /^6\d{2}$/.test(unit.unit_number)))
  const counts = Object.fromEntries(Object.keys(expectedCounts).map(floor => [floor, targets.filter(unit => unit.floor_number === Number(floor)).length]))
  assert.deepEqual(counts, expectedCounts, 'Inventory differs from reviewed scope; inspect before changing prices')
  assert.equal(targets.length, 42)
  for (const unit of targets) {
    const price = amounts[unit.floor_number]
    assert.ok(price > 200000 && (!unit.unit_number.startsWith('6') || price > 500000))
    assert.ok(unit.published_commercial_price == null || unit.published_commercial_price === price, `Existing price for ${unit.unit_number} must be reviewed manually`)
  }
  console.log(JSON.stringify({ apply, scope: 'La Vilet: 36 suites and units 601-606', scale: Object.entries(counts).map(([floor, count]) => ({ floor: Number(floor), count, price: amounts[floor] })), changes: targets.filter(unit => unit.published_commercial_price !== amounts[unit.floor_number]).length }))
  if (!apply) return
  const directory = join(process.cwd(), 'tmp')
  mkdirSync(directory, { recursive: true })
  const backup = join(directory, `lavilet-prices-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(backup, JSON.stringify({ scope, created_at: new Date().toISOString(), units: before }, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ backup }))
  for (const unit of targets) {
    const price = amounts[unit.floor_number]
    if (unit.published_commercial_price === price) continue
    const { data, error } = await db.from('units').update({ published_commercial_price: price, updated_at: new Date().toISOString() })
      .match(scope).eq('id', unit.id).eq('updated_at', unit.updated_at).is('published_commercial_price', null)
      .select('id').maybeSingle().abortSignal(AbortSignal.timeout(15000))
    if (error || !data) throw Error(`Could not update ${unit.unit_number}: ${error?.message || 'concurrent edit detected'}`)
    applied.push(unit.unit_number)
  }
  const after = await load()
  assert.equal(after.length, before.length)
  for (const previous of before) {
    const current = after.find(unit => unit.id === previous.id)
    assert.ok(current, `Missing unit ${previous.unit_number}`)
    if (targets.some(unit => unit.id === previous.id)) {
      assert.equal(current.published_commercial_price, amounts[previous.floor_number])
      assert.deepEqual({ ...current, published_commercial_price: previous.published_commercial_price, updated_at: previous.updated_at }, previous)
    } else assert.deepEqual(current, previous, `Untargeted unit changed: ${previous.unit_number}`)
  }
  const { data: config, error } = await db.from('project_automation_config').select('mode').match(scope).maybeSingle()
  if (error) throw Error(error.message)
  console.log(JSON.stringify({ verified: true, updated: applied.length, targeted: targets.length, untouched: before.length - targets.length, mode: config?.mode, units: applied }))
}
main().catch(error => { console.error(JSON.stringify({ error: error.message, updatedBeforeError: applied })); process.exitCode = 1 })
