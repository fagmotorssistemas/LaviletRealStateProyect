'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { APPOINTMENT_STATUS_OPTIONS } from '@/types/inmobiliaria'
import type {
  Appointment,
  AppointmentStatus,
  AppointmentWithUnits,
  Lead,
  LocationType,
  Project,
  Unit,
} from '@/types/inmobiliaria'
import { formatDateTime } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { getAppointment, listLeads, listProjects, updateAppointment } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import { Building2, Clock, FileText, MapPin, Pencil, User } from 'lucide-react'
import { AppointmentInterestUnitsPicker } from '@/components/inmobiliaria/agenda/AppointmentInterestUnitsPicker'
import {
  validateAppointmentForm,
  toastAppointmentValidationError,
} from '@/lib/inmobiliaria/appointmentFormValidation'

const locationOptions = [
  { value: 'proyecto', label: 'Proyecto' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'mixto', label: 'Mixto' },
]

function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  const hh = `${d.getHours()}`.padStart(2, '0')
  const mm = `${d.getMinutes()}`.padStart(2, '0')
  return `${y}-${m}-${day}T${hh}:${mm}`
}

const defaultForm = {
  title: '',
  lead_id: '',
  project_id: '',
  location_type: 'proyecto' as LocationType,
  start_time: '',
  end_time: '',
  notes: '',
  status: 'pendiente' as AppointmentStatus,
}

function appointmentToForm(d: AppointmentWithUnits) {
  return {
    title: d.title ?? '',
    lead_id: d.lead_id ?? '',
    project_id: d.project_id ?? '',
    location_type: d.location_type,
    start_time: toDatetimeLocalValue(d.start_time),
    end_time: d.end_time ? toDatetimeLocalValue(d.end_time) : '',
    notes: d.notes ?? '',
    status: d.status,
  }
}

interface AppointmentDetailModalProps {
  appointment: Appointment | null
  isOpen: boolean
  onClose: () => void
  onStatusChange: (id: string, status: AppointmentStatus) => void
  tenantId: string
  onAppointmentUpdated?: () => void
}

export function AppointmentDetailModal({
  appointment,
  isOpen,
  onClose,
  onStatusChange,
  tenantId,
  onAppointmentUpdated,
}: AppointmentDetailModalProps) {
  const { supabase } = useAuth()
  const [newStatus, setNewStatus] = useState('')
  const [detail, setDetail] = useState<AppointmentWithUnits | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [form, setForm] = useState(defaultForm)
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([])

  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false)
      setDetail(null)
      setLoadError(false)
      return
    }
    if (!appointment?.id) return

    let cancelled = false
    setLoadingDetail(true)
    setLoadError(false)
    getAppointment(supabase, appointment.id)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true)
          toast.error('No se pudo cargar el detalle de la cita')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, appointment?.id, supabase])

  useEffect(() => {
    if (!isOpen || !tenantId) return
    Promise.all([listProjects(supabase, tenantId), listLeads(supabase, { tenantId })])
      .then(([p, lRes]) => {
        setProjects(p)
        setLeads(lRes.data)
      })
      .catch(console.error)
  }, [isOpen, tenantId, supabase])

  const updateField = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }))

  const handleSaveStatus = () => {
    if (!detail || !newStatus || newStatus === detail.status) return
    onStatusChange(detail.id, newStatus as AppointmentStatus)
    setNewStatus('')
  }

  const startEdit = () => {
    if (!detail) return
    setForm(appointmentToForm(detail))
    setSelectedUnits([...detail.units])
    setIsEditing(true)
  }

  const cancelEdit = () => {
    if (!detail) return
    setForm(appointmentToForm(detail))
    setSelectedUnits([...detail.units])
    setIsEditing(false)
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!detail) return
    const { missing, endBeforeOrEqualStart } = validateAppointmentForm({
      title: form.title,
      lead_id: form.lead_id,
      project_id: form.project_id,
      location_type: form.location_type,
      start_time: form.start_time,
      end_time: form.end_time,
      notes: form.notes,
      selectedUnitCount: selectedUnits.length,
    })
    const errMsg = toastAppointmentValidationError(missing, endBeforeOrEqualStart)
    if (errMsg) {
      toast.error(errMsg)
      return
    }
    setSaving(true)
    try {
      await updateAppointment(
        supabase,
        detail.id,
        {
          title: form.title.trim(),
          lead_id: form.lead_id,
          project_id: form.project_id,
          location_type: form.location_type,
          start_time: new Date(form.start_time).toISOString(),
          end_time: new Date(form.end_time).toISOString(),
          notes: form.notes.trim(),
          status: form.status,
        },
        selectedUnits.map((u) => u.id),
      )
      const fresh = await getAppointment(supabase, detail.id)
      setDetail(fresh)
      onAppointmentUpdated?.()
      toast.success('Cita actualizada')
      setIsEditing(false)
    } catch {
      toast.error('Error al guardar los cambios')
    } finally {
      setSaving(false)
    }
  }

  const retryLoad = () => {
    if (!appointment?.id) return
    setLoadingDetail(true)
    setLoadError(false)
    getAppointment(supabase, appointment.id)
      .then(setDetail)
      .catch(() => {
        setLoadError(true)
        toast.error('No se pudo cargar el detalle de la cita')
      })
      .finally(() => setLoadingDetail(false))
  }

  if (!appointment) return null

  const titleLabel = detail?.title || appointment.title || 'Cita'
  const modalTitle = isEditing ? `Editar cita — ${titleLabel}` : `Cita — ${titleLabel}`

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size="lg"
      headerActions={
        detail && !isEditing && !loadingDetail && !loadError ? (
          <button
            type="button"
            onClick={startEdit}
            title="Editar"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-[#2B1A18] transition-colors cursor-pointer"
          >
            <Pencil size={18} aria-hidden />
            <span className="sr-only">Editar</span>
          </button>
        ) : null
      }
    >
      {loadingDetail && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {!loadingDetail && loadError && (
        <div className="text-center py-10 space-y-4">
          <p className="text-sm text-gray-600">No se pudo cargar la información completa.</p>
          <Button type="button" variant="outline" onClick={retryLoad}>
            Reintentar
          </Button>
        </div>
      )}

      {!loadingDetail && !loadError && detail && !isEditing && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={detail.status} type="appointment" />
            <span className="text-sm text-gray-500 capitalize">{detail.location_type}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-2 text-sm text-gray-600">
              <Clock size={14} className="text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Inicio</p>
                <p className="font-medium text-gray-900">{formatDateTime(detail.start_time)}</p>
              </div>
            </div>
            <div className="flex items-start gap-2 text-sm text-gray-600">
              <Clock size={14} className="text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Fin</p>
                <p className="font-medium text-gray-900">{detail.end_time ? formatDateTime(detail.end_time) : '—'}</p>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 text-sm">
            <User size={14} className="text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Lead</p>
              {detail.lead ? (
                <p className="text-gray-800">
                  <strong>{detail.lead.name}</strong>
                  {detail.lead.phone && <span className="text-gray-500"> • {detail.lead.phone}</span>}
                </p>
              ) : (
                <p className="text-gray-500">—</p>
              )}
            </div>
          </div>

          {detail.project && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin size={14} className="text-gray-400" />
              <span>{detail.project.name}</span>
            </div>
          )}

          {detail.responsible?.full_name && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <User size={14} className="text-gray-400" />
              <span>Responsable: {detail.responsible.full_name}</span>
            </div>
          )}

          <div className="rounded-lg bg-gray-50 p-3">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <FileText size={12} /> Notas
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{detail.notes?.trim() ? detail.notes : 'Sin notas.'}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Unidad(es) de interés</h4>
            {detail.units.length > 0 ? (
              <div className="space-y-2">
                {detail.units.map((unit) => (
                  <div
                    key={unit.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
                    <span className="font-medium text-gray-900">{unit.unit_number}</span>
                    <span className="text-gray-500">{unit.category}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Ninguna unidad vinculada.</p>
            )}
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Cambiar estado</p>
            <div className="flex gap-3">
              <Select
                options={APPOINTMENT_STATUS_OPTIONS}
                value={newStatus || detail.status}
                onChange={(e) => setNewStatus(e.target.value)}
                className="flex-1"
              />
              <Button onClick={handleSaveStatus} disabled={!newStatus || newStatus === detail.status}>
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}

      {!loadingDetail && !loadError && detail && isEditing && (
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <Input
            id="edit-title"
            label="Título *"
            placeholder="Ej: Visita proyecto con cliente"
            value={form.title}
            required
            onChange={(e) => updateField('title', e.target.value)}
          />
          <div className="grid grid-cols-2 gap-4">
            <Select
              id="edit-lead"
              label="Lead *"
              options={leads.map((l) => ({ value: l.id, label: l.name }))}
              placeholder="Seleccionar lead"
              value={form.lead_id}
              required
              onChange={(e) => updateField('lead_id', e.target.value)}
            />
            <Select
              id="edit-location"
              label="Tipo de ubicación *"
              options={locationOptions}
              value={form.location_type}
              required
              onChange={(e) => updateField('location_type', e.target.value)}
            />
          </div>
          <Select
            id="edit-project"
            label="Proyecto *"
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Seleccionar proyecto"
            value={form.project_id}
            required
            onChange={(e) => {
              updateField('project_id', e.target.value)
              setSelectedUnits([])
            }}
          />

          <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
            <AppointmentInterestUnitsPicker
              tenantId={tenantId}
              projectId={form.project_id}
              selectedUnits={selectedUnits}
              onChange={setSelectedUnits}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              id="edit-start"
              label="Inicio *"
              type="datetime-local"
              value={form.start_time}
              required
              onChange={(e) => updateField('start_time', e.target.value)}
            />
            <Input
              id="edit-end"
              label="Fin *"
              type="datetime-local"
              value={form.end_time}
              required
              onChange={(e) => updateField('end_time', e.target.value)}
            />
          </div>
          <Select
            id="edit-status"
            label="Estado *"
            options={APPOINTMENT_STATUS_OPTIONS}
            value={form.status}
            required
            onChange={(e) => updateField('status', e.target.value)}
          />
          <Textarea
            id="edit-notes"
            label="Notas *"
            placeholder="Observaciones de la cita..."
            value={form.notes}
            required
            onChange={(e) => updateField('notes', e.target.value)}
          />

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
