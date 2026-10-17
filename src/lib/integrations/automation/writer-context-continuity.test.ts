import assert from 'node:assert/strict'
import test from 'node:test'
import { object, type Row } from './data'
import { leadIntroductionTurn } from './lead-introduction'
import { commercialStageContract } from './response-plan'
import { turnEvidence } from './turn-evidence'
import { writerPresentationEvidence } from './writer-presentation-scope'
import { writerContextSlices } from '../../../components/inmobiliaria/automation/workflow/writerContext'
import type { WorkflowExecutionStep } from '../../../components/inmobiliaria/automation/workflow/executionWorkflow'

const profile: Row = { full_name: 'Carlos', name_status: 'confirmed', residence_status: 'unknown',
  sources: { full_name: { source: 'lead_declaration', evidence: 'me llamo carlos' } },
  declared_location: { kind: 'former', city: null, country: 'Ecuador', evidence: 'vivi en ecuador' } }
const prior = { version: 3, status: 'pending', presentation_sent: true, request_sent: true,
  requested_fields: ['full_name', 'residence'], reminder_count: 0, brochure_sent: false }

test('a partial profile reminder preserves the former place and does not order another brochure offer', () => {
  const intro = leadIntroductionTurn({ current: 'gracias\nme llamo carlos\nvivi en ecuador', profile,
    extracted: { lead_profile: profile }, summary: { _lead_introduction: prior }, reply: '' })
  const plan = object(intro.audit.profile_introduction)
  assert.equal(plan.stage, 'reminder')
  assert.equal(plan.question_purpose, 'collect_residence')
  const contract = commercialStageContract(intro.audit, { perfil_lead: profile })
  assert.deepEqual(contract.datos_a_pedir, ['current_residence'])
  assert.equal(object(contract.brochure).accion, 'await_profile')
  assert.equal(object(contract.brochure).url, null)
  assert.equal(object(contract.objetivo_presentacion).offer_project_brochure, false)
  assert.equal(object(contract.objetivo_presentacion).repeat_previous_offer, false)
  assert.deepEqual(contract.lugar_declarado, profile.declared_location)
  assert.equal(object(contract.datos_confirmados).residencia_actual, null)
})

test('the first profile request still links the initial offer and explicit material requests still share', () => {
  const initial = commercialStageContract({ profile_introduction: { stage: 'request', question_purpose: 'collect_profile', brochure_deferred: true } })
  assert.equal(object(initial.brochure).accion, 'offer_after_profile')
  assert.equal(object(initial.objetivo_presentacion).offer_project_brochure, true)
  const direct = commercialStageContract({ profile_introduction: { stage: 'reminder', brochure_deferred: true, brochure_required: true } })
  assert.equal(object(direct.brochure).accion, 'share_now')
})

const units: Row[] = [
  ...[2, 3, 4, 5].map(floor => ({ id: floor + '02', bedrooms: 3, floor_number: floor, area_internal_m2: 120.83, area_exterior_m2: 27.03 })),
  ...[3, 4, 5].map(floor => ({ id: floor + '04', bedrooms: 2, floor_number: floor, area_internal_m2: 109.69, area_exterior_m2: 34.59 })),
].map(unit => ({ ...unit, unit_number: unit.id, category: 'departamento', is_published: true, status: 'disponible' }))
const verified: Row = { catalogo: units, siguiente_paso_comercial: { action: 'select_property', presentation: 'floors',
  selection_scope: { unit_ids: ['304', '404', '504'], categories: ['departamento'], floors: [3, 4, 5] } },
  property_context: { query: { category: 'departamento', operation: 'none', filters: { bedrooms: null } } } }

test('a presentation uses its exact members, not mixed two/three-bedroom category ranges', () => {
  const canonical = turnEvidence(verified), before = structuredClone(canonical)
  const evidence = writerPresentationEvidence(canonical, verified)
  assert.deepEqual(evidence.units.map(unit => unit.id), ['304', '404', '504'])
  assert.deepEqual(evidence.presentation_scope?.bedroom_counts, [2])
  assert.deepEqual(evidence.presentation_scope?.floors, [3, 4, 5])
  assert.ok(evidence.groups.length)
  for (const group of evidence.groups) {
    assert.equal(group.area_internal_m2, 109.69)
    assert.equal(object(group.upper_values).area_internal_m2, 109.69)
    assert.equal(group.area_exterior_m2, 34.59)
    assert.equal(object(group.upper_values).area_exterior_m2, 34.59)
    assert.equal(group.complete_for_query, false)
  }
  assert.deepEqual(canonical, before, 'canonical evidence is not modified')
})

for (const query of [{ semantica_turno: { catalog_request: { purpose: 'compare' } } },
  { solicitudes_interpretadas: [{ domain: 'property', topics: ['bedrooms'] }] },
  { prompt_context_selection: { task: 'multiple_requests' } },
  { property_context: { query: { operation: 'compare' } } }]) test('an independent current question retains broader evidence: ' + JSON.stringify(query), () => {
  const canonical = turnEvidence(verified), result = writerPresentationEvidence(canonical, { ...verified, ...query })
  assert.equal(result.units.length, 7)
  assert.equal(result.presentation_scope?.use, 'presentation_beside_current_query')
  assert.ok(result.groups.some(group => group.bedrooms_filter === 3))
})

test('missing presentation members do not create a partial range presented as complete', () => {
  const evidence = turnEvidence({ ...verified, catalogo: units.filter(unit => unit.id !== '504') })
  assert.equal(writerPresentationEvidence(evidence, verified), evidence)
})

const captured = { contrato_redaccion: { objetivo_siguiente: { question_id: 'property_floor', instruction: 'Primera línea.\nSegunda línea.' } },
  contexto_verificado: { siguiente_paso_comercial: verified.siguiente_paso_comercial,
    lead: { name: 'Nombre visible' }, perfil_lead: profile, ficha_comercial: null },
  estado_operativo: { profile_introduction: { stage: 'reminder' } } }
const step = { key: 'model_request', input: { ai_role: 'writer', prompt_snapshot: { data: captured, limited: false, privacy_filtered: false } } } as unknown as WorkflowExecutionStep
test('writer inspector exports recorded values at their original paths including nulls, without reconstructing a card', () => {
  const result = writerContextSlices(step)!
  assert.deepEqual(result.input, captured)
  assert.deepEqual(object(result.decision.contexto_verificado).siguiente_paso_comercial, verified.siguiente_paso_comercial)
  assert.equal(object(result.profile.contexto_verificado).ficha_comercial, null)
  assert.equal(Object.hasOwn(object(result.profile.contexto_verificado), 'memoria_comercial'), false)
  assert.equal(result.limited, false)
  assert.equal(result.protected, false)
})
test('writer inspector distinguishes partial captures, missing captures and other AI roles', () => {
  assert.equal(writerContextSlices({ ...step, input: { ai_role: 'extractor' } }), null)
  assert.equal(writerContextSlices({ ...step, input: { ai_role: 'writer' } }), null)
  const result = writerContextSlices({ ...step, input: { ai_role: 'writer', prompt_snapshot: { data: {}, limited: true, privacy_filtered: true } } })!
  assert.deepEqual(result.decision, {})
  assert.equal(result.limited, true)
  assert.equal(result.protected, true)
})
