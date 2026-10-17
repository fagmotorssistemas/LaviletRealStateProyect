import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { deliveredPendingQuestion } from './continuation-question'
import { normalizedPendingQuestion, normalizedReservation } from './turn-semantics'
import { reservationRequest } from './reservation-action'
import { authorityFixture } from './fixtures/typed-turn.fixture'

const unit: Row = { id: 'u605', unit_number: '605', category: 'penthouse', status: 'disponible', is_published: true }
const other: Row = { ...unit, id: 'u602', unit_number: '602' }
const plan = { action: 'offer_reservation', question_id: 'reservation_invitation', question_act: 'reservation', selected_unit_id: unit.id }
const metadata = (question: string): Row => ({ text: question, purpose: 'permission_to_continue',
  continuation_id: 'reservation_invitation', continuation_act: 'reservation' })
const delivered = (question: string, changes: Row = {}, catalog = [unit, other]) => deliveredPendingQuestion(
  `Podemos ayudarle a iniciar la reserva del penthouse 605. ${question}`, { plan, metadata: { ...metadata(question), ...changes } }, catalog)
const answer = (current: string, changes: Row = {}): Row => ({ question_id: 'reservation_invitation',
  kind: 'affirmative', evidence: current, confidence: 'high', ...changes })
const permission = (current: string, attribution = 'self') => authorityFixture(current, 'reservation', 'accept', attribution)
const accept = (pending: Row, current = 'Sí', changes: Row = {}, authority = permission(current)) =>
  normalizedReservation({ kind: 'none' }, current, pending, answer(current, changes), authority)
const request = (reservation: Row, current = 'Sí', catalog = [unit, other], selected = [unit], authority = permission(current)) => reservationRequest(
  reservation, [{ externalId: 'current', text: current }], catalog, selected, authority)

for (const question of ['¿Damos ese paso con la unidad elegida?',
  '¿Quiere que avancemos con su solicitud para este espacio?', '¿Comenzamos esa gestión para el 605?']) {
  test('typed reservation receipt keeps a freely worded invitation actionable: ' + question, () => {
    const pending = delivered(question)
    assert.equal(pending.question, question)
    assert.deepEqual(pending.target_ids, ['u605'])
    assert.equal(object(pending.reservation_invitation).source, 'writer_metadata')
    assert.deepEqual(normalizedPendingQuestion(pending, [unit, other]), pending, 'Persistence must retain the typed receipt')
    const reservation = accept(pending)
    assert.equal(reservation.kind, 'request')
    assert.deepEqual(request(reservation)?.unit_ids, ['u605'])
    assert.equal(request(reservation)?.source_message_id, 'current')
  })
}

test('a delivered reservation receipt still needs a confident current answer to that same act', () => {
  const pending = delivered('¿Damos ese paso?')
  for (const [current, changes, attribution, decision] of [
    ['Sí', { evidence: 'Una respuesta anterior' }, 'self', 'accept'], ['Sí', { confidence: 'low' }, 'self', 'accept'],
    ['Sí', { question_id: 'unit_choice' }, 'self', 'accept'], ['No, gracias', { kind: 'negative' }, 'self', 'decline'],
    ['Sí, pero primero necesito saber el precio', {}, 'conditional', 'accept'],
    ['Sí, solo si me aprueban el crédito', {}, 'conditional', 'accept'], ['Mi asesor reserva la unidad', {}, 'reported', 'request'],
  ] as [string, Row, string, string][]) {
    const reservation = accept(pending, current, changes, authorityFixture(current, 'reservation', decision, attribution))
    assert.equal(reservation.kind, 'none', current + JSON.stringify(changes))
    assert.equal(request(reservation, current), null)
  }
  assert.equal(normalizedReservation({ kind: 'none' }, 'Sí', pending, {}).kind, 'none')
})

test('reservation receipts cannot substitute a different, unknown, ambiguous or unavailable unit', () => {
  const pending = delivered('¿Damos ese paso?'), reservation = accept(pending)
  assert.equal(request(reservation, 'Sí', [unit, other], [other]), null, 'A stale selected unit cannot redirect the yes')
  assert.equal(request(reservation, 'Sí', [unit, other], [unit, other]), null, 'A yes needs one selected target')
  assert.equal(request(reservation, 'Sí', [other], [unit]), null, 'Missing current catalogue membership blocks execution')
  assert.equal(request(reservation, 'Sí', [{ ...unit, status: 'vendido' }], [unit]), null)
  for (const changed of [
    delivered('¿Damos ese paso?', { target_ids: ['unknown'] }),
    delivered('¿Damos ese paso?', { target_ids: ['u605', 'u602'] }),
    delivered('¿Damos ese paso?', { target_ids: ['u602'] }),
    delivered('¿Damos ese paso?', {}, [other]),
    { ...pending, target_ids: ['u602'] },
    { ...pending, reservation_invitation: { ...object(pending.reservation_invitation), unit_id: 'u602' } },
  ]) {
    assert.equal(accept(changed).kind, 'none')
    assert.equal(request(accept(changed)), null)
  }
})

test('a plan, legacy label, copied question or model-supplied proof never creates a reservation invitation', () => {
  for (const question of ['¿Desea iniciar la reserva del penthouse 605?', '¿Qué le parece?',
    '¿Desea conocer los requisitos para reservar?', '¿Prefiere reservar o coordinar una visita?']) {
    const legacy = { id: 'reservation_invitation', act: 'reservation', question, target_ids: ['u605'] }
    assert.equal(accept(legacy).kind, 'none', question)
    assert.equal(legacy.question, question, 'Legacy context is retained without inventing an operational receipt')
  }
  const pending = delivered('¿Damos ese paso?')
  assert.equal(normalizedReservation({ kind: 'none', accepted_invitation: object(pending.reservation_invitation) }, 'Sí', {}, answer('Sí')).kind, 'none')
  const fabricated = { kind: 'request', confidence: 'high', evidence: 'Sí',
    accepted_invitation: { question: '¿Desea iniciar la reserva del penthouse 605?', target_ids: ['u605'] } }
  assert.equal(request(fabricated), null)
  assert.deepEqual(deliveredPendingQuestion('¿Damos ese paso?', { plan }), {})
})

test('an information or property act cannot inherit the reservation plan receipt', () => {
  for (const changes of [{ purpose: 'choose_property' }, { continuation_act: 'show_unit_details' },
    { continuation_id: 'unit_choice', continuation_act: 'show_unit_details', purpose: 'choose_property' }]) {
    const pending = delivered('¿Damos ese paso?', changes)
    assert.equal(pending.reservation_invitation, undefined)
    assert.equal(accept(pending).kind, 'none')
  }
})

test('normalization rejects malformed reservation provenance without parsing its wording', () => {
  const pending = delivered('¿Damos ese paso?'), valid = object(pending.reservation_invitation)
  for (const changed of [{ version: 'legacy' }, { kind: 'confirmed_reservation' }, { source: 'model_extraction' },
    { question_id: 'unit_choice' }, { question_act: 'show_unit_details' }, { unit_id: '' }]) {
    const malformed = { ...pending, reservation_invitation: { ...valid, ...changed } }
    assert.equal(normalizedPendingQuestion(malformed).reservation_invitation, undefined)
    assert.equal(accept(malformed).kind, 'none')
  }
  const withoutText = { ...pending, question: 'Any wording supplied by the writer' }
  assert.equal(accept(withoutText).kind, 'request')
  assert.deepEqual(request(accept(withoutText))?.unit_ids, ['u605'])
})

test('explicit current reservation requests remain independent of legacy invitation memory and keep their permission checks', () => {
  const current = 'Quiero reservar el penthouse 605'
  const raw = { kind: 'request', reference_kind: 'explicit', evidence: current, unit_numbers: ['605'], confidence: 'high' }
  const authority = authorityFixture(current, 'reservation')
  assert.deepEqual(request(normalizedReservation(raw, current, {}, {}, authority), current, [unit, other], [unit], authority)?.unit_ids, ['u605'])
  for (const [current, decision, attribution] of [['No quiero reservar el penthouse 605', 'decline', 'self'],
    ['Quiero reservar el penthouse 605 solo si me aprueban el crédito', 'request', 'conditional']]) {
    const rejectedAuthority = authorityFixture(current, 'reservation', decision, attribution)
    const normalized = normalizedReservation({ ...raw, evidence: current }, current, {}, {}, rejectedAuthority)
    assert.equal(request(normalized, current, [unit, other], [unit], rejectedAuthority), null)
  }
})
