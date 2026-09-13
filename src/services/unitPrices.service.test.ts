import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { botPriceStatus, parseCommercialPrice } from '../lib/inmobiliaria/unitPrices'
import { listProjectPrices, saveCommercialUnitPrice } from './unitPrices.service'

const client = (fetcher: typeof fetch) => createClient('https://example.supabase.co', 'test-key', {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher },
})
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const params = { tenantId: 'tenant-a', projectId: 'project-a', unitId: 'unit-210', price: '200.000,50', expectedUpdatedAt: '2026-09-13T12:00:00Z' }

test('commercial prices accept Ecuador and unambiguous international money formats', () => {
  for (const value of ['200000.50', '200000,50', '200.000,50', '200,000.50']) assert.equal(parseCommercialPrice(value), 200000.5)
  assert.equal(parseCommercialPrice('200.000'), 200000)
  assert.equal(parseCommercialPrice('200,000'), 200000)
  assert.equal(parseCommercialPrice('150'), 150)
  assert.equal(parseCommercialPrice('  '), null)
  for (const value of ['0', '-2', 'NaN', '1e5', '12.34.56', '200mil', '1,50,000', '1000000000', '$200000', '200000.123']) assert.throws(() => parseCommercialPrice(value))
})

test('saving a price scopes tenant, project, unit and version without changing publication or cost', async () => {
  let calls = 0
  const db = client(async (input, init) => {
    calls++
    const url = new URL(String(input)), body = JSON.parse(String(init?.body))
    assert.equal(init?.method, 'PATCH')
    assert.equal(url.searchParams.get('tenant_id'), 'eq.tenant-a')
    assert.equal(url.searchParams.get('project_id'), 'eq.project-a')
    assert.equal(url.searchParams.get('id'), 'eq.unit-210')
    assert.equal(url.searchParams.get('updated_at'), 'eq.' + params.expectedUpdatedAt)
    assert.deepEqual(Object.keys(body).sort(), ['published_commercial_price', 'updated_at'])
    assert.equal(body.published_commercial_price, 200000.5)
    assert.ok(Number.isFinite(Date.parse(body.updated_at)))
    return json({ id: params.unitId, ...body })
  })
  assert.equal((await saveCommercialUnitPrice(db, params)).published_commercial_price, 200000.5)
  assert.equal(calls, 1)
})

test('clearing a price stores null instead of a zero-dollar offer', async () => {
  const db = client(async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    assert.equal(body.published_commercial_price, null)
    return json({ id: params.unitId, ...body })
  })
  assert.equal((await saveCommercialUnitPrice(db, { ...params, price: '' })).published_commercial_price, null)
})

test('a concurrent edit or an inaccessible unit cannot be reported as a successful price save', async () => {
  const db = client(async () => json(null))
  await assert.rejects(saveCommercialUnitPrice(db, params), /cambió/)
  const noRequests = client(async () => { assert.fail('Invalid price must not reach the database') })
  await assert.rejects(saveCommercialUnitPrice(noRequests, { ...params, price: '0' }))
  await assert.rejects(saveCommercialUnitPrice(noRequests, { ...params, tenantId: '' }))
  await assert.rejects(saveCommercialUnitPrice(noRequests, { ...params, expectedUpdatedAt: 'invalid' }))
})

test('listing prices paginates without silently losing units and sorts unit numbers naturally', async () => {
  let requests = 0
  const db = client(async input => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get('tenant_id'), 'eq.tenant-a')
    assert.equal(url.searchParams.get('project_id'), 'eq.project-a')
    assert.equal(url.searchParams.get('offset'), requests ? '500' : '0')
    requests++
    return json(requests === 1 ? Array.from({ length: 500 }, (_, i) => ({ unit_number: String(501 - i) })) : [{ unit_number: '1' }])
  })
  const rows = await listProjectPrices(db, 'project-a', 'tenant-a')
  assert.equal(rows.length, 501)
  assert.equal(rows[0].unit_number, '1')
  assert.equal(rows[500].unit_number, '501')
  assert.equal(requests, 2)
})

test('saving prices does not bypass launch mode or unit publication and availability', () => {
  const unit = { is_published: true, status: 'disponible', published_commercial_price: 200000 }
  assert.match(botPriceStatus(unit, 'lanzamiento'), /Oculto/)
  assert.match(botPriceStatus(unit, 'preventa'), /puede informarlo/)
  assert.match(botPriceStatus({ ...unit, is_published: false }, 'preventa'), /sin publicar/)
  assert.match(botPriceStatus({ ...unit, status: 'vendido' }, 'preventa'), /no disponible/)
  assert.equal(botPriceStatus({ ...unit, published_commercial_price: null }, 'preventa'), 'Sin precio')
})
