import assert from 'node:assert/strict'
import { it } from 'node:test'
import { normalizeVisitOptions, visitOptionsList } from './visitProposalOptions.ts'

const now = Date.parse('2026-09-14T12:00:00Z')
const slots = [14, 15, 16].map(hour => ({ start_time: `2026-09-15T${hour}:00:00Z`, end_time: `2026-09-15T${hour + 1}:00:00Z` }))

it('normalizes three choices and renders the actual Ecuador times in client order', () => {
  const choices = normalizeVisitOptions(slots, now)
  assert.equal(choices.length, 3)
  assert.match(visitOptionsList(choices), /^1\. martes 15 de septiembre a las 9 a\. m\./)
  assert.match(visitOptionsList(choices), /3\. martes 15 de septiembre a las 11 a\. m\./)
})

it('rejects duplicate, invalid, past and excessive options before drafting or sending', () => {
  for (const input of [[], [...slots, slots[0]], [slots[0], slots[0]], [{ start_time: 'bad', end_time: 'bad' }],
    [{ start_time: '2026-09-13T14:00:00Z', end_time: '2026-09-13T15:00:00Z' }],
    [{ ...slots[0], end_time: '2026-09-15T16:00:00Z' }]]) {
    assert.throws(() => normalizeVisitOptions(input, now))
  }
})
