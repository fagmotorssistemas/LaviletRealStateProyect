'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import type { Project, Unit, Lead } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { createAppointment, listLeads, listProjects } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import {
  validateAppointmentForm,
  toastAppointmentValidationError,
} from '@/lib/inmobiliaria/appointmentFormValidation'
import { AppointmentInterestUnitsPicker } from '@/components/inmobiliaria/agenda/AppointmentInterestUnitsPicker'

interface CreateAppointmentModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  tenantId: string
}

export function CreateAppointmentModal({ isOpen, onClose, onCreated, tenantId }: CreateAppointmentModalProps) {
  const { supabase, user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([])
  const [form, setForm] = useState({
    title: '',
    lead_id: '',
    project_id: '',
    start_time: '',
    end_time: '',
    notes: '',
  })

  useEffect(() => {
    if (isOpen && tenantId) {
      Promise.all([listProjects(supabase, tenantId), listLeads(supabase, { tenantId })])
        .then(([p, lRes]) => {
          setProjects(p)
          setLeads(lRes.data)
        })
        .catch(console.error)
    }
  }, [isOpen, tenantId, supabase])

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { missing, endBeforeOrEqualStart } = validateAppointmentForm({
      title: form.title,
      lead_id: form.lead_id,
      project_id: form.project_id,
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
          lead_id: form.lead_id,
          project_id: form.project_id,
          start_time: new Date(form.start_time).toISOString(),
          end_time: new Date(form.end_time).toISOString(),
          responsible_id: user?.id ?? null,
          notes: form.notes.trim(),
        },
        selectedUnits.map((u) => u.id),
      )
      toast.success('Cita creada exitosamente')
      onCreated()
      onClose()
      setForm({
        title: '',
        lead_id: '',
        project_id: '',
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
    <Modal isOpen={isOpen} onClose={onClose} title="Nueva Cita" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="title"
          label="Título *"
          placeholder="Ej: Visita proyecto con cliente"
          value={form.title}
          required
          onChange={(e) => update('title', e.target.value)}
        />

        <Select
          id="lead"
          label="Lead *"
          options={leads.map((l) => ({ value: l.id, label: l.name }))}
          placeholder="Seleccionar lead"
          value={form.lead_id}
          required
          onChange={(e) => update('lead_id', e.target.value)}
        />

        <Select
          id="project"
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
            id="start"
            label="Inicio *"
            type="datetime-local"
            value={form.start_time}
            required
            onChange={(e) => update('start_time', e.target.value)}
          />
          <Input
            id="end"
            label="Fin *"
            type="datetime-local"
            value={form.end_time}
            required
            onChange={(e) => update('end_time', e.target.value)}
          />
        </div>

        <Textarea
          id="notes"
          label="Notas *"
          placeholder="Observaciones de la cita..."
          value={form.notes}
          required
          onChange={(e) => update('notes', e.target.value)}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Creando...' : 'Crear Cita'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
