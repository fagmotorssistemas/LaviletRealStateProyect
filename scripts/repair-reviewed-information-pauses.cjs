/* eslint-disable @typescript-eslint/no-require-imports -- Explicitly reviewed, scoped CAS repair. */
// --plan reads only. --apply uses the exact saved plan, rechecks the source event
// and compares the entire text summary before updating it. No messages/RPCs.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'), false, { info() {}, error() {} })
require('./test-typescript.cjs')
const { db, scope } = require('../src/lib/integrations/automation/data.ts')
const { reviewedPauseRepair } = require('../src/lib/integrations/automation/reviewed-pause-repair.ts')
const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1]
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
async function read(query) { const response = await query.abortSignal(AbortSignal.timeout(15000)); if (response.error) throw Error(response.error.code); return response.data }
async function main() {
  if (args.includes('--plan')) {
    const manifest = JSON.parse(fs.readFileSync(value('--manifest'), 'utf8'))
    const plan = { scope, createdAt: new Date().toISOString(), actions: [], skipped: [] }
    for (const reviewed of manifest) {
      const event = await read(db().from('lv_integration_events').select('id,result').match(scope).eq('id', reviewed.sourceEventId).single())
      if (event.result?.leadId !== reviewed.leadId) throw Error('REPAIR_SOURCE_LEAD_MISMATCH')
      const conversations = await read(db().from('conversations').select('id,lead_id,summary').match(scope).eq('lead_id', reviewed.leadId))
      for (const row of conversations) {
        if (typeof row.summary !== 'string') { plan.skipped.push({ conversationId: row.id, reason: 'unexpected_summary_type' }); continue }
        const result = reviewedPauseRepair(JSON.parse(row.summary || '{}'), reviewed, plan.createdAt)
        if (!result.applicable) { plan.skipped.push({ conversationId: row.id, reason: result.reason }); continue }
        plan.actions.push({ conversationId: row.id, leadId: row.lead_id, sourceEventId: reviewed.sourceEventId,
          evidence: reviewed.evidence, before: row.summary, beforeHash: hash(row.summary), after: JSON.stringify(result.summary) })
      }
    }
    fs.mkdirSync(path.dirname(value('--out')), { recursive: true })
    fs.writeFileSync(value('--out'), JSON.stringify(plan, null, 2) + '\n')
    console.log(JSON.stringify({ mode: 'plan', actions: plan.actions.length, skipped: plan.skipped }))
    return
  }
  if (!args.includes('--apply')) throw Error('USE_PLAN_OR_APPLY')
  const file = value('--apply'), plan = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (JSON.stringify(plan.scope) !== JSON.stringify(scope)) throw Error('REPAIR_SCOPE_MISMATCH')
  if (Date.now() - Date.parse(plan.createdAt) > 86400000) throw Error('REPAIR_PLAN_EXPIRED')
  const results = []
  for (const action of plan.actions) {
    if (hash(action.before) !== action.beforeHash) throw Error('REPAIR_PLAN_CORRUPTED')
    const verified = reviewedPauseRepair(JSON.parse(action.before), action, plan.createdAt)
    if (!verified.applicable || JSON.stringify(verified.summary) !== action.after) throw Error('REPAIR_PLAN_NOT_REPRODUCIBLE')
    const event = await read(db().from('lv_integration_events').select('id,result').match(scope).eq('id', action.sourceEventId).single())
    if (event.result?.leadId !== action.leadId) throw Error('REPAIR_SOURCE_LEAD_MISMATCH')
    const changed = await read(db().from('conversations').update({ summary: action.after }).match(scope)
      .eq('id', action.conversationId).eq('lead_id', action.leadId).eq('summary', action.before).select('id'))
    results.push({ conversationId: action.conversationId, status: changed.length === 1 ? 'applied' : 'skipped_concurrent_change' })
  }
  fs.writeFileSync(file + '.result.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n')
  console.log(JSON.stringify({ mode: 'apply', results }))
}
main().catch(error => { console.error('PAUSE_REPAIR_FAILED', error.message); process.exitCode = 1 })
