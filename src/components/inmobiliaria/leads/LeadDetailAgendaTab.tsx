'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import type { AppointmentLocationType, Lead, Project, TeamProfile, Unit } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { listProjectAdvisors } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import {
  validateAppointmentForm,
  toastAppointmentValidationError,
} from '@/lib/inmobiliaria/appointmentFormValidation'
import { AppointmentInterestUnitsPicker } from '@/components/inmobiliaria/agenda/AppointmentInterestUnitsPicker'
import { AgendaVisitFields, addOneHour, type AgendaVisitFieldValues } from '@/components/inmobiliaria/agenda/AgendaVisitFields'
import { ecuadorLocalToIso } from '@/lib/inmobiliaria/agendaTime'
import { createConfirmedAppointmentAction } from '@/app/inmobiliaria/agenda/actions'

interface LeadDetailAgendaTabProps {
  lead: Lead
  tenantId: string
  projects: Project[]
}

const emptyVisit = (): AgendaVisitFieldValues => ({
  visitDate: '',
  startHm: '',
  endHm: '',
  responsibleId: '',
  meetingPlace: '',
  locationType: 'proyecto',
})

export function LeadDetailAgendaTab({ lead, tenantId, projects }: LeadDetailAgendaTabProps) {
  const { supabase } = useAuth()
  const [loading, setLoading] = useState(false)
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([])
  const [advisors, setAdvisors] = useState<TeamProfile[]>([])
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [notes, setNotes] = useState('')
  const [visit, setVisit] = useState<AgendaVisitFieldValues>(emptyVisit)
  const selectedProject = projects.find((project) => project.id === projectId)

  useEffect(() => {
    setTitle('')
    setProjectId('')
    setNotes('')
    setVisit(emptyVisit())
    setSelectedUnits([])
  }, [lead.id])

  useEffect(() => {
    if (!projectId) {
      setAdvisors([])
      return
    }
    listProjectAdvisors(supabase, projectId)
      .then(setAdvisors)
      .catch(console.error)
  }, [projectId, supabase])

  const patchVisit = (patch: Partial<AgendaVisitFieldValues>) => {
    setVisit((prev) => {
      const next = { ...prev, ...patch }
      if (patch.startHm && !prev.endHm) next.endHm = addOneHour(patch.startHm)
      return next
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const startIso = ecuadorLocalToIso(visit.visitDate, visit.startHm)
    const endIso = ecuadorLocalToIso(visit.visitDate, visit.endHm)
    const { missing, endBeforeOrEqualStart } = validateAppointmentForm({
      title,
      lead_id: lead.id,
      project_id: projectId,
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

    setLoading(true)
    try {
      await createConfirmedAppointmentAction({
        tenantId: selectedProject?.tenant_id ?? tenantId,
        leadId: lead.id,
        projectId,
        title: title.trim(),
        startTime: startIso,
        endTime: endIso,
        responsibleId: visit.responsibleId,
        meetingPlace: visit.meetingPlace.trim(),
        locationType: visit.locationType as AppointmentLocationType,
        notes: notes.trim(),
        unitIds: selectedUnits.map((unit) => unit.id),
      })
      toast.success('Cita creada')
      setTitle('')
      setProjectId('')
      setNotes('')
      setVisit(emptyVisit())
      setSelectedUnits([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al crear la cita')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
      <p className="text-xs text-slate-500">
        Agenda una cita para <span className="font-semibold text-slate-700">{lead.name}</span>. Elige el asesor que
        atenderá; no se asigna automáticamente a quien crea el registro.
      </p>

      <Input
        id="lead-agenda-title"
        label="Título *"
        placeholder="Ej: Visita al proyecto"
        value={title}
        required
        onChange={(e) => setTitle(e.target.value)}
      />

      <Select
        id="lead-agenda-project"
        label="Proyecto *"
        options={projects.map((project) => ({ value: project.id, label: project.name }))}
        placeholder="Seleccionar proyecto"
        value={projectId}
        required
        onChange={(e) => {
          setProjectId(e.target.value)
          setSelectedUnits([])
          setVisit((prev) => ({ ...prev, responsibleId: '', meetingPlace: '' }))
        }}
      />

      <AgendaVisitFields values={visit} advisors={advisors} onChange={patchVisit} disabled={loading} />

      <div className="border border-[#2B1A18]/12 bg-[#fcfbf9] p-4">
        <AppointmentInterestUnitsPicker
          tenantId={selectedProject?.tenant_id ?? tenantId}
          projectId={projectId}
          selectedUnits={selectedUnits}
          onChange={setSelectedUnits}
        />
      </div>

      <Textarea
        id="lead-agenda-notes"
        label="Observaciones"
        placeholder="Opcional"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={loading}>
          {loading ? 'Creando...' : 'Crear cita'}
        </Button>
      </div>
    </form>
  )
}
