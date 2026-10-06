/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { reservationPermission, reservationRequest, requestReservationHandoff, verifiedReservationReceipt, evaluateInterestDecision } = require('../src/lib/integrations/automation/reservation-action.ts')

const catalog = [
  { id: 'u605', unit_number: '605', category: 'penthouse', status: 'disponible', is_published: true },
  { id: 'u302', unit_number: '302', category: 'departamento', status: 'disponible', is_published: true },
  { id: 'u2', unit_number: 'LC-002', category: 'local', status: 'disponible', is_published: true },
  { id: 'sold', unit_number: '101', category: 'suite', status: 'vendido', is_published: true },
  { id: 'hidden', unit_number: '102', category: 'suite', status: 'disponible', is_published: false },
]
const reservation = (evidence, unit_numbers = ['605'], extra = {}) => ({ kind: 'request', confidence: 'high', evidence, unit_numbers, ...extra })
const message = (text, externalId = 'm1') => ({ text, externalId })

test('partial refusal does not erase a newly evidenced request and the actual unit is resolved from the catalogue', () => {
  const current = 'Por ahora no, entonces quiero separar el departametno 605}'
  const result = reservationRequest(reservation('quiero separar el departametno 605'), [message(current)], catalog, [catalog[1]])
  assert.deepEqual(result.unit_ids, ['u605'])
  assert.deepEqual(result.evidence_message_ids, ['m1'])
  assert.equal(result.source_message_id, 'm1')
  assert.deepEqual(result.unresolved_unit_numbers, [])
})

test('split batch evidence is proved by the actual ordered messages and the final proof message anchors the request', () => {
  const messages = [message('Por ahora no', 'm1'), message('Quiero separar', 'm2'), message('el departamento 605', 'm3')]
  const result = reservationRequest(reservation('Quiero separar\nel departamento 605'), messages, catalog, [])
  assert.deepEqual(result.evidence_message_ids, ['m2', 'm3'])
  assert.equal(result.source_message_id, 'm3')
  assert.deepEqual(result.unit_ids, ['u605'])
  const separateReference = reservationRequest(reservation('Quiero separar'), messages, catalog, [])
  assert.deepEqual(separateReference.evidence_message_ids, ['m2', 'm3'])
  assert.equal(separateReference.source_message_id, 'm3')
  assert.equal(reservationRequest(reservation('Quiero separar el 302'), messages, catalog, []), null)
})

test('duplicated batch entries do not duplicate proof or unit IDs and the latest literal occurrence wins', () => {
  const messages = [message('Quiero separar el 605', 'm1'), message('Quiero separar el 605', 'm1'), message('Quiero separar el 605', 'm2')]
  const result = reservationRequest(reservation('Quiero separar el 605', ['605', '0605']), messages, catalog, [])
  assert.equal(result.source_message_id, 'm2')
  assert.deepEqual(result.unit_ids, ['u605'])
  assert.equal(new Set(result.evidence_message_ids).size, result.evidence_message_ids.length)
})

test('a model code needs current literal support or the single confirmed selection, never only existence in the catalogue', () => {
  const wrong = reservationRequest(reservation('Quiero separar el 605', ['302']), [message('Quiero separar el 605')], catalog, [catalog[1]])
  assert.deepEqual(wrong.unit_ids, [])
  assert.deepEqual(wrong.unresolved_unit_numbers, ['302'])
  const implicit = reservationRequest(reservation('Quiero separar esa opción'), [message('Quiero separar esa opción')], catalog, [catalog[0]])
  assert.deepEqual(implicit.unit_ids, ['u605'])
  const unselected = reservationRequest(reservation('Quiero separar esa opción'), [message('Quiero separar esa opción')], catalog, [])
  assert.deepEqual(unselected.unit_ids, [])
  const ambiguous = reservationRequest(reservation('Quiero separar esa opción', []), [message('Quiero separar esa opción')], catalog, catalog.slice(0, 2))
  assert.deepEqual(ambiguous.unit_ids, [])
})

test('unknown, unpublished and sold units never silently restore the old selection', () => {
  for (const unit of ['999', '101', '102']) {
    const current = `Quiero separar el ${unit}`
    const result = reservationRequest(reservation(current, [unit]), [message(current)], catalog, [catalog[0]])
    assert.deepEqual(result.unit_ids, [], current)
    assert.deepEqual(result.unresolved_unit_numbers, [unit])
  }
  const omitted = reservationRequest(reservation('Quiero separar el 999', []), [message('Quiero separar el 999')], catalog, [catalog[0]])
  assert.deepEqual(omitted.unit_ids, [])
})

test('commercial code separators, zero padding and common joined residential spelling are equivalent references', () => {
  for (const current of ['Quiero separar el LC02', 'Quiero separar el LC-002', 'Quiero separar el local 02']) {
    const result = reservationRequest(reservation(current, ['LC-02']), [message(current)], catalog, [])
    assert.deepEqual(result.unit_ids, ['u2'], current)
  }
  assert.deepEqual(reservationRequest(reservation('Quiero separar el departamento605'), [message('Quiero separar el departamento605')], catalog, []).unit_ids, ['u605'])
})

test('information, declined, unconfident and unevidenced requests cannot execute a handoff', () => {
  const current = 'Quiero separar el 605'
  for (const extra of [{ kind: 'information' }, { kind: 'declined' }, { kind: 'none' }, { confidence: 'medium' }, { evidence: '' }, { evidence: 'Solicito reservar mañana' }]) {
    assert.equal(reservationRequest(reservation(current, ['605'], extra), [message(current)], catalog, []), null)
  }
})

test('current local negation cannot be cut away from permission, while refusal of a different proposal still permits a new request', () => {
  for (const [current, evidence] of [
    ['No quiero separar el 605', 'quiero separar el 605'],
    ['No quiero separar el 605', 'separar el 605'],
    ['No quiero separar el 605', 'No quiero separar el 605'],
    ['No quiero que separen el 605', 'separen el 605'],
    ['Tampoco deseo reservar el 605', 'reservar el 605'],
    ['No voy a apartar el 605', 'apartar el 605'],
  ]) assert.equal(reservationRequest(reservation(evidence), [message(current)], catalog, []), null, current)
  const batched = reservationRequest(reservation('quiero separar el 605'), [message('no'), message('quiero separar el 605', 'm2')], catalog, [])
  assert.deepEqual(batched.unit_ids, ['u605'])
  for (const [current, evidence] of [
    ['Por ahora no, entonces quiero separar el 605', 'quiero separar el 605'],
    ['Por ahora no, entonces quiero separar el 605', 'Por ahora no, entonces quiero separar el 605'],
    ['No quiero financiamiento, quiero separar el 605', 'quiero separar el 605'],
    ['No, mejor separemos el 605', 'separemos el 605'],
  ]) assert.deepEqual(reservationRequest(reservation(evidence), [message(current)], catalog, []).unit_ids, ['u605'], current)
})

test('a handoff receipt must identify the actual request, exact units and persisted current owner', () => {
  const request = reservationRequest(reservation('Quiero separar el 605'), [message('Quiero separar el 605')], catalog, [])
  const lead = { id: 'lead', handoff_status: 'assigned', assigned_to: 'advisor' }
  const receipt = { request_id: 'request', lead_id: 'lead', source_message_id: 'm1', unit_ids: ['u605'], request_status: 'requested', handoff_status: 'assigned', assigned_to: 'advisor' }
  assert.equal(verifiedReservationReceipt(receipt, lead, request), true)
  for (const change of [{ unit_ids: ['u302'] }, { assigned_to: 'another' }, { source_message_id: 'm2' }, { lead_id: 'other' }, { request_status: 'confirmed' }]) {
    assert.equal(verifiedReservationReceipt({ ...receipt, ...change }, lead, request), false)
  }
  assert.equal(verifiedReservationReceipt({ ...receipt, handoff_status: 'queued', assigned_to: null }, { ...lead, handoff_status: 'queued', assigned_to: null }, request), true)
})

test('reservation permission examines prerequisites across the complete turn, not only the extracted wish', () => {
  for (const [current, evidence] of [
    ['Quisiera asegurar un departamento\nObviamente ver si es alcanzable el valor que me ofrezcan.', 'Quisiera asegurar un departamento'],
    ['Si me alcanza, quiero separar el 605.', 'Si me alcanza, quiero separar el 605.'],
    ['Quiero separar el 605 siempre que me aprueben el crédito.', 'Quiero separar el 605 siempre que me aprueben el crédito.'],
    ['Quiero separar el 605 si cuesta menos de 300 mil.', 'Quiero separar el 605'],
    ['Si me aprueban el crédito, quiero separar el 605.', 'quiero separar el 605'],
    ['Antes de reservar quiero conocer el precio.', 'Antes de reservar quiero conocer el precio.'],
    ['Quiero separar el 605. Primero necesito saber si hay disponibilidad.', 'Quiero separar el 605.'],
  ]) {
    const raw = reservation(evidence)
    assert.equal(reservationPermission(raw, current).kind, 'information', current)
    assert.equal(reservationPermission(raw, current).request_deferred, true, current)
    assert.equal(reservationRequest(raw, [message(current)], catalog, []), null, current)
  }
  for (const current of ['Quiero separar el 605.', 'Sí, quiero separar el 605.', 'Quiero separar el 605. Además, ¿qué incluye?',
    'Quiero separar el 605. También quisiera saber si entrega en 2028.', 'Quiero separar el 605 y saber si tiene ascensor.',
    'Quiero separar el 605 y saber si hay financiamiento.', 'Sí me interesa separar el 605.',
    'si me gustaria separar el 605', 'si deseo separar el 605',
    'No necesito saber si es alcanzable, ya comprobé mi presupuesto. Quiero separar el 605.',
    'Quiero separar el 605. También quisiera saber si hay acceso accesible para mi familiar.',
    'Primero reservé un hotel. Ahora quiero separar el 605 y saber si tiene ascensor.',
    'Quiero separar el 605 y saber el precio y si hay financiamiento.',
    'Ya confirmé que puedo pagarlo. Quiero separar el 605.', 'Por ahora no quiero financiamiento, quiero separar el 605.']) {
    const raw = reservation(current)
    assert.deepEqual(reservationPermission(raw, current), raw, current)
    assert.deepEqual(reservationRequest(raw, [message(current)], catalog, []).unit_ids, ['u605'], current)
  }
})

test('only a definitely absent reservation RPC permits an informational continuation; no alternate mutation or retry is attempted', async () => {
  const args = { p_lead_id: 'lead', p_source_message_id: 'm1', p_unit_ids: ['u605'], p_evidence: 'quiero separar', p_evidence_message_ids: ['m1'] }
  for (const code of ['PGRST202', '42883']) {
    const calls = []
    const result = await requestReservationHandoff(async (name, received) => {
      calls.push({ name, args: received })
      throw new Error(`RPC_LV_REQUEST_RESERVATION_HANDOFF_${code}`)
    }, args)
    assert.equal(result.status, 'unavailable')
    assert.equal(result.action_executed, false)
    assert.deepEqual(calls, [{ name: 'lv_request_reservation_handoff', args }])
  }
  for (const code of ['FAILED', '57014', 'P0001', 'TIMEOUT']) {
    const calls = []
    await assert.rejects(() => requestReservationHandoff(async name => {
      calls.push(name)
      throw new Error(`RPC_LV_REQUEST_RESERVATION_HANDOFF_${code}`)
    }, args), new RegExp(code))
    assert.deepEqual(calls, ['lv_request_reservation_handoff'])
  }
  const receipt = { request_id: 'request', handoff_status: 'queued' }
  assert.deepEqual(await requestReservationHandoff(async () => receipt, args), { status: 'recorded', receipt })
  for (const value of [null, 'queued', [receipt]]) await assert.rejects(() => requestReservationHandoff(async () => value, args), /CONTRACT_MISMATCH/)
})

test('only a missing v2 function falls back once to v1; timeouts and ambiguous failures never replay the mutation', async () => {
  for (const code of ['PGRST202', '42883']) {
    const calls = []
    const result = await evaluateInterestDecision(async (name, args) => {
      calls.push({ name, args })
      if (name.endsWith('_v2')) throw new Error(`RPC_LV_EVALUATE_MESSAGE_INTEREST_V2_${code}`)
      return {}
    }, { p_source_message_id: 'm1', p_events: ['asked_reservation'] })
    assert.deepEqual(calls.map(call => call.name), ['lv_evaluate_message_interest_v2', 'lv_evaluate_message_interest'])
    assert.equal(result.decision_source, 'legacy_without_receipt')
    assert.equal(result.handoff_required, null)
  }
  for (const code of ['FAILED', '57014', 'P0001', 'TIMEOUT']) {
    const calls = []
    await assert.rejects(() => evaluateInterestDecision(async name => {
      calls.push(name)
      throw new Error(`RPC_LV_EVALUATE_MESSAGE_INTEREST_V2_${code}`)
    }, {}), new RegExp(code))
    assert.deepEqual(calls, ['lv_evaluate_message_interest_v2'])
  }
  await assert.rejects(() => evaluateInterestDecision(async () => null, {}), /CONTRACT_MISMATCH/)
})
