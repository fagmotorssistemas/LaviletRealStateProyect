import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addOneHour,
  buildVisitConfirmMessage,
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
    assert.match(text, /^Perfecto, Carlos\. Le esperamos el martes 8 de septiembre a la 1 p\. m\. con Freddy Javier/)
    assert.doesNotMatch(text, /mañana/)
    assert.ok(text.includes('\nhttps://maps.app.goo.gl/cjkNv7c4siehTqAN9\n'))
    assert.doesNotMatch(text, /siehTqAN9\./)
  })
})
