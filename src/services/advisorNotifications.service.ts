import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdvisorNotification } from '@/types/inmobiliaria'

const NOTIFICATION_SELECT =
  '*, lead:leads(id, name, phone, kommo_id), project:projects(id, name)'

export async function listAdvisorNotifications(
  supabase: SupabaseClient,
  recipientId: string,
  signal?: AbortSignal,
): Promise<AdvisorNotification[]> {
  if (!recipientId) return []
  let request = supabase
    .from('advisor_notifications')
    .select(NOTIFICATION_SELECT)
    .eq('recipient_id', recipientId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (signal) request = request.abortSignal(signal)
  let result = await request

  // If a relationship cache is temporarily stale just after applying the
  // migration, the private inbox remains usable without the optional joins.
  if (['PGRST200', 'PGRST201'].includes(result.error?.code ?? '')) {
    let fallback = supabase
      .from('advisor_notifications')
      .select('*')
      .eq('recipient_id', recipientId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (signal) fallback = fallback.abortSignal(signal)
    result = await fallback
  }
  if (result.error) throw result.error
  return (result.data ?? []) as unknown as AdvisorNotification[]
}

export async function markAdvisorNotificationRead(
  supabase: SupabaseClient,
  recipientId: string,
  notificationId: string,
) {
  const { error } = await supabase
    .from('advisor_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('recipient_id', recipientId)
    .is('read_at', null)
  if (error) throw error
}

export async function markAllAdvisorNotificationsRead(
  supabase: SupabaseClient,
  recipientId: string,
) {
  const { error } = await supabase
    .from('advisor_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', recipientId)
    .is('read_at', null)
  if (error) throw error
}
