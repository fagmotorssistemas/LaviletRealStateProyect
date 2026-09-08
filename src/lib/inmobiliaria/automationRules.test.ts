import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hoursToWeekdays, weekdaysToHours } from './automationRules.ts'

describe('business hours form', () => {
  it('marks missing days as closed', () => {
    const days = hoursToWeekdays({
      '1': { open: '09:00', close: '18:00' },
    })
    assert.equal(days[0]?.enabled, true)
    assert.equal(days[6]?.enabled, false)
  })

  it('omits closed days when saving', () => {
    const hours = weekdaysToHours([
      { iso: '1', label: 'Lunes', enabled: true, open: '09:00', close: '18:00' },
      { iso: '7', label: 'Domingo', enabled: false, open: '09:00', close: '18:00' },
    ])
    assert.deepEqual(hours, { '1': { open: '09:00', close: '18:00' } })
  })
})
