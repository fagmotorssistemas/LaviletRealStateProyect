import 'server-only'
import { start } from 'workflow/api'
import { rpc } from './data'
import { scheduledConversation } from './conversation-workflow'
import type { ContactWakeup } from './conversation-schedule'

/** Enqueue durable work after inbox persistence, never after a client send. */
export async function scheduleConversations(contacts: string[]): Promise<void> {
  const results = await Promise.allSettled([...new Set(contacts)].map(async contact => {
    const pending = await rpc<ContactWakeup>('lv_app_contact_wakeup', { p_contact: contact })
    if (pending) await start(scheduledConversation, [contact, pending.event_id])
  }))
  if (results.some(result => result.status === 'rejected')) console.error('CONVERSATION_SCHEDULE_FAILED_CRON_FALLBACK')
}
