import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildGuionBlock,
  isEngineerPrompt,
  replaceGuionBlock,
  GUION_START,
  GUION_END,
} from './automationGuion.ts'

describe('automation guion block', () => {
  it('numbers active questions', () => {
    const block = buildGuionBlock([{ question_text: '¿Su nombre?' }, { question_text: ' ¿Vivir o invertir? ' }])
    assert.match(block, /1\. ¿Su nombre\?/)
    assert.match(block, /2\. ¿Vivir o invertir\?/)
    assert.ok(block.startsWith(GUION_START))
    assert.ok(block.endsWith(GUION_END))
  })

  it('replaces an existing block without duplicating it', () => {
    const first = replaceGuionBlock('intro', buildGuionBlock([{ question_text: 'A' }]))
    const second = replaceGuionBlock(first, buildGuionBlock([{ question_text: 'B' }]))
    assert.equal(second.split(GUION_START).length, 2)
    assert.match(second, /1\. B/)
    assert.doesNotMatch(second, /1\. A/)
  })

  it('hides engineering prompts', () => {
    assert.equal(isEngineerPrompt('respuesta_comercial'), true)
    assert.equal(isEngineerPrompt('precio'), false)
  })
})
