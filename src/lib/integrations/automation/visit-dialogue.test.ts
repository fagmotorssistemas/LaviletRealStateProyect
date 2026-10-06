import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { visitDialogueTurn, visitDialoguePendingQuestion, visitDialogueBaseReply, visitDialogueIntakeSnapshot,
  rememberVisitDialogue, reconcileVisitDialogueScope } from './visit-dialogue'
import { normalizedVisitIntent, normalizedVisitPreference } from './conversation-rules'
import { commercialJourneyPlan } from './commercial-journey'
import { interpretationInput } from './turn-interpretation-input'
import { normalizedPendingQuestion } from './turn-semantics'
import { visitBusinessHoursReply } from './visit-intake'
import { type ProjectReadiness, projectReadiness, readinessInvitation, readinessRules, validateReadiness } from '@/lib/inmobiliaria/projectReadiness'
import { object, type Row } from './data'

const readiness: ProjectReadiness = { stage: 'not_started', progress: '', verifiedOn: '2026-09-17', enabledPlaces: ['office'], primaryPlace: 'office', conditions: '', officeAtProjectSite: true }
const intent = (current: string, purpose: string, destination: string | null = null, target = 'project') => normalizedVisitIntent({ kind:
  purpose.endsWith('information') ? 'visit_information' : purpose === 'accept_alternative' ? 'accept_visit_preference' : purpose === 'decline' ? 'decline_visit' : 'request_visit',
  purpose, destination, target, evidence: current, confidence: 'high' }, current)
const turn = (current: string, purpose: string, previous: unknown = {}, destination: string | null = null, extra: Row = {}) => visitDialogueTurn({
  current, intent: intent(current, purpose, destination), previous, readiness, sourceMessageId: 'current', ...extra })
const offered = () => turn('Quisiera recorrer el edificio', 'coordination', {}, 'building')

describe('semantic visit destination and informational continuity', () => {
  it('offers the authorized office at the project site without accepting it or creating a visit', () => {
    const plan = offered()
    assert.equal(plan.operation_allowed, false)
    assert.equal(plan.requested_destination, 'building')
    assert.equal(plan.offered_destination, 'office')
    assert.equal(plan.effective_destination, null)
    assert.equal(plan.alternative_accepted, false)
    assert.equal(plan.explain_restriction, true)
    assert.deepEqual(object(plan.state).missing_fields, ['destination_acceptance'])
    assert.match(visitDialogueBaseReply(plan, readiness), /obra todavía no ha iniciado.*oficina.*sitio del proyecto/)
    assert.equal(normalizedPendingQuestion(visitDialoguePendingQuestion(plan)).id, 'visit_destination')
  })
  for (const current of ['Para qué días dispones citas', '¿Cuándo puedo ir?', '¿Hay horarios por la tarde?', '¿Qué fechas tienen libres?']) {
    it(`informs hours without treating ${current} as acceptance or repeating the restriction`, () => {
      const first = offered(), saved = rememberVisitDialogue({}, first, {}, true)
      const plan = turn(current, 'availability_information', saved)
      assert.equal(plan.information_only, true)
      assert.equal(plan.operation_allowed, false)
      assert.equal(plan.alternative_accepted, false)
      assert.equal(plan.explain_restriction, false)
      assert.equal(plan.question_id, 'visit_destination')
      const journey = commercialJourneyPlan({ visit_dialogue_plan: plan, coordinacion_visita: { status: 'collecting' } })
      assert.equal(journey.question_id, 'visit_destination')
      const hours = visitBusinessHoursReply({ 1: { open: '08:30', close: '18:30' } }, { action: 'information' })
      assert.match(hours, /08:30.*18:30.*no cupos confirmados/)
      assert.doesNotMatch(hours, /qué fecha|indíquenos|edificación|obra/)
    })
  }
  it('suspends the visit for an unrelated question without discarding the offered destination', () => {
    const previous = rememberVisitDialogue({}, offered(), {}, true)
    const plan = visitDialogueTurn({ previous, current: '¿Qué tan segura es la zona?', readiness,
      intent: { kind: 'none', purpose: 'none', target: 'project', evidence: '¿Qué tan segura es la zona?', confidence: 'high' } })
    assert.equal(plan.current_kind, 'other')
    assert.equal(plan.explain_restriction, false)
    assert.equal(plan.operation_allowed, false)
    assert.equal(plan.question, null)
    assert.equal(object(plan.state).offered_destination, 'office')
    const journey = commercialJourneyPlan({ visit_dialogue_plan: plan, coordinacion_visita: { status: 'collecting' } })
    assert.equal(journey.action, 'visit_suspended_for_current_query')
    assert.equal(journey.question_id, '')
    assert.doesNotMatch(journey.instruction as string, /elegir.*departamento|presupuesto/)
  })
  it('re-explains access when expressly asked or when verified readiness changes', () => {
    const previous = rememberVisitDialogue({}, offered(), {}, true)
    assert.equal(turn('¿Por qué no se puede recorrer la obra?', 'access_information', previous, 'work_area').explain_restriction, true)
    const changed = visitDialogueTurn({ previous, current: '¿Qué horarios hay?', intent: intent('¿Qué horarios hay?', 'availability_information'),
      readiness: { ...readiness, verifiedOn: '2026-10-05', progress: 'Actualización autorizada' } })
    assert.equal(changed.explain_restriction, true)
  })
  it('accepts only the offered destination and keeps the original time evidence attributed to its source', () => {
    const current = 'Quiero recorrer el edificio el viernes a las 10am'
    const preference = normalizedVisitPreference({ evidence: current, date_text: 'viernes', time_text: 'a las 10 am', location_type: null, confidence: 'high' }, current)
    const first = turn(current, 'coordination', {}, 'building', { preference, sourceMessageId: 'source', sourceAt: '2026-10-06T14:00:00Z' })
    const previous = rememberVisitDialogue({}, first, {}, true)
    const acceptance = 'Sí, en la oficina'
    const acceptedIntent = intent(acceptance, 'accept_alternative', 'office')
    const plan = visitDialogueTurn({ previous, current: acceptance, intent: acceptedIntent, readiness,
      pendingQuestion: visitDialoguePendingQuestion(first), sourceMessageId: 'acceptance' })
    assert.equal(plan.operation_allowed, true)
    assert.equal(plan.effective_destination, 'office')
    assert.equal(plan.requested_destination, 'building')
    assert.equal(plan.alternative_accepted, true)
    const snapshot = visitDialogueIntakeSnapshot(plan, acceptedIntent, null, 'acceptance')
    assert.equal(object(snapshot._interpreted_visit).canonical_text, null)
    assert.equal(object(object(snapshot._visit_dialogue_consent).source_preference).source_message_id, 'source')
    assert.equal(object(object(snapshot._visit_dialogue_consent).source_preference).evidence, current)
  })
  it('rejecting the alternative does not accept another place and revokes retained preference', () => {
    const previous = rememberVisitDialogue({}, offered(), {}, true)
    const plan = turn('No deseo esa cita', 'decline', previous)
    assert.equal(plan.operation_allowed, false)
    assert.equal(object(plan.state).status, 'declined')
    assert.equal(object(plan.state).offered_destination, null)
    assert.equal(object(plan.state).pending_preference, null)
  })
  it('a new explicit forbidden destination overrides a previously accepted office', () => {
    const previous = { version: 'visit-dialogue-v1', status: 'collecting', effective_destination: 'office', alternative_accepted: true }
    const plan = turn('Prefiero visitar el departamento modelo', 'coordination', previous, 'model')
    assert.equal(plan.operation_allowed, false)
    assert.equal(plan.offered_destination, 'office')
    assert.equal(plan.alternative_accepted, false)
  })
  it('repairs scope uncertainty only for a grounded project visit and leaves foreign businesses unchanged', () => {
    const current = 'Agéndame una cita a las 10am para este viernes'
    const uncertain = { kind: 'neutral' as const, uncertain: true, property_message: current, reply: '', outside_evidence: { fragment: 'cita', source: 'current' as const } }
    const requests = [{ domain: 'visit', confidence: 'high', evidence: current }]
    const fixed = reconcileVisitDialogueScope(uncertain, current, intent(current, 'coordination'), requests)
    assert.equal(fixed.kind, 'property')
    assert.equal(fixed.uncertain, false)
    assert.equal(reconcileVisitDialogueScope(uncertain, current, intent(current, 'coordination', null, 'other'), requests), uncertain)
    const foreign = { ...uncertain, kind: 'out_of_scope' as const, uncertain: false }
    assert.equal(reconcileVisitDialogueScope(foreign, current, intent(current, 'coordination'), requests), foreign)
    assert.equal(reconcileVisitDialogueScope(uncertain, current, { ...intent(current, 'coordination'), confidence: 'low' }, requests), uncertain)
  })
  it('never marks an offer explained or accepted before successful delivery', () => {
    assert.deepEqual(rememberVisitDialogue({}, offered(), {}, false), {})
    const saved = rememberVisitDialogue({}, offered(), {}, true)
    assert.equal(saved.explained_readiness_signature, saved.readiness_signature)
    assert.equal(saved.alternative_accepted, false)
  })
  it('rejects contradictory purpose and action declarations instead of turning an information query into consent', () => {
    const current = '¿Qué días atienden?'
    for (const kind of ['visit_information', 'decline_visit', 'none']) {
      assert.equal(normalizedVisitIntent({ kind, purpose: 'accept_alternative', target: 'project', destination: 'office',
        evidence: current, confidence: 'high' }, current), null)
    }
    assert.equal(object(normalizedVisitIntent({ kind: 'request_visit', evidence: 'Quiero una cita', confidence: 'high' }, 'Quiero una cita')).purpose, 'coordination')
  })
  it('passes durable visit decisions to the existing extractor without another AI call', () => {
    const state = object(offered().state)
    const input = interpretationInput({ resumen: { _visit_dialogue: state }, dialogo_visita: state }, '¿Qué horarios tienen?')
    assert.deepEqual(input.dialogo_visita, state)
    assert.deepEqual(object(input.resumen)._visit_dialogue, state)
  })
})

describe('office location and physical readiness configuration', () => {
  it('keeps older policies compatible with an explicit false default', () => {
    const legacy = { ...readiness }; delete legacy.officeAtProjectSite
    assert.equal(validateReadiness(legacy).officeAtProjectSite, false)
    assert.equal(projectReadiness({}, 'lanzamiento').value.officeAtProjectSite, false)
    assert.doesNotMatch(readinessInvitation(legacy), /sitio del proyecto/)
  })
  it('describes the onsite office without granting building access or tying physical state to commercial mode', () => {
    assert.match(readinessInvitation(readiness), /oficina.*sitio del proyecto/)
    assert.match(readinessRules(readiness), /no habilita recorrer la obra ni las unidades/)
    const policies = { project_readiness: { current: readiness } }
    assert.equal(projectReadiness(policies, 'preventa').value.stage, 'not_started')
    assert.throws(() => validateReadiness({ ...readiness, officeAtProjectSite: 'sí' }))
  })
})
