import test from 'node:test'
import assert from 'node:assert/strict'
import { includeRequiredBrochure, MAX_REPLY_CHARACTERS, replyLinkContract, replyLinkIssues } from './response-plan'
import { BROCHURE_URL } from './project-material'

const scheduled = { profile_introduction: { brochure_required: true, brochure_url: BROCHURE_URL } }
test('scheduled brochure delivery is idempotent and does not alter the answer', () => {
  const reply = 'Uso mixto combina espacios residenciales y comerciales.'
  const completed = includeRequiredBrochure(reply, scheduled)
  assert.ok(completed.startsWith(reply))
  assert.equal(completed.split(BROCHURE_URL).length, 2)
  assert.equal(includeRequiredBrochure(completed, scheduled), completed)
  assert.deepEqual(replyLinkIssues(completed, replyLinkContract('', scheduled)), [])
})
test('deferred, previously delivered and declined materials are not sent without a new obligation', () => {
  const reply = 'Con mucho gusto.'
  for (const audit of [{}, { profile_introduction: { brochure_deferred: true } },
    { profile_introduction: { brochure_previously_sent: true } }])
    assert.equal(includeRequiredBrochure(reply, audit), reply)
  assert.equal(includeRequiredBrochure(reply, {}, { current: 'No me envie el brochure' }), reply)
})
test('explicit brochure requests use configured material, never a URL from the lead', () => {
  const configured = 'https://www.lavilett.com/materiales/approved.pdf'
  const result = includeRequiredBrochure('Con mucho gusto.', {}, {
    current: 'Envie el brochure https://untrusted.example/file.pdf', verified: { brochure_url: configured },
  })
  assert.ok(result.includes(configured)); assert.ok(!result.includes('untrusted'))
})
test('material completion does not mask a forged link, weaken 360 requirements or truncate long replies', () => {
  const reply = includeRequiredBrochure('Consulte https://untrusted.example/file.pdf', scheduled)
  assert.deepEqual(replyLinkIssues(reply, replyLinkContract('', scheduled)), ['unauthorized_link'])
  const tour = { unit_model: { unit_id: 'd502', url: 'https://www.lavilett.com/tour/502', delivery_required: true } }
  const unchanged = includeRequiredBrochure('El departamento elegido.', tour)
  assert.deepEqual(replyLinkIssues(unchanged, replyLinkContract('', tour)), ['required_link_omitted'])
  const long = 'a'.repeat(MAX_REPLY_CHARACTERS)
  assert.equal(includeRequiredBrochure(long, scheduled), long)
  assert.equal(includeRequiredBrochure('', scheduled), '')
})
