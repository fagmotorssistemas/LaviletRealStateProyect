'use client'

import { useState, useEffect, useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { LEAD_STATUS_OPTIONS } from '@/types/inmobiliaria'
import type { Unit } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import { createLead, listUnits } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import { X } from 'lucide-react'

interface CreateLeadModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  tenantId: string
}

const sourceOptions = [
  { value: 'Referido', label: 'Referido' },
  { value: 'Portal web', label: 'Portal web' },
  { value: 'Instagram', label: 'Instagram' },
  { value: 'Facebook Ads', label: 'Facebook Ads' },
  { value: 'Google Ads', label: 'Google Ads' },
  { value: 'WhatsApp', label: 'WhatsApp' },
  { value: 'Showroom', label: 'Showroom' },
  { value: 'Feria inmobiliaria', label: 'Feria inmobiliaria' },
  { value: 'Evento corporativo', label: 'Evento corporativo' },
  { value: 'Otro', label: 'Otro' },
]

export function CreateLeadModal({ isOpen, onClose, onCreated, tenantId }: CreateLeadModalProps) {
  const { supabase, user, profile } = useAuth()
  const scope = useMemo(() => getDataAccessScope(user?.id, profile?.role), [user?.id, profile?.role])
  const [loading, setLoading] = useState(false)
  const [availableUnits, setAvailableUnits] = useState<Unit[]>([])
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([])
  const [form, setForm] = useState({
    name: '', phone: '', status: 'nuevo', budget: '', financing: false, source: '', resume: '',
  })

  useEffect(() => {
    if (isOpen && tenantId) {
      listUnits(supabase, { tenantId }).then((res) => setAvailableUnits(res.data)).catch(console.error)
    }
  }, [isOpen, tenantId, supabase])

  const update = (key: string, value: string | boolean) => setForm((p) => ({ ...p, [key]: value }))

  const toggleUnit = (unitId: string) => {
    setSelectedUnitIds((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('El nombre es obligatorio'); return }
    setLoading(true)
    try {
      await createLead(
        supabase,
        {
          tenant_id: tenantId,
          name: form.name,
          phone: form.phone || null,
          status: form.status as 'nuevo',
          budget: form.budget ? Number(form.budget) : null,
          financing: form.financing,
          source: form.source || null,
          resume: form.resume || null,
          ...(scope && !scope.isAdmin && user?.id ? { assigned_to: user.id } : {}),
        },
        selectedUnitIds.length ? selectedUnitIds : undefined,
      )
      toast.success('Lead creado exitosamente')
      onCreated()
      onClose()
      setForm({ name: '', phone: '', status: 'nuevo', budget: '', financing: false, source: '', resume: '' })
      setSelectedUnitIds([])
    } catch {
      toast.error('Error al crear el lead')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo Lead" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input id="name" label="Nombre *" placeholder="Nombre del prospecto" value={form.name} onChange={(e) => update('name', e.target.value)} />
          <Input id="phone" label="Teléfono" placeholder="0991234567" value={form.phone} onChange={(e) => update('phone', e.target.value)} />
        </div>
        <Select id="source" label="Fuente" options={sourceOptions} placeholder="¿Cómo nos contactó?" value={form.source} onChange={(e) => update('source', e.target.value)} />
        <div className="grid grid-cols-3 gap-4">
          <Input id="budget" label="Presupuesto" type="number" placeholder="120000" value={form.budget} onChange={(e) => update('budget', e.target.value)} />
          <Select id="status" label="Estado" options={LEAD_STATUS_OPTIONS} value={form.status} onChange={(e) => update('status', e.target.value)} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Financiamiento</label>
            <label className="flex items-center gap-2 h-10 cursor-pointer">
              <input type="checkbox" checked={form.financing} onChange={(e) => update('financing', e.target.checked)} className="rounded border-gray-300 h-4 w-4" />
              <span className="text-sm text-gray-600">Requiere crédito</span>
            </label>
          </div>
        </div>
        <Textarea id="resume" label="Resumen / Observaciones" placeholder="Notas sobre el prospecto..." value={form.resume} onChange={(e) => update('resume', e.target.value)} />

        {/* Selección de unidades */}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">Unidades de interés</label>
          {selectedUnitIds.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedUnitIds.map((id) => {
                const u = availableUnits.find((x) => x.id === id)
                return (
                  <span key={id} className="inline-flex items-center gap-1 rounded-lg bg-[#BDA27E]/15 px-2.5 py-1 text-xs font-medium text-[#2B1A18]">
                    {u?.unit_number ?? id}
                    <button type="button" onClick={() => toggleUnit(id)} className="hover:text-red-600 cursor-pointer"><X size={12} /></button>
                  </span>
                )
              })}
            </div>
          )}
          <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
            {availableUnits.filter((u) => u.status === 'disponible' || u.status === 'en_preventa').map((u) => (
              <label key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                <input type="checkbox" checked={selectedUnitIds.includes(u.id)} onChange={() => toggleUnit(u.id)} className="rounded border-gray-300 h-4 w-4" />
                <span className="font-medium">{u.unit_number}</span>
                <span className="text-gray-400">—</span>
                <span className="text-gray-500">{u.category}</span>
                {u.published_commercial_price && <span className="ml-auto text-gray-500">${u.published_commercial_price.toLocaleString()}</span>}
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Creando...' : 'Crear Lead'}</Button>
        </div>
      </form>
    </Modal>
  )
}
