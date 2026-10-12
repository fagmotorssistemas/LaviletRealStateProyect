import test from 'node:test'
import assert from 'node:assert/strict'
import { explicitReservationAction } from './reservation-invitation'
import { normalizeTurnSemantics } from './turn-semantics'
import { reservationPermission, reservationRequest } from './reservation-action'

const unit = { id: 'u502', unit_number: '502', category: 'departamento', status: 'disponible', is_published: true }

test('reservation nouns, status and explanations do not become an action through a model label or clipped quote', () => {
  for (const [current, evidence] of [
    ['¿Cuánto cuesta la reserva?', 'reserva'],
    ['¿Esta unidad está reservada?', 'reservada'],
    ['Quiero conocer cómo reservar la unidad 502', 'Quiero conocer cómo reservar la unidad 502'],
    ['Quiero conocer cómo reservar la unidad 502', 'reservar'],
    ['¿Cuánto cuesta reservar la unidad 502?', 'reservar'],
    ['Me interesa saber los requisitos para separar la unidad 502', 'Me interesa saber los requisitos para separar la unidad 502'],
    ['¿Me explica cómo iniciar la reserva?', 'iniciar la reserva'],
    ['Quiero información sobre el apartamento 502', 'apartamento'],
    ['Quiero cancelar la reserva de la unidad 502', 'Quiero cancelar la reserva de la unidad 502'],
    ['Ayer reservé la unidad 502', 'Ayer reservé la unidad 502'],
    ['Separé la unidad 502 la semana pasada', 'Separé la unidad 502 la semana pasada'],
    ['El asesor reserva la unidad 502', 'El asesor reserva la unidad 502'],
    ['¿Quién reserva la unidad 502?', '¿Quién reserva la unidad 502?'],
  ]) {
    assert.equal(explicitReservationAction(evidence), false, evidence)
    const raw = { kind: 'request', evidence, confidence: 'high', unit_numbers: ['502'] }
    const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'request_reservation', primary_evidence: current,
      confidence: 'high', reservation: raw } }, current, {})
    assert.equal((semantics.reservation as { kind: string }).kind, 'none', current)
    assert.equal(reservationRequest(raw, [{ externalId: 'current', text: current }], [unit], [unit]), null, current)
  }
})

test('a direct request, imperative or process initiation keeps its literal action and current unit', () => {
  for (const current of [
    'Quiero reservar la unidad 502',
    'Quisiera separar esa opción',
    'Quiero serpar la unidad 502',
    'Quisiera asegurar este departamento',
    'Me gustaría iniciar la reserva de la unidad 502',
    'Solicito tramitar la solicitud de reserva de la unidad 502',
    'Ayúdeme a reservar la unidad 502',
    '¿Podría ayudarme a reservar la unidad 502?',
    'Separemos la unidad 502',
    'Por favor, resérvela',
    'Reserva la unidad 502, por favor',
    'Inicie la reserva de la unidad 502',
    'Quiero reservar la unidad 502 y saber su precio',
    'Quiero conocer el precio y quiero reservar la unidad 502',
  ]) {
    assert.equal(explicitReservationAction(current), true, current)
    const raw = { kind: 'request', evidence: current, confidence: 'high', unit_numbers: ['502'] }
    assert.deepEqual(reservationRequest(raw, [{ externalId: 'current', text: current }], [unit], [unit])?.unit_ids, ['u502'], current)
  }
})

test('recognizing a requested action preserves the existing prerequisite and local-negation controls', () => {
  for (const current of ['Quiero reservar la unidad 502 si me aprueban el crédito', 'No quiero reservar la unidad 502']) {
    assert.equal(explicitReservationAction(current), true)
    const raw = { kind: 'request', evidence: current, confidence: 'high', unit_numbers: ['502'] }
    assert.equal(reservationRequest(raw, [{ externalId: 'current', text: current }], [unit], [unit]), null)
    if (current.includes('si me')) assert.equal(reservationPermission(raw, current).kind, 'information')
  }
})
