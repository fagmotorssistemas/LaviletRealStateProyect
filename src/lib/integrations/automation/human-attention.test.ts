import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { advisorOwnsConversation } from './human-attention'

describe('human attention', () => {
  const inboundAt = '2026-09-18T18:00:00.000Z'

  it('lets the bot continue when it was the latest outbound author', () => {
    assert.equal(advisorOwnsConversation([
      { role: 'asesor', sent_at: '2026-09-18T17:40:00.000Z' },
      { role: 'bot', sent_at: '2026-09-18T17:50:00.000Z' },
    ], inboundAt), false)
  })

  it('yields when an advisor owns the current conversation', () => {
    assert.equal(advisorOwnsConversation([
      { role: 'bot', sent_at: '2026-09-18T17:40:00.000Z' },
      { role: 'asesor', sent_at: '2026-09-18T17:55:00.000Z' },
    ], inboundAt), true)
  })

  it('does not carry human ownership into a new conversation', () => {
    assert.equal(advisorOwnsConversation([], inboundAt), false)
  })
})
