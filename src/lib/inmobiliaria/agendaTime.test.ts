import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addYmd,
  datetimeLocalToIso,
  ecuadorInclusiveRange,
  ecuadorYmd,
  ecuadorLocalToIso,
  formatAgendaDateTime,
  isoToDatetimeLocal,
  lastDaysPresetRange,
  nextDaysPresetRange,
} from './agendaTime.ts'

describe('agenda ecuador range', () => {
  it('allows incomplete forms without throwing and rejects invalid calendar dates', () => {
    for (const [day, time] of [['', ''], ['2026-09-10', ''], ['2026-02-30', '10:00'], ['2026-09-10', '25:00']]) {
      assert.equal(ecuadorLocalToIso(day, time), '')
    }
    assert.equal(ecuadorLocalToIso('2026-09-11', '10:00'), '2026-09-11T15:00:00.000Z')
  })
  it('uses exclusive next-day bound at UTC-5', () => {
    const range = ecuadorInclusiveRange('2026-09-07', '2026-09-07')
    assert.equal(range.fromIso, '2026-09-07T05:00:00.000Z')
    assert.equal(range.toExclusiveIso, '2026-09-08T05:00:00.000Z')
  })

  it('adds days without UTC date slippage', () => {
    assert.equal(addYmd('2026-09-07', 1), '2026-09-08')
    assert.equal(addYmd('2026-09-07', -6), '2026-09-01')
  })

  it('roundtrips datetime-local in Guayaquil', () => {
    const iso = datetimeLocalToIso('2026-09-07T09:30')
    assert.equal(iso, '2026-09-07T14:30:00.000Z')
    assert.equal(isoToDatetimeLocal(iso), '2026-09-07T09:30')
  })

  it('labels missing times', () => {
    assert.equal(formatAgendaDateTime(null), 'Horario por confirmar')
    assert.equal(formatAgendaDateTime('no-es-fecha'), 'Horario por confirmar')
  })

  it('builds last and next 7-day presets from Ecuador today', () => {
    const last = lastDaysPresetRange(7)
    const next = nextDaysPresetRange(7)
    assert.equal(last.to, ecuadorYmd())
    assert.equal(next.from, ecuadorYmd())
    assert.equal(addYmd(last.from, 6), last.to)
    assert.equal(addYmd(next.from, 6), next.to)
  })

  it('returns a yyyy-mm-dd today string', () => {
    assert.match(ecuadorYmd(new Date('2026-09-07T08:00:00.000Z')), /^\d{4}-\d{2}-\d{2}$/)
  })
})
