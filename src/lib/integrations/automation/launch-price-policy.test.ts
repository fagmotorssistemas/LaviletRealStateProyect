import test from 'node:test'
import assert from 'node:assert/strict'
import { changeBusinessPolicy, publishedBusinessPolicies } from '@/lib/inmobiliaria/businessPolicies'
import { taskVerifiedContext } from './task-context'
import { completeTurnReply } from './turn-completeness'
import { unitPriceQuote } from './price-reply'
import { LAUNCH_PRICE_COMPARISON_RULE } from './launch-price-policy'
import { object, type Row } from './data'
import { BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'

const now = '2026-10-06T14:00:00.000Z'
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const policy = { title: 'Condiciones de lanzamiento', topic: 'otros', mode: 'lanzamiento',
  content: 'El departamento 304 tiene un beneficio comercial confirmado de USD 5.000 hasta el 31 de octubre; no aplica a otras unidades.',
  scope: 'Solo departamento 304 en lanzamiento, sujeto a disponibilidad y vigencia.',
  source: 'Condición confirmada por el equipo comercial el 6 de octubre.', validUntil: '2026-10-31' }
const catalog = [
  { id: 'd304', unit_number: '304', category: 'departamento', bedrooms: 2, floor_number: 3,
    published_commercial_price: 270000, spaces: 'sala, comedor y cocina', status: 'disponible', is_published: true },
  { id: 'd504', unit_number: '504', category: 'departamento', bedrooms: 2, floor_number: 5,
    published_commercial_price: 310000, spaces: 'sala, comedor y cocina', status: 'disponible', is_published: true },
]

test('a future comparison policy is editable and applies only after publication, within stage and validity', () => {
  const draft = changeBusinessPolicy({}, { action: 'draft', id: 'launch-benefit', value: policy }, 'admin', now)
  assert.deepEqual(publishedBusinessPolicies(draft, 'lanzamiento', now), [])
  const published = changeBusinessPolicy(draft, { action: 'publish', id: 'launch-benefit', value: policy }, 'admin', now)
  assert.equal(publishedBusinessPolicies(published, 'lanzamiento', now)[0].scope, policy.scope)
  assert.deepEqual(publishedBusinessPolicies(published, 'preventa', now), [])
  assert.deepEqual(publishedBusinessPolicies(published, 'lanzamiento', '2026-11-01T00:00:00Z'), [])
  const editedDraft = changeBusinessPolicy(published, { action: 'draft', id: 'launch-benefit', value: { ...policy, content: 'Otro beneficio aún sin publicar.' } }, 'admin', now)
  assert.equal(publishedBusinessPolicies(editedDraft, 'lanzamiento', now)[0].policy_content, policy.content)
  const paused = changeBusinessPolicy(editedDraft, { action: 'pause', id: 'launch-benefit' }, 'admin', now)
  assert.deepEqual(publishedBusinessPolicies(paused, 'lanzamiento', now), [])
})

test('current quotes stay exact without an authorized future-price comparison', () => {
  const quote = unitPriceQuote({ catalogo: catalog, alcance_negocio: 'property',
    politica_comercial: { precios_autorizados: true, precios_aproximados: true },
    lead: { preferred_category: 'departamento', preferred_bedrooms: 2 } }, 'Quisiera saber los precios de departamentos de 2 dormitorios', {})
  assert.equal(quote?.quoted, true)
  assert.deepEqual(quote?.prices, [270000, 310000])
  assert.deepEqual(quote?.units?.map(unit => unit.id), ['d304', 'd504'])
  assert.equal(quote?.comparison, undefined, 'A pair of current units does not create a comparison with future stages.')
})

for (const approximate of [true, false, undefined]) for (const withPublishedPolicy of [false, true]) test(`compound preconstruction-price question shares commercial guard with both agents (approximate=${approximate}, policy=${withPublishedPolicy})`, async () => {
  const requests = [
    { domain: 'property', request: 'Quisiera saber los precios', evidence: 'Quisiera saber los precios', confidence: 'high' },
    { domain: 'property', request: 'Qué incluye', evidence: 'Qué incluye', confidence: 'high' },
    { domain: 'property', request: 'Si compro antes de construir, ¿los precios son menores?', evidence: 'Si compro antes de construir, ¿los precios son menores?', confidence: 'high' },
  ]
  const current = requests.map(request => request.evidence).join('\n') + '\nQuisiera asegurar un departamento si el valor me alcanza.'
  const published = withPublishedPolicy ? publishedBusinessPolicies(changeBusinessPolicy({},
    { action: 'publish', id: 'launch-benefit', value: policy }, 'admin', now), 'lanzamiento', now) : []
  const verified = taskVerifiedContext({ catalogo: catalog, alcance_negocio: 'property',
    modo_comercial: 'lanzamiento', politica_comercial: { precios_autorizados: true,
      ...(approximate === undefined ? {} : { precios_aproximados: approximate }) },
    proyecto: { name: 'La Vilet' }, politicas_negocio: published, solicitudes_interpretadas: requests,
    contrato_turno: { objective: 'ask_price', requests, scope: { kind: 'property' } },
    lead: { preferred_category: 'departamento', preferred_bedrooms: 2 },
    perfil_lead: { full_name: 'Nombre de prueba', name_status: 'confirmed', residence_status: 'confirmed', residence_city: 'Cuenca' } }, {}, current)
  assert.deepEqual(rows(verified.politicas_negocio), published)
  let writerObligations: Row[] = [], reviewed = false
  const callbackErrors: string[] = []
  const response = 'Los departamentos de 2 dormitorios cuestan entre USD 270.000 y USD 310.000.'
    + (approximate === true ? ' Son valores referenciales de lanzamiento que pueden cambiar.' : '')
    + ' Incluyen sala, comedor y cocina. '
    + (withPublishedPolicy ? 'El beneficio de USD 5.000 solo aplica al departamento 304 hasta el 31 de octubre.'
      : 'No tenemos una comparación confirmada para comunicar que comprar ahora sea más barato que después.')
  const result = await completeTurnReply({ current, baseReply: response, verified,
    audit: { semantic_review_enabled: true, business_risk_review_enabled: true } }, async (_instructions, input, _schema, _image, _file, _tone, task) => {
    try {
    const context = object(input)
    if (task === 'writing') {
      writerObligations = rows(context.obligaciones_del_turno)
      assert.ok(String(writerObligations.find(obligation => obligation.id === 'business_scope')?.instruction).includes(LAUNCH_PRICE_COMPARISON_RULE))
      assert.equal(writerObligations.some(obligation => obligation.id === 'price_conditions'), approximate === true,
        'The comparison safeguard must not require an unconfigured referential-price notice.')
      assert.deepEqual(rows(object(context.contexto_verificado).politicas_negocio), published)
      const refs = rows(context.referencias_solicitud)
      for (const request of requests) assert.ok(refs.some(ref => ref.text === request.evidence), request.evidence)
      return { reply: response, requests: refs.map(ref => ({ fragment: ref.id, intent: 'Informar condiciones y precios', request_type: 'general_information', status: 'answered', evidence: 'Valores actuales y alcance de las condiciones, sin gestión de reserva.', fact_key: null })),
        question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '' } }
    }
    reviewed = true
    assert.deepEqual(context.obligaciones_del_turno, writerObligations)
    const otherSources = rows(object(context.fuentes_autorizadas).otros_hechos_y_politicas)
    assert.equal(otherSources.some(source => String(source.path).includes('politicas_negocio')), withPublishedPolicy)
    return { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [], facts: [], question: null }
    } catch (error) { callbackErrors.push(String(error)); throw error }
  })
  assert.deepEqual(callbackErrors, [])
  assert.equal(reviewed, true, JSON.stringify(result.audit))
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, response)
})
