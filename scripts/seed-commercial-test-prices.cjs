// User-authorized fictional launch prices for La Vilet's commercial units.
// Preview by default. Leaves existing prices intact and checks concurrent edits.
require('@next/env').loadEnvConfig(process.cwd())
const fs = require('node:fs')
const { createClient } = require('@supabase/supabase-js')
const scope = { tenant_id: 'a1b2c3d4-0001-4000-8000-000000000001', project_id: 'b1b2c3d4-0001-4000-8000-000000000001' }
async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data, error } = await db.from('units')
    .select('id,unit_number,category,area_internal_m2,area_exterior_m2,published_commercial_price,updated_at')
    .match(scope).eq('category', 'local').order('unit_number')
  if (error) throw Error(error.message)
  if (data.length !== 16 || data.some(u => !/^LC-\d{2}$/.test(u.unit_number) || Number(u.area_internal_m2) <= 0)) throw Error('CATALOG_MISMATCH')
  const plan = data.filter(u => u.published_commercial_price === null).map(unit => ({ unit,
    // Test data only; this formula is not a property valuation.
    price: Math.round((Number(unit.area_internal_m2) * 3000 + Number(unit.area_exterior_m2 || 0) * 800) / 5000) * 5000,
  }))
  console.table(plan.map(({ unit, price }) => ({ local: unit.unit_number, precio_ficticio_usd: price })))
  if (!process.argv.includes('--apply')) return console.log('Vista previa. Use --apply para guardar únicamente los precios vacíos.')
  fs.mkdirSync('tmp', { recursive: true })
  const backup = `tmp/commercial-test-prices-${Date.now()}.json`
  fs.writeFileSync(backup, JSON.stringify({ scope, reason: 'Valores ficticios solicitados para pruebas', plan }, null, 2))
  for (const { unit, price } of plan) {
    const { data: updated, error } = await db.from('units').update({ published_commercial_price: price, updated_at: new Date().toISOString() })
      .match(scope).eq('id', unit.id).eq('category', 'local').eq('updated_at', unit.updated_at)
      .is('published_commercial_price', null).select('id,published_commercial_price').single()
    if (error || updated?.published_commercial_price !== price) throw Error(`PRICE_UPDATE_FAILED: ${unit.unit_number}`)
  }
  const { data: verified, error: verifyError } = await db.from('units').select('unit_number,published_commercial_price').match(scope).eq('category', 'local')
  if (verifyError || verified.length !== 16 || verified.some(u => !Number(u.published_commercial_price))) throw Error('PRICE_VERIFICATION_FAILED')
  console.log(`${plan.length} precios ficticios guardados y verificados. Respaldo: ${backup}`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
