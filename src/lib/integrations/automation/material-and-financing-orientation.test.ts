import { writerFixture } from './fixtures/writer-response.fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultFinancingGuidance } from '@/lib/inmobiliaria/financingGuidance'
import { calculateMonthlyPayment } from '@/lib/financing/calculator'
import { financingPolicyContext, financingQuoteContext } from './financing-quote'
import { publishedFinancingRequirements } from './financing-requirements'
import { localVisualMaterials } from './visual-materials'
import { commercialJourneyPlan } from './commercial-journey'
import { replyLinkContract, replyLinkIssues } from './response-plan'
import { completeTurnReply, mandatoryReplyIssues } from './turn-completeness'
import { verifiedClaimSources } from './turn-evidence'
import { object, type Row } from './data'

const partners = ['Cooperativa JEP', 'Banco Pichincha']
const inquiry = { requested: true, beforeApplication: true, years: null, evidence: '¿Qué cuota mensual aproximada tendría?' }
const unit = { id: 'u304', unit_number: '304', category: 'departamento', published_commercial_price: 270000, status: 'disponible', is_published: true }
function financialInfo(): Row {
  return { catalogo: [unit], property_context: { selected_ids: [unit.id] },
    politica_comercial: { precios_autorizados: true },
    politica_financiera: { guidance: financingPolicyContext(defaultFinancingGuidance(), partners, '2026-10-15') },
    financiamiento: { current: {} } }
}

test('missing bank conditions permit a labelled server example without manufacturing bank terms or lead choices', () => {
  const info = financialInfo(), before = structuredClone(info)
  const quote = financingQuoteContext(info, inquiry), example = object(quote.illustrative_example)
  assert.equal(quote.monthly_estimate_available, false)
  assert.ok(quote.estimates.every(estimate => estimate.basic_monthly_payment === null))
  assert.equal(example.principal, 216000)
  assert.equal(example.down_payment, 54000)
  assert.equal(example.annual_rate, 8)
  assert.equal(example.years, 20)
  assert.equal(example.basic_monthly_payment, 1806.71)
  assert.equal(example.lender_offer, false)
  assert.equal(example.persists_customer_decisions, false)
  assert.deepEqual(info, before)
  const sources = verifiedClaimSources({ ...info, financing_quote: quote }, {}, {})
  assert.ok(sources.some(source => source.scope === 'hypothetical_arithmetic_not_lender_terms_or_customer_decision'))
})

test('a declared contribution and a requested term are used; a purchase budget is never converted to entry', () => {
  const info = financialInfo()
  info.financing_amounts = { total_budget: { amount: 250000 }, down_payment: { amount: 100000 } }
  const example = object(financingQuoteContext(info, { ...inquiry, years: 15 }).illustrative_example)
  assert.equal(example.principal, 170000)
  assert.equal(example.down_payment, 100000)
  assert.equal(example.years, 15)
  assert.equal(example.basic_monthly_payment, calculateMonthlyPayment(170000, 8, 15, 'nominal_annual'))
  assert.equal(example.contribution_basis, 'customer_proposal')
})

test('a selected lender keeps its coverage reference without claiming its hypothetical rate or term', () => {
  const info = financialInfo()
  info.financiamiento = { current: { selected_partner_name: 'JEP' } }
  const example = object(financingQuoteContext(info, inquiry).illustrative_example)
  assert.equal(example.principal, 150000)
  assert.equal(example.down_payment, 120000)
  assert.equal(example.selected_lender, null)
  assert.equal(example.lender_offer, false)
})

test('disabled estimates, missing unit, entry-only questions and inconsistent amounts cannot produce an illustrative payment', () => {
  const cases = [
    { ...financialInfo(), property_context: {} },
    { ...financialInfo(), politica_comercial: { precios_autorizados: false } },
    { ...financialInfo(), financing_amounts: { down_payment: { amount: 100000 }, loan: { amount: 200000 } } },
  ]
  for (const change of [{ enabled: false }, { estimatesEnabled: false }]) {
    const settings = { ...defaultFinancingGuidance(), ...change }
    cases.push({ ...financialInfo(), politica_financiera: { guidance: financingPolicyContext(settings, partners, '2026-10-15') } })
  }
  for (const info of cases) assert.equal(financingQuoteContext(info, inquiry).illustrative_example, null)
  assert.equal(financingQuoteContext(financialInfo(), { ...inquiry, evidence: '¿Cuánta entrada hace falta?' }).illustrative_example, null)
})

test('bank requirements are sourced per product and remain separate from collection authority', () => {
  const policy = financingPolicyContext(defaultFinancingGuidance(), partners, '2026-10-15')
  assert.ok(policy.lenders.every(lender => lender.published_requirements?.basic.length))
  assert.match(String(policy.lenders[0].published_requirements?.eligibility), /primera vivienda/)
  const lender = defaultFinancingGuidance().lenders[0]
  assert.equal(publishedFinancingRequirements({ ...lender, product: 'Otro producto' }, '2026-10-15'), null)
  assert.equal(publishedFinancingRequirements({ ...lender, enabled: false }, '2026-10-15'), null)
  assert.equal(publishedFinancingRequirements(lender, '2026-10-14'), null)
  assert.equal(publishedFinancingRequirements(lender, '2026-11-16'), null)
})

const locals = [
  { id: 'lc08', unit_number: 'LC-08', category: 'local', unit_type_id: 'ta', is_published: true, status: 'disponible' },
  { id: 'lc09', unit_number: 'LC-09', category: 'local', unit_type_id: 'ta', is_published: true, status: 'disponible' },
]
const types = [{ id: 'ta', name: 'Locales planta alta', slug: 'localesplantaalta', is_active: true }]
const assets = [
  { typology_code: 'Locales planta alta', kind: 'render', file_name: 'local.png', storage_path: 'local.png' },
  { typology_code: 'Otra tipología', kind: 'render', file_name: 'otro.png', storage_path: 'otro.png' },
  { typology_code: 'Locales planta alta', kind: 'render', file_name: 'local_2048.png', storage_path: 'local_2048.png' },
]
const visual = () => localVisualMaterials(locals, types, assets, asset => `https://images.example/${asset.storage_path}`)

test('commercial galleries are scoped reference renders, never exact-unit photographs or 360 tours', () => {
  const material = visual(), gallery = object((material.galleries as Row[])[0])
  assert.equal(material.available, true)
  assert.equal(gallery.asset_count, 1)
  assert.equal(gallery.has_360, false)
  assert.equal(gallery.scope, 'shared_typology_reference')
  assert.deepEqual(gallery.unit_ids, ['lc08', 'lc09'])
  assert.equal(localVisualMaterials(locals, [{ ...types[0], is_active: false }], assets, () => 'x').available, false)
  assert.equal(localVisualMaterials(locals.map(local => ({ ...local, is_published: false })), types, assets, () => 'x').available, false)
})

test('a visual reply shares the verified gallery without triggering the all-unit presentation obligation', () => {
  const material = visual()
  const info = { material_visual: material, catalogo: locals }
  const journey = commercialJourneyPlan(info, { source: 'catalog_search' })
  assert.equal(journey.action, 'visual_information')
  assert.notEqual(journey.requires_unit_presentation, true)
  const audit = { material_visual: material }
  const links = replyLinkContract('', audit, { verified: info })
  const reply = `Puede ver los renders de referencia de los locales en la galería del showroom: ${links.required_links[0]}`
  assert.deepEqual(replyLinkIssues(reply, links), [])
  assert.ok(!mandatoryReplyIssues({ current: '¿Cómo puedo ver esos locales?', baseReply: '', verified: { ...info, siguiente_paso_comercial: journey } }, reply)
    .includes('required_unit_presentation_missing'))
  assert.ok(!links.allowed_links.some(url => url.includes('otro.png')))
})

test('the writer and independent reviewer receive the gallery for the visual request through optimized context', async () => {
  const material = visual(), gallery = object((material.galleries as Row[])[0])
  const current = '¿Tiene imágenes o alguna forma de ver esos locales?'
  const request = { domain: 'property', topics: ['visualization'], request: current, evidence: current, confidence: 'high' }
  const audit = { source: 'catalog_search', material_visual: material, semantic_review_enabled: true, business_risk_review_enabled: true,
    resolved_turn_intent: { requests: [request], objective: 'property_information' } }
  const reply = `Puede ver renders de referencia de los locales en esta galería: ${gallery.gallery_url}. Son representaciones de la tipología, no fotos de obra terminada.`
  const calls: string[] = [], snapshots: Row[] = []
  const result = await completeTurnReply({ current, baseReply: 'No tengo imágenes.', audit,
    verified: { material_visual: material, catalogo: locals, recorrido_comercial: {}, catalog_read: { complete: true }, catalog_search: { embeddingsEnabled: true },
      solicitudes_interpretadas: [request] } }, async (_rules, raw, _schema, _image, _file, _tone, task) => {
    calls.push(String(task))
    const input = object(raw)
    if (task === 'writing') {
      snapshots.push({ material: object(input.contexto_verificado).material_visual,
        goal: object(input.contrato_redaccion).objetivo_siguiente })
      assert.equal(object(object(input.contexto_verificado).material_visual).available, true)
      assert.equal(object(input.capacidades_disponibles).visual_material_links, true)
      assert.equal(object(input.capacidades_disponibles).dynamic_image_attachments, false)
      assert.equal(object(object(input.contrato_redaccion).objetivo_siguiente).action, 'visual_information')
      return writerFixture({ reply, question: { role: 'none', purpose: 'none', missing_datum: '', next_decision: '' },
        requests: [{ fragment: 'R1', status: 'answered', intent: 'Ver los locales', evidence: reply, fact_key: 'policy', request_type: 'specific_fact' }] })
    }
    assert.ok(JSON.stringify(input.fuentes_autorizadas).includes('shared_typology_reference'))
    return { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
  })
  assert.equal(result.reply, reply, JSON.stringify({ calls, snapshots, final_validation: result.audit.final_validation,
    repair_attempts: result.audit.repair_attempts, reason: result.audit.reason, errors: result.audit.errors }))
  assert.equal(result.audit.status, 'checked')
  assert.deepEqual(calls, ['writing', 'review'])
})
