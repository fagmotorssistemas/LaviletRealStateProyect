'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/contexts/AuthContext'
import { createProject } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  tenantId: string
}

export function CreateProjectModal({ isOpen, onClose, onCreated, tenantId }: CreateProjectModalProps) {
  const { supabase } = useAuth()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', address: '', estimated_projection_date: '', architects: '', plan_type: '',
    summary_financial_initial_pvp_total: '', summary_financial_min_expected_with_discounts: '',
  })

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('El nombre es obligatorio'); return }
    setLoading(true)
    try {
      await createProject(supabase, {
        tenant_id: tenantId,
        name: form.name,
        address: form.address || null,
        estimated_projection_date: form.estimated_projection_date || null,
        architects: form.architects || null,
        plan_type: form.plan_type || null,
        summary_financial_initial_pvp_total: form.summary_financial_initial_pvp_total ? Number(form.summary_financial_initial_pvp_total) : null,
        summary_financial_min_expected_with_discounts: form.summary_financial_min_expected_with_discounts ? Number(form.summary_financial_min_expected_with_discounts) : null,
      })
      toast.success('Proyecto creado exitosamente')
      onCreated()
      onClose()
      setForm({ name: '', address: '', estimated_projection_date: '', architects: '', plan_type: '', summary_financial_initial_pvp_total: '', summary_financial_min_expected_with_discounts: '' })
    } catch {
      toast.error('Error al crear proyecto')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo Proyecto" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input id="name" label="Nombre del proyecto *" placeholder="Ej: EDIFICIO TORRE CENTRO" value={form.name} onChange={(e) => update('name', e.target.value)} />
        <Input id="address" label="Dirección" placeholder="Dirección del proyecto" value={form.address} onChange={(e) => update('address', e.target.value)} />
        <div className="grid grid-cols-2 gap-4">
          <Input id="architects" label="Arquitectos" placeholder="Nombre del estudio" value={form.architects} onChange={(e) => update('architects', e.target.value)} />
          <Input id="projection" label="Fecha proyección" type="date" value={form.estimated_projection_date} onChange={(e) => update('estimated_projection_date', e.target.value)} />
        </div>
        <Input id="plan" label="Tipo de plan" placeholder="Ej: PLAN COMERCIAL TENTATIVO" value={form.plan_type} onChange={(e) => update('plan_type', e.target.value)} />
        <div className="grid grid-cols-2 gap-4">
          <Input id="pvp" label="PVP Total inicial" type="number" step="0.01" placeholder="4850000" value={form.summary_financial_initial_pvp_total} onChange={(e) => update('summary_financial_initial_pvp_total', e.target.value)} />
          <Input id="min" label="Mínimo esperado con descuentos" type="number" step="0.01" placeholder="4600000" value={form.summary_financial_min_expected_with_discounts} onChange={(e) => update('summary_financial_min_expected_with_discounts', e.target.value)} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Creando...' : 'Crear Proyecto'}</Button>
        </div>
      </form>
    </Modal>
  )
}
