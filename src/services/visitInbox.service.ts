import type { SupabaseClient } from '@supabase/supabase-js'
import type { VisitInboxItem } from '@/types/inmobiliaria'

const INBOX_SELECT =
  '*, lead:leads(id, name, phone, kommo_id, preferred_category), assigned_advisor:profiles!appointment_reschedule_requests_assigned_advisor_id_fkey(full_name), project:projects(id, name), appointment:appointments(id, status, meeting_place)'

export function visitInboxError(error: unknown) {
  const source = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const message = typeof source.message === 'string' && source.message.trim()
    ? source.message : typeof error === 'string' && error.trim() ? error : 'Error sin detalle'
  const code = typeof source.code === 'string' ? source.code : ''
  const connection = /Failed to fetch|NetworkError|Load failed|TimeoutError|AbortError|network|timed?\s*out/i.test(`${source.name ?? ''} ${message}`)
  const session = code === 'PGRST301' || code === 'PGRST303' || /JWT expired/i.test(message)
  return {
    diagnostic: `${code ? `[${code}] ` : ''}${message}`,
    message: connection
      ? 'No se pudo conectar para actualizar las citas. Reintentaremos automáticamente.'
      : session ? 'La sesión ha vencido. Vuelva a iniciar sesión para consultar las citas.'
        : 'No se pudieron actualizar las citas. Puede reintentar la consulta.',
    connection,
  }
}

export async function listVisitInbox(
  supabase: SupabaseClient,
  params: { isAdmin: boolean; userId: string; signal?: AbortSignal },
): Promise<VisitInboxItem[]> {
  if (!params.userId) return []
  const pageSize = 100
  const query = (select: string, offset: number) => {
    let request = supabase.from('appointment_reschedule_requests')
      .select(select)
      .in('status', ['awaiting_advisor', 'awaiting_client'])
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (!params.isAdmin) request = request.eq('assigned_advisor_id', params.userId)
    if (params.signal) request = request.abortSignal(params.signal)
    return request
  }

  const items = new Map<string, VisitInboxItem>()
  let select = INBOX_SELECT
  for (let offset = 0; ; offset += pageSize) {
    let result = await query(select, offset)
    // Network/session errors must not start an alternative query.
    if (!params.signal?.aborted && ['PGRST200', 'PGRST201'].includes(result.error?.code ?? '')) {
      select = '*'
      result = await query(select, offset)
    }
    if (result.error) throw result.error
    const rows = (result.data ?? []) as unknown as VisitInboxItem[]
    rows.forEach(item => items.set(item.id, item))
    if (rows.length < pageSize) return [...items.values()]
  }
}
