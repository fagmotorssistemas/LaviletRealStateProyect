import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { intakeReply, visitBusinessHoursReply } from './visit-intake'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { VISIT_COPY_RULES, VISIT_NATURAL_RULES } from './visit-copy'
import { object, type Row } from './data'

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

describe('visit copy follows the operation without routine disclaimers', () => {
  const at = '2026-10-16T20:20:00Z'
  const slot = { requested_date: '2026-10-21', has_time: true,
    start_time: '2026-10-21T20:00:00Z', confidence: 'exact' }

  it('gives the published hours directly without converting them into a booking', () => {
    const reply = visitBusinessHoursReply(hours, { action: 'information' }, at)
    assert.match(reply, /lunes a viernes.*08:30.*18:30.*sábados.*09:30.*13:30/)
    assert.doesNotMatch(reply, /cupo|confirm|registr|agend|revis/)
  })

  it('asks only for the missing time after an operationally known date', () => {
    const reply = intakeReply({ action: 'collecting', slot: { requested_date: '2026-10-21', has_time: false } }, at)
    assert.match(reply, /miércoles 21 de octubre.*¿A qué hora/)
    assert.doesNotMatch(reply, /qué día|registrada|confirmada|debe revisarse/i)
  })

  it('communicates a verified registration and the team action positively', () => {
    for (const needsHelp of [false, true]) {
      const reply = intakeReply({ action: 'submitted', registration_verified: true, needs_help: needsHelp,
        review_reason: 'advisor_availability', slot }, at)
      assert.match(reply, /solicitud quedó registrada para el miércoles 21 de octubre a las 3 p\. m\. El equipo revisará ese horario/)
      assert.equal(reply.match(/miércoles 21 de octubre/g)?.length, 1)
      assert.doesNotMatch(reply, /no (?:está|confirma)|antes de confirmar|cita (?:está|quedó) (?:confirmada|agendada)|p\. m\.\./)
    }
  })

  it('does not turn an exact preference into a recorded or confirmed appointment', () => {
    const reply = intakeReply({ action: 'collecting', slot }, at)
    assert.match(reply, /preferencia para el miércoles 21 de octubre a las 3 p\. m\./)
    assert.doesNotMatch(reply, /registrad|confirmad|agendad|equipo revisará/)
  })

  for (const scenario of [
    { action: 'collecting', current: 'Quisiera ir el miércoles', registration: false,
      preference: { requested_date: '2026-10-21', has_time: false },
      drafts: ['Para el miércoles 21, ¿a qué hora le gustaría venir?', 'Podemos continuar con su visita del miércoles. ¿Qué hora le vendría bien?'],
      question: true },
    { action: 'submitted', current: 'Sí, el miércoles a las tres', registration: true, preference: slot,
      drafts: ['Su solicitud para el miércoles 21 a las tres quedó registrada. El equipo revisará su agenda y le responderá por aquí.',
        'Ya quedó registrada su solicitud para el miércoles 21 a las tres. Le escribiremos por aquí con la respuesta del equipo.'],
      question: false },
    { action: 'confirmed', current: 'Sí, ese horario está bien', registration: true, preference: slot,
      drafts: ['Su cita está confirmada para el miércoles 21 a las tres en nuestra oficina. Será un gusto recibirle.',
        'Le esperamos el miércoles 21 a las tres en nuestra oficina; su cita ya está confirmada.'],
      question: false },
  ]) {
    it(`passes the ${scenario.action} operation and positive visit directions to the writer without rewriting its wording`, async () => {
      for (const draft of scenario.drafts) {
        const audit = { source: 'visit_intake', action: scenario.action, registration_verified: scenario.registration,
          preference: scenario.preference, request_id: scenario.registration ? 'verified-request' : null }
        const result = await withResponseReviewPolicy({ enabled: false, observationOnly: false, updatedAt: null }, () => completeTurnReply({
          current: scenario.current, baseReply: 'Respuesta interna de respaldo.',
          verified: {}, audit,
        }, async (rules, input, _schema, _image, _file, _tone, task) => {
          assert.equal(task, 'writing')
          assert.ok(rules.includes(VISIT_COPY_RULES))
          assert.ok(rules.includes(VISIT_NATURAL_RULES))
          assert.doesNotMatch(rules, /responda de forma directa: «Revisaremos la disponibilidad/)
          const operation = object(object(object(input).contrato_redaccion).estado_operativo)
          assert.equal(operation.action, scenario.action)
          assert.equal(operation.registration_verified, scenario.registration)
          assert.deepEqual(operation.preference, scenario.preference)
          return { reply: draft, requests: [], question: scenario.question ? {
            text: draft.endsWith('?') ? draft.slice(draft.lastIndexOf('¿')) : '', purpose: 'coordinate_visit',
            role: 'necessary_clarification', missing_datum: 'hora', next_decision: 'Completar el horario elegido',
            continuation_id: 'visit_date_time', continuation_act: 'visit', comparison_categories: [], comparison_bedrooms: null,
          } : null } as Row
        }))
        assert.equal(result.reply, draft)
        assert.equal(result.needsAdvisor, false)
      }
    })
  }
})
