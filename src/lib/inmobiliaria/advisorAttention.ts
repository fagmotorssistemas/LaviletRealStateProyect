import type { LeadAutomationRow } from '@/types/leadAutomation'

export type AdvisorAttentionView = 'pending' | 'mine'
export type AdvisorAttentionPriority = 'high' | 'medium' | 'normal'

export function advisorAttentionView(
  row: Pick<LeadAutomationRow, 'handoff_status' | 'assigned_to'>,
  currentUserId: string,
): AdvisorAttentionView | null {
  if (row.handoff_status === 'resolved') return null
  if (['assigned', 'acknowledged'].includes(row.handoff_status) && row.assigned_to === currentUserId) return 'mine'
  if (row.handoff_status === 'queued' || ['assigned', 'acknowledged'].includes(row.handoff_status)) return 'pending'
  return null
}

function normalized(value: string | null | undefined) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function advisorAttentionPriority(
  row: Pick<LeadAutomationRow, 'sla_status' | 'handoff_reason' | 'last_visit_status'>,
): AdvisorAttentionPriority {
  const reason = normalized(row.handoff_reason)
  if (row.sla_status === 'vencido'
    || /\b(?:cancel|reagend|agend|cita|visita|reserv|separ|comprar|compra)\b/.test(reason)
    || ['solicitada', 'pendiente'].includes(String(row.last_visit_status ?? ''))) return 'high'
  if (row.sla_status === 'pendiente' || /\b(?:financ|credito|precio|presupuesto)\b/.test(reason)) return 'medium'
  return 'normal'
}

export function advisorAttentionTitle(reason: string | null | undefined) {
  const value = normalized(reason)
  if (/reagend|cambiar.*(?:cita|horario)/.test(value)) return 'Reagendar cita'
  if (/cancel.*cita/.test(value)) return 'Revisar cancelación'
  if (/agend|cita|visita/.test(value)) return 'Coordinar visita'
  if (/separ|reserv/.test(value)) return 'Separación o reserva'
  if (/financ|credito|banco|jep|pichincha/.test(value)) return 'Revisar financiamiento'
  if (/precio|presupuesto/.test(value)) return 'Verificar precio o presupuesto'
  return 'Consulta comercial'
}

export function advisorAttentionWaitLabel(value: string | null | undefined, now = Date.now()) {
  const started = Date.parse(String(value ?? ''))
  if (!Number.isFinite(started)) return 'Tiempo sin registrar'
  const minutes = Math.max(0, Math.floor((now - started) / 60_000))
  if (minutes < 1) return 'Ahora'
  if (minutes < 60) return `${minutes} min esperando`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ${minutes % 60} min esperando`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'día' : 'días'} esperando`
}
