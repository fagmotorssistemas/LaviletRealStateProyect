import { CalendarDays, Check, ChevronRight, Clock3, History, House, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { AppointmentWithUnits, VisitSchedulingOptions } from '@/types/inmobiliaria'
import { formatAgendaDateTime } from '@/lib/inmobiliaria/agendaTime'
import { visitInterest, visitRequestLabel, visitTimeline } from '@/lib/inmobiliaria/visitPresentation'

const availabilityMessages: Record<string, string> = {
  advisor_unavailable: 'No hay un asesor disponible para esta solicitud. Puedes solicitar una reasignación.',
  needs_time: 'Falta concretar la hora. Puedes elegir un horario disponible y proponérselo al cliente.',
  past: 'El horario solicitado ya pasó. Elige una nueva propuesta.',
  outside_hours: 'El horario solicitado está fuera de la jornada de visitas.',
  busy: 'Ese horario ya está ocupado. Puedes proponer una alternativa disponible.',
  expired: 'La propuesta venció. Envía una nueva para que el cliente la confirme.',
}
const appointmentLabels: Record<string, string> = { aceptado: 'Cita confirmada', reprogramado: 'Cita reprogramada', cancelado: 'Cita cancelada', atendido: 'Visita realizada' }

function requestedLabel(detail: AppointmentWithUnits, options: VisitSchedulingOptions | null) {
  if (detail.collectingVisit) return 'Horario en coordinación'
  const request = detail.openReschedule
  if (!request && detail.start_time) return formatAgendaDateTime(detail.start_time)
  const date = options?.requested.start_time ?? request?.proposed_start_time
  if (date) return formatAgendaDateTime(date)
  if (options?.requested.requested_date) {
    const day = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', weekday: 'long', day: 'numeric', month: 'long' })
      .format(new Date(`${options.requested.requested_date}T12:00:00-05:00`))
    return `${day} · hora por definir`
  }
  return request ? 'Fecha y hora por definir' : formatAgendaDateTime(detail.start_time)
}

export function AppointmentSummary({ detail, options, scheduleLoading, scheduleError, canManage, saving, onAccept, onPropose, onReassign, onDetails, onConfirm, onAttendance, onCancel }: {
  detail: AppointmentWithUnits; options: VisitSchedulingOptions | null; scheduleLoading: boolean; scheduleError: string
  canManage: boolean; saving: boolean; onAccept: () => void; onPropose: () => void; onReassign: () => void
  onDetails: () => void; onConfirm: () => void; onAttendance: () => void; onCancel: () => void
}) {
  const request = detail.openReschedule
  const history = visitTimeline(detail).slice(0, 2)
  const waitingClient = request?.status === 'awaiting_client'
  const canAccept = Boolean(options?.can_accept || (request?.proposed_by === 'advisor' && request.status === 'awaiting_advisor' && options?.available))
  const pending = Boolean(request || ['solicitada', 'pendiente'].includes(detail.status))
  const availabilityMessage = options?.reason === 'needs_time'
    ? options.requested.needs_help ? 'El cliente pidió ayuda para elegir el horario. Revisa las recomendaciones y envíale una propuesta.'
      : options.requested.confidence === 'time_only' ? 'Falta concretar el día de la visita.'
      : options.requested.requested_date && options.requested.has_time ? 'Falta confirmar si el horario es por la mañana o por la tarde.'
        : options.requested.requested_date ? 'Falta concretar la hora de la visita.' : 'Falta concretar la fecha y la hora de la visita.'
    : availabilityMessages[options?.reason ?? '']
  return <div className="space-y-5">
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${waitingClient ? 'bg-sky-50 text-sky-800' : pending ? 'bg-amber-50 text-amber-800' : 'bg-[#edf2e7] text-[#526247]'}`}>
          {detail.collectingVisit ? 'Definiendo horario con el cliente' : request ? visitRequestLabel(request.status) : detail.status === 'atendido' && detail.no_show ? 'No asistió' : (appointmentLabels[detail.status] ?? 'Cita pendiente')}
        </span>
        {request?.previous_request_id && <span className="text-xs text-[#858a7c]">{request.proposed_by === 'client' ? 'Nueva preferencia del cliente' : 'Nueva propuesta de horario'}</span>}
      </div>
      <p className="text-xs font-medium text-[#818575]">{pending ? 'Cita solicitada por' : 'Visita de'}</p>
      <h3 className="mt-1 text-xl font-semibold tracking-tight text-[#353c30]">{detail.lead?.name || 'Cliente'}</h3>
    </div>

    <div className="overflow-hidden rounded-2xl border border-[#e3e6dc] bg-[#f8f9f5]">
      <div className="flex gap-3 p-4 sm:p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#787d62] shadow-sm"><CalendarDays size={20} /></span>
        <div className="min-w-0">
          <p className="text-xs text-[#7b8170]">{waitingClient ? 'Horario propuesto' : pending ? 'Fecha y hora solicitadas' : 'Fecha y hora de la visita'}</p>
          <p className="mt-1 text-2xl font-semibold leading-snug tracking-tight text-[#3e4735]">{scheduleLoading ? 'Consultando horario…' : requestedLabel(detail, options)}</p>
          <p className="mt-1 text-xs text-[#858a7c]">Hora de Ecuador · duración de 60 minutos</p>
          {options?.requested.preferred_period && <p className="mt-1 text-sm text-[#667253]">Prefiere {options.requested.preferred_period === 'afternoon' ? 'por la tarde' : 'por la mañana'}</p>}
        </div>
      </div>
      <div className="flex items-start gap-3 border-t border-[#e3e6dc] bg-white/60 px-4 py-3 sm:px-5">
        <House size={17} className="mt-0.5 shrink-0 text-[#858a7c]" />
        <div><p className="text-xs text-[#7b8170]">Propiedad de interés</p><p className="mt-0.5 text-sm font-medium text-[#3e4735]">{visitInterest(detail)}</p></div>
      </div>
    </div>

    {request && ((options?.requested.source_messages?.length ?? 0) > 0 || request.source_message_text) && <section className="rounded-xl border border-[#eceee6] px-4 py-3">
      <h4 className="mb-2 text-xs font-semibold text-[#7b8170]">Mensajes del lead</h4>
      <div className="max-h-32 space-y-2 overflow-y-auto">
        {options?.requested.source_messages?.length ? options.requested.source_messages.map(message => <blockquote key={message.id} className="whitespace-pre-wrap border-l-2 border-[#dce1d2] pl-3 text-sm leading-relaxed text-[#7b8170]">{message.text}</blockquote>)
          : <blockquote className="whitespace-pre-wrap text-sm leading-relaxed text-[#7b8170]">{request.source_message_text}</blockquote>}
      </div>
    </section>}

    {request && canManage && <div className="space-y-3">
      {scheduleLoading ? <p role="status" className="text-xs text-[#858a7c]">Comprobando la agenda del asesor…</p>
        : scheduleError ? <p role="alert" className="text-sm text-[#966543]">{scheduleError}</p>
          : !waitingClient && options?.reason ? <p className="text-sm leading-relaxed text-[#79715f]">{availabilityMessage}</p>
            : options?.can_accept ? <p className="flex items-center gap-1.5 text-xs text-[#607351]"><Check size={14} />El horario solicitado está disponible en la agenda del asesor.</p> : null}
      {!waitingClient && <Button type="button" size="lg" className="w-full gap-2 tracking-normal" disabled={saving || scheduleLoading || !canAccept} onClick={onAccept}>
        <Check size={17} />{saving ? 'Guardando…' : 'Aceptar cita'}
      </Button>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" className="h-auto min-h-10 gap-2 py-2.5 tracking-normal" disabled={saving} onClick={onPropose}><Clock3 size={15} />Proponer horario</Button>
        <Button type="button" variant="ghost" className="h-auto min-h-10 gap-2 py-2.5 tracking-normal" disabled={saving} onClick={onReassign}><RefreshCw size={14} />Solicitar reasignación</Button>
      </div>
      {waitingClient && <p className="text-xs text-[#858a7c]">La cita se confirmará cuando el cliente acepte esta propuesta.</p>}
    </div>}
    {request && !canManage && <p className="text-sm text-[#7b8170]">Esta solicitud está a cargo de {detail.responsible?.full_name || 'otro asesor'}.</p>}

    {detail.collectingVisit && <p className="text-sm text-[#7b8170]">Estamos completando el día y la hora con el cliente. Se avisará cuando responda o pida una recomendación.</p>}
    {!request && !detail.collectingVisit && <div className="flex flex-wrap gap-2">
      {['solicitada', 'pendiente'].includes(detail.status) && <Button type="button" className="tracking-normal" disabled={saving} onClick={onConfirm}>Confirmar cita</Button>}
      {['aceptado', 'reprogramado', 'atendido'].includes(detail.status) && <Button type="button" variant="outline" className="tracking-normal" onClick={onAttendance}>{detail.status === 'atendido' ? 'Editar asistencia' : 'Registrar asistencia'}</Button>}
      {!['atendido', 'cancelado'].includes(detail.status) && <Button type="button" variant="ghost" className="tracking-normal" onClick={onCancel}>Cancelar cita</Button>}
    </div>}

    {history.length > 0 && <div className="border-t border-[#eceee6] pt-4">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-[#7b8170]"><History size={13} />Últimos cambios</p>
      <ol className="space-y-3">{history.map(item => <li key={item.id} className="border-l-2 border-[#dce1d2] pl-3">
        <div className="flex flex-wrap items-baseline justify-between gap-1"><p className="text-xs font-medium text-[#535c48]">{item.label}</p><time className="text-[11px] text-[#959b8b]">{formatAgendaDateTime(item.at)}</time></div>
        {item.description && <p className="mt-0.5 line-clamp-1 text-xs text-[#858a7c]">{item.description}</p>}
      </li>)}</ol>
    </div>}
    <button type="button" onClick={onDetails} className="flex w-full items-center justify-between rounded-xl border border-[#e7e9e1] px-4 py-3 text-sm font-medium text-[#667253] transition hover:bg-[#f8f9f5] focus-visible:outline-2 focus-visible:outline-[#787D62]">
      Ver detalles<ChevronRight size={16} />
    </button>
  </div>
}

export function AppointmentExpandedDetails({ detail }: { detail: AppointmentWithUnits }) {
  const history = visitTimeline(detail)
  return <div className="space-y-5 text-sm">
    <section className="rounded-xl bg-[#f8f9f5] p-4">
      <h3 className="font-semibold text-[#3e4735]">{detail.lead?.name || 'Cliente'}</h3>
      <p className="mt-1 text-[#7b8170]">{detail.lead?.phone || 'Teléfono no registrado'}</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><dt className="text-xs text-[#8a907e]">Interés</dt><dd className="mt-1 text-[#535c48]">{visitInterest(detail)}</dd></div>
        <div><dt className="text-xs text-[#8a907e]">Asesor responsable</dt><dd className="mt-1 text-[#535c48]">{detail.responsible?.full_name || 'Sin asignar'}</dd></div>
        <div><dt className="text-xs text-[#8a907e]">Proyecto</dt><dd className="mt-1 text-[#535c48]">{detail.project?.name || '—'}</dd></div>
        <div><dt className="text-xs text-[#8a907e]">Lugar de encuentro</dt><dd className="mt-1 text-[#535c48]">{detail.meeting_place || detail.project?.name || 'Por coordinar'}</dd></div>
      </dl>
      {detail.lead?.resume && <p className="mt-4 whitespace-pre-wrap border-t border-[#e3e6dc] pt-3 leading-relaxed text-[#646c59]">{detail.lead.resume}</p>}
    </section>
    {detail.openReschedule?.source_message_text && <section><h4 className="mb-2 text-xs font-semibold text-[#7b8170]">Mensaje que originó la solicitud actual</h4><blockquote className="rounded-xl border-l-2 border-[#bbc3ac] bg-[#fafbf8] p-3 leading-relaxed text-[#535c48]">{detail.openReschedule.source_message_text}</blockquote></section>}
    {(detail.notes || detail.result_notes) && <section><h4 className="mb-2 text-xs font-semibold text-[#7b8170]">Observaciones</h4><p className="whitespace-pre-wrap leading-relaxed text-[#646c59]">{detail.result_notes || detail.notes}</p></section>}
    {history.length > 0 && <section><h4 className="mb-3 text-xs font-semibold text-[#7b8170]">Historial de citas y cambios</h4><ol className="space-y-3">{history.map(item => <li key={item.id} className="rounded-xl border border-[#e7e9e1] p-3"><p className="font-medium text-[#535c48]">{item.label}</p><p className="mt-1 text-xs text-[#959b8b]">{formatAgendaDateTime(item.at)}</p>{item.description && <p className="mt-2 text-[#7b8170]">{item.description}</p>}</li>)}</ol></section>}
  </div>
}
