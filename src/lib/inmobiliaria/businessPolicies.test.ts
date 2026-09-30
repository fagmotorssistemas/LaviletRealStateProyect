import assert from 'node:assert/strict'
import test from 'node:test'
import { businessPolicies, changeBusinessPolicy, emptyPolicy, publishedBusinessPolicies, validatePolicy } from './businessPolicies'
import { verifiedClaimSources } from '../integrations/automation/turn-evidence'
import { reviewClaims } from '../integrations/automation/semantic-review'
import { sanitizeTraceSummary } from '../integrations/automation/trace-summary'

const now = '2026-09-30T16:00:00.000Z'
const content = { ...emptyPolicy(), title: 'Información a distancia', content: 'Se puede compartir el brochure con residentes en el exterior.',
  scope: 'Solo información. Las condiciones de reserva y firma deben confirmarse.', source: 'Responsable comercial, 30/09/2026' }
test('drafts never reach the bot; publishing, editing and pausing preserve unrelated configuration', () => {
  const original = { bot_visits: { enabled: true }, another_setting: 12 }
  const draft = changeBusinessPolicy(original, { action: 'draft', id: 'policy-1', value: content }, 'admin', now)
  assert.deepEqual(publishedBusinessPolicies(draft, 'preventa', now), [])
  const live = changeBusinessPolicy(draft, { action: 'publish', id: 'policy-1', value: content }, 'admin', now)
  const edited = changeBusinessPolicy(live, { action: 'draft', id: 'policy-1', value: { ...content, content: 'BORRADOR NO CONFIRMADO' } }, 'admin', now)
  assert.equal(publishedBusinessPolicies(edited, 'preventa', now)[0].policy_content, content.content)
  assert.deepEqual(edited.bot_visits, original.bot_visits)
  assert.equal(edited.another_setting, 12)
  const paused = changeBusinessPolicy(edited, { action: 'pause', id: 'policy-1' }, 'admin', now)
  assert.deepEqual(publishedBusinessPolicies(paused, 'preventa', now), [])
  assert.equal(businessPolicies(paused).items[0].history[0].content, content.content)
  const republished = changeBusinessPolicy(paused, { action: 'publish', id: 'policy-1', value: content }, 'admin', now)
  assert.equal(publishedBusinessPolicies(republished, 'preventa', now)[0].version, 2)
})
test('publication requires scope and source; expired or other-stage policies cannot be used', () => {
  for (const key of ['content', 'scope', 'source']) assert.throws(() => validatePolicy({ ...content, [key]: '' }, true, now))
  assert.throws(() => validatePolicy({ ...content, validUntil: '2026-09-29' }, true, now))
  assert.throws(() => validatePolicy({ ...content, validUntil: '2026-02-30' }, true, now))
  const live = changeBusinessPolicy({}, { action: 'publish', id: 'policy-1', value: { ...content, mode: 'preventa', validUntil: '2026-10-01' } }, 'admin', now)
  assert.equal(publishedBusinessPolicies(live, 'preventa', now).length, 1)
  assert.deepEqual(publishedBusinessPolicies(live, 'lanzamiento', now), [])
  assert.deepEqual(publishedBusinessPolicies(live, 'preventa', '2026-10-02T00:00:00Z'), [])
})
test('a published policy is project evidence; a residence declaration still cannot authorize purchase', () => {
  const live = changeBusinessPolicy({}, { action: 'publish', id: 'policy-1', value: content }, 'admin', now)
  const policies = publishedBusinessPolicies(live, 'preventa', now)
  const sources = verifiedClaimSources({ politicas_negocio: policies }, {}, {}, 'Resido en Colombia')
  const source = sources.find(item => item.path === 'contexto_verificado.politicas_negocio.0')!
  const reply = content.content
  const claim = { fragment: reply, subject: 'Información a distancia', claim_kind: 'project_fact', polarity: 'affirmation', verdict: 'supported', evidence_source: 'verified_context', evidence: content.scope, evidence_ids: [source.id] }
  assert.equal(reviewClaims([claim], reply, sources).valid, true)
  assert.equal(reviewClaims([{ ...claim, evidence_ids: [sources.find(item => item.path === 'mensaje_actual')!.id] }], reply, sources).issues[0].code, 'claim_source_not_verified')
  assert.equal((source.value as { version: number }).version, 1)
})

test('historical policy snapshots preserve identity and full text while protecting credentials', () => {
  const policy = { policy_id: '12345678-1234-1234-1234-123456789012', version: 1,
    policy_content: 'Condición comercial. '.repeat(100) + 'Bearer private-secret' }
  const result = sanitizeTraceSummary({ business_policy_sources: [policy] })
  const saved = (result.business_policy_sources as typeof policy[])[0]
  assert.equal(saved.policy_id, policy.policy_id)
  assert.ok(saved.policy_content.length > 1500)
  assert.doesNotMatch(saved.policy_content, /private-secret/)
  assert.equal(saved.version, 1)
})
