import test from 'node:test'
import assert from 'node:assert/strict'
import { projectIntroductionContext } from '@/lib/inmobiliaria/projectIntroduction'
import { generalProjectIntroductionTurn, projectIntroductionForTurn, withProjectIntroductionForTurn } from './project-introduction-context'
import { resolveTurnIntent } from './turn-intent'
import { taskVerifiedContext } from './task-context'
import { projectInformationReply } from './commercial-experience'
import { verifiedClaimSources } from './turn-evidence'
import { compactTurnPromptContext } from './turn-prompt-context'
import { businessRiskContext } from './business-risk-review'
import { object, type Row } from './data'

const summary = 'La Vilet combina viviendas y locales comerciales en Puertas del Sol, Cuenca.'
const fixture = (): Row => {
  const current = 'Quiero conocer el proyecto', requests = [{ domain: 'property', confidence: 'high', request: 'Información general del proyecto', evidence: current, source: 'current' }]
  const semantica_turno = { primary_intent: 'project_information', primary_evidence: current, confidence: 'high', requests,
    property: { operation: 'none', reference_kind: 'none', unit_numbers: [], filters: {} },
    catalog_request: { purpose: 'none', requirements: [], semantic_preferences: [] }, budget: { status: 'not_discussed' } }
  return { semantica_turno, solicitudes_interpretadas: requests,
    contrato_turno: resolveTurnIntent({ current, semantics: semantica_turno, requests, scope: { kind: 'neutral', uncertain: false } }),
    configuracion_presentacion_proyecto: projectIntroductionContext({ project_introduction: { current: { enabled: true, summary, source: 'Responsable del proyecto' } } }),
    posicionamiento_proyecto: {}, proyecto: { name: 'La Vilet' }, property_context: { query: {}, selected_ids: [] },
    perfil_lead: { name_status: 'pending', residence_status: 'pending' }, materiales: [{ type: 'brochure', url: 'https://example.com/brochure.pdf' }],
    modo_comercial: 'lanzamiento', estado_proyecto: null, entrega_proyecto: { available: true, delivery: '2028', certainty: 'estimated' },
    instalaciones: [], lead: {}, historial: [{ role: 'bot', content: 'Hola. ¿En qué podemos ayudarle?' }] }
}
test('single general request receives the approved summary after a greeting, without losing profile, materials or next step', () => {
  const input = fixture(), before = structuredClone(input), selected = withProjectIntroductionForTurn(input)
  assert.equal(object(selected.presentacion_general_proyecto).summary, summary)
  assert.equal(selected.configuracion_presentacion_proyecto, undefined)
  for (const key of ['perfil_lead', 'materiales', 'contrato_turno', 'property_context']) assert.deepEqual(selected[key], input[key])
  assert.deepEqual(withProjectIntroductionForTurn(selected), selected)
  assert.deepEqual(input, before)
  const reply = projectInformationReply(input, 'Quiero conocer el proyecto', 'https://example.com/brochure.pdf')
  assert.match(reply, /La Vilet combina viviendas y locales comerciales/)
  assert.match(reply, /brochure/); assert.match(reply, /\?$/)
  assert.doesNotMatch(reply, /obra|construcción|2028|entrega|no ha comenzado/)
})
test('real intent projection keeps a source-less extracted request identical to its canonical current request and ignores unconstrained group all', () => {
  const input = fixture(), extracted = (input.solicitudes_interpretadas as Row[]).map(request => { const result = { ...request }; delete result.source; return result })
  input.solicitudes_interpretadas = extracted
  input.contrato_turno = resolveTurnIntent({ current: 'Quiero conocer el proyecto', semantics: object(input.semantica_turno), requests: extracted,
    scope: { kind: 'neutral', uncertain: false } })
  object(input.contrato_turno).requests = (object(input.contrato_turno).requests as Row[]).map(request => ({ ...request, source: 'current', source_message_id: 'current-message' }))
  object(input.property_context).query = { operation: 'none', group: 'all', category: null, filters: { bedrooms: null, floor_number: null } }
  object(object(input.semantica_turno).property).group = 'all'
  assert.equal(object(projectIntroductionForTurn(input)).summary, summary)
  const mixed = structuredClone(input)
  ;(mixed.solicitudes_interpretadas as Row[]).push({ ...extracted[0], request: '¿Aceptan mascotas?' })
  assert.equal(projectIntroductionForTurn(mixed), null)
})
test('an explicit general overview keeps the approved source despite an incidental broad property group', () => {
  for (const group of ['residential', 'commercial']) {
    const input = fixture(), current = 'Saludos, quiero informacion por favor'
    const requests = [{ domain: 'property', topics: ['project_overview'], confidence: 'high', request: 'Quiero informacion por favor', evidence: current }]
    input.solicitudes_interpretadas = requests
    input.semantica_turno = { ...object(input.semantica_turno), requests, primary_evidence: current,
      property: { ...object(object(input.semantica_turno).property), group } }
    input.contrato_turno = resolveTurnIntent({ current, semantics: object(input.semantica_turno), requests, scope: { kind: 'property', uncertain: false } })
    object(input.property_context).query = { operation: 'none', group, filters: { bedrooms: null } }
    const before = structuredClone(input)
    assert.equal(generalProjectIntroductionTurn(input), true)
    assert.equal(object(projectIntroductionForTurn(input)).summary, summary)
    assert.equal(object(taskVerifiedContext(input, { source: 'catalog_search' }, current).presentacion_general_proyecto).summary, summary)
    assert.deepEqual(input, before)
    for (const topics of [['purchase_prices'], ['property_options'], ['project_overview', 'delivery']]) {
      const concrete = structuredClone(input)
      ;(concrete.solicitudes_interpretadas as Row[])[0].topics = topics
      ;(object(concrete.contrato_turno).requests as Row[])[0].topics = topics
      assert.equal(generalProjectIntroductionTurn(concrete), false, topics.join(','))
      assert.equal(projectIntroductionForTurn(concrete), null)
    }
  }
})
test('greetings, concrete topics, compound requests, uncertainty and active unit selection exclude the presentation irrespective of wording', () => {
  const modifications: [string, (input: Row) => void][] = [
    ['greeting', input => { object(input.semantica_turno).primary_intent = 'other'; object(input.contrato_turno).objective = 'other' }],
    ['price', input => { object(input.contrato_turno).objective = 'ask_price'; object(input.contrato_turno).required_facts = ['price'] }],
    ['delivery', input => { object(input.contrato_turno).required_facts = ['delivery'] }],
    ['two current requests', input => { (input.solicitudes_interpretadas as Row[]).push({ domain: 'property', confidence: 'high', request: 'Admiten mascotas', evidence: 'y mascotas', source: 'current' }) }],
    ['financial request', input => { (input.solicitudes_interpretadas as Row[]).push({ domain: 'financing', confidence: 'high', request: 'Cuotas JEP' }) }],
    ['low certainty', input => { object(input.semantica_turno).confidence = 'low' }],
    ['pending request', input => { (object(input.contrato_turno).requests as Row[])[0].source = 'pending' }],
    ['property category', input => { object(object(input.semantica_turno).property).category = 'suite' }],
    ['floor zero', input => { object(object(input.semantica_turno).property).filters = { floor_number: 0 } }],
    ['selected unit', input => { object(input.property_context).selected_ids = ['unit-502'] }],
    ['legacy unit', input => { object(input.lead).unit_id = 'unit-502' }],
    ['details clarification', input => { object(object(input.semantica_turno).property).operation = 'details' }],
    ['followup clarification', input => { object(object(input.semantica_turno).property).reference_kind = 'followup' }],
    ['brochure already delivered', input => { input.estado_conversacion = { brochure_sent: true } }],
    ['presentation already delivered', input => { input.estado_conversacion = { presentation_sent: true } }],
    ['commercial pending question', input => { input.pregunta_pendiente = { id: 'property_category', act: 'discover' } }],
    ['known commercial preference', input => { object(input.lead).purchase_purpose = 'vivir' }],
    ['known commercial context', input => { input.conversacion = { datos_conocidos: { categoria: 'suite' } } }],
    ['loan amount', input => { object(input.semantica_turno).budget = { status: 'initial_capital', amount: 200000, confidence: 'high' } }],
    ['catalog preferences', input => { object(object(input.semantica_turno).catalog_request).semantic_preferences = ['buenas vistas'] }],
  ]
  for (const [name, modify] of modifications) {
    const input = fixture(); modify(input)
    assert.equal(projectIntroductionForTurn(input), null, name)
    const selected = withProjectIntroductionForTurn(input)
    assert.equal(selected.presentacion_general_proyecto, undefined, name)
    assert.equal(selected.configuracion_presentacion_proyecto, undefined, name)
    assert.doesNotMatch(JSON.stringify(selected), /Responsable del proyecto/, name)
  }
})
test('profile pending exchange still allows the first general information, including after a greeting', () => {
  const input = fixture(); input.pregunta_pendiente = { id: 'lead_profile', act: 'profile' }
  input.lead = { budget: 0, budget_max: null, preferred_bedrooms: 0 }
  input.conversacion = { datos_conocidos: { categoria: null, proposito: null, dormitorios: 0, presupuesto: 0 } }
  assert.equal(object(projectIntroductionForTurn(input)).summary, summary)
})
test('unknown or disabled summaries expose no reusable text and the legacy overview does not assert construction by default', () => {
  const input = fixture(); input.configuracion_presentacion_proyecto = { available: false, status: 'disabled' }
  assert.equal(projectIntroductionForTurn(input), null)
  const reply = projectInformationReply(input, 'Quiero información general del proyecto', 'https://example.com/brochure.pdf')
  assert.match(reply, /suites y departamentos/)
  assert.doesNotMatch(reply, /construcción|obra|2028|entrega|no ha comenzado/)
})
test('selection survives compacting and becomes a verified source for both review contracts', () => {
  const input = fixture(), selected = taskVerifiedContext(input, { source: 'project_overview' }, 'Quiero conocer el proyecto')
  assert.equal(object(selected.presentacion_general_proyecto).summary, summary)
  const sources = verifiedClaimSources(selected, {}, {}, 'Quiero conocer el proyecto')
  assert.ok(sources.some(source => source.path === 'contexto_verificado.presentacion_general_proyecto' && source.kind === 'project_fact'))
  const compact = compactTurnPromptContext({ contexto_verificado: selected, evidencia_afirmaciones: sources })
  assert.equal(object(object(compact.contexto_verificado).presentacion_general_proyecto).summary, summary)
  assert.equal(object(compact.contexto_verificado).configuracion_presentacion_proyecto, undefined)
  const risk = businessRiskContext({ current: 'Quiero conocer el proyecto', reply: summary, verified: selected, audit: {},
    obligations: [], units: [], groups: [], projectFacts: [], claimSources: sources, allowedLinks: [] })
  assert.ok((object(risk.fuentes_autorizadas).otros_hechos_y_politicas as Row[]).some(source => source.path === 'contexto_verificado.presentacion_general_proyecto'))
})
