'use client'

import Link from 'next/link'
import { formatAgendaDateTime } from '@/lib/inmobiliaria/agendaTime'
import { useVisitInbox } from '@/hooks/inmobiliaria/useVisitInbox'
import type { VisitInboxItem } from '@/types/inmobiliaria'

function slotLabel(item: VisitInboxItem) {
  if (item.proposed_start_time) return formatAgendaDateTime(item.proposed_start_time)
  return 'Consulta disponibilidad'
}

function statusLabel(item: VisitInboxItem, userId: string) {
  if (!item.assigned_advisor_id) return 'Sin responsable'
  if (item.status === 'awaiting_advisor' && item.assigned_advisor_id === userId) {
    return 'Pendiente de tu revisión'
  }
  if (item.status === 'awaiting_advisor') return 'Pendiente de revisión'
  if (item.status === 'awaiting_client') return 'Esperando al cliente'
  return item.status
}

export function AppointmentInboxBanner() {
  const { items, userId } = useVisitInbox()
  if (!items.length) return null

  return (
    <section
      aria-label="Solicitudes de visita pendientes"
      className="shrink-0 border-b border-[#e2e4dc] bg-[#f7f7f3] px-4 py-2 md:px-8"
    >
      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map((item) => (
          <article
            key={item.id}
            className="min-w-[260px] max-w-sm shrink-0 rounded-lg border border-[#c5c8bc] bg-white px-3 py-2 text-sm"
          >
            <p className="truncate font-semibold text-[#3a3d36]">
              {item.lead?.name || 'Cliente'}
              <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-[#7a7e70]">
                {item.request_type === 'reschedule' ? 'Reprogramación' : 'Cita nueva'}
              </span>
            </p>
            <p className="mt-1 text-xs text-[#5c6156]">{slotLabel(item)}</p>
            <p className="mt-1 text-[11px] text-[#7a7e70]">
              Recibida {formatAgendaDateTime(item.created_at)}
              {item.assigned_advisor?.full_name ? ` · ${item.assigned_advisor.full_name}` : ' · Sin asignar'}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#5c6156]">
                {statusLabel(item, userId)}
                {item.previous_request_id ? ' · Hubo propuesta anterior' : ''}
              </span>
              <Link
                href={`/inmobiliaria/agenda?appointment=${item.appointment_id}`}
                className="shrink-0 text-[11px] font-semibold text-[#4d5c50] underline-offset-2 hover:underline"
              >
                Revisar solicitud
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
