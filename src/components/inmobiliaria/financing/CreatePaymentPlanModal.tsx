'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/contexts/AuthContext'
import { createPaymentPlan } from '@/services/inmobiliaria.service'
import {
  PAYMENT_PLAN_BALANCE_OPTIONS,
  PAYMENT_PLAN_CATEGORY_OPTIONS,
  type Project,
} from '@/types/inmobiliaria'
import { toast } from 'sonner'

interface CreatePaymentPlanModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  projects: Project[]
}

const emptyForm = {
  project_id: '',
  name: '',
  applies_to_category: 'todos',
  reservation_amount: '',
  entry_pct: '',
  balance_type: '',
  conditions: '',
  is_active: true,
}

export function CreatePaymentPlanModal({
  isOpen,
  onClose,
  onCreated,
  projects,
}: CreatePaymentPlanModalProps) {
  const { supabase } = useAuth()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const update = (key: string, value: string | boolean) => setForm((p) => ({ ...p, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.project_id || !form.name.trim()) {
      toast.error('Proyecto y nombre del plan son obligatorios')
      return
    }
    setLoading(true)
    try {
      await createPaymentPlan(supabase, {
        project_id: form.project_id,
        name: form.name.trim(),
        is_active: form.is_active,
        applies_to_category: form.applies_to_category || 'todos',
        reservation_amount: form.reservation_amount ? Number(form.reservation_amount) : null,
        entry_pct: form.entry_pct ? Number(form.entry_pct) : null,
        balance_type: form.balance_type || null,
        conditions: form.conditions.trim() || null,
      })
      toast.success('Plan de pago creado')
      onCreated()
      onClose()
      setForm(emptyForm)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear el plan')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo plan de pago" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          id="plan-project"
          label="Proyecto *"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Seleccionar proyecto"
          value={form.project_id}
          onChange={(e) => update('project_id', e.target.value)}
        />
        <Input
          id="plan-name"
          label="Nombre del plan *"
          placeholder="Ej: 30/40/30 — Anticipo, obra y entrega"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            id="plan-category"
            label="Aplica a"
            options={PAYMENT_PLAN_CATEGORY_OPTIONS}
            value={form.applies_to_category}
            onChange={(e) => update('applies_to_category', e.target.value)}
          />
          <Select
            id="plan-balance"
            label="Tipo de saldo"
            options={PAYMENT_PLAN_BALANCE_OPTIONS}
            placeholder="Opcional"
            value={form.balance_type}
            onChange={(e) => update('balance_type', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            id="plan-reservation"
            label="Monto de reserva"
            type="number"
            min="0"
            step="0.01"
            placeholder="2000"
            value={form.reservation_amount}
            onChange={(e) => update('reservation_amount', e.target.value)}
          />
          <Input
            id="plan-entry"
            label="Entrada (%)"
            type="number"
            min="0"
            max="100"
            step="0.01"
            placeholder="30"
            value={form.entry_pct}
            onChange={(e) => update('entry_pct', e.target.value)}
          />
        </div>
        <Textarea
          id="plan-conditions"
          label="Condiciones"
          placeholder="Reserva, cronograma de pagos, entrega..."
          value={form.conditions}
          onChange={(e) => update('conditions', e.target.value)}
        />
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => update('is_active', e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Plan activo
        </label>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Creando...' : 'Crear plan'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
