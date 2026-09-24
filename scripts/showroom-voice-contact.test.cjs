// Real client callback with simulated UI/storage. Does not save contacts or call production.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const voice = require('../src/lib/tour/voiceAssist.ts')
const { isVoiceQuestion } = require('../src/lib/tour/voiceTurnIntent.ts')

test('contact invitation is consumed by the next turn; later yes does not ask for a phone', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/tour/TourVoiceAssist.tsx'), 'utf8')
  const callback = source.slice(source.indexOf('  const tryHandlePhoneTurn ='), source.indexOf('  const buildPickedTurn ='))
  const replies = []
  const context = {
    ...voice, isVoiceQuestion, phoneInvitationPendingRef: { current: true },
    isShowroomIdentified: () => false, setPhase() {}, setError() {},
    memoryFiltersRef: { current: null }, memoryMatchesRef: { current: [] },
    finishAssistantTurn: async data => replies.push(data),
    saveVoiceLeadPhone: async () => { throw new Error('Test must not write any contact') },
  }
  vm.createContext(context)
  vm.runInContext(ts.transpile(callback + '\nglobalThis.handle = tryHandlePhoneTurn;', { target: ts.ScriptTarget.ES2022 }), context)
  assert.equal(await context.handle('¿Cuánto cuesta la segunda?'), false)
  assert.equal(context.phoneInvitationPendingRef.current, false)
  assert.equal(await context.handle('sí'), false)
  assert.equal(replies.length, 0)
  context.phoneInvitationPendingRef.current = true
  assert.equal(await context.handle('no gracias'), true)
  assert.match(replies[0].speak, /sin dejar ningún contacto/)
  assert.equal(await context.handle('sí'), false)
  assert.equal(replies.length, 1)
})
