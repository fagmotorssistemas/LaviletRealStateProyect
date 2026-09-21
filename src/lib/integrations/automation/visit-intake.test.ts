import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { visitBusinessHoursReply } from './visit-intake'

const hours = {
  1: { open: '08:30', close: '18:30' }, 2: { open: '08:30', close: '18:30' },
  3: { open: '08:30', close: '18:30' }, 4: { open: '08:30', close: '18:30' },
  5: { open: '08:30', close: '18:30' }, 6: { open: '09:30', close: '13:30' },
}

describe('visit business hours before date collection', () => {
  it('shows configured hours before asking for the initial date and time', () => {
    const reply = visitBusinessHoursReply(hours, { action: 'collecting', slot: {} }, '2026-09-19T16:17:00Z')
    assert.match(reply, /Nuestro horario de atención es de lunes a viernes de 08:30 a 18:30; los sábados de 09:30 a 13:30/)
    assert.match(reply, /Después de revisar estos horarios, indíquenos qué fecha y hora/)
  })

  it('does not repeat a closed Sunday and preserves the valid 3 p. m. preference', () => {
    const reply = visitBusinessHoursReply(hours, { action: 'closed_day', slot: {
      requested_date: '2026-09-20', start_time: '2026-09-20T20:00:00Z', confidence: 'exact',
    } }, '2026-09-19T16:27:00Z')
    assert.match(reply, /domingo 20 de septiembre no está habilitado/)
    assert.match(reply, /Como indicó a las 3 p\. m\., puede solicitar esa hora de lunes a viernes/)
    assert.match(reply, /¿Qué día le convendría\?/)
    assert.doesNotMatch(reply, /asesor de nuestro equipo/)
  })

  it('does not carry 6 p. m. to weekdays when a one-hour visit would end after closing', () => {
    const reply = visitBusinessHoursReply(hours, { action: 'closed_day', slot: {
      requested_date: '2026-09-27', start_time: '2026-09-27T23:00:00Z', confidence: 'exact',
    } }, '2026-09-21T16:27:00Z')

    assert.equal(reply.match(/domingo 27 de septiembre/gi)?.length, 1)
    assert.match(reply, /¿Qué otro día y hora le convendrían dentro de esos horarios\?/)
    assert.doesNotMatch(reply, /Como indicó a las 6 p\. m\., puede solicitar esa hora/)
  })
})
