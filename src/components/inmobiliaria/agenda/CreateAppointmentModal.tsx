'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import type { AppointmentLocationType, Lead, Project, TeamProfile, Unit } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import { listLeads, listProjectAdvisors, listProjects } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import {
  validateAppointmentForm,
  toastAppointmentValidationError,
} from '@/lib/inmobiliaria/appointmentFormValidation'
import { AppointmentInterestUnitsPicker } from '@/components/inmobiliaria/agenda/AppointmentInterestUnitsPicker'
import { AgendaVisitFields, addOneHour, type AgendaVisitFieldValues } from '@/components/inmobiliaria/agenda/AgendaVisitFields'
import { ecuadorLocalToIso } from '@/lib/inmobiliaria/agendaTime'
import { createConfirmedAppointmentAction } from '@/app/inmobiliaria/agenda/actions'
import { KommoChatLink } from './KommoChatLink'

interface CreateAppointmentModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  tenantId: string
  tenantIds?: string[]
}

const emptyVisit = (): AgendaVisitFieldValues => ({
  visitDate: '',
  startHm: '',
  endHm: '',
  responsibleId: '',
  meetingPlace: '',
  locationType: 'proyecto',
})

export function CreateAppointmentModal({
  isOpen,
  onClose,
  onCreated,
  tenantId,
  tenantIds,
}: CreateAppointmentModalProps) {
  const { supabase, user, profile } = useAuth()
  const scope = useMemo(() => getDataAccessScope(user?.id, profile?.role), [user?.id, profile?.role])
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [advisors, setAdvisors] = useState<TeamProfile[]>([])
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([])
  const [title, setTitle] = useState('')
  const [leadId, setLeadId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [notes, setNotes] = useState('')
  const [visit, setVisit] = useState<AgendaVisitFieldValues>(emptyVisit)

  const selectedProject = projects.find((project) => project.id === projectId)

  useEffect(() => {
    if (!isOpen || !tenantId) return
    Promise.all([
      listProjects(supabase, tenantId, tenantIds),
      listLeads(supabase, { tenantId, tenantIds, scope, pageSize: 200 }),
    ])
      .then(([nextProjects, leadsRes]) => {
        setProjects(nextProjects)
        setLeads(leadsRes.data)
      })
      .catch(console.error)
  }, [isOpen, tenantId, tenantIds, supabase, scope])

  useEffect(() => {
    if (!isOpen || !projectId) {
      setAdvisors([])
      return
    }
    listProjectAdvisors(supabase, projectId)
      .then(setAdvisors)
      .catch(console.error)
  }, [isOpen, projectId, supabase])

  const patchVisit = (patch: Partial<AgendaVisitFieldValues>) => {
    setVisit((prev) => {
      const next = { ...prev, ...patch }
      if (patch.startHm && !prev.endHm) next.endHm = addOneHour(patch.startHm)
      return next
    })
  }

  const reset = () => {
    setTitle('')
    setLeadId('')
    setProjectId('')
    setNotes('')
    setVisit(emptyVisit())
    setSelectedUnits([])
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const startIso = ecuadorLocalToIso(visit.visitDate, visit.startHm)
    const endIso = ecuadorLocalToIso(visit.visitDate, visit.endHm)
    const { missing, endBeforeOrEqualStart } = validateAppointmentForm({
      title,
      lead_id: leadId,
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
        leadId,
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
      onCreated()
      onClose()
      reset()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al crear la cita')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nueva cita" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {leadId && <div className="flex justify-end"><KommoChatLink kommoId={leads.find(lead => lead.id === leadId)?.kommo_id} /></div>}
        <Input
          id="title"
          label="Título *"
          placeholder="Ej: Visita al proyecto"
          value={title}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
        <Select
          id="lead"
          label="Cliente *"
          options={leads.map((lead) => ({ value: lead.id, label: lead.name }))}
          placeholder="Seleccionar cliente"
          value={leadId}
          required
          onChange={(e) => setLeadId(e.target.value)}
        />
        <Select
          id="project"
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
        <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
          <AppointmentInterestUnitsPicker
            tenantId={selectedProject?.tenant_id ?? tenantId}
            projectId={projectId}
            selectedUnits={selectedUnits}
            onChange={setSelectedUnits}
          />
        </div>
        <Textarea
          id="notes"
          label="Observaciones"
          placeholder="Opcional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            Cancelar
          </Button>
          <Button type="submit" disabled={loading} className="w-full sm:w-auto">
            {loading ? 'Creando...' : 'Crear cita'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
