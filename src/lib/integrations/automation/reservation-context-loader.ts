import 'server-only'
import { db, scope, text, type Row } from './data'
import { projectReservationOperation } from './reservation-operation-context'

type ReservationRead = (leadId: string, sourceSentAt: string) => Promise<{ data: Row[] | null; error: unknown }>

const readLatestReservation: ReservationRead = async (leadId, sourceSentAt) => {
  // The request table is scoped through its lead FK, not tenant/project columns.
  // Only an already scoped lead can reach this reader.
  return await db().from('lead_reservation_requests')
    .select('id,lead_id,unit_ids,request_status,source_message_id,source_sent_at,created_at,notification_status')
    .eq('lead_id', leadId).lte('source_sent_at', sourceSentAt)
    .order('created_at', { ascending: false }).limit(1)
    .abortSignal(AbortSignal.timeout(5000))
}

/** One read per turn. An unavailable source is never evidence of no request. */
export async function loadReservationContext(lead: Row, catalog: Row[], sourceSentAt: string,
  read: ReservationRead = readLatestReservation): Promise<Row> {
  const unavailable = () => projectReservationOperation({ requests: [], lead, catalog, readStatus: 'unavailable' })
  if (!text(lead.id) || lead.tenant_id !== scope.tenant_id || lead.project_id !== scope.project_id
    || !Number.isFinite(Date.parse(sourceSentAt))) return unavailable()
  try {
    const result = await read(text(lead.id), sourceSentAt)
    if (result.error || !Array.isArray(result.data)) return unavailable()
    return projectReservationOperation({ requests: result.data, lead, catalog, readStatus: 'available' })
  } catch {
    return unavailable()
  }
}
