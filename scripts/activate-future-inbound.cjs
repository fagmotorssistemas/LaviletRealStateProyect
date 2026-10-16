/* eslint-disable @typescript-eslint/no-require-imports -- Explicit operational command; never launches a bot. */
const fs = require('node:fs')
const cp = require('node:child_process')
const { createClient } = require('@supabase/supabase-js')
const scope = { tenant_id: 'a1b2c3d4-0001-4000-8000-000000000001', project_id: 'b1b2c3d4-0001-4000-8000-000000000001' }
const url = 'https://www.lavilett.com/api/integrations/automation/audience'
const tasks = ['nutrition_24h', 'nutrition_week_one', 'nutrition_week_two', 'nutrition_week_three']
const apply = process.argv.includes('--apply')
const check = (response, code) => { if (response.error) throw Error(code + ':' + response.error.code); return response.data }

async function run() {
  if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname !== 'xhjnyntywqhczdtecgim.supabase.co') throw Error('WRONG_DATABASE')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY, secret = process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET
  if (!key || !secret) throw Error('OPERATOR_CREDENTIALS_MISSING')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + secret }, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw Error('PRODUCTION_PREFLIGHT_HTTP_' + response.status)
  const deployed = await response.json(), head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (deployed.boundaryVersion !== 1 || deployed.commit !== head) throw Error('GUARDED_DEPLOYMENT_REQUIRED')
  if (!deployed.live || deployed.mode !== 'live' || deployed.environmentLeadRestricted || deployed.webhookContactRestricted) throw Error('PRODUCTION_RUNTIME_RESTRICTED')
  const config = check(await admin.from('lv_auto_config').select('*').match(scope).single(), 'CONFIG_READ')
  const project = check(await admin.from('projects').select('policies_json').eq('id', scope.project_id).eq('tenant_id', scope.tenant_id).single(), 'POLICY_READ')
  const policies = project.policies_json || {}, previous = policies.automation_audience
  if (previous && (previous.version !== 1 || previous.mode !== 'future_messages' || !Number.isFinite(Date.parse(previous.activatedAt)))) throw Error('AUDIENCE_POLICY_REQUIRES_REVIEW')
  if (previous && config.enabled && config.test_only === false && config.dry_run === false) {
    console.log(JSON.stringify({ active: true, alreadyActivated: true, audience: previous })); return
  }
  const policy = previous || { version: 1, mode: 'future_messages', activatedAt: new Date().toISOString() }
  const cutoff = Date.parse(policy.activatedAt)
  const busy = await admin.from('lv_integration_events').select('id', { count: 'exact', head: true }).match(scope).eq('status', 'processing')
    .or('kind.in.(inbound,delivery_retry),and(kind.eq.maintenance,payload->>task.in.(' + tasks.join(',') + '))')
  check(busy, 'ACTIVE_READ')
  const outbox = await admin.from('lv_outbox').select('id', { count: 'exact', head: true }).match(scope).eq('status', 'claimed')
  check(outbox, 'ACTIVE_OUTBOX_READ')
  const showroom = await admin.from('lv_showroom_contacts').select('id', { count: 'exact', head: true }).match(scope).eq('status', 'processing')
  check(showroom, 'ACTIVE_SHOWROOM_READ')
  if (busy.count || outbox.count || showroom.count) throw Error('ACTIVE_SEND_WAIT_AND_RETRY')
  console.log(JSON.stringify({ apply, previous: { enabled: config.enabled, dryRun: config.dry_run, testOnly: config.test_only }, next: { enabled: true, dryRun: false, testOnly: false }, audience: policy, preservesExistingPauses: true }))
  if (!apply) return
  fs.mkdirSync('tmp', { recursive: true })
  fs.writeFileSync('tmp/automation-activation-before.json', JSON.stringify({ at: new Date().toISOString(), config, previousAudience: previous || null }, null, 2))
  // Close the existing test gate before saving the boundary. Interrupted runs stay paused.
  const paused = check(await admin.from('lv_auto_config').update({ enabled: false }).match(scope)
    .eq('enabled', config.enabled).eq('test_only', config.test_only).eq('dry_run', config.dry_run).select('project_id'), 'PAUSE')
  if (paused.length !== 1) throw Error('CONFIG_CHANGED_RETRY')
  let save = admin.from('projects').update({ policies_json: { ...policies, automation_audience: policy }, updated_at: new Date().toISOString() }).eq('id', scope.project_id).eq('tenant_id', scope.tenant_id)
  save = project.policies_json === null ? save.is('policies_json', null) : save.eq('policies_json', JSON.stringify(project.policies_json))
  if (check(await save.select('id'), 'POLICY_SAVE').length !== 1) throw Error('PROJECT_CHANGED_AUTOMATION_LEFT_PAUSED')
  let cancelled = 0
  // Re-scan from zero after each cancellation so large backlogs are not skipped.
  for (;;) {
    const pending = check(await admin.from('lv_integration_events').select('id,kind,payload,received_at').match(scope).eq('status', 'pending')
      .or('kind.in.(inbound,delivery_retry),and(kind.eq.maintenance,payload->>task.in.(' + tasks.join(',') + '))')
      .lt('received_at', policy.activatedAt).order('id').limit(500), 'PENDING_READ')
    if (!pending.length) break
    const retired = check(await admin.from('lv_integration_events').update({ status: 'cancelled', completed_at: new Date().toISOString(),
      result: { action: 'cancelled', reason: 'BEFORE_PRODUCTION_ACTIVATION', delivery_status: 'not_sent', activated_at: policy.activatedAt } })
      .match(scope).eq('status', 'pending').in('id', pending.map(row => row.id)).select('id'), 'PENDING_RETIRE')
    if (!retired.length) throw Error('QUEUE_CHANGED_AUTOMATION_LEFT_PAUSED')
    cancelled += retired.length
  }
  const retiredVisits = check(await admin.from('lv_outbox').update({ status: 'cancelled', detail: 'BEFORE_PRODUCTION_ACTIVATION' }).match(scope)
    .eq('status', 'pending').lt('created_at', policy.activatedAt).in('kind', ['visit_propose', 'visit_confirm', 'visit_reschedule_confirm', 'visit_2h']).select('id'), 'OLD_VISITS_RETIRE')
  const retiredShowroom = check(await admin.from('lv_showroom_contacts').update({ status: 'cancelled', reason: 'BEFORE_PRODUCTION_ACTIVATION' }).match(scope)
    .eq('status', 'scheduled').lt('created_at', policy.activatedAt).select('id'), 'OLD_SHOWROOM_RETIRE')
  const finalPolicy = check(await admin.from('projects').select('policies_json').eq('id', scope.project_id).eq('tenant_id', scope.tenant_id).single(), 'VERIFY_POLICY')
  const verified = finalPolicy.policies_json.automation_audience
  if (verified?.version !== 1 || verified.mode !== policy.mode || verified.activatedAt !== policy.activatedAt) throw Error('ACTIVATION_VERIFICATION_FAILED_AUTOMATION_LEFT_PAUSED')
  const enabled = check(await admin.from('lv_auto_config').update({ enabled: true, dry_run: false, test_only: false }).match(scope)
    .eq('enabled', false).eq('test_only', config.test_only).eq('dry_run', config.dry_run).select('enabled,dry_run,test_only'), 'ACTIVATE')
  if (enabled.length !== 1) throw Error('CONFIG_CHANGED_AUTOMATION_LEFT_PAUSED')
  const receipt = { active: true, audience: policy, config: enabled[0], cancelled: { events: cancelled, visits: retiredVisits.length, showroom: retiredShowroom.length }, sends: 0,
    activatedAtLocal: new Date(cutoff).toLocaleString('es-EC', { timeZone: 'America/Bogota' }) }
  fs.writeFileSync('tmp/automation-activation-receipt.json', JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(receipt))
}
run().catch(error => { console.error(error.message); process.exitCode = 1 })
