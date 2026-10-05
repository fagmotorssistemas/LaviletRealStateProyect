import assert from 'node:assert/strict'
import test from 'node:test'
import { businessPolicies, changeBusinessPolicy, emptyPolicy, publishedBusinessPolicies, validatePolicy } from './businessPolicies'
import { verifiedClaimSources } from '../integrations/automation/turn-evidence'
import { reviewClaims } from '../integrations/automation/semantic-review'
import { sanitizeTraceSummary } from '../integrations/automation/trace-summary'
import { businessPolicyExamples } from './businessPolicyExamples'

const now = '2026-09-30T16:00:00.000Z'
test('published legacy policies apply project-wide without changing automation permissions', () => {
  const fixtures = businessPolicyExamples(now)
  const stored = { automation: { test_only: true, enabled: false }, business_policies: { revision: 1, items: [], test_items: fixtures } }
  assert.equal(businessPolicies(stored).items.length, 4)
  const active = publishedBusinessPolicies(stored, 'preventa', now)
  assert.equal(active.length, 4)
  assert.doesNotMatch(JSON.stringify(active), /prueba|ejemplo|restricted|administrator-scenario/i)
  const edited = changeBusinessPolicy(stored, { action: 'publish', id: fixtures[0].id, value: fixtures[0].draft }, 'admin', now)
  assert.equal(edited.business_policies.items.length, 4)
  assert.deepEqual(edited.business_policies.test_items, [])
  assert.equal(publishedBusinessPolicies(edited, 'preventa', now).length, 4)
  assert.deepEqual(edited.automation, stored.automation)
  const paused = changeBusinessPolicy(edited, { action: 'pause', id: fixtures[0].id }, 'admin', now)
  assert.equal(publishedBusinessPolicies(paused, 'preventa', now).length, 3)
  assert.deepEqual(stored.business_policies.items, []) // reading does not mutate saved history
})
test('legacy entries cannot revive a paused policy or overwrite its current version', () => {
  const fixtures = businessPolicyExamples(now)
  const active = { ...fixtures[0], restricted: false, published: null }
  const stored = { business_policies: { items: [active], test_items: fixtures } }
  assert.equal(businessPolicies(stored).items.length, 4)
  assert.equal(publishedBusinessPolicies(stored, 'preventa', now).length, 3)
})
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
