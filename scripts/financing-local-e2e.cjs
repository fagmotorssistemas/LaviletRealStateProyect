/**
 * Pruebas REALES de persistencia contra Next + Supabase local.
 * Entorno: supabase-local (API http://127.0.0.1:54331) + Next en BASE_URL.
 *
 * Uso:
 *   node --require ./scripts/test-typescript.cjs scripts/financing-local-e2e.cjs
 */
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const PARTNER_ID = 'c1c1c1c1-0001-4000-8000-000000000001'
const UNIT_ID = 'e1e1e1e1-0001-4000-8000-000000000101'

function parseSetCookie(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const jar = {}
  for (const line of raw) {
    const [pair] = line.split(';')
    const i = pair.indexOf('=')
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
  }
  return jar
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

async function identifyVisitor(label, phone) {
  const visitorKey = randomUUID()
  const jar = { lv_vid: visitorKey }
  // warm session optional
  const leadRes = await fetch(`${BASE}/api/tour/lead`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookieHeader(jar),
    },
    body: JSON.stringify({
      mode: 'phone',
      phone,
      consent: true,
      visitor_key: visitorKey,
      unit_id: UNIT_ID,
      unit_number: '101',
    }),
  })
  const leadJson = await leadRes.json()
  Object.assign(jar, parseSetCookie(leadRes))
  jar.lv_vid = visitorKey
  assert.equal(leadRes.status, 200, `${label} identify: ${JSON.stringify(leadJson)}`)
  assert.ok(leadJson.lead_id, `${label} sin lead_id`)
  return { label, phone, visitorKey, leadId: leadJson.lead_id, jar }
}

async function postScenario(visitor, body) {
  const res = await fetch(`${BASE}/api/financing/scenarios`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookieHeader(visitor.jar),
    },
    body: JSON.stringify({
      unit_id: UNIT_ID,
      project_id: 'b1b2c3d4-0001-4000-8000-000000000001',
      phone: visitor.phone,
      lead_id: visitor.leadId,
      ...body,
    }),
  })
  const json = await res.json()
  return { res, json }
}

async function listScenarios(visitor, overrides = {}) {
  const qs = new URLSearchParams()
  if (overrides.phone ?? visitor.phone) qs.set('phone', overrides.phone ?? visitor.phone)
  if (overrides.lead_id ?? visitor.leadId) qs.set('lead_id', overrides.lead_id ?? visitor.leadId)
  const headers = {}
  if (overrides.cookie !== null) {
    headers.cookie =
      overrides.cookie === undefined
        ? cookieHeader(visitor.jar)
        : overrides.cookie
  }
  const res = await fetch(`${BASE}/api/financing/scenarios?${qs}`, { headers })
  const json = await res.json()
  return { res, json }
}

async function deleteScenario(visitor, id, overrides = {}) {
  const qs = new URLSearchParams({ id })
  if (overrides.phone ?? visitor.phone) qs.set('phone', overrides.phone ?? visitor.phone)
  if (overrides.lead_id ?? visitor.leadId) qs.set('lead_id', overrides.lead_id ?? visitor.leadId)
  const headers = {}
  if (overrides.cookie !== null) {
    headers.cookie =
      overrides.cookie === undefined ? cookieHeader(visitor.jar) : overrides.cookie
  }
  const res = await fetch(`${BASE}/api/financing/scenarios?${qs}`, {
    method: 'DELETE',
    headers,
  })
  const json = await res.json().catch(() => ({}))
  return { res, json }
}

async function main() {
  console.log('E2E financing local →', BASE)

  const a = await identifyVisitor('A', '0999111001')
  const b = await identifyVisitor('B', '0999222002')
  console.log('identidades', { a: a.leadId, b: b.leadId })

  // Contado
  const cash = await postScenario(a, {
    mode: 'cash',
    estimated_monthly_rent: 1200,
    vacancy_rate: 0.05,
    annual_expenses: 4280,
    annual_management: 0,
    unit_price: 310000,
    expense_breakdown: {
      propertyTax: 310,
      maintenance: 2400,
      insurance: 1570,
      other: 0,
      total: 4280,
    },
  })
  assert.equal(cash.res.status, 200, JSON.stringify(cash.json))
  assert.equal(cash.json.preview.mode, 'cash')
  assert.equal(cash.json.scenario.simulation_mode, 'cash')
  assert.equal(Number(cash.json.scenario.vacancy_rate_snapshot), 0.05)
  assert.equal(Number(cash.json.scenario.annual_net_cash_flow), 9400)
  assert.equal(cash.json.scenario.calculation_version, 'investment-v2')
  const cashId = cash.json.scenario.id

  // Financiado
  const fin = await postScenario(a, {
    mode: 'financed',
    financing_partner_id: PARTNER_ID,
    down_payment_percent: 30,
    financing_years: 30,
    estimated_monthly_rent: 1200,
    vacancy_rate: 0.05,
    annual_expenses: 4280,
    applied_interest_rate: 7.8,
    rate_type: 'nominal_annual',
    unit_price: 310000,
  })
  assert.equal(fin.res.status, 200, JSON.stringify(fin.json))
  assert.equal(fin.json.preview.mode, 'financed')
  assert.ok(Math.abs(Number(fin.json.scenario.monthly_payment) - 1562.12) < 0.05)
  assert.ok(Math.abs(Number(fin.json.scenario.annual_net_cash_flow) + 9345.44) < 0.15)
  assert.equal(Number(fin.json.scenario.applied_interest_rate), 7.8)
  const finId = fin.json.scenario.id

  // Manual
  const man = await postScenario(a, {
    mode: 'manual',
    financing_partner_id: null,
    down_payment_percent: 40,
    financing_years: 25,
    estimated_monthly_rent: 1100,
    vacancy_rate: 0.08,
    annual_expenses: 5000,
    applied_interest_rate: 9.25,
    rate_type: 'effective_annual',
    unit_price: 310000,
  })
  assert.equal(man.res.status, 200, JSON.stringify(man.json))
  assert.equal(man.json.preview.mode, 'manual')
  assert.equal(man.json.scenario.simulation_mode, 'manual')
  assert.equal(Number(man.json.scenario.applied_interest_rate), 9.25)
  assert.equal(man.json.scenario.rate_type, 'effective_annual')
  assert.equal(Number(man.json.scenario.vacancy_rate_snapshot), 0.08)
  const manId = man.json.scenario.id

  // Reabrir vía GET: supuestos presentes
  const listed = await listScenarios(a)
  assert.equal(listed.res.status, 200)
  assert.equal(listed.json.identified, true)
  const ids = (listed.json.scenarios || []).map((s) => s.id)
  assert.ok(ids.includes(cashId) && ids.includes(finId) && ids.includes(manId))
  const reopenedManual = listed.json.scenarios.find((s) => s.id === manId)
  assert.equal(reopenedManual.simulation_mode, 'manual')
  assert.equal(Number(reopenedManual.applied_interest_rate), 9.25)
  assert.equal(Number(reopenedManual.annual_expenses), 5000)

  // B guarda uno propio
  const bCash = await postScenario(b, {
    mode: 'cash',
    estimated_monthly_rent: 900,
    vacancy_rate: 0,
    annual_expenses: 1000,
    unit_price: 200000,
  })
  assert.equal(bCash.res.status, 200, JSON.stringify(bCash.json))
  const bId = bCash.json.scenario.id

  // A no ve escenarios de B
  const aList = await listScenarios(a)
  assert.ok(!(aList.json.scenarios || []).some((s) => s.id === bId))

  // B no ve escenarios de A
  const bList = await listScenarios(b)
  assert.ok(!(bList.json.scenarios || []).some((s) => s.id === cashId))
  assert.ok((bList.json.scenarios || []).some((s) => s.id === bId))

  // Sin cookie
  const noCookie = await listScenarios(a, { cookie: null })
  assert.equal(noCookie.json.identified, false)
  assert.deepEqual(noCookie.json.scenarios || [], [])

  // Cookie inventada
  const fake = await listScenarios(a, { cookie: 'lv_vid=' + randomUUID() })
  assert.equal(fake.json.identified, false)

  // Intento con lead/teléfono de B pero cookie de A
  const spoof = await listScenarios(a, { phone: b.phone, lead_id: b.leadId })
  assert.equal(spoof.json.identified, false)

  // B no puede borrar escenario de A
  const delCross = await deleteScenario(b, cashId)
  assert.ok(delCross.res.status === 401 || delCross.res.status === 404, delCross.res.status)

  // A borra el suyo
  const delOwn = await deleteScenario(a, manId)
  assert.equal(delOwn.res.status, 200, JSON.stringify(delOwn.json))

  console.log('OK financing local e2e')
}

main().catch((err) => {
  console.error('FAIL', err)
  process.exit(1)
})
