'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import type { Project, Unit } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { createShowroomVisit, listUnits } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import { X } from 'lucide-react'

const sourceOptions = [
  { value: 'oficina', label: 'Oficina' },
  { value: 'proyecto', label: 'Proyecto' },
  { value: 'mixto', label: 'Mixto' },
]

interface CreateVisitModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  projects: Project[]
  tenantId: string
}

export function CreateVisitModal({ isOpen, onClose, onCreated, projects, tenantId }: CreateVisitModalProps) {
  const { supabase } = useAuth()
  const [loading, setLoading] = useState(false)
  const [units, setUnits] = useState<Unit[]>([])
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([])
  const [form, setForm] = useState({
    source: 'oficina', project_id: '', client_name: '', phone: '', notes: '', visit_start: '',
  })

  useEffect(() => {
    if (isOpen && tenantId) {
      listUnits(supabase, { tenantId }).then((res) => setUnits(res.data)).catch(console.error)
    }
  }, [isOpen, tenantId, supabase])

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))
  const toggleUnit = (id: string) => setSelectedUnitIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.client_name.trim()) { toast.error('El nombre del cliente es obligatorio'); return }
    setLoading(true)
    try {
      await createShowroomVisit(supabase, {
        tenant_id: tenantId,
        source: form.source as 'oficina',
        project_id: form.project_id || null,
        client_name: form.client_name,
        phone: form.phone || null,
        visit_start: form.visit_start || new Date().toISOString(),
        notes: form.notes || null,
      }, selectedUnitIds.length ? selectedUnitIds : undefined)
      toast.success('Visita registrada')
      onCreated()
      onClose()
      setForm({ source: 'oficina', project_id: '', client_name: '', phone: '', notes: '', visit_start: '' })
      setSelectedUnitIds([])
    } catch {
      toast.error('Error al registrar visita')
    } finally {
      setLoading(false)
    }
  }

  const filteredUnits = form.project_id ? units.filter((u) => u.project_id === form.project_id) : units

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar Visita" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input id="client" label="Nombre del cliente *" placeholder="Nombre completo" value={form.client_name} onChange={(e) => update('client_name', e.target.value)} />
          <Input id="phone" label="Teléfono" placeholder="0991234567" value={form.phone} onChange={(e) => update('phone', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Select id="source" label="Fuente" options={sourceOptions} value={form.source} onChange={(e) => update('source', e.target.value)} />
          <Select id="project" label="Proyecto" options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="Seleccionar" value={form.project_id} onChange={(e) => update('project_id', e.target.value)} />
          <Input id="visit_start" label="Inicio de visita" type="datetime-local" value={form.visit_start} onChange={(e) => update('visit_start', e.target.value)} />
        </div>
        <Textarea id="notes" label="Notas" placeholder="Observaciones de la visita..." value={form.notes} onChange={(e) => update('notes', e.target.value)} />

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">Unidades mostradas</label>
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
          <Button type="submit" disabled={loading}>{loading ? 'Registrando...' : 'Registrar Visita'}</Button>
        </div>
      </form>
    </Modal>
  )
}
