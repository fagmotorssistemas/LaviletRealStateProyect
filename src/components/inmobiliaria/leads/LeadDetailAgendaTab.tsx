'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import type { Lead, LocationType, Project, Unit } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { createAppointment } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import {
  validateAppointmentForm,
  toastAppointmentValidationError,
} from '@/lib/inmobiliaria/appointmentFormValidation'
import { AppointmentInterestUnitsPicker } from '@/components/inmobiliaria/agenda/AppointmentInterestUnitsPicker'

const locationOptions = [
  { value: 'proyecto', label: 'Proyecto' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'mixto', label: 'Mixto' },
]

interface LeadDetailAgendaTabProps {
  lead: Lead
  tenantId: string
  projects: Project[]
}

export function LeadDetailAgendaTab({ lead, tenantId, projects }: LeadDetailAgendaTabProps) {
  const { supabase, user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([])
  const [form, setForm] = useState({
    title: '',
    project_id: '',
    location_type: 'proyecto' as LocationType,
    start_time: '',
    end_time: '',
    notes: '',
  })

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  useEffect(() => {
    setForm({
      title: '',
      project_id: '',
      location_type: 'proyecto',
      start_time: '',
      end_time: '',
      notes: '',
    })
    setSelectedUnits([])
  }, [lead.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { missing, endBeforeOrEqualStart } = validateAppointmentForm({
      title: form.title,
      lead_id: lead.id,
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

    setLoading(true)
    try {
      await createAppointment(
        supabase,
        {
          tenant_id: tenantId,
          title: form.title.trim(),
          lead_id: lead.id,
          project_id: form.project_id,
          location_type: form.location_type,
          start_time: new Date(form.start_time).toISOString(),
          end_time: new Date(form.end_time).toISOString(),
          responsible_id: user?.id ?? null,
          notes: form.notes.trim(),
        },
        selectedUnits.map((u) => u.id),
      )
      toast.success('Cita creada exitosamente')
      setForm({
        title: '',
        project_id: '',
        location_type: 'proyecto',
        start_time: '',
        end_time: '',
        notes: '',
      })
      setSelectedUnits([])
    } catch {
      toast.error('Error al crear la cita')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
      <p className="text-xs text-slate-500">
        Agenda una cita para <span className="font-semibold text-slate-700">{lead.name}</span>. Los datos del lead ya están vinculados.
      </p>

      <Input
        id="lead-agenda-title"
        label="Título *"
        placeholder="Ej: Visita proyecto con cliente"
        value={form.title}
        required
        onChange={(e) => update('title', e.target.value)}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          id="lead-agenda-location"
          label="Tipo de ubicación *"
          options={locationOptions}
          value={form.location_type}
          required
          onChange={(e) => update('location_type', e.target.value)}
        />
        <Select
          id="lead-agenda-project"
          label="Proyecto *"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Seleccionar proyecto"
          value={form.project_id}
          required
          onChange={(e) => {
            update('project_id', e.target.value)
            setSelectedUnits([])
          }}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
        <AppointmentInterestUnitsPicker
          tenantId={tenantId}
          projectId={form.project_id}
          selectedUnits={selectedUnits}
          onChange={setSelectedUnits}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          id="lead-agenda-start"
          label="Inicio *"
          type="datetime-local"
          value={form.start_time}
          required
          onChange={(e) => update('start_time', e.target.value)}
        />
        <Input
          id="lead-agenda-end"
          label="Fin *"
          type="datetime-local"
          value={form.end_time}
          required
          onChange={(e) => update('end_time', e.target.value)}
        />
      </div>

      <Textarea
        id="lead-agenda-notes"
        label="Notas *"
        placeholder="Observaciones de la cita..."
        value={form.notes}
        required
        onChange={(e) => update('notes', e.target.value)}
      />

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={loading}>
          {loading ? 'Creando...' : 'Crear cita'}
        </Button>
      </div>
    </form>
  )
}
