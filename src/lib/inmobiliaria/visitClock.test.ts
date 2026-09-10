import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addOneHour,
  buildVisitConfirmMessage,
  buildVisitMessage,
  formatVisitClock,
  formatVisitWhen,
} from './visitClock.ts'

describe('visit duration and confirm copy', () => {
  it('locks visits to 60 minutes', () => {
    assert.equal(addOneHour('17:30'), '18:30')
    assert.equal(addOneHour('12:30'), '13:30')
  })

  it('uses a la 1 and a las 2 without repeating the date', () => {
    assert.equal(formatVisitClock('2026-09-08T18:00:00.000Z'), 'a la 1 p. m.')
    assert.equal(formatVisitClock('2026-09-08T19:00:00.000Z'), 'a las 2 p. m.')
    assert.equal(formatVisitWhen('2026-09-08T18:00:00.000Z'), 'el martes 8 de septiembre a la 1 p. m.')
  })

  it('keeps the maps url without trailing punctuation', () => {
    const text = buildVisitConfirmMessage({
      leadName: 'Carlos Pérez',
      advisorName: 'Freddy Javier',
      startIso: '2026-09-08T18:00:00.000Z',
      locationUrl: 'https://maps.app.goo.gl/cjkNv7c4siehTqAN9',
    })
    assert.match(text, /^Perfecto, Carlos\. Confirmamos su cita el martes 8 de septiembre a la 1 p\. m\. con nuestro asesor Freddy Javier/)
    assert.doesNotMatch(text, /mañana/)
    assert.ok(text.endsWith('\nhttps://maps.app.goo.gl/cjkNv7c4siehTqAN9'))
    assert.doesNotMatch(text, /siehTqAN9\./)
    assert.ok(text.length <= 256)
  })

  it('offers an alternative without disclosing the advisor or repeating location before confirmation', () => {
    const text = buildVisitMessage({ kind: 'visit_propose', leadName: 'Carlos Fabián', advisorName: 'Carlos Argudo',
      startIso: '2026-09-10T20:00:00Z', locationUrl: 'https://www.google.com/maps/search/?api=1&query=-2.892340%2C-79.030352' })
    assert.match(text, /Con gusto podemos recibirle el jueves 10 de septiembre a las 3 p\. m\./)
    assert.match(text, /prefiere otro horario/)
    assert.doesNotMatch(text, /Carlos|https|confirmamos/i)
  })

  it('fits canonical Maps URLs without cutting the link, advisor or agreed clock', () => {
    const url = 'https://www.google.com/maps/search/?api=1&query=-2.892340%2C-79.030352'
    const text = buildVisitConfirmMessage({ leadName: 'Carlos Fabián', advisorName: 'Carlos Argudo', startIso: '2026-09-10T20:00:00Z', locationUrl: url })
    assert.ok(text.length <= 256)
    assert.ok(text.endsWith(url))
    assert.match(text, /nuestro asesor Carlos Argudo/)
    assert.match(text, /a las 3 p\. m\./)
    assert.doesNotMatch(text, /Fabián|kommo\.cc/)
  })
})
