'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type {
  Appointment,
  AppointmentLocationType,
  AppointmentWithUnits,
  TeamProfile,
  Unit,
} from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import { getAppointment, listProjectAdvisors } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import { Building2, Clock, FileText, MapPin, User } from 'lucide-react'
import { AppointmentInterestUnitsPicker } from '@/components/inmobiliaria/agenda/AppointmentInterestUnitsPicker'
import { AgendaVisitFields, addOneHour, type AgendaVisitFieldValues } from '@/components/inmobiliaria/agenda/AgendaVisitFields'
import {
  validateAppointmentForm,
  toastAppointmentValidationError,
} from '@/lib/inmobiliaria/appointmentFormValidation'
import {
  ecuadorLocalToIso,
  formatAgendaDateTime,
  isoToEcuadorParts,
} from '@/lib/inmobiliaria/agendaTime'
import {
  advisorAcceptRequestAction,
  advisorProposeRequestAction,
  cancelAppointmentAction,
  confirmAppointmentAction,
  markAppointmentAttendanceAction,
  markRequestReviewedAction,
  reassignVisitRequestAction,
  rejectVisitRequestAction,
  requestReassignmentAction,
} from '@/app/inmobiliaria/agenda/actions'

type Panel = 'view' | 'confirm' | 'attendance' | 'propose' | 'cancel' | 'reassign'

const emptyVisit: AgendaVisitFieldValues = {
  visitDate: '',
  startHm: '',
  endHm: '',
  responsibleId: '',
  meetingPlace: '',
  locationType: 'proyecto',
}

function visitFromAppointment(detail: AppointmentWithUnits): AgendaVisitFieldValues {
  const start = isoToEcuadorParts(detail.start_time)
  const end = isoToEcuadorParts(detail.end_time)
  return {
    visitDate: start?.date ?? '',
    startHm: start?.time ?? '',
    endHm: end?.time ?? (start?.time ? addOneHour(start.time) : ''),
    responsibleId: detail.responsible_id ?? '',
    meetingPlace: detail.meeting_place ?? detail.project?.name ?? '',
    locationType: (detail.location_type ?? 'proyecto') as AppointmentLocationType,
  }
}

interface AppointmentDetailModalProps {
  appointment: Appointment | null
  isOpen: boolean
  onClose: () => void
  tenantId: string
  onAppointmentUpdated?: () => void
  startInConfirm?: boolean
}

export function AppointmentDetailModal({
  appointment,
  isOpen,
  onClose,
  tenantId,
  onAppointmentUpdated,
  startInConfirm = false,
}: AppointmentDetailModalProps) {
  const { supabase, user, profile } = useAuth()
  const scope = useMemo(() => getDataAccessScope(user?.id, profile?.role), [user?.id, profile?.role])
  const [detail, setDetail] = useState<AppointmentWithUnits | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [panel, setPanel] = useState<Panel>('view')
  const [saving, setSaving] = useState(false)
  const [advisors, setAdvisors] = useState<TeamProfile[]>([])
  const [visit, setVisit] = useState<AgendaVisitFieldValues>(emptyVisit)
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([])
  const [visitedUnitIds, setVisitedUnitIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')

  const loadDetail = async (id: string) => {
    setLoadingDetail(true)
    setLoadError(false)
    try {
      const next = await getAppointment(supabase, id, scope)
      setDetail(next)
      setVisit(visitFromAppointment(next))
      setSelectedUnits([...next.units])
      setVisitedUnitIds(next.visitedUnitIds ?? [])
      setNotes('')
      return next
    } catch {
      setLoadError(true)
      toast.error('No se pudo cargar el detalle de la cita')
      return null
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => {
    if (!isOpen) {
      setPanel('view')
      setDetail(null)
      setLoadError(false)
      return
    }
    if (!appointment?.id) return
    let cancelled = false
    void loadDetail(appointment.id).then((next) => {
      if (cancelled || !next) return
      if (next.openReschedule?.id) {
        void markRequestReviewedAction(next.openReschedule.id).catch(() => undefined)
      }
      if (startInConfirm && (next.status === 'solicitada' || next.status === 'pendiente') && !next.openReschedule) {
        setPanel('confirm')
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when opening a different appointment
  }, [isOpen, appointment?.id, startInConfirm, supabase, scope])

  useEffect(() => {
    const projectId = detail?.project_id
    if (!isOpen || !projectId) {
      setAdvisors([])
      return
    }
    listProjectAdvisors(supabase, projectId)
      .then(setAdvisors)
      .catch(console.error)
  }, [isOpen, detail?.project_id, supabase])

  const patchVisit = (patch: Partial<AgendaVisitFieldValues>) => {
    setVisit((prev) => {
      const next = { ...prev, ...patch }
      if (patch.startHm && !prev.endHm) next.endHm = addOneHour(patch.startHm)
      return next
    })
  }

  const refreshAfter = async (message: string) => {
    if (!appointment?.id) return
    toast.success(message)
    onAppointmentUpdated?.()
    const next = await loadDetail(appointment.id)
    if (next) setPanel('view')
  }

  const handleConfirm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!detail) return
    const startIso = ecuadorLocalToIso(visit.visitDate, visit.startHm)
    const endIso = ecuadorLocalToIso(visit.visitDate, visit.endHm)
    const { missing, endBeforeOrEqualStart } = validateAppointmentForm({
      title: detail.title || 'Visita',
      lead_id: detail.lead_id ?? '',
      project_id: detail.project_id ?? '',
      start_time: startIso,
      end_time: endIso,
      notes,
      responsible_id: visit.responsibleId,
      meeting_place: visit.meetingPlace,
      requireResponsible: true,
    })
    const errMsg = toastAppointmentValidationError(missing, endBeforeOrEqualStart)
    if (errMsg) {
      toast.error(errMsg)
      return
    }
    setSaving(true)
    try {
      await confirmAppointmentAction({
        appointmentId: detail.id,
        startTime: startIso,
        endTime: endIso,
        responsibleId: visit.responsibleId,
        meetingPlace: visit.meetingPlace.trim(),
        locationType: visit.locationType,
        notes: notes.trim(),
        unitIds: selectedUnits.map((unit) => unit.id),
      })
      await refreshAfter('Cita confirmada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo confirmar la cita')
    } finally {
      setSaving(false)
    }
  }

  const handleAcceptRequest = async () => {
    if (!detail?.openReschedule) return
    setSaving(true)
    try {
      await advisorAcceptRequestAction(detail.openReschedule.id)
      await refreshAfter('Horario aceptado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo aceptar el horario')
    } finally {
      setSaving(false)
    }
  }

  const handleProposeRequest = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!detail?.openReschedule) return
    const startIso = ecuadorLocalToIso(visit.visitDate, visit.startHm)
    const endIso = ecuadorLocalToIso(visit.visitDate, visit.endHm)
    if (!startIso || !endIso) {
      toast.error('Indica fecha y hora para el nuevo horario.')
      return
    }
    setSaving(true)
    try {
      await advisorProposeRequestAction({
        requestId: detail.openReschedule.id,
        startTime: startIso,
        endTime: endIso,
        notes: notes.trim(),
      })
      await refreshAfter('Se envió la propuesta al cliente')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo proponer el horario')
    } finally {
      setSaving(false)
    }
  }

  const handleRejectRequest = async () => {
    if (!detail?.openReschedule) return
    setSaving(true)
    try {
      await rejectVisitRequestAction({ requestId: detail.openReschedule.id, notes: notes.trim() })
      await refreshAfter('La propuesta se rechazó. La cita original se mantiene si existía.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo rechazar')
    } finally {
      setSaving(false)
    }
  }

  const handleReassign = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!detail?.openReschedule) return
    if (!notes.trim()) {
      toast.error('Indica el motivo de la reasignación')
      return
    }
    setSaving(true)
    try {
      if (scope?.isAdmin) {
        await reassignVisitRequestAction({ requestId: detail.openReschedule.id, reason: notes.trim() })
        await refreshAfter('Solicitud reasignada')
      } else {
        await requestReassignmentAction({ requestId: detail.openReschedule.id, reason: notes.trim() })
        await refreshAfter('Se registró el pedido de reasignación')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo reasignar')
    } finally {
      setSaving(false)
    }
  }

  const handleAttendance = async (attended: boolean) => {
    if (!detail) return
    setSaving(true)
    try {
      await markAppointmentAttendanceAction({
        appointmentId: detail.id,
        attended,
        notes: notes.trim(),
        visitedUnitIds,
      })
      await refreshAfter(attended ? 'Asistencia registrada' : 'Inasistencia registrada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar la asistencia')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!detail) return
    setSaving(true)
    try {
      await cancelAppointmentAction(detail.id, notes.trim())
      await refreshAfter('Cita cancelada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar la cita')
    } finally {
      setSaving(false)
    }
  }

  if (!appointment) return null

  const titleLabel = detail?.title || appointment.title || 'Cita'
  const canActOnRequest =
    Boolean(detail?.openReschedule)
    && Boolean(scope?.isAdmin || detail?.openReschedule?.assigned_advisor_id === user?.id)
  const needsConfirm = (detail?.status === 'solicitada' || detail?.status === 'pendiente') && !detail?.openReschedule
  const canAttend = detail?.status === 'aceptado' || detail?.status === 'reprogramado' || detail?.status === 'atendido'
  const canCancel = detail && !['atendido', 'cancelado'].includes(detail.status)
  const requestHistory = (detail?.rescheduleHistory ?? []).filter((row) => row.id !== detail?.openReschedule?.id)

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={panel === 'confirm' ? `Confirmar cita — ${titleLabel}` : `Cita — ${titleLabel}`}
      size="lg"
    >
      {loadingDetail && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {!loadingDetail && loadError && (
        <div className="space-y-4 py-10 text-center">
          <p className="text-sm text-gray-600">No se pudo cargar la información completa.</p>
          <Button type="button" variant="outline" onClick={() => appointment.id && void loadDetail(appointment.id)}>
            Reintentar
          </Button>
        </div>
      )}

      {!loadingDetail && !loadError && detail && panel === 'view' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={detail.status} type="appointment" />
            {detail.no_show ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8a5c58]">No asistió</span>
            ) : null}
            {detail.openReschedule ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#5c6156]">Cambio pendiente</span>
            ) : null}
            {detail.remindersPaused ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7a7e70]">
                Recordatorios en pausa
              </span>
            ) : null}
            {detail.confirmed_by_client ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#4d5c50]">
                Confirmada por el cliente
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-2 text-sm text-gray-600">
              <Clock size={14} className="mt-0.5 shrink-0 text-gray-400" />
              <div>
                <p className="text-xs text-gray-400">Horario actual</p>
                <p className="font-medium text-gray-900">{formatAgendaDateTime(detail.start_time)}</p>
                {detail.end_time ? (
                  <p className="text-xs text-gray-500">Hasta {formatAgendaDateTime(detail.end_time)}</p>
                ) : null}
              </div>
            </div>
            <div className="flex items-start gap-2 text-sm text-gray-600">
              <Clock size={14} className="mt-0.5 shrink-0 text-gray-400" />
              <div>
                <p className="text-xs text-gray-400">Solicitud recibida</p>
                <p className="font-medium text-gray-900">{formatAgendaDateTime(detail.requested_at)}</p>
              </div>
            </div>
          </div>

          {detail.preferred_time_text ? (
            <div className="rounded-lg border border-[#e2e4dc] bg-[#f7f7f3] p-3 text-sm">
              <p className="text-xs uppercase tracking-wider text-[#7a7e70]">Preferencia original del cliente</p>
              <p className="mt-1 text-[#3a3d36]">{detail.preferred_time_text}</p>
            </div>
          ) : null}

          <div className="flex items-start gap-2 text-sm">
            <User size={14} className="mt-0.5 shrink-0 text-gray-400" />
            <div>
              <p className="text-xs text-gray-400">Cliente</p>
              {detail.lead ? (
                <p className="text-gray-800">
                  <strong>{detail.lead.name}</strong>
                  {detail.lead.phone ? <span className="text-gray-500"> • {detail.lead.phone}</span> : null}
                </p>
              ) : (
                <p className="text-gray-500">—</p>
              )}
            </div>
          </div>

          {detail.project ? (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin size={14} className="text-gray-400" />
              <span>{detail.project.name}</span>
            </div>
          ) : null}

          <div className="flex items-center gap-2 text-sm text-gray-600">
            <User size={14} className="text-gray-400" />
            <span>Asesor: {detail.responsible?.full_name ?? 'Sin asignar'}</span>
          </div>

          {detail.meeting_place ? (
            <p className="text-sm text-gray-600">Lugar: {detail.meeting_place}</p>
          ) : null}

          <div className="rounded-lg bg-gray-50 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs text-gray-400">
              <FileText size={12} /> Notas
            </div>
            <p className="whitespace-pre-wrap text-sm text-gray-700">
              {detail.notes?.trim() ? detail.notes : 'Sin notas.'}
            </p>
            {detail.result_notes ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">Resultado: {detail.result_notes}</p>
            ) : null}
          </div>

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Unidad(es) de interés</h4>
            {detail.units.length > 0 ? (
              <div className="space-y-2">
                {detail.units.map((unit) => (
                  <div
                    key={unit.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    <Building2 className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="font-medium text-gray-900">{unit.unit_number}</span>
                    <span className="text-gray-500">{unit.category}</span>
                    {detail.visitedUnitIds?.includes(unit.id) ? (
                      <span className="ml-auto text-[10px] uppercase text-[#4d5c50]">Visitada</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm italic text-gray-400">Visita general al proyecto, sin unidad concreta.</p>
            )}
          </div>

          {detail.openReschedule ? (
            <div className="space-y-3 rounded-lg border border-[#c5c8bc] bg-[#f7f7f3] p-4">
              <p className="text-sm font-semibold text-[#3a3d36]">
                {detail.openReschedule.request_type === 'reschedule' ? 'Reprogramación' : 'Cita nueva'}
                {detail.openReschedule.previous_request_id ? ' · Hubo propuesta anterior' : ''}
              </p>
              <p className="text-sm text-[#5c6156]">
                Propuesta vigente:{' '}
                {detail.openReschedule.proposed_start_time
                  ? formatAgendaDateTime(detail.openReschedule.proposed_start_time)
                  : detail.openReschedule.preferred_time_text || 'Consulta disponibilidad'}
              </p>
              {detail.openReschedule.source_message_text ? (
                <p className="text-sm text-[#3a3d36]">
                  Mensaje del cliente: {detail.openReschedule.source_message_text}
                </p>
              ) : null}
              <p className="text-xs text-[#7a7e70]">
                Asesor: {detail.responsible?.full_name ?? 'Sin asignar'}
                {detail.openReschedule.status === 'awaiting_advisor' ? ' · Pendiente de revisión' : ' · Esperando al cliente'}
              </p>
              <p className="text-xs text-[#7a7e70]">
                Aceptación cliente: {detail.openReschedule.client_accepted_at ? formatAgendaDateTime(detail.openReschedule.client_accepted_at) : 'No'}
                {' · '}
                Aceptación asesor: {detail.openReschedule.advisor_accepted_at ? formatAgendaDateTime(detail.openReschedule.advisor_accepted_at) : 'No'}
              </p>
              {canActOnRequest ? (
                <>
                  <Textarea
                    id="reschedule-notes"
                    label="Observaciones o motivo"
                    placeholder="Opcional, salvo al pedir reasignación"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {detail.openReschedule.proposed_start_time ? (
                      <Button type="button" disabled={saving} onClick={() => void handleAcceptRequest()}>
                        Aceptar horario
                      </Button>
                    ) : null}
                    <Button type="button" variant="outline" disabled={saving} onClick={() => setPanel('propose')}>
                      Proponer otro horario
                    </Button>
                    <Button type="button" variant="outline" disabled={saving} onClick={() => setPanel('reassign')}>
                      Solicitar reasignación
                    </Button>
                    {detail.openReschedule.request_type === 'reschedule' ? (
                      <Button type="button" variant="outline" disabled={saving} onClick={() => void handleRejectRequest()}>
                        Rechazar cambio
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="text-xs text-[#8a5c58]">No puedes confirmar la solicitud de otro asesor.</p>
              )}
            </div>
          ) : null}

          {requestHistory.length > 0 ? (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Historial de propuestas
              </h4>
              <ul className="space-y-2 text-sm text-gray-600">
                {requestHistory.map((row) => (
                  <li key={row.id} className="rounded border border-gray-100 px-3 py-2">
                    {row.status} · {formatAgendaDateTime(row.proposed_start_time ?? row.created_at)}
                    {row.resolution_notes ? ` · ${row.resolution_notes}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:flex-wrap">
            {needsConfirm ? (
              <Button type="button" onClick={() => setPanel('confirm')}>
                Confirmar cita
              </Button>
            ) : null}
            {canAttend ? (
              <Button type="button" variant="outline" onClick={() => setPanel('attendance')}>
                Registrar asistencia
              </Button>
            ) : null}
            {canCancel ? (
              <Button type="button" variant="outline" onClick={() => setPanel('cancel')}>
                Cancelar cita
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {!loadingDetail && !loadError && detail && panel === 'confirm' && (
        <form onSubmit={handleConfirm} className="space-y-4">
          <p className="text-sm text-[#5c6156]">
            Cliente: <strong>{detail.lead?.name ?? '—'}</strong>
            {detail.lead?.phone ? ` · ${detail.lead.phone}` : ''}
          </p>
          <p className="text-sm text-[#5c6156]">Proyecto: <strong>{detail.project?.name ?? '—'}</strong></p>
          {detail.preferred_time_text ? (
            <p className="text-sm text-[#5c6156]">Preferencia original: {detail.preferred_time_text}</p>
          ) : null}
          <AgendaVisitFields values={visit} advisors={advisors} onChange={patchVisit} disabled={saving} />
          <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
            <AppointmentInterestUnitsPicker
              tenantId={detail.tenant_id || tenantId}
              projectId={detail.project_id ?? ''}
              selectedUnits={selectedUnits}
              onChange={setSelectedUnits}
            />
          </div>
          <Textarea
            id="confirm-notes"
            label="Observaciones"
            placeholder="Opcional"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setPanel('view')} disabled={saving}>
              Volver
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Confirmando...' : 'Confirmar cita'}
            </Button>
          </div>
        </form>
      )}

      {!loadingDetail && !loadError && detail && panel === 'propose' && (
        <form className="space-y-4" onSubmit={handleProposeRequest}>
          <p className="text-sm text-[#5c6156]">
            Propón un intervalo disponible. Eso registra tu aceptación de esa propuesta y la envía al cliente.
          </p>
          <AgendaVisitFields
            values={visit}
            advisors={advisors}
            onChange={patchVisit}
            disabled={saving}
            showAssignment={false}
          />
          <Textarea
            id="propose-notes"
            label="Observaciones"
            placeholder="Opcional"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setPanel('view')} disabled={saving}>
              Volver
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando...' : 'Proponer horario'}
            </Button>
          </div>
        </form>
      )}

      {!loadingDetail && !loadError && detail && panel === 'attendance' && (
        <div className="space-y-4">
          <p className="text-sm text-[#5c6156]">
            No se marca inasistencia por vencimiento. Elige el resultado real de la visita.
          </p>
          <Textarea
            id="attendance-notes"
            label="Observaciones"
            placeholder="Opcional"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {detail.units.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Unidades visitadas</p>
              {detail.units.map((unit) => (
                <label key={unit.id} className="flex items-center gap-2 text-sm text-[#3a3d36]">
                  <input
                    type="checkbox"
                    checked={visitedUnitIds.includes(unit.id)}
                    onChange={(event) => {
                      setVisitedUnitIds((prev) =>
                        event.target.checked ? [...prev, unit.id] : prev.filter((id) => id !== unit.id),
                      )
                    }}
                  />
                  {unit.unit_number} · {unit.category}
                </label>
              ))}
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" disabled={saving} onClick={() => void handleAttendance(true)}>
              Marcar asistió
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => void handleAttendance(false)}>
              Marcar no asistió
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPanel('view')} disabled={saving}>
              Volver
            </Button>
          </div>
        </div>
      )}

      {!loadingDetail && !loadError && detail && panel === 'reassign' && (
        <form className="space-y-4" onSubmit={handleReassign}>
          <p className="text-sm text-[#5c6156]">
            {scope?.isAdmin
              ? 'Coordinación reasigna de forma equitativa entre los asesores elegibles. No se reutiliza la aceptación del asesor anterior.'
              : 'Se registra el motivo. Coordinación aplica la reasignación o la regla automática de plazo.'}
          </p>
          <Textarea
            id="reassign-reason"
            label="Motivo"
            placeholder="Obligatorio"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setPanel('view')} disabled={saving}>
              Volver
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando...' : scope?.isAdmin ? 'Reasignar' : 'Solicitar reasignación'}
            </Button>
          </div>
        </form>
      )}
      {!loadingDetail && !loadError && detail && panel === 'cancel' && (
        <form onSubmit={handleCancel} className="space-y-4">
          <p className="text-sm text-[#5c6156]">Cancelar invalida recordatorios pendientes del horario actual.</p>
          <Textarea
            id="cancel-notes"
            label="Motivo"
            placeholder="Opcional"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setPanel('view')} disabled={saving}>
              Volver
            </Button>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving ? 'Cancelando...' : 'Confirmar cancelación'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}


