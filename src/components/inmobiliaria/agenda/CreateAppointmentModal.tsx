'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import type { Project, Unit, Lead } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { createAppointment, listUnits, listLeads, listProjects } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import { X } from 'lucide-react'

const locationOptions = [
  { value: 'proyecto', label: 'Proyecto' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'mixto', label: 'Mixto' },
]

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
  const [units, setUnits] = useState<Unit[]>([])
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([])
  const [form, setForm] = useState({
    title: '', lead_id: '', project_id: '', location_type: 'proyecto', start_time: '', end_time: '', notes: '',
  })

  useEffect(() => {
    if (isOpen && tenantId) {
      Promise.all([
        listProjects(supabase, tenantId),
        listLeads(supabase, { tenantId }),
        listUnits(supabase, { tenantId }),
      ]).then(([p, lRes, uRes]) => { setProjects(p); setLeads(lRes.data); setUnits(uRes.data) }).catch(console.error)
    }
  }, [isOpen, tenantId, supabase])

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))
  const toggleUnit = (id: string) => setSelectedUnitIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.start_time) { toast.error('La fecha/hora de inicio es obligatoria'); return }
    setLoading(true)
    try {
      await createAppointment(supabase, {
        tenant_id: tenantId,
        title: form.title || null,
        lead_id: form.lead_id || null,
        project_id: form.project_id || null,
        location_type: form.location_type as 'proyecto',
        start_time: new Date(form.start_time).toISOString(),
        end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
        responsible_id: user?.id ?? null,
        notes: form.notes || null,
      }, selectedUnitIds.length ? selectedUnitIds : undefined)
      toast.success('Cita creada exitosamente')
      onCreated()
      onClose()
      setForm({ title: '', lead_id: '', project_id: '', location_type: 'proyecto', start_time: '', end_time: '', notes: '' })
      setSelectedUnitIds([])
    } catch {
      toast.error('Error al crear la cita')
    } finally {
      setLoading(false)
    }
  }

  const filteredUnits = form.project_id ? units.filter((u) => u.project_id === form.project_id) : units

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nueva Cita" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input id="title" label="Título" placeholder="Ej: Visita proyecto con cliente" value={form.title} onChange={(e) => update('title', e.target.value)} />
        <div className="grid grid-cols-2 gap-4">
          <Select id="lead" label="Lead (opcional)" options={leads.map((l) => ({ value: l.id, label: l.name }))} placeholder="Seleccionar lead" value={form.lead_id} onChange={(e) => update('lead_id', e.target.value)} />
          <Select id="location" label="Tipo ubicación" options={locationOptions} value={form.location_type} onChange={(e) => update('location_type', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Select id="project" label="Proyecto" options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="Seleccionar" value={form.project_id} onChange={(e) => update('project_id', e.target.value)} />
          <Input id="start" label="Inicio *" type="datetime-local" value={form.start_time} onChange={(e) => update('start_time', e.target.value)} />
          <Input id="end" label="Fin" type="datetime-local" value={form.end_time} onChange={(e) => update('end_time', e.target.value)} />
        </div>
        <Textarea id="notes" label="Notas" placeholder="Observaciones de la cita..." value={form.notes} onChange={(e) => update('notes', e.target.value)} />

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">Unidades a mostrar</label>
          {selectedUnitIds.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedUnitIds.map((id) => {
                const u = units.find((x) => x.id === id)
                return (<span key={id} className="inline-flex items-center gap-1 rounded-lg bg-[#BDA27E]/15 px-2.5 py-1 text-xs font-medium text-[#2B1A18]">{u?.unit_number}<button type="button" onClick={() => toggleUnit(id)} className="hover:text-red-600 cursor-pointer"><X size={12} /></button></span>)
              })}
            </div>
          )}
          <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
            {filteredUnits.map((u) => (
              <label key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                <input type="checkbox" checked={selectedUnitIds.includes(u.id)} onChange={() => toggleUnit(u.id)} className="rounded border-gray-300 h-4 w-4" />
                <span className="font-medium">{u.unit_number}</span>
                <span className="text-gray-500">{u.category}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Creando...' : 'Crear Cita'}</Button>
        </div>
      </form>
    </Modal>
  )
}
