import { sleep } from 'workflow'
import { wakeupDecision, shouldStopScheduledWorker, type ContactWakeup } from './conversation-schedule'

async function readWakeup(contact: string): Promise<ContactWakeup> {
  'use step'
  const { rpc } = await import('./data')
  return rpc<ContactWakeup>('lv_app_contact_wakeup', { p_contact: contact })
}

async function processContact(contact: string) {
  'use step'
  const { runAutomation } = await import('./worker')
  const result = await runAutomation(contact)
  // Store no conversation content or provider payload in the workflow journal.
  return { mode: result.mode, processed: result.processed ?? 0, reason: 'reason' in result ? result.reason : undefined }
}
// Effects may have reached Kommo before a connection fails. The database/outbox
// owns recovery; a workflow retry must never replay an indeterminate send.
processContact.maxRetries = 0

export async function scheduledConversation(contact: string, anchor: string) {
  'use workflow'
  for (let attempt = 0; attempt < 60; attempt++) {
    const decision = wakeupDecision(await readWakeup(contact), anchor, Date.now())
    if (decision.action === 'stop') return
    if (decision.action === 'wait') {
      await sleep(new Date(decision.until))
      continue
    }
    const result = await processContact(contact)
    if (shouldStopScheduledWorker(result)) return
    // Same-contact contention, the concurrency cap or the backup worker: wait
    // durably, without keeping an HTTP request or a Node timer alive.
    if (!result.processed) await sleep('5s')
  }
  // The persisted inbox remains eligible for the existing recovery cron.
}
