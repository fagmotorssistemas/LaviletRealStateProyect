import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildReminderDetail,
  buildReminderGreeting,
  buildVisitReminderFields,
  googleMapsSearchUrl,
  reminderVisitReason,
  verifiedLeadFirstName,
  VISIT_REMINDER_BOT_ID,
  VISIT_REMINDER_FIELD_IDS,
} from './visit-reminder.ts'

describe('two-hour visit reminder variables', () => {
  it('uses the send time for a lowercase greeting and omits unsafe CRM names', () => {
    assert.equal(buildReminderGreeting('Carlos Pérez', '2026-09-18T14:00:00Z'), 'buenos días, Carlos')
    assert.equal(buildReminderGreeting('Nathaly Caballero', '2026-09-18T19:00:00Z'), 'buenas tardes, Nathaly')
    assert.equal(buildReminderGreeting('0987110032', '2026-09-19T01:00:00Z'), 'buenas noches')
    assert.equal(verifiedLeadFirstName('Sin nombre'), '')
  })

  it('builds today, tomorrow and later details from the confirmed appointment', () => {
    assert.equal(buildReminderDetail({ startIso: '2026-09-18T15:00:00Z', sentAt: '2026-09-18T13:00:00Z',
      advisorName: 'Carlos Argudo' }), 'hoy a las 10:00 a. m. con nuestro asesor Carlos Argudo para conocer el proyecto')
    assert.equal(buildReminderDetail({ startIso: '2026-09-19T20:00:00Z', sentAt: '2026-09-18T19:00:00Z',
      advisorName: 'Carlos Argudo', preferredCategory: 'suite' }),
    'mañana a las 3:00 p. m. con nuestro asesor Carlos Argudo para conocer más sobre nuestras suites')
    assert.equal(buildReminderDetail({ startIso: '2026-09-21T14:30:00Z', sentAt: '2026-09-18T19:00:00Z',
      advisorName: 'Ana Torres', advisorTitle: 'asesora', units: [{ unit: { category: 'departamento', unit_number: '204' } }] }),
    'el lunes 21 de septiembre a las 9:30 a. m. con nuestra asesora Ana Torres para revisar los detalles del departamento 204')
  })

  it('uses a confirmed unit before a general lead preference', () => {
    assert.equal(reminderVisitReason([{ unit: { category: 'local', unit_number: 'LC-05' } }], 'departamento'),
      'para revisar los detalles del local LC-05')
    assert.equal(reminderVisitReason([], 'departamento'), 'para conocer las opciones de departamentos del proyecto')
    assert.equal(reminderVisitReason([], 'otro'), 'para conocer el proyecto')
  })

  it('selects the agreed Maps link and exposes the configured Kommo IDs', () => {
    const fields = buildVisitReminderFields({
      lead: { name: 'Carlos Pérez', preferred_category: 'departamento' },
      appointment: { start_time: '2026-09-18T15:00:00Z', meeting_place: 'Oficina La Vilet' },
      advisor_name: 'Carlos Argudo', appointment_units: [],
      location: 'https://maps.app.goo.gl/cjkNv7c4siehTqAN9',
    }, '2026-09-18T13:00:00Z')
    assert.equal(fields.greeting, 'buenos días, Carlos')
    assert.equal(fields.location, 'https://maps.app.goo.gl/cjkNv7c4siehTqAN9')
    assert.equal(VISIT_REMINDER_BOT_ID, 22246)
    assert.deepEqual(VISIT_REMINDER_FIELD_IDS, { greeting: 531808, detail: 531120, location: 531812 })
    assert.match(googleMapsSearchUrl('Ricardo Darquea y Elena Landívar'), /^https:\/\/www\.google\.com\/maps\/search/)
  })
})
