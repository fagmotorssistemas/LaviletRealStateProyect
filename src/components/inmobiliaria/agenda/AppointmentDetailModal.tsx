'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type {
  Appointment,
  AppointmentLocationType,
  AppointmentWithUnits,
  TeamProfile,
  Unit,
  VisitTimeSlot,
} from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import { getAppointment, listProjectAdvisors } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import { ArrowLeft, Send } from 'lucide-react'
import { AppointmentSummary, AppointmentExpandedDetails } from './AppointmentSummary'
import { KommoChatLink } from './KommoChatLink'
import { VisitRecommendations } from './VisitRecommendations'
import { useVisitScheduling } from '@/hooks/inmobiliaria/useVisitScheduling'
import { AppointmentInterestUnitsPicker } from '@/components/inmobiliaria/agenda/AppointmentInterestUnitsPicker'
import { AgendaVisitFields, addOneHour, type AgendaVisitFieldValues } from '@/components/inmobiliaria/agenda/AgendaVisitFields'
import {
  validateAppointmentForm,
  toastAppointmentValidationError,
} from '@/lib/inmobiliaria/appointmentFormValidation'
import {
  ecuadorLocalToIso,
  isoToEcuadorParts,
} from '@/lib/inmobiliaria/agendaTime'
import {
  advisorAcceptRequestAction,
  acceptClientVisitTimeAction,
  advisorProposeRequestAction,
  cancelAppointmentAction,
  confirmAppointmentAction,
  markAppointmentAttendanceAction,
  markRequestReviewedAction,
  reassignVisitRequestAction,
  rejectVisitRequestAction,
  requestReassignmentAction,
} from '@/app/inmobiliaria/agenda/actions'

type Panel = 'view' | 'details' | 'confirm' | 'attendance' | 'propose' | 'cancel' | 'reassign'

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
  appointment: Pick<Appointment, 'id' | 'title'> | null
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
  const detailSequence = useRef(0)
  const loadedRequestId = useRef<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [panel, setPanel] = useState<Panel>('view')
  const [saving, setSaving] = useState(false)
  const [advisors, setAdvisors] = useState<TeamProfile[]>([])
  const [visit, setVisit] = useState<AgendaVisitFieldValues>(emptyVisit)
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([])
  const [visitedUnitIds, setVisitedUnitIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const canActOnRequest = Boolean(detail?.openReschedule)
    && Boolean(scope?.isAdmin || detail?.openReschedule?.assigned_advisor_id === user?.id)
  const scheduling = useVisitScheduling(supabase, isOpen && canActOnRequest ? detail?.openReschedule?.id : undefined)

  const selectRecommendation = (slot: VisitTimeSlot) => {
    const start = isoToEcuadorParts(slot.start_time)
    const end = isoToEcuadorParts(slot.end_time)
    if (!start || !end) return
    setVisit(prev => ({ ...prev, visitDate: start.date, startHm: start.time, endHm: end.time }))
  }

  const loadDetail = async (id: string, background = false) => {
    const current = ++detailSequence.current
    if (!background) { setLoadingDetail(true); setLoadError(false) }
    try {
      const next = await getAppointment(supabase, id, scope)
      if (current !== detailSequence.current) return null
      const requestChanged = loadedRequestId.current !== (next.openReschedule?.id ?? null)
      loadedRequestId.current = next.openReschedule?.id ?? null
      setDetail(next)
      if (!background || requestChanged) {
        setVisit(visitFromAppointment(next))
        setSelectedUnits([...next.units])
        setVisitedUnitIds(next.visitedUnitIds ?? [])
        setNotes('')
        if (background) setPanel('view')
      }
      return next
    } catch {
      if (current !== detailSequence.current) return null
      if (!background) { setLoadError(true); toast.error('No se pudo cargar el detalle de la cita') }
      return null
    } finally {
      if (!background && current === detailSequence.current) setLoadingDetail(false)
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
    setPanel('view')
    setDetail(null)
    const guard = detailSequence
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
      guard.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when opening a different appointment
  }, [isOpen, appointment?.id, startInConfirm, supabase, scope])

  useEffect(() => {
    if (!isOpen || !appointment?.id || saving || loadingDetail) return
    const id = appointment.id
    const refresh = () => { void loadDetail(id, true) }
    const channel = supabase.channel('visit-detail-' + id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointment_reschedule_requests', filter: 'appointment_id=eq.' + id }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'appointments', filter: 'id=eq.' + id }, refresh)
      .subscribe()
    const timer = window.setInterval(refresh, 15000)
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the active appointment is reloaded without replacing an unchanged draft
  }, [isOpen, appointment?.id, saving, loadingDetail, supabase, scope])

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
    window.dispatchEvent(new Event('visit-inbox-updated'))
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
      const requested = scheduling.options?.requested
      if (detail.openReschedule.proposed_by === 'client' && (!scheduling.options?.can_accept || !requested?.start_time || !requested.end_time || !requested.source_message_id)) {
        throw new Error('Actualiza la disponibilidad antes de aceptar el horario del cliente.')
      }
      const result = scheduling.options?.can_accept && requested?.start_time && requested.end_time && requested.source_message_id
        ? await acceptClientVisitTimeAction({ requestId: detail.openReschedule.id, startTime: requested.start_time, endTime: requested.end_time, sourceMessageId: requested.source_message_id })
        : await advisorAcceptRequestAction(detail.openReschedule.id)
      await refreshAfter(result.status === 'confirmed' ? 'Cita confirmada. Se enviará la confirmación al cliente.' : 'Horario aceptado. Se enviará la propuesta al cliente.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo aceptar el horario')
      void scheduling.reload()
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
      await refreshAfter('Propuesta registrada. Se enviará al cliente.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo proponer el horario')
      void scheduling.reload()
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

  const panelTitle: Record<Panel, string> = {
    view: detail?.openReschedule ? 'Cita pendiente' : 'Visita a La Vilet',
    details: 'Detalles de la visita', confirm: 'Confirmar cita', attendance: 'Registrar asistencia',
    propose: 'Proponer otro horario', cancel: 'Cancelar cita', reassign: 'Solicitar reasignación',
  }
  const openProposal = () => {
    setVisit(prev => ({ ...prev, visitDate: scheduling.options?.requested.requested_date ?? '', startHm: '', endHm: '' }))
    setNotes('')
    setPanel('propose')
    void scheduling.reload()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={panelTitle[panel]}
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

      {!loadingDetail && !loadError && detail && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          {panel !== 'view' ? <button type="button" disabled={saving} onClick={() => setPanel('view')} className="inline-flex items-center gap-1.5 rounded-lg py-2 pr-3 text-xs font-medium text-[#858a7c] hover:text-[#526247]"><ArrowLeft size={14} />Resumen de la cita</button>
            : <span className="text-xs text-[#959b8b]">{detail.project?.name || 'La Vilet'}</span>}
          <KommoChatLink kommoId={detail.lead?.kommo_id} />
        </div>
      )}
      {!loadingDetail && !loadError && detail && panel === 'view' && (
        <AppointmentSummary
          detail={detail} options={scheduling.options} scheduleLoading={scheduling.loading} scheduleError={scheduling.error}
          canManage={canActOnRequest} saving={saving} onAccept={() => void handleAcceptRequest()}
          onPropose={openProposal} onReassign={() => { setNotes(''); setPanel('reassign') }}
          onDetails={() => setPanel('details')} onConfirm={() => setPanel('confirm')}
          onAttendance={() => setPanel('attendance')} onCancel={() => setPanel('cancel')}
        />
      )}
      {!loadingDetail && !loadError && detail && panel === 'details' && (
        <div className="space-y-5">
          <AppointmentExpandedDetails detail={detail} />
          <div className="flex flex-wrap gap-2 border-t border-[#eceee6] pt-4">
            {canActOnRequest && detail.openReschedule?.request_type === 'reschedule' && <Button type="button" variant="outline" className="tracking-normal" disabled={saving} onClick={() => void handleRejectRequest()}>Rechazar cambio</Button>}
            {!['atendido','cancelado'].includes(detail.status) && <Button type="button" variant="ghost" className="tracking-normal text-[#966543]" disabled={saving} onClick={() => setPanel('cancel')}>Cancelar cita</Button>}
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
          <VisitRecommendations options={scheduling.options} loading={scheduling.loading} error={scheduling.error}
            disabled={saving} selectedStart={ecuadorLocalToIso(visit.visitDate, visit.startHm)}
            onSelect={selectRecommendation} onReload={() => void scheduling.reload(visit.visitDate || undefined)} />
          <p className="text-xs text-[#858a7c]">También puedes ajustar la fecha y la hora. El cliente recibirá el mensaje cuando pulses «Enviar propuesta».</p>
          <AgendaVisitFields
            values={visit}
            advisors={advisors}
            onChange={(patch) => { patchVisit(patch); if (patch.visitDate) void scheduling.reload(patch.visitDate) }}
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
              <Send size={14} className="mr-2" />{saving ? 'Guardando…' : 'Enviar propuesta'}
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
              ? 'La solicitud pasará a otro asesor disponible del equipo.'
              : 'Indica el motivo para que coordinación asigne la solicitud a otro asesor.'}
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
          <p className="text-sm text-[#5c6156]">Se cancelará la visita de {detail.lead?.name || 'este cliente'} y sus recordatorios.</p>
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





