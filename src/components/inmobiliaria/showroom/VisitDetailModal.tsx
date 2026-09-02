'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { Project, ShowroomVisit, ShowroomVisitSource, ShowroomVisitWithUnits, Unit } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import { getShowroomVisit, updateShowroomVisit } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import { Building2, Pencil, Phone, User, MapPin, CalendarClock, FileText, Plus, Trash2 } from 'lucide-react'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { UnitNumberSearchInput } from '@/components/inmobiliaria/shared/UnitNumberSearchInput'
import { formatDateTime } from '@/lib/utils'

const sourceOptions = [
  { value: 'organica', label: 'Showroom' },
  { value: 'redes_sociales', label: 'Redes sociales' },
  { value: 'referido', label: 'Referido' },
  { value: 'agendada', label: 'Cita agendada' },
  { value: 'otro', label: 'Otro' },
]

const sourceLabels: Record<string, string> = {
  organica: 'Showroom',
  redes_sociales: 'Redes sociales',
  referido: 'Referido',
  agendada: 'Cita agendada',
  otro: 'Otro',
  oficina: 'Oficina',
  proyecto: 'Proyecto',
  mixto: 'Mixto',
}

function toLocalDateParts(iso: string) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  const hh = `${d.getHours()}`.padStart(2, '0')
  const mm = `${d.getMinutes()}`.padStart(2, '0')
  return { date: `${y}-${m}-${day}`, time: `${hh}:${mm}` }
}

const defaultForm = {
  source: 'organica' as ShowroomVisitSource,
  project_id: '',
  client_name: '',
  phone: '',
  notes: '',
  visit_date: '',
  visit_start_time: '',
  visit_end_time: '',
}

function visitToForm(detail: ShowroomVisitWithUnits) {
  const start = toLocalDateParts(detail.visit_start)
  const end = detail.visit_end ? toLocalDateParts(detail.visit_end) : null
  return {
    source: detail.source,
    project_id: detail.project_id ?? '',
    client_name: detail.client_name ?? '',
    phone: detail.phone ?? '',
    notes: detail.notes ?? '',
    visit_date: start.date,
    visit_start_time: start.time,
    visit_end_time: end ? end.time : '',
  }
}

interface VisitDetailModalProps {
  visit: ShowroomVisit | null
  isOpen: boolean
  onClose: () => void
  projects: Project[]
  tenantId: string
  onVisitUpdated?: (visit: ShowroomVisitWithUnits) => void
  startInEdit?: boolean
}

export function VisitDetailModal({
  visit,
  isOpen,
  onClose,
  projects,
  tenantId,
  onVisitUpdated,
  startInEdit = false,
}: VisitDetailModalProps) {
  const { supabase, user, profile } = useAuth()
  const scope = useMemo(() => getDataAccessScope(user?.id, profile?.role), [user?.id, profile?.role])
  const [detail, setDetail] = useState<ShowroomVisitWithUnits | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(defaultForm)
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([])
  const [unitSearchOpen, setUnitSearchOpen] = useState(false)
  const enteredEditRef = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false)
      setDetail(null)
      setLoadError(false)
      enteredEditRef.current = false
      return
    }
    if (!visit?.id) return

    let cancelled = false
    setLoadingDetail(true)
    setLoadError(false)
    getShowroomVisit(supabase, visit.id, scope)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true)
          toast.error('No se pudo cargar el detalle de la visita')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, visit?.id, supabase, scope])

  useEffect(() => {
    if (!isOpen || !detail || !startInEdit || loadingDetail || enteredEditRef.current) return
    enteredEditRef.current = true
    setForm(visitToForm(detail))
    setSelectedUnits([...detail.units])
    setUnitSearchOpen(false)
    setIsEditing(true)
  }, [isOpen, detail, startInEdit, loadingDetail])

  const updateField = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  const handleAddUnit = (unit: Unit) => {
    setSelectedUnits((prev) => (prev.some((u) => u.id === unit.id) ? prev : [...prev, unit]))
    setUnitSearchOpen(false)
  }

  const handleRemoveUnit = (unitId: string) => {
    setSelectedUnits((prev) => prev.filter((u) => u.id !== unitId))
  }

  const startEdit = () => {
    if (!detail) return
    setForm(visitToForm(detail))
    setSelectedUnits([...detail.units])
    setUnitSearchOpen(false)
    setIsEditing(true)
  }

  const cancelEdit = () => {
    if (!detail) return
    setForm(visitToForm(detail))
    setSelectedUnits([...detail.units])
    setIsEditing(false)
    setUnitSearchOpen(false)
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!detail) return

    const missing: string[] = []
    if (!form.source) missing.push('Origen de la visita')
    if (!form.project_id) missing.push('Proyecto')
    if (!form.client_name.trim()) missing.push('Nombre del cliente')
    if (!form.phone?.trim()) missing.push('Teléfono')
    if (!form.visit_date) missing.push('Fecha de la visita')
    if (!form.visit_start_time) missing.push('Hora de inicio')
    if (!form.visit_end_time) missing.push('Hora fin')
    if (!form.notes?.trim()) missing.push('Notas')
    if (selectedUnits.length === 0) missing.push('Al menos una unidad de interés')

    if (missing.length > 0) {
      toast.error(`Faltan campos obligatorios: ${missing.join(', ')}`)
      return
    }

    const visitStart = new Date(`${form.visit_date}T${form.visit_start_time}`).toISOString()
    const visitEnd = form.visit_end_time
      ? new Date(`${form.visit_date}T${form.visit_end_time}`).toISOString()
      : null

    if (visitEnd && new Date(visitEnd).getTime() < new Date(visitStart).getTime()) {
      toast.error('La hora fin no puede ser menor que la hora inicio')
      return
    }

    setSaving(true)
    try {
      await updateShowroomVisit(
        supabase,
        detail.id,
        {
          source: form.source,
          project_id: form.project_id || null,
          client_name: form.client_name,
          phone: form.phone || null,
          visit_start: visitStart,
          visit_end: visitEnd,
          notes: form.notes || null,
        },
        selectedUnits.map((u) => u.id),
      )
      const fresh = await getShowroomVisit(supabase, detail.id, scope)
      setDetail(fresh)
      onVisitUpdated?.(fresh)
      toast.success('Visita actualizada')
      setIsEditing(false)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Error al guardar los cambios'
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const retryLoad = () => {
    if (!visit?.id) return
    setLoadingDetail(true)
    setLoadError(false)
    getShowroomVisit(supabase, visit.id, scope)
      .then(setDetail)
      .catch(() => {
        setLoadError(true)
        toast.error('No se pudo cargar el detalle de la visita')
      })
      .finally(() => setLoadingDetail(false))
  }

  if (!visit) return null

  const clientLabel = detail?.lead?.name ?? detail?.client_name ?? visit.lead?.name ?? visit.client_name ?? '—'
  const titleBase = isEditing ? `Editar visita — ${clientLabel}` : `Visita — ${clientLabel}`

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={titleBase}
      size="xl"
      headerActions={
        detail && !isEditing && !loadingDetail && !loadError ? (
          <button
            type="button"
            onClick={startEdit}
            title="Editar"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-[#3a3d36] transition-colors cursor-pointer"
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
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {sourceLabels[detail.source] ?? detail.source}
            </span>
            {detail.project?.name && (
              <span className="text-gray-500 flex items-center gap-1">
                <MapPin size={14} className="text-gray-400" />
                {detail.project.name}
              </span>
            )}
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Cliente</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-2.5">
                <User size={15} className="text-gray-800 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-gray-400">Nombre</p>
                  <p className="text-sm font-medium text-gray-900">{clientLabel}</p>
                  {detail.lead?.name && detail.client_name && detail.lead.name !== detail.client_name && (
                    <p className="text-xs text-gray-500 mt-0.5">Registrado como: {detail.client_name}</p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Phone size={15} className="text-gray-800 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-gray-400">Teléfono</p>
                  <p className="text-sm font-medium text-gray-900">{detail.phone ?? '—'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Horario</h4>
            <div className="flex items-start gap-2.5">
              <CalendarClock size={15} className="text-gray-800 mt-0.5 shrink-0" />
              <div className="grid gap-2 sm:grid-cols-2 text-sm w-full">
                <div>
                  <p className="text-xs text-gray-400">Inicio</p>
                  <p className="font-medium text-gray-900">{formatDateTime(detail.visit_start)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Fin</p>
                  <p className="font-medium text-gray-900">{detail.visit_end ? formatDateTime(detail.visit_end) : '—'}</p>
                </div>
              </div>
            </div>
          </div>

          {detail.salesperson?.full_name && (
            <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Asesor</h4>
              <p className="text-sm font-medium text-gray-900">{detail.salesperson.full_name}</p>
            </div>
          )}

          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={15} className="text-gray-800" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Notas</h4>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {detail.notes?.trim() ? detail.notes : 'Sin notas.'}
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Unidades de interés</h4>
            {detail.units.length > 0 ? (
              <div className="space-y-2">
                {detail.units.map((unit) => (
                  <div
                    key={unit.id}
                    className="flex items-center gap-3 border border-[#2B1A18]/12 bg-white p-3"
                  >
                    <div className="p-2 bg-slate-100 rounded-lg">
                      <Building2 className="h-4 w-4 text-slate-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-sm text-slate-800 block truncate">{unit.unit_number}</span>
                      <span className="text-xs text-slate-400">{unit.project?.name ?? unit.category}</span>
                    </div>
                    <StatusBadge status={unit.status} type="unit" className="shrink-0" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Sin unidades vinculadas.</p>
            )}
          </div>
        </div>
      )}

      {!loadingDetail && !loadError && detail && isEditing && (
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              id="edit-client"
              label="Nombre del cliente *"
              placeholder="Nombre completo"
              value={form.client_name}
              onChange={(e) => updateField('client_name', e.target.value)}
            />
            <Input
              id="edit-phone"
              label="Teléfono *"
              placeholder="0991234567"
              value={form.phone}
              required
              onChange={(e) => updateField('phone', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              id="edit-source"
              label="Origen de la visita *"
              options={sourceOptions}
              value={form.source}
              required
              onChange={(e) => updateField('source', e.target.value)}
            />
            <Select
              id="edit-project"
              label="Proyecto *"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Seleccionar"
              value={form.project_id}
              required
              onChange={(e) => updateField('project_id', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              id="edit-visit_date"
              label="Fecha de visita *"
              type="date"
              value={form.visit_date}
              required
              onChange={(e) => updateField('visit_date', e.target.value)}
            />
            <div />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              id="edit-visit_start_time"
              label="Hora inicio *"
              type="time"
              value={form.visit_start_time}
              required
              onChange={(e) => updateField('visit_start_time', e.target.value)}
            />
            <Input
              id="edit-visit_end_time"
              label="Hora fin *"
              type="time"
              value={form.visit_end_time}
              required
              onChange={(e) => updateField('visit_end_time', e.target.value)}
            />
          </div>
          <Textarea
            id="edit-notes"
            label="Notas *"
            placeholder="Observaciones de la visita..."
            value={form.notes}
            required
            onChange={(e) => updateField('notes', e.target.value)}
          />

          <div>
            <div className="flex justify-between items-center mb-3">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Unidades de interés *
              </label>
              <button
                type="button"
                onClick={() => setUnitSearchOpen(!unitSearchOpen)}
                className="flex items-center gap-1 text-[10px] font-semibold text-[#8b917c] hover:text-[#a88d6a] cursor-pointer transition-colors uppercase tracking-wider"
              >
                <Plus size={12} /> Agregar
              </button>
            </div>
            <p className="text-xs text-slate-400 -mt-3 mb-4">Selecciona al menos una unidad.</p>

            {unitSearchOpen && (
              <UnitNumberSearchInput
                tenantId={tenantId}
                projectId={form.project_id || undefined}
                excludeIds={selectedUnits.map((u) => u.id)}
                onSelect={handleAddUnit}
              />
            )}

            {selectedUnits.length > 0 ? (
              <div className="space-y-3">
                {selectedUnits.map((unit) => (
                  <div
                    key={unit.id}
                    className="flex items-center gap-3 border border-[#2B1A18]/12 bg-white p-3 group"
                  >
                    <div className="p-2 bg-slate-100 rounded-lg">
                      <Building2 className="h-4 w-4 text-slate-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-sm text-slate-800 block truncate">{unit.unit_number}</span>
                      <span className="text-xs text-slate-400">{unit.project?.name ?? unit.category}</span>
                    </div>
                    <StatusBadge status={unit.status} type="unit" className="shrink-0" />
                    <button
                      type="button"
                      onClick={() => handleRemoveUnit(unit.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer"
                      title="Quitar unidad"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="border border-dashed border-[#2B1A18]/12 bg-white p-3 text-center text-sm italic text-[#8a8d87]">
                Sin unidades seleccionadas.
              </p>
            )}
          </div>

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
