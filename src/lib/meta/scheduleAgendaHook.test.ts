/**
 * Gancho agenda Schedule (sin I/O Meta).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { notifyScheduleIfRequestConfirmed } from './scheduleAgendaHook'

const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

describe('scheduleAgendaHook', () => {
  it('propuesta awaiting_client excluida', async () => {
    let calls = 0
    assert.equal(
      await notifyScheduleIfRequestConfirmed(
        null,
        { status: 'awaiting_client', appointment_id: APPT },
        async () => {
          calls += 1
        },
      ),
      false,
    )
    assert.equal(calls, 0)
  })

  it('confirmación definitiva incluida', async () => {
    let seen = ''
    assert.equal(
      await notifyScheduleIfRequestConfirmed(
        { tag: 'sb' },
        { status: 'confirmed', appointment_id: APPT },
        async (_sb, id) => {
          seen = id
        },
      ),
      true,
    )
    assert.equal(seen, APPT)
  })

  it('fallo de guardado (sin request) sin evento', async () => {
    let calls = 0
    assert.equal(await notifyScheduleIfRequestConfirmed(null, null, async () => { calls += 1 }), false)
    assert.equal(calls, 0)
  })
})
