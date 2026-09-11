import type { AppointmentRequestStatus, AppointmentWithUnits } from '@/types/inmobiliaria'
import { formatAgendaDateTime } from './agendaTime'

const requestLabels: Record<AppointmentRequestStatus, string> = {
  awaiting_advisor: 'Pendiente de revisión',
  awaiting_client: 'Esperando al cliente',
  confirmed: 'Cita confirmada',
  rejected: 'Propuesta rechazada',
  superseded: 'Reemplazada por otra propuesta',
  cancelled: 'Cita cancelada',
  expired: 'Propuesta vencida',
}

export function visitRequestLabel(status: string) {
  return requestLabels[status as AppointmentRequestStatus] ?? 'Solicitud actualizada'
}

export function kommoLeadUrl(id: number | string | null | undefined) {
  const value = Number(id)
  return Number.isSafeInteger(value) && value > 0 ? `https://lavilet.kommo.com/leads/detail/${value}` : null
}

export function visitInterest(detail: AppointmentWithUnits) {
  const units = detail.units.length ? detail.units : (detail.lead?.lead_units ?? []).flatMap(link => link.unit ? [link.unit] : [])
  const categories: Record<string, string> = { local: 'Local comercial', local_comercial: 'Local comercial', suite: 'Suite', departamento: 'Departamento' }
  const label = (category?: string | null) => categories[category?.toLowerCase() ?? ''] ?? 'Propiedad'
  if (units.length) return units.map(unit => `${label(unit.category)} ${unit.unit_number}`).join(' · ')
  return detail.lead?.preferred_category ? label(detail.lead.preferred_category) : 'Visita general al proyecto'
}

export function visitTimeline(detail: AppointmentWithUnits) {
  const requests = (detail.rescheduleHistory ?? []).filter(row => row.id !== detail.openReschedule?.id)
  const items = requests.map(row => ({
    id: row.id,
    at: row.resolved_at ?? row.created_at,
    label: visitRequestLabel(row.status),
    description: row.proposed_start_time ? formatAgendaDateTime(row.proposed_start_time) : row.preferred_time_text,
  }))
  const actions: Record<string, string> = { confirmada: 'Cita confirmada', cancelada: 'Cita cancelada', reprogramada: 'Cita reprogramada', attended: 'Visita realizada', no_show: 'No asistió a la visita', asistencia: 'Asistencia registrada', asistio: 'Asistió', no_asistio: 'No asistió', asistencia_editada: 'Asistencia editada' }
  for (const event of detail.changeLog ?? []) {
    if (requests.some(row => event.detail?.request_id === row.id)) continue
    items.push({ id: event.id, at: event.created_at, label: actions[event.action] ?? 'Cita actualizada', description: event.action === 'asistencia_editada' ? `${event.detail?.previous_no_show ? 'No asistió' : 'Asistió'} → ${event.detail?.no_show ? 'No asistió' : 'Asistió'}. Editado por ${event.detail?.actor_name || 'Usuario registrado'}. Motivo: ${event.detail?.edit_reason || '—'}` : null })
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}
