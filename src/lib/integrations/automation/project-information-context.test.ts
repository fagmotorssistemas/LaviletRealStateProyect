import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { resolveTurnIntent } from './turn-intent'
import { taskVerifiedContext, taskModelEvidence } from './task-context'
import { turnEvidence } from './turn-evidence'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { responseReviewSettings } from '@/lib/inmobiliaria/responseReview'
import { journeyPendingQuestion } from './commercial-journey'

const catalog = Array.from({ length: 65 }, (_, i) => ({ id: `unit-${i}`, unit_number: String(100 + i),
  category: i < 10 ? 'local' : i < 30 ? 'suite' : i < 55 ? 'departamento' : 'penthouse',
  bedrooms: i < 10 ? null : i < 30 ? 1 : i % 2 ? 2 : 3, floor_number: i < 55 ? 2 + i % 4 : 6,
  published_commercial_price: 145000 + i * 5000, status: 'disponible' }))

const fixture = (current = 'bueno y para que necesitaria esa guia personalizada?', domain = 'other'): Row => {
  const semantica_turno = { primary_intent: 'project_information', confidence: 'high', primary_evidence: current,
    property: { operation: 'none', reference_kind: 'none', category: null, group: null, unit_numbers: [], filters: { bedrooms: null } },
    catalog_request: { purpose: 'none', requirements: [], semantic_preferences: [] }, budget: { status: 'not_discussed' } }
  const solicitudes_interpretadas = [{ domain, confidence: 'high', request: 'Comprender la información presentada', evidence: current }]
  const contrato_turno = resolveTurnIntent({ current, semantics: semantica_turno, requests: solicitudes_interpretadas,
    scope: { kind: 'neutral', uncertain: false } })
  return { catalogo: catalog, catalogo_verificacion: catalog, contrato_turno, semantica_turno, solicitudes_interpretadas,
    property_context: { query: {}, selected_ids: [] }, recorrido_comercial: {}, lead: {}, perfil_lead: {}, financiamiento: {},
    proyecto: { name: 'La Vilet', address: 'Puertas del Sol, Cuenca' },
    entrega_proyecto: { enabled: true, timing: 'year', year: 2028, approximate: true },
    materiales: [{ type: 'brochure', url: 'https://example.com/brochure.pdf' }],
    politica_comercial: { precios_autorizados: true }, catalog_search: { embeddingsEnabled: false } }
}
const audit = { source: 'project_overview', semantic_review_enabled: true, business_risk_review_enabled: true,
  profile_introduction: { stage: 'deliver', question_purpose: 'none', brochure_previously_sent: true } }

test('project clarifications use their canonical domain and omit catalogue evidence independently of wording or vector ranking', () => {
  for (const current of ['bueno y para que necesitaria esa guia personalizada?', '¿Qué significa ese concepto?', '¿Cuánto tarda ese servicio?'])
    for (const domain of ['other', 'property']) for (const embeddingsEnabled of [false, true]) {
      const input = fixture(current, domain)
      input.catalog_search = { embeddingsEnabled }
      const before = structuredClone(input), full = turnEvidence(input)
      const selected = taskVerifiedContext(input, audit, current), model = taskModelEvidence(turnEvidence(selected), selected)
      assert.equal(object(selected.prompt_context_selection).task, 'project_overview')
      assert.deepEqual(selected.catalogo, [])
      assert.equal(selected.catalogo_verificacion, undefined)
      assert.deepEqual(model.units, []); assert.deepEqual(model.groups, [])
      assert.ok(JSON.stringify(model).length < JSON.stringify(full).length * 0.1)
      for (const key of ['proyecto', 'entrega_proyecto', 'materiales', 'recorrido_comercial', 'politica_comercial', 'contrato_turno'])
        assert.deepEqual(selected[key], input[key], key)
      assert.deepEqual(input, before)
      assert.equal(full.units.length, 65)
    }
})

test('compound requests, concrete requirements, uncertainty and financial declarations never take the general explanation shortcut', () => {
  const modifications: [string, (input: Row) => void][] = [
    ['second property request', v => { (v.solicitudes_interpretadas as Row[]).push({ domain: 'property', confidence: 'high', request: 'Ver la unidad 502' }) }],
    ['financial request', v => { (v.solicitudes_interpretadas as Row[]).push({ domain: 'financing', confidence: 'high', request: 'Condiciones JEP' }) }],
    ['floor zero', v => { object(v.property_context).query = { filters: { floor_number: 0 } } }],
    ['selector', v => { object(v.property_context).query = { selector: 'largest' } }],
    ['query requirement', v => { object(v.property_context).query = { requirements: [{ field: 'spaces', value: 'terraza' }] } }],
    ['semantic preference', v => { object(object(v.semantica_turno).catalog_request).semantic_preferences = ['buenas vistas'] }],
    ['current bedrooms', v => { object(object(v.semantica_turno).property).filters = { bedrooms: 2 } }],
    ['household', v => { object(v.semantica_turno).household = { adults: 2 } }],
    ['amount', v => { object(v.semantica_turno).budget = { status: 'amount', amount: 400000, confidence: 'high' } }],
    ['initial capital', v => { object(v.semantica_turno).budget = { status: 'initial_capital', amount: 50000, confidence: 'high' } }],
    ['undefined budget', v => { object(v.semantica_turno).budget = { status: 'no_defined', confidence: 'high' } }],
    ['selected unit', v => { object(v.property_context).selected_ids = ['unit-55'] }],
    ['legacy selected unit', v => { object(v.lead).unit_id = 'unit-55' }],
    ['remembered budget', v => { object(v.lead).budget_max = 400000 }],
    ['required price', v => { object(v.contrato_turno).required_facts = ['price'] }],
    ['uncertain scope', v => { object(v.contrato_turno).scope = { kind: 'clarify_scope' } }],
    ['foreign scope', v => { v.limite_alcance = { kind: 'out_of_scope' } }],
    ['low certainty', v => { object(v.semantica_turno).confidence = 'low' }],
  ]
  for (const [name, modify] of modifications) {
    const input = fixture('', 'property'); modify(input)
    const selected = taskVerifiedContext(input, audit, '')
    assert.notEqual(object(selected.prompt_context_selection).task, 'project_overview', name)
    assert.notEqual(object(selected.prompt_context_selection).task, 'catalog_overview', name)
    assert.equal((selected.catalogo as Row[]).length, 65, name)
    assert.ok(taskModelEvidence(turnEvidence(selected), selected).units.length > 0, name)
  }
})

test('broad catalogue introductions keep complete category ranges without duplicated extrema or member lists', () => {
  const input = fixture('¿Qué ofrece el proyecto?', 'property'), before = structuredClone(input)
  const selected = taskVerifiedContext(input, { source: 'catalog_details' }, '¿Qué ofrece el proyecto?')
  const canonical = turnEvidence(selected), model = taskModelEvidence(canonical, selected)
  assert.equal(object(selected.prompt_context_selection).task, 'catalog_overview')
  assert.equal(model.units.length, 0)
  assert.ok(model.groups.every(group => group.aggregation === 'range' && !('member_ids' in group)))
  for (const category of ['local', 'suite', 'departamento', 'penthouse']) {
    const range = model.groups.find(group => group.category === category && group.bedrooms_filter === null)!
    const members = catalog.filter(unit => unit.category === category)
    assert.ok(range, category)
    assert.equal(range.member_count, members.length)
    assert.equal(range.published_commercial_price, Math.min(...members.map(unit => unit.published_commercial_price)))
    assert.equal(object(range.upper_values).published_commercial_price, Math.max(...members.map(unit => unit.published_commercial_price)))
  }
  assert.ok(JSON.stringify(model).length < JSON.stringify(canonical).length * 0.4)
  assert.equal(canonical.units.length, 65); assert.ok(canonical.groups.some(group => group.aggregation === 'max'))
  assert.deepEqual(input, before)
})

test('an older contract with a different request cannot hide an independent interpreted request of the same count', () => {
  const input = fixture('¿Qué significa ese concepto?', 'property')
  input.solicitudes_interpretadas = [{ domain: 'property', request: 'Ver características de la unidad 502', confidence: 'high',
    evidence: 'Ver características de la unidad 502', source: 'pending', source_message_id: 'previous-message' }]
  const selected = taskVerifiedContext(input, audit, '¿Qué significa ese concepto?')
  assert.equal(object(selected.prompt_context_selection).task, 'multiple_requests')
  assert.equal(taskModelEvidence(turnEvidence(selected), selected).units.length, 65)
})

test('the same compact context reaches writer and reviewer while the commercial next question and review switch remain effective', async () => {
  const current = 'bueno y para que necesitaria esa guia personalizada?'
  const answer = 'La guía permite conocer las opciones según sus intereses.', question = '¿Busca una vivienda o un local para su negocio?'
  const reply = `${answer} Para orientarle con las opciones del proyecto, ${question}`
  for (const enabled of [false, true]) {
    const calls: string[] = [], errors: unknown[] = []
    const result = await withResponseReviewPolicy(responseReviewSettings({ response_review: { enabled } }),
      () => completeTurnReply({ current, baseReply: answer, verified: fixture(current), audit },
        async (_rules, raw, _schema, _image, _file, _tone, task) => {
          calls.push(String(task))
          try {
            const input = object(raw), obligation = (input.obligaciones_del_turno as Row[]).find(item => item.id === 'commercial_next_step')!
            assert.equal(obligation.question_id, 'property_category')
            if (task === 'writing') {
              assert.deepEqual(object(input.evidencia_turno).units, []); assert.deepEqual(object(input.evidencia_turno).groups, [])
              assert.deepEqual(object(input.contexto_verificado).entrega_proyecto, fixture(current).entrega_proyecto)
            } else {
              assert.deepEqual(object(input.fuentes_autorizadas).unidades, []); assert.deepEqual(object(input.fuentes_autorizadas).grupos, [])
            }
          } catch (error) { errors.push(error); throw error }
          return task === 'writing' ? { reply, question: null, requests: [] }
            : { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
        }))
    assert.deepEqual(errors, [])
    assert.deepEqual(calls, enabled ? ['writing', 'review'] : ['writing'])
    assert.equal(result.audit.status, enabled ? 'checked' : 'review_disabled')
    assert.equal(result.reply, reply); assert.equal(result.needsAdvisor, false)
    assert.equal(journeyPendingQuestion(reply, object(result.audit.commercial_journey), true).id, 'property_category')
  }
})
