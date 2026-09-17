import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type MetaCapiStatusFilter = 'all' | 'sent' | 'failed'

export type MetaCapiOutboxKpis = {
  windowHours: number
  total: number
  sent: number
  failed: number
  pending: number
  errorPct: number
}

export type MetaCapiOutboxRow = {
  id: string
  phone: string | null
  createdAt: string
  eventName: string
  status: string
  statusLabel: string
  uiBucket: 'sent' | 'failed' | 'other'
  detail: string
  lastError: string | null
  deliveryLane: string
  eventId: string
}

export type MetaCapiOutboxResult = {
  kpis: MetaCapiOutboxKpis
  rows: MetaCapiOutboxRow[]
  totalFiltered: number
  fetchedAt: string
}

type OutboxDbRow = {
  id: string
  event_id: string
  event_name: string
  event_time: number | null
  payload: Record<string, unknown> | null
  status: string
  delivery_lane: string
  created_at: string
  forwarded_at: string | null
  last_error: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function phoneFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const raw = payload.phone ?? payload.user_phone ?? payload.wa_id
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/[^\d+]/g, '').trim()
  return digits || null
}

function ctwaDetail(payload: Record<string, unknown> | null, eventId: string, lastError: string | null): string {
  if (lastError) return lastError.slice(0, 120)
  const clid =
    typeof payload?.ctwa_clid === 'string'
      ? payload.ctwa_clid.trim()
      : typeof payload?.ctwaClid === 'string'
        ? payload.ctwaClid.trim()
        : ''
  if (clid) {
    const short = clid.length > 28 ? `${clid.slice(0, 12)}…${clid.slice(-8)}` : clid
    return `ctwa:${short}`
  }
  const channel = typeof payload?.messaging_channel === 'string' ? payload.messaging_channel : null
  if (channel) return `${channel}:${eventId.slice(0, 8)}`
  return eventId
}

function mapStatus(status: string): { label: string; bucket: 'sent' | 'failed' | 'other' } {
  if (status === 'forwarded') return { label: 'Enviado', bucket: 'sent' }
  if (status === 'dead') return { label: 'Fallido', bucket: 'failed' }
  if (status === 'cancelled') return { label: 'Cancelado', bucket: 'other' }
  if (status === 'needs_review' || status === 'review_hold') return { label: 'En revisión', bucket: 'other' }
  if (status === 'pending') return { label: 'Pendiente', bucket: 'other' }
  return { label: status, bucket: 'other' }
}

function mapRow(row: OutboxDbRow): MetaCapiOutboxRow {
  const payload = asRecord(row.payload)
  const mapped = mapStatus(row.status)
  return {
    id: row.id,
    phone: phoneFromPayload(payload),
    createdAt: row.created_at,
    eventName: row.event_name,
    status: row.status,
    statusLabel: mapped.label,
    uiBucket: mapped.bucket,
    detail: ctwaDetail(payload, row.event_id, row.last_error),
    lastError: row.last_error,
    deliveryLane: row.delivery_lane,
    eventId: row.event_id,
  }
}

/**
 * Bitácora CAPI desde `meta_capi_outbox` (últimas 24h por defecto).
 * Requiere cliente service_role (RLS bloquea authenticated).
 */
export async function listMetaCapiOutbox(
  admin: SupabaseClient,
  opts?: { hours?: number; filter?: MetaCapiStatusFilter; limit?: number },
): Promise<MetaCapiOutboxResult> {
  const hours = Math.min(168, Math.max(1, opts?.hours ?? 24))
  const filter = opts?.filter ?? 'all'
  const limit = Math.min(500, Math.max(1, opts?.limit ?? 200))
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from('meta_capi_outbox')
    .select(
      'id, event_id, event_name, event_time, payload, status, delivery_lane, created_at, forwarded_at, last_error',
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(800)

  if (error) throw new Error(error.message || 'No se pudo leer la cola CAPI')

  const mapped = ((data ?? []) as OutboxDbRow[]).map(mapRow)
  const sent = mapped.filter((r) => r.uiBucket === 'sent').length
  const failed = mapped.filter((r) => r.uiBucket === 'failed').length
  const pending = mapped.filter((r) => r.status === 'pending').length
  const total = mapped.length
  const errorPct = total > 0 ? Math.round((failed / total) * 1000) / 10 : 0

  const filtered =
    filter === 'sent'
      ? mapped.filter((r) => r.uiBucket === 'sent')
      : filter === 'failed'
        ? mapped.filter((r) => r.uiBucket === 'failed')
        : mapped

  return {
    kpis: {
      windowHours: hours,
      total,
      sent,
      failed,
      pending,
      errorPct,
    },
    rows: filtered.slice(0, limit),
    totalFiltered: filtered.length,
    fetchedAt: new Date().toISOString(),
  }
}
