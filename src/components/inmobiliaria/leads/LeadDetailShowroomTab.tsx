'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import type { Lead, Project, Unit } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { createShowroomVisit } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import { Building2, Plus, Trash2 } from 'lucide-react'
import type { ShowroomVisitSource } from '@/types/inmobiliaria'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { UnitNumberSearchInput } from '@/components/inmobiliaria/shared/UnitNumberSearchInput'

const sourceOptions = [
  { value: 'organica', label: 'Showroom' },
  { value: 'redes_sociales', label: 'Redes sociales' },
  { value: 'referido', label: 'Referido' },
  { value: 'agendada', label: 'Cita agendada' },
  { value: 'otro', label: 'Otro' },
]

interface LeadDetailShowroomTabProps {
  lead: Lead
  tenantId: string
  projects: Project[]
}

export function LeadDetailShowroomTab({ lead, tenantId, projects }: LeadDetailShowroomTabProps) {
  const { supabase, user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [unitSearchOpen, setUnitSearchOpen] = useState(false)
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([])

  const getTodayLocalISODate = () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = `${now.getMonth() + 1}`.padStart(2, '0')
    const d = `${now.getDate()}`.padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const [form, setForm] = useState({
    source: 'organica' as ShowroomVisitSource,
    project_id: '',
    client_name: '',
    phone: '',
    notes: '',
    visit_date: '',
    visit_start_time: '',
    visit_end_time: '',
  })

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  useEffect(() => {
    setForm({
      source: 'organica',
      project_id: '',
      client_name: lead.name || '',
      phone: lead.phone || '',
      notes: '',
      visit_date: '',
      visit_start_time: '',
      visit_end_time: '',
    })
    setSelectedUnits([])
    setUnitSearchOpen(false)
  }, [lead.id, lead.name, lead.phone])

  const handleAddUnit = (unit: Unit) => {
    setSelectedUnits((prev) => (prev.some((u) => u.id === unit.id) ? prev : [...prev, unit]))
    setUnitSearchOpen(false)
  }

  const handleRemoveUnit = (unitId: string) => {
    setSelectedUnits((prev) => prev.filter((u) => u.id !== unitId))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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

    setLoading(true)
    try {
      await createShowroomVisit(
        supabase,
        {
          tenant_id: tenantId,
          salesperson_id: user?.id ?? null,
          lead_id: lead.id,
          source: form.source,
          project_id: form.project_id || null,
          client_name: form.client_name,
          phone: form.phone || null,
          visit_start: visitStart,
          visit_end: visitEnd,
          notes: form.notes || null,
        },
        selectedUnits.length ? selectedUnits.map((u) => u.id) : undefined,
      )
      toast.success('Visita de showroom registrada')
      setForm({
        source: 'organica',
        project_id: '',
        client_name: lead.name || '',
        phone: lead.phone || '',
        notes: '',
        visit_date: '',
        visit_start_time: '',
        visit_end_time: '',
      })
      setSelectedUnits([])
      setUnitSearchOpen(false)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string'
              ? error.message
              : 'Error al registrar visita')
      toast.error(message)
      console.error('Error registrando visita:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
      <p className="text-xs text-slate-500">
        Registra una visita de showroom vinculada a este lead. El contacto se guardará asociado al prospecto.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          id="lead-showroom-client"
          label="Nombre del cliente *"
          placeholder="Nombre completo"
          value={form.client_name}
          onChange={(e) => update('client_name', e.target.value)}
        />
        <Input
          id="lead-showroom-phone"
          label="Teléfono *"
          placeholder="0991234567"
          value={form.phone}
          required
          onChange={(e) => update('phone', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          id="lead-showroom-source"
          label="Origen de la visita *"
          options={sourceOptions}
          value={form.source}
          required
          onChange={(e) => update('source', e.target.value)}
        />
        <Select
          id="lead-showroom-project"
          label="Proyecto *"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Seleccionar"
          value={form.project_id}
          required
          onChange={(e) => update('project_id', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="col-span-full flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1 min-w-0">
            <Input
              id="lead-showroom-visit_date"
              label="Fecha de visita *"
              type="date"
              value={form.visit_date}
              required
              onChange={(e) => update('visit_date', e.target.value)}
            />
          </div>
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setForm((p) => ({ ...p, visit_date: getTodayLocalISODate() }))}>
            Hoy
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          id="lead-showroom-start"
          label="Hora inicio *"
          type="time"
          value={form.visit_start_time}
          required
          onChange={(e) => update('visit_start_time', e.target.value)}
        />
        <Input
          id="lead-showroom-end"
          label="Hora fin *"
          type="time"
          value={form.visit_end_time}
          required
          onChange={(e) => update('visit_end_time', e.target.value)}
        />
      </div>
      <Textarea
        id="lead-showroom-notes"
        label="Notas *"
        placeholder="Observaciones de la visita..."
        value={form.notes}
        required
        onChange={(e) => update('notes', e.target.value)}
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

        <p className="text-xs text-slate-400 -mt-2 mb-4">
          Selecciona al menos una unidad para continuar.
        </p>

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
                className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 group"
              >
                <div className="p-2 bg-slate-100 rounded-lg">
                  <Building2 className="h-4 w-4 text-slate-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-sm text-slate-800 block truncate">{unit.unit_number}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-400">
                      {unit.project?.name ?? unit.category}
                    </span>
                  </div>
                </div>
                <StatusBadge status={unit.status} type="unit" className="shrink-0" />
                <button
                  type="button"
                  onClick={() => handleRemoveUnit(unit.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer"
                  title="Eliminar unidad"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 italic bg-white p-3 rounded-xl border border-dashed border-slate-200 text-center">
            Sin unidades seleccionadas.
          </p>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={loading}>
          {loading ? 'Registrando...' : 'Registrar visita'}
        </Button>
      </div>
    </form>
  )
}
