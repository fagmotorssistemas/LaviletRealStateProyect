import test from 'node:test'
import assert from 'node:assert/strict'
import { brochureDeliveryIntent, BROCHURE_URL } from './project-material'
import { leadIntroductionTurn, rememberLeadIntroduction } from './lead-introduction'
import { includeRequiredBrochure, replyLinkContract, replyLinkIssues } from './response-plan'

const history = [{ role: 'bot', content: 'Puedo compartirle el brochure. ¿Quiere que se lo envíe?' }]
const pending = { id: 'brochure_offer', act: 'material', question: '¿Quiere que se lo envíe?' }
test('equivalent acceptances share delivery across the opening and link contract without a data gate', () => {
  for (const current of ['Sí por favor', 'SI COMPARTEME INFORMACION', 'Adelante, me vendría muy bien']) {
    const extracted = { material_request: { kind: 'accept', evidence: current, confidence: 'high' } }
    const intent = brochureDeliveryIntent(current, history, extracted, pending)
    assert.equal(intent.requested, true)
    const turn = leadIntroductionTurn({ current, history, extracted, summary: { _pending_question: pending },
      reply: `Con mucho gusto. ${BROCHURE_URL}`, audit: { source: 'brochure' } })
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.equal(turn.brochureDeferred, false)
    assert.doesNotMatch(turn.reply, /Para enviarle|reside actualmente|su nombre/)
    const contract = replyLinkContract('', turn.audit)
    assert.ok(contract.required_links.includes(BROCHURE_URL))
    assert.deepEqual(replyLinkIssues(includeRequiredBrochure('Con mucho gusto.', turn.audit), contract), [])
    for (const accepted of [true, false]) {
      const state = rememberLeadIntroduction({ previous: {}, planned: turn.state, profile: {}, reply: turn.reply,
        audit: { ...turn.audit, turn_completeness: { status: 'checked' } }, accepted, followUpUsable: true })
      assert.equal(state.brochure_sent === true, accepted)
    }
  }
})

test('legacy acceptances of the same material offer no longer diverge at opening', () => {
  const legacyHistory = [{ role: 'bot', content: 'Puedo compartirle la información del proyecto disponible hasta ahora.' }]
  for (const current of ['Sí por favor', 'SI COMPARTEME INFORMACION']) {
    const intent = brochureDeliveryIntent(current, legacyHistory)
    assert.equal(intent.requested, true)
    const turn = leadIntroductionTurn({ current, history: legacyHistory, reply: BROCHURE_URL, audit: { source: 'brochure' } })
    assert.equal(turn.brochureDeferred, false)
    assert.ok(turn.reply.includes(BROCHURE_URL))
  }
})

test('a yes to another flow, informational request, rejected offer and historical evidence do not accept the brochure', () => {
  for (const [current, otherHistory, extracted, question] of [
    ['Sí', [{ role: 'bot', content: '¿Desea iniciar financiamiento?' }], {}, { id: 'financing_invitation' }],
    ['Quiero información', [], { material_request: { kind: 'none', evidence: '', confidence: 'high' } }, {}],
    ['No, no me lo envíe', history, { material_request: { kind: 'decline', evidence: 'No, no me lo envíe', confidence: 'high' } }, pending],
    ['Qué días atienden', history, { material_request: { kind: 'accept', evidence: 'Sí', confidence: 'high' } }, pending],
    ['Sí', [{ role: 'bot', content: '¿Prefiere departamentos o penthouses?' }], { material_request: { kind: 'accept', evidence: 'Sí', confidence: 'high' } }, { id: 'property_category' }],
  ] as const) assert.equal(brochureDeliveryIntent(current, otherHistory, extracted, question).requested, false, current)
})

test('new material intent does not change the residence-confirmation deferral', () => {
  const profile = { full_name: 'Nathaly', name_status: 'confirmed', sources: { full_name: { source: 'lead_declaration', evidence: 'Nathaly' } },
    residence_status: 'pending_confirmation', residence_candidate: { city: 'Cuenca', evidence: 'Soy de Cuenca' } }
  const turn = leadIntroductionTurn({ current: 'Nathaly, soy de Cuenca', extracted: { lead_profile: profile },
    summary: { _lead_introduction: { status: 'pending', request_sent: true } }, reply: 'Con gusto.', audit: {} })
  assert.equal(turn.brochureDeferred, true)
  assert.ok(!turn.reply.includes(BROCHURE_URL))
})
