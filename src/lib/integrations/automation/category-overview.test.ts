import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { taskVerifiedContext, taskModelEvidence } from './task-context'
import { turnEvidence } from './turn-evidence'
import { validateBusinessFacts } from './business-facts'
import { completeTurnReply } from './turn-completeness'
import { leadIntroductionTurn } from './lead-introduction'

const catalog = Array.from({ length: 49 }, (_, i) => ({ id: `unit-${i}`, unit_number: String(100 + i),
  category: i < 10 ? 'suite' : i < 40 ? 'departamento' : 'penthouse', bedrooms: i < 10 ? 1 : i % 2 ? 2 : 3,
  floor_number: i < 40 ? 2 : 6, published_commercial_price: 210000 + i * 5000,
  spaces: 'Sala, comedor, cocina, balcón', status: 'disponible' }))
const request = { domain: 'property', request: 'Opciones para vivienda', evidence: 'quiero algo para vivir', confidence: 'high' }
const info = (): Row => ({ catalogo: catalog, catalog_search: { embeddingsEnabled: true },
  politica_comercial: { precios_autorizados: true },
  property_context: { query: { group: 'residential', operation: 'search', filters: {} }, selected_ids: [] },
  solicitudes_interpretadas: [request],
  semantica_turno: { primary_intent: 'project_information', confidence: 'high',
    property: { operation: 'search', group: 'residential', reference_kind: 'none' },
    catalog_request: { purpose: 'search', requirements: [], semantic_preferences: [] } } })
const audit = { source: 'catalog_search', semantic_review_enabled: true, business_risk_review_enabled: true,
  resolved_turn_intent: { objective: 'project_information', requests: [request] } }
const question = { role: 'necessary_clarification', purpose: 'choose_property', missing_datum: 'Dormitorios', next_decision: 'Filtrar viviendas' }

test('broad category selection keeps every category and its full ranges, omitting individual sheets only in optimized mode', () => {
  const original = info(), before = structuredClone(original)
  const selected = taskVerifiedContext(original, audit, request.evidence)
  assert.equal(object(selected.prompt_context_selection).task, 'category_overview')
  const canonical = turnEvidence(selected), model = taskModelEvidence(canonical, selected)
  assert.equal(canonical.units.length, 49)
  assert.equal(model.units.length, 0)
  for (const category of ['suite', 'departamento', 'penthouse']) {
    const groups = model.groups.filter(g => g.category === category)
    assert.ok(groups.length, category)
    const members = catalog.filter(u => u.category === category)
    assert.equal(Math.min(...groups.map(g => Number(g.published_commercial_price))), Math.min(...members.map(u => u.published_commercial_price)))
    assert.equal(Math.max(...groups.map(g => Number(object(g.upper_values).published_commercial_price))), Math.max(...members.map(u => u.published_commercial_price)))
  }
  assert.ok(JSON.stringify(model).length < JSON.stringify(canonical).length * 0.4)
  assert.deepEqual(original, before)
  const off = { ...original, catalog_search: { embeddingsEnabled: false } }
  assert.equal(taskVerifiedContext(off, audit, request.evidence), off)
  assert.equal(taskModelEvidence(turnEvidence(off), off).units.length, 49)
})

test('specific attributes, semantic preferences, comparisons and multiple requests keep detailed evidence', () => {
  for (const modify of [
    (v: Row) => { object(object(v.property_context).query).filters = { bedrooms: 3 } },
    (v: Row) => { object(object(v.semantica_turno).catalog_request).requirements = [{ field: 'area_exterior_m2', value: 20 }] },
    (v: Row) => { object(object(v.semantica_turno).catalog_request).semantic_preferences = ['buenas vistas'] },
    (v: Row) => { object(object(v.property_context).query).operation = 'compare' },
    (v: Row) => { object(v.property_context).selected_ids = ['unit-48'] },
    (v: Row) => { v.solicitudes_interpretadas = [request, { domain: 'financing' }] },
  ]) {
    const input = info(); modify(input)
    const selected = taskVerifiedContext(input, audit, request.evidence)
    assert.notEqual(object(selected.prompt_context_selection).task, 'category_overview')
    assert.ok(taskModelEvidence(turnEvidence(selected), selected).units.length > 0)
  }
})

test('category metadata has no numeric endpoint; wrong categories and nonconstant numeric equality still fail', () => {
  const evidence = turnEvidence(info())
  const group = evidence.groups.find(g => g.id === 'group:penthouse:all:range')!
  const fact = { statement: 'El proyecto incluye penthouses', kind: 'catalog_value', subject_id: group.id,
    field: 'category', value: 'penthouse', relation: 'eq', unit: 'text', scope: null }
  assert.equal(validateBusinessFacts([fact], evidence.units, evidence.groups, {})[0].status, 'verified')
  assert.equal(validateBusinessFacts([{ ...fact, value: 'local' }], evidence.units, evidence.groups, {})[0].status, 'contradiction')
  assert.equal(validateBusinessFacts([{ ...fact, field: 'published_commercial_price', value: group.published_commercial_price, unit: 'USD' }], evidence.units, evidence.groups, {})[0].status, 'unverified')
})

test('residential presentation uses one writer and one reviewer with no sheets and preserves its next question', async () => {
  const calls: string[] = []
  const reply = 'Tenemos suites, departamentos y penthouses. ¿Cuántos dormitorios necesita?'
  const result = await completeTurnReply({ current: request.evidence, baseReply: reply, verified: info(), audit },
    async (_rules, raw, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      const context = object(raw)
      if (task === 'writing') {
        assert.deepEqual(object(context.evidencia_turno).units, [])
        return { reply, question: { ...question, text: '¿Cuántos dormitorios necesita?' }, requests: [
          { fragment: 'R1', intent: request.request, status: 'answered', evidence: reply, request_type: 'general_information', fact_key: 'other' }] }
      }
      const sources = object(context.fuentes_autorizadas)
      assert.deepEqual(sources.unidades, [])
      const group = (sources.grupos as Row[]).find(g => g.category === 'penthouse')!
      assert.ok(group)
      return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], question: { ...question, offered_action: 'information' },
        facts: [{ statement: 'Tenemos penthouses', kind: 'catalog_value', subject_id: group.id,
          field: 'category', value: 'penthouse', relation: 'eq', unit: 'text', scope: null, upper_value: null }] }
    })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.deepEqual(calls, ['writing', 'review'])
  assert.equal(result.reply, reply)
})

test('first information request receives courtesy before review without adding a model call or repeating it later', async () => {
  const current = 'quieor informacion'
  const introduction = leadIntroductionTurn({ current, reply: '', extracted: { turn_semantics: {
    primary_intent: 'project_information', confidence: 'high' } }, audit: { source: 'project_overview' } })
  const draft = 'La Vilet está en Puertas del Sol, Cuenca. Para enviarle el brochure y brindarle una guía personalizada, ¿cuál es su nombre y en qué ciudad o país reside?'
  for (const first of [true, false]) {
    const calls: string[] = []
    const expected = first ? 'Con mucho gusto le comparto información. ' + draft : draft
    const result = await completeTurnReply({ current, baseReply: introduction.reply, verified: { proyecto: { name: 'La Vilet' } },
      audit: { ...audit, ...introduction.audit, profile_introduction: { ...object(introduction.audit.profile_introduction),
        reason: first ? 'first_substantive_project_contact' : 'continue_opening_profile_exchange' } } },
    async (_rules, raw, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      if (task === 'writing') return { reply: draft, question: { ...question, purpose: 'collect_lead_profile' }, requests: [
        { fragment: 'R1', intent: 'Información', status: 'answered', evidence: draft, request_type: 'general_information', fact_key: 'other' }] }
      assert.equal(object(raw).borrador, expected)
      return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: { ...question, purpose: 'collect_lead_profile', offered_action: 'information' } }
    })
    assert.equal(result.audit.status, 'checked')
    assert.equal(result.reply, expected)
    assert.deepEqual(calls, ['writing', 'review'])
  }
})
