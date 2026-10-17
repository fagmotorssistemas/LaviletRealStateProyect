import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { visitIntakePlan } from './visit-intake-plan'
import { responsePlan, finalWriterContract } from './response-plan'

describe('visit coordination follows the operational result', () => {
  it('requires a next question when the record is still missing date and time', () => {
    const audit = { source: 'visit_intake', action: 'collecting', preference: { requested_date: null, has_time: false } }
    const plan = responsePlan('Entonces, prefiere el miércoles a las tres.', audit)
    assert.equal(plan.continuation.required, true)
    assert.equal(plan.continuation.question_id, 'visit_date_time')
    assert.deepEqual(plan.operational_state.coordination.missing_fields, ['date', 'time'])
    assert.ok(plan.next_question)
    assert.equal(finalWriterContract('', audit).estado_operativo.coordination.phase, 'collecting')
  })

  it('retains an identified hour while asking only for the missing date', () => {
    const plan = visitIntakePlan({ source: 'visit_intake', action: 'collecting', preference: { has_time: true } })
    assert.deepEqual(plan.missing_fields, ['date'])
    assert.equal(plan.question_id, 'visit_date_time')
  })

  it('retains an identified date while asking only for the missing time', () => {
    const plan = visitIntakePlan({ source: 'visit_intake', action: 'collecting', preference: { requested_date: '2026-10-21', has_time: false } })
    assert.deepEqual(plan.missing_fields, ['time'])
  })

  it('keeps place selection separate from date and time', () => {
    const plan = visitIntakePlan({ source: 'visit_intake', action: 'collecting', needs_location: true,
      preference: { confidence: 'exact', start_time: '2026-10-21T20:00:00Z' } })
    assert.deepEqual(plan.missing_fields, ['destination'])
    assert.equal(plan.question_id, 'visit_destination')
  })

  it('announces registration only with a verified request receipt', () => {
    const submitted = { source: 'visit_intake', action: 'submitted', request_id: 'request', registration_verified: true }
    assert.equal(visitIntakePlan(submitted).phase, 'awaiting_advisor')
    assert.equal(visitIntakePlan(submitted).requires_question, false)
    assert.equal(visitIntakePlan({ ...submitted, registration_verified: false }).phase, 'registration_unverified')
    assert.equal(visitIntakePlan({ ...submitted, request_id: null }).phase, 'registration_unverified')
  })

  it('does not create a visit objective for another conversation flow', () => {
    assert.deepEqual(visitIntakePlan({ source: 'reservation_handoff', action: 'submitted', registration_verified: true }), {})
    assert.deepEqual(visitIntakePlan({ source: 'visit_intake', action: 'closed_day' }), {})
  })
})
