import 'server-only'
import { randomUUID } from 'node:crypto'
import { assertLive, automationSettings } from './config'
import { autoConfig, db, object, rpc, scope, text, type Row } from './data'
import { processConversation } from './conversation'
import { pendingVisits, planVisits, previewVisits, sendVisit } from './visits'
import { ProviderError } from './kommo'

async function scheduleTasks() {
  const now = new Date()
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(now)
  const tasks = [{ ...scope, event_key: `maintenance:${now.toISOString().slice(0, 16)}`, kind: 'maintenance', payload: {} }]
  if (automationSettings().globalMaintenance && !automationSettings().testLeadId) {
    tasks.push({ ...scope, event_key: `decay:${day}`, kind: 'decay', payload: {} })
  }
  const { error } = await db().from('lv_integration_events').upsert(tasks, { onConflict: 'project_id,event_key', ignoreDuplicates: true })
  if (error) throw new Error('TASK_SCHEDULE_FAILED')
}

export async function runAutomation() {
  const settings = automationSettings()
  if (settings.mode === 'off') return { mode: 'off', processed: 0 }
  if (settings.mode === 'preview') return { mode: 'preview', databaseWrites: false, visits: await previewVisits() }
  assertLive()
  const config = await autoConfig()
  if (config.enabled !== true || config.dry_run !== false) return { mode: 'live', processed: 0, reason: 'database_paused' }
  const token = randomUUID()
  if (await rpc('lv_app_worker_lock', { p_token: token, p_action: 'acquire' }) !== true) return { mode: 'live', processed: 0, reason: 'worker_busy' }
  const guard = async () => {
    assertLive()
    if (await rpc('lv_app_worker_lock', { p_token: token, p_action: 'renew' }) !== true) throw new Error('WORKER_LEASE_LOST')
  }
  const results: Row[] = [], started = Date.now()
  try {
    await scheduleTasks()
    // Reservas abandonadas del nuevo ejecutor requieren revisión; nunca reenvío automático.
    const { error } = await db().from('lv_outbox').update({ status: 'uncertain', detail: 'Worker interrumpido; comprobar Kommo' })
      .match(scope).eq('status', 'claimed').contains('payload', { _app: 'lavilet' })
      .lt('claimed_at', new Date(Date.now() - 5 * 60_000).toISOString())
    if (error) throw new Error('STALE_OUTBOX_CHECK_FAILED')
    for (let i = 0; i < 3 && Date.now() - started < 45_000; i++) {
      const batch = await rpc<Row[]>('lv_app_claim', { p_token: token })
      if (!batch.length) break
      const first = object(batch[0]), ids = batch.map(row => row.id)
      try {
        let result: Row
        if (first.kind === 'inbound') result = await processConversation(batch, guard)
        else if (first.kind === 'maintenance') {
          await guard()
          const enqueued = await planVisits(guard)
          // Estas RPC originales son globales. No ejecutarlas en modo de un lead de prueba.
          if (settings.globalMaintenance && !settings.testLeadId && config.test_only === false) {
            for (const name of ['lv_release_expired_holds', 'lv_escalate_overdue_requests', 'process_handoff_queue']) { await guard(); await rpc(name) }
          }
          result = { enqueued }
        } else if (first.kind === 'decay') {
          await guard()
          if (settings.globalMaintenance && !settings.testLeadId && config.test_only === false) await rpc('apply_temperature_decay')
          result = { action: 'daily_decay' }
        } else throw new Error('UNSUPPORTED_TASK')
        await rpc('lv_app_finish', { p_token: token, p_ids: ids, p_status: 'completed', p_result: result })
        results.push({ kind: first.kind, ...result })
      } catch (error) {
        // Una RPC o petición pudo ejecutar su efecto antes de fallar la conexión.
        // Guardar solo códigos propios, nunca cuerpos de proveedores o datos del cliente.
        const reason = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PROCESSING_FAILED'
        const detail = error instanceof ProviderError ? { provider_operation: error.operation, delivery_uncertain: error.uncertain, http_status: error.status } : {}
        await rpc('lv_app_finish', { p_token: token, p_ids: ids, p_status: 'uncertain', p_result: { reason, ...detail } })
        results.push({ kind: first.kind, status: 'uncertain', reason })
      }
    }
    for (const job of await pendingVisits()) {
      if (Date.now() - started > 150_000) break
      await guard()
      results.push(await sendVisit(text(job.id), guard))
    }
    return { mode: 'live', processed: results.length, results }
  } finally {
    // No libera el bloqueo de otro worker si nuestro arrendamiento ya expiró.
    await rpc('lv_app_worker_lock', { p_token: token, p_action: 'release' })
  }
}
