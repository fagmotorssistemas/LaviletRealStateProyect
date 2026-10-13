import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { discountNegotiationForTurn, normalizedDiscountRequest } from './discount-request'
import { normalizeTurnSemantics } from './turn-semantics'
import { responseContentScope } from './response-content-scope'
import { selectedUnitModelDelivery } from './unit-model'
import { selectedTourPrice } from './selected-tour-price'
import { reviewObligations } from './focused-review'
import { completeTurnReply } from './turn-completeness'
import { earlyPurchaseDiscountContext } from './early-purchase-discount-context'
import { discountReferenceEvidence } from './discount-evidence'
import { projectQuantityEvidence } from './project-quantities'
import { changeEarlyPurchaseDiscountSettings, earlyPurchaseDiscountSettings, validateEarlyPurchaseDiscountSettings } from '@/lib/inmobiliaria/earlyPurchaseDiscounts'
import { object, type Row } from './data'

const unit = { id: 'u502', unit_number: '502', category: 'departamento', bedrooms: 3, floor_number: 5,
  is_published: true, status: 'disponible', published_commercial_price: 310000 }
const current = 'Quiero el 502'
const reference = { query: { operation: 'select' }, context: { selected_ids: [unit.id] }, matches: [unit] }
const verified = { catalogo: [unit], property_context: reference.context, politica_comercial: { precios_autorizados: true, aviso_precios_referenciales: false },
  semantica_turno: { primary_intent: 'select_property', confidence: 'high', property: { operation: 'select', evidence: current } },
  contrato_turno: { objective: 'select_property', requests: [] } }

test('the actual selected-unit delivery opens and requires only its verified price for writer and reviewer', async () => {
  const model = selectedUnitModelDelivery(reference, current, [])!
  const audit = { source: 'catalog_select', unit_model: model, semantic_review_enabled: true, business_risk_review_enabled: true }
  assert.equal(object(object(responseContentScope(current, verified, audit).topics).purchase_prices).reason, 'selected_unit_tour_price')
  assert.deepEqual(selectedTourPrice(verified, audit), { unit_id: unit.id, unit_number: '502', published_commercial_price: 310000 })
  assert.ok(reviewObligations(audit, verified, {}).some(row => row.id === 'selected_unit_tour_price'))
  const tasks: string[] = [], errors: unknown[] = []
  const result = await completeTurnReply({ current, baseReply: model.caption, verified, audit }, async (_rules, raw, _schema, _image, _file, _tone, task) => {
    tasks.push(String(task))
    const input = object(raw)
    try {
      const obligation = (input.obligaciones_del_turno as Row[]).find(row => row.id === 'selected_unit_tour_price')!
      assert.equal(obligation.unit_number, unit.unit_number)
      assert.equal(obligation.published_commercial_price, 310000)
    } catch (error) { errors.push(error) }
    if (task === 'review') return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
    return { reply: `El departamento 502 tiene un precio de USD 310.000. ${model.caption}`,
      requests: (input.referencias_solicitud as Row[]).map(row => ({ fragment: row.id, intent: 'Precio y recorrido de la unidad elegida',
        request_type: 'general_information', status: 'answered', evidence: 'Precio y tour autorizados', fact_key: null })),
      question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' } }
  })
  if (errors.length) throw errors[0]
  assert.deepEqual(tasks, ['writing', 'review'])
  assert.equal(result.needsAdvisor, false)
  assert.match(result.reply, /310\.000/)
  assert.ok(result.reply.includes(model.url))
})

test('offers, general tours, mismatched or repeated tours and hidden prices do not trigger automatic pricing', () => {
  const model = selectedUnitModelDelivery(reference, current, [])!
  for (const [info, audit] of [
    [verified, { unit_model: { ...model, delivery_reason: 'offered_unit' } }],
    [verified, { unit_model: { ...model, unit_id: null } }],
    [{ ...verified, property_context: { selected_ids: [] } }, { unit_model: model }],
    [{ ...verified, politica_comercial: { precios_autorizados: false } }, { unit_model: model }],
    [{ ...verified, catalogo: [{ ...unit, status: 'vendido' }] }, { unit_model: model }],
    [{ ...verified, catalogo: [{ ...unit, published_commercial_price: null }] }, { unit_model: model }],
  ] as [Row, Row][]) assert.equal(selectedTourPrice(info, audit), null)
  assert.equal(selectedUnitModelDelivery(reference, current, [], [unit.id]), null)
})

test('normalized extractor meaning distinguishes published discount questions from personal negotiation', () => {
  for (const evidence of ['¿Tiene descuento de lanzamiento?', '¿De cuánto es?', '¿Ya está aplicado?']) {
    const request = { kind: 'published_offer_information', evidence, confidence: 'medium' }
    assert.equal(normalizedDiscountRequest(request, evidence)?.kind, 'published_offer_information')
    assert.equal(discountNegotiationForTurn({ discount_request: request }, evidence, { kind: 'property' }), null)
    const semantics = normalizeTurnSemantics({ turn_semantics: { discount_request: request } }, evidence, {})
    assert.equal(object(semantics.discount_request).kind, 'published_offer_information')
    const scope = responseContentScope(evidence, { ...verified, semantica_turno: semantics }, {})
    assert.equal(object(object(scope.topics).purchase_prices).reason, 'current_discount_request')
  }
  const evidence = '¿Me pueden hacer un descuento?', request = { kind: 'negotiate_personal_discount', evidence, confidence: 'high' }
  assert.deepEqual(discountNegotiationForTurn({ discount_request: request }, evidence, { kind: 'property' }), request)
  assert.equal(discountNegotiationForTurn({ discount_request: request }, 'Gracias', { kind: 'property' }), null)
  assert.equal(discountNegotiationForTurn({ discount_request: request }, evidence, { kind: 'property', uncertain: true }), null)
  assert.equal(discountNegotiationForTurn({ discount_request: { ...request, confidence: 'low' } }, evidence, { kind: 'property' }), null)
})

test('the migrated editable 10% policy is included once, survives edits and exposes exact discount evidence to both models', async t => {
  const db = new PGlite(); t.after(() => db.close())
  await db.exec(`create table projects(id uuid, tenant_id uuid, policies_json jsonb, updated_at timestamptz);
    insert into projects values('b1b2c3d4-0001-4000-8000-000000000001','a1b2c3d4-0001-4000-8000-000000000001','{"bot_pricing":{"launch_prices_visible":true}}',now());`)
  const migration = readFileSync('supabase/migrations/20261013180000_launch_discount_included_in_catalog.sql', 'utf8')
  await db.exec(migration)
  const policies = object((await db.query<{ policies_json: Row }>('select policies_json from projects')).rows[0].policies_json)
  assert.deepEqual(policies.bot_pricing, { launch_prices_visible: true })
  const settings = earlyPurchaseDiscountSettings(policies), rule = settings.rules.find(row => row.id === 'launch-price-included')!
  assert.equal(rule.percent, 10)
  assert.equal(rule.base, 'included_in_catalog')
  assert.equal(rule.condition, 'published_price')
  const discounts = earlyPurchaseDiscountContext([unit], settings, { mode: 'lanzamiento', today: '2026-10-13', pricesAuthorized: true })
  const quoted = object(discounts.units[0])
  assert.equal(quoted.published_commercial_price, 310000)
  assert.equal(quoted.discounted_price_reference, 310000)
  assert.equal(quoted.discount_amount_reference, null)
  assert.equal(quoted.discount_reference_price, null)
  assert.equal(object(quoted.early_purchase_discount).condition_met, true)
  assert.equal(object(quoted.early_purchase_discount).inventory_reserved, false)
  assert.equal(discountReferenceEvidence(quoted).values.discount_percent, 10)
  assert.ok(projectQuantityEvidence({ politica_descuentos: discounts.policy }).some(row => row.value === 10))
  const evidence = '¿Ya está aplicado el descuento?', requests = [{ domain: 'property', request: evidence, evidence, confidence: 'high', topics: ['purchase_price'] }]
  const seen: string[] = [], inspectionErrors: unknown[] = []
  const completed = await completeTurnReply({ current: evidence, baseReply: 'El 10 % ya está incluido en los precios publicados de lanzamiento.',
    verified: { ...verified, catalogo: discounts.units, politica_descuentos: discounts.policy,
      semantica_turno: { primary_intent: 'ask_price', confidence: 'high', discount_request: { kind: 'published_offer_information', evidence, confidence: 'high' } },
      solicitudes_interpretadas: requests, contrato_turno: { objective: 'ask_price', requests } },
    audit: { source: 'commercial', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, raw, _schema, _image, _file, _tone, task) => {
    const input = object(raw); seen.push(String(task))
    try {
      const authority = object((input.obligaciones_del_turno as Row[]).find(row => row.id === 'early_purchase_discount')?.policy)
      const approved = (authority.rules as Row[])[0]
      assert.equal(approved.percent, 10)
      assert.equal(approved.condition, 'published_price')
      assert.equal(approved.base_mode, 'included_in_catalog')
    } catch (error) { inspectionErrors.push(error) }
    if (task === 'review') return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
    return { reply: 'El 10 % ya está incluido en los precios publicados de lanzamiento. No hay que restarlo otra vez.',
      requests: (input.referencias_solicitud as Row[]).map(row => ({ fragment: row.id, intent: 'Explicar el descuento incluido', request_type: 'general_information',
        status: 'answered', evidence: 'Oferta publicada incluida en el precio', fact_key: null })),
      question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' } }
  })
  if (inspectionErrors.length) throw inspectionErrors[0]
  assert.deepEqual(seen, ['writing', 'review'])
  assert.equal(completed.needsAdvisor, false)
  assert.equal(earlyPurchaseDiscountContext([unit], settings, { mode: 'preventa', today: '2026-10-13', pricesAuthorized: true }).policy.rules.length, 0)
  const edited = { ...settings, rules: settings.rules.map(row => ({ ...row, percent: 8, endDate: '2026-10-31' })) }
  const editedPolicies = changeEarlyPurchaseDiscountSettings(policies, edited, 'admin', '2026-10-13T20:00:00.000Z')
  await db.query('update projects set policies_json=$1', [JSON.stringify(editedPolicies)])
  await db.exec(migration)
  const preserved = earlyPurchaseDiscountSettings((await db.query<{ policies_json: Row }>('select policies_json from projects')).rows[0].policies_json)
  assert.equal(preserved.rules.length, 1)
  assert.equal(preserved.rules[0].percent, 8)
  assert.equal(earlyPurchaseDiscountContext([unit], preserved, { mode: 'lanzamiento', today: '2026-11-01', pricesAuthorized: true }).policy.rules.length, 0)
  assert.throws(() => validateEarlyPurchaseDiscountSettings({ ...edited, rules: [{ ...rule, base: 'catalog_additional' }] }), /rebaja adicional/)
})

test('migration is project-scoped and does not overwrite an existing conflicting approved launch policy', async t => {
  const db = new PGlite(); t.after(() => db.close())
  await db.exec('create table projects(id uuid, tenant_id uuid, policies_json jsonb, updated_at timestamptz)')
  const existing = { other: 'preserved', early_purchase_discounts: { enabled: true, rules: [{ id: 'existing-offer', enabled: true,
    mode: 'lanzamiento', categories: [], unitNumbers: [], percent: 7 }] } }
  await db.query('insert into projects values($1,$2,$3,now())', ['b1b2c3d4-0001-4000-8000-000000000001', 'a1b2c3d4-0001-4000-8000-000000000001', JSON.stringify(existing)])
  await db.query('insert into projects values($1,$2,$3,now())', ['b1b2c3d4-0001-4000-8000-000000000002', 'a1b2c3d4-0001-4000-8000-000000000001', JSON.stringify({ other: 'untouched' })])
  const migration = readFileSync('supabase/migrations/20261013180000_launch_discount_included_in_catalog.sql', 'utf8')
  await assert.rejects(db.exec(migration), /LAUNCH_DISCOUNT_POLICY_CONFLICT/)
  const rows = (await db.query<{ policies_json: Row }>('select policies_json from projects order by id')).rows
  assert.deepEqual(rows[0].policies_json, existing)
  assert.deepEqual(rows[1].policies_json, { other: 'untouched' })
})
