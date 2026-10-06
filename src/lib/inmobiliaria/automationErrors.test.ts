import test from 'node:test'
import assert from 'node:assert/strict'
import { reservationServiceError } from './automationErrors'

test('absent reservation RPC is explained without asserting an operational receipt', () => {
  for (const code of ['RPC_LV_REQUEST_RESERVATION_HANDOFF_PGRST202', 'RPC LV REQUEST RESERVATION HANDOFF PGRST202', 'RPC_LV_REQUEST_RESERVATION_HANDOFF_42883']) {
    assert.match(reservationServiceError(code)!, /migración.*caché/)
    assert.match(reservationServiceError(code)!, /no acredita.*registrada.*asignado/)
  }
})

test('timeouts, denied access and unrelated RPC failures retain their own diagnosis', () => {
  for (const code of [null, '', 'RPC_LV_REQUEST_RESERVATION_HANDOFF_42501', 'RPC_LV_REQUEST_RESERVATION_HANDOFF_TIMEOUT', 'RPC_OTHER_PGRST202']) {
    assert.equal(reservationServiceError(code), null)
  }
})
