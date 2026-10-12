import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { projectIntroductionContext } from '@/lib/inmobiliaria/projectIntroduction'
import { leadIntroductionTurn, PROFILE_INVITATION } from './lead-introduction'
import { resolveTurnIntent } from './turn-intent'
import { finalWriterContract, protectInitialProjectPresentation } from './response-plan'
import { responseContentScope, projectContentForWriter } from './response-content-scope'
import { normalizeTurnSemantics } from './turn-semantics'
import { resolvePropertyTurn, propertyContext } from './property-context'
import { commercialJourneyPlan } from './commercial-journey'
import { withHandoffNotice } from './handoff-copy'
import { applyTurnGreeting } from './conversation-style'

const summary = 'La Vilet es un proyecto de uso mixto ubicado en Puertas del Sol, Cuenca, con suites, departamentos, penthouses y locales comerciales.'
const inventory: Row[] = [
  { id: 's201', category: 'suite', unit_number: '201', bedrooms: 1, floor_number: 2, published_commercial_price: 160000 },
  { id: 'd202', category: 'departamento', unit_number: '202', bedrooms: 3, floor_number: 2, published_commercial_price: 250000 },
  { id: 'ph602', category: 'penthouse', unit_number: '602', bedrooms: 3, floor_number: 6, published_commercial_price: 550000 },
  { id: 'lc1', category: 'local', unit_number: 'LC1', floor_number: 0, published_commercial_price: 50000 },
].map(unit => ({ ...unit, status: 'disponible', is_published: true, area_internal_m2: 120.83, spaces: ['sala', 'comedor'] }))

function opening(current: string, confidence: string): Row {
  const requests = [{ domain: 'property', request: 'Información general del proyecto', topics: ['project_overview'],
    evidence: current, confidence }]
  const semantics = { primary_intent: 'project_information', primary_evidence: current, confidence,
    property: { operation: 'none', reference_kind: 'none', filters: {}, unit_numbers: [] }, budget: { status: 'not_discussed' } }
  return { semantica_turno: semantics, solicitudes_interpretadas: requests,
    contrato_turno: resolveTurnIntent({ current, semantics, requests, scope: { kind: 'property', uncertain: false } }),
    configuracion_presentacion_proyecto: projectIntroductionContext({}, 'La Vilet'),
    proyecto: { name: 'La Vilet', floors: 8, housing_units: 49, parking_basements: 2 },
    catalogo: inventory, instalaciones: [{ name: 'ascensores', count: 2 }] }
}

for (const confidence of ['high', 'medium']) for (const current of ['Hola quiero información', 'Saludos, quiero información por favor']) {
  test(`the initial summary is protected against omission and expansion across routes: ${confidence}, ${current}`, () => {
    const info = opening(current, confidence)
    for (const source of ['project_overview', 'catalog_search', 'future_general_information']) {
      const planned = leadIntroductionTurn({ current, projectInfo: info,
        extracted: { turn_semantics: info.semantica_turno, requests: info.solicitudes_interpretadas },
        reply: 'Tenemos muchas opciones. ¿Qué le gustaría conocer?', audit: { source, resolved_turn_intent: info.contrato_turno } })
      assert.equal(object(object(planned.audit.profile_introduction).presentation).approved_summary, summary)
      const scope = responseContentScope(current, info, planned.audit)
      assert.equal(object(scope.property_presentation).kind, 'approved_summary')
      const writer = projectContentForWriter({ ...info, alcance_contenido_turno: scope }, scope)
      assert.equal(writer.catalogo, undefined)
      assert.equal(writer.instalaciones, undefined)
      assert.deepEqual(writer.proyecto, { name: 'La Vilet' })
      const contract = finalWriterContract(planned.reply, planned.audit, { current, verified: info })
      assert.equal(contract.base_role, 'approved_initial_presentation')
      assert.equal(object(contract.presentacion).policy, 'required_approved_business_copy')
      for (const draft of ['Para orientarle, ¿cómo se llama?', `${summary} Tiene 49 viviendas en 2 subsuelos y 8 pisos.`]) {
        assert.equal(protectInitialProjectPresentation(draft, planned.audit, { current, verified: info }), `${summary}\n\n${PROFILE_INVITATION}`)
      }
    }
  })
}

test('a legacy general enquiry receives the same approved summary, while a greeting and a concrete enquiry keep their routes', () => {
  const config = { configuracion_presentacion_proyecto: projectIntroductionContext({}, 'La Vilet') }
  const opening = leadIntroductionTurn({ current: 'Saludos, quiero información por favor', projectInfo: config, reply: 'Podemos orientarle.' })
  assert.equal(object(object(opening.audit.profile_introduction).presentation).approved_summary, summary)
  const greeting = leadIntroductionTurn({ current: 'Hola', projectInfo: config, reply: 'Hola. ¿En qué podemos ayudarle?' })
  assert.equal(greeting.applied, false)
  const specific = leadIntroductionTurn({ current: '¿Qué área tiene la suite 201?', projectInfo: config, reply: 'Tiene 50 m².' })
  assert.equal(object(object(specific.audit.profile_introduction).presentation).required, false)
  assert.equal(protectInitialProjectPresentation('Tiene 50 m².', specific.audit), 'Tiene 50 m².')
})

test('a first general overview still gets its protected summary when a profile request exists without a delivered presentation', () => {
  const current = 'Quiero información del proyecto', info = opening(current, 'high')
  const result = leadIntroductionTurn({ current, projectInfo: info,
    summary: { _lead_introduction: { version: 3, status: 'pending', request_sent: true,
      requested_fields: ['full_name', 'residence'], presentation_sent: false } },
    extracted: { turn_semantics: info.semantica_turno, requests: info.solicitudes_interpretadas },
    reply: 'Podemos ayudarle.', audit: { source: 'future_information', resolved_turn_intent: info.contrato_turno } })
  assert.equal(object(object(result.audit.profile_introduction).presentation).required, true)
  assert.match(protectInitialProjectPresentation('Puede ver el brochure.', result.audit), /La Vilet es un proyecto de uso mixto/)
})

test('a protected presentation preserves the next asset question for a previously confirmed profile', () => {
  const question = '¿Le interesa una vivienda o un local comercial?'
  const result = protectInitialProjectPresentation('Hay 49 unidades.', { profile_introduction: {
    presentation: { required: true, approved_summary: summary }, question: '', brochure_required: true,
    brochure_url: 'https://example.com/brochure.pdf' } }, { verified: {
    siguiente_paso_comercial: { action: 'discover_use', question_id: 'property_category', question } } })
  assert.equal(result, `${summary}\n\nBrochure del proyecto: https://example.com/brochure.pdf\n\n${question}`)
})

test('a verified late handoff remains visible after the final approved-summary preparation and stays idempotent', () => {
  const current = 'Hola quiero información', info = opening(current, 'high')
  const planned = leadIntroductionTurn({ current, projectInfo: info,
    extracted: { turn_semantics: info.semantica_turno, requests: info.solicitudes_interpretadas },
    reply: 'Podemos orientarle.', audit: { source: 'project_overview', resolved_turn_intent: info.contrato_turno } })
  // This notice represents the already verified operational result. The helper
  // receives it explicitly; an overview alone never invents or registers a handoff.
  const notice = 'He dejado su consulta en la bandeja del equipo para que un asesor le ayude con ese detalle.'
  const audit = { ...planned.audit, additional_questions_handoff: true }
  const prepare = (reply: string, verifiedNotice = '') => applyTurnGreeting(withHandoffNotice(
    protectInitialProjectPresentation(reply, audit, { current, verified: info }), verifiedNotice), 'Hola.')
  const final = prepare('Una respuesta anterior del redactor.', notice)
  assert.ok(final.includes(summary))
  assert.ok(final.includes(notice))
  assert.ok(final.includes(PROFILE_INVITATION))
  assert.equal(prepare(final, notice), final)
  assert.doesNotMatch(prepare('Una respuesta anterior del redactor.'), /bandeja del equipo|asesor le ayude/)
})

test('a CRM category and its technical retrieval scope do not suppress a current general opening without declaration evidence', () => {
  const current = 'Hola quiero información', info = opening(current, 'high')
  info.lead = { preferred_category: 'departamento' }
  info.conversacion = { datos_conocidos: { categoria: 'departamento' } }
  info.property_context = { query: { category: 'departamento', group: 'residential', operation: 'none', filters: {} } }
  info.hechos_confirmados = { property: { category: 'departamento', confidence: 'high', evidence: 'Me interesa vivienda' } }
  const result = leadIntroductionTurn({ current, projectInfo: info,
    extracted: { turn_semantics: info.semantica_turno, requests: info.solicitudes_interpretadas }, reply: '¿Cómo se llama?',
    audit: { source: 'catalog_search', resolved_turn_intent: info.contrato_turno } })
  assert.equal(object(object(result.audit.profile_introduction).presentation).approved_summary, summary)
})

function journey(purpose: string | null, group = 'residential', status = 'maximum_total'): Row {
  return { lead: { purchase_purpose: purpose }, catalogo: inventory, catalogo_verificacion: inventory,
    catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
    hechos_confirmados: { property: { group, category: group === 'commercial' ? 'local' : null,
      evidence: group === 'commercial' ? 'Busco un local comercial' : 'Busco una vivienda', confidence: 'high' } },
    property_context: { query: { group, operation: 'search', filters: {} }, selected_ids: [] },
    semantica_turno: { primary_intent: 'discuss_budget', confidence: 'high', budget: {
      status, amount: status === 'maximum_total' ? 600000 : null, evidence: 'Tengo seiscientos mil', confidence: 'high' } },
    financiamiento: { partners: ['Cooperativa JEP'], journey: {} } }
}

test('housing proceeds from budget to bedrooms without requiring living versus investment and preserves volunteered purpose', () => {
  for (const purpose of [null, 'vivir', 'invertir']) for (const budget of ['maximum_total', 'no_defined_budget']) {
    const info = journey(purpose, 'residential', budget)
    const plan = commercialJourneyPlan(info)
    assert.equal(plan.action, 'discover_bedrooms')
    assert.equal(plan.question, '¿Cuántos dormitorios necesita?')
    assert.equal(object(info.lead).purchase_purpose, purpose)
  }
  const financed = journey(null)
  financed.financiamiento = { partners: ['Cooperativa JEP'], journey: { accepted: true },
    entry: { status: 'amount', amount: 100000, evidence: 'Ese dinero será mi entrada', source_message_id: 'entry-answer' } }
  assert.equal(commercialJourneyPlan(financed).action, 'discover_bedrooms')
})

test('investment alone still requires the asset, while commercial inventory never asks residential bedrooms', () => {
  const investment = journey('invertir')
  investment.hechos_confirmados = {}; investment.property_context = { query: {}, selected_ids: [] }
  assert.equal(commercialJourneyPlan(investment).action, 'discover_use')
  assert.equal(object(investment.lead).purchase_purpose, 'invertir')
  const local = commercialJourneyPlan(journey(null, 'commercial'))
  assert.equal(local.action, 'select_property')
  assert.notEqual(local.question_id, 'property_purpose')
  assert.notEqual(local.question_id, 'property_bedrooms')
})

test('generic housing and budget echoes cannot create category exclusions in the canonical or durable query', () => {
  let saved: Row = {}
  for (const current of ['Me interesa una vivienda', 'Tengo seiscientos mil']) {
    const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'answer_previous', primary_evidence: current,
      confidence: 'high', property: { group: 'residential', category: current.includes('vivienda') ? 'departamento' : null,
        excluded_categories: ['suite', 'penthouse', 'local'], operation: current.includes('vivienda') ? 'search' : 'none',
        reference_kind: 'none', filters: {}, evidence: current, confidence: 'high' } } }, current, {})
    assert.deepEqual(object(semantics.property).excluded_categories, [])
    const result = resolvePropertyTurn(inventory, current, { _property_context: saved }, [], semantics)
    saved = result.context
    assert.deepEqual(saved.excluded_categories, [])
    assert.equal(object(saved.query).category, null)
  }
})

test('a current semantic rejection keeps its category source and survives later turns; only proven bad sources are removed', () => {
  const current = 'Preferiría departamentos; los penthouses me parecen demasiado amplios'
  const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'select_property', primary_evidence: current,
    confidence: 'medium', property: { category: 'departamento', excluded_categories: ['penthouse'], operation: 'search',
      evidence: current, confidence: 'medium', reference_kind: 'none', filters: {} } } }, current, {})
  assert.deepEqual(object(semantics.property).excluded_categories, ['penthouse'])
  const resolved = resolvePropertyTurn(inventory, current, {}, [], semantics)
  assert.deepEqual(resolved.context.excluded_categories, ['penthouse'])
  const resumed = propertyContext(inventory, resolved.context, [])
  assert.deepEqual(resumed.excluded_categories, ['penthouse'])
  const broadCurrent = 'Sigo buscando una vivienda'
  const broad = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'select_property', primary_evidence: broadCurrent,
    confidence: 'high', property: { group: 'residential', category: null, excluded_categories: [], operation: 'search',
      evidence: broadCurrent, confidence: 'high', reference_kind: 'none', filters: {} } } }, broadCurrent, {})
  assert.deepEqual(resolvePropertyTurn(inventory, broadCurrent, { _property_context: resumed }, [], broad).context.excluded_categories, ['penthouse'])
  const bad = propertyContext(inventory, { excluded_categories: ['penthouse', 'suite'], category_exclusion_sources: {
    penthouse: { evidence: 'Me interesa una vivienda' }, suite: { evidence: 'No me interesa la suite' } } }, [])
  assert.deepEqual(bad.excluded_categories, ['suite'])
  assert.deepEqual(propertyContext(inventory, { excluded_categories: ['penthouse'] }, []).excluded_categories, ['penthouse'])
})
