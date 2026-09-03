'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  createUnitsImportAction,
  updateUnitsImportAction,
} from '@/app/inmobiliaria/inventario-2/actions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import type { UnitsImportWrite } from '@/services/inmobiliaria.service'
import {
  UNIT_IMPORT_CATEGORY_OPTIONS,
  UNIT_STATUS_OPTIONS,
  type UnitImport,
  type UnitStatus,
} from '@/types/inmobiliaria'

function toNum(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function spacesFromInput(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

type FormState = {
  category: string
  unit_code: string
  plan_group: string
  floor_label: string
  floor_number: string
  area_internal_m2: string
  area_exterior_m2: string
  parking: string
  bedrooms: string
  bathrooms_full: string
  bathrooms_half: string
  spaces: string
  price: string
  status: UnitStatus
}

function emptyForm(): FormState {
  return {
    category: 'departamento',
    unit_code: '',
    plan_group: '',
    floor_label: '',
    floor_number: '',
    area_internal_m2: '',
    area_exterior_m2: '',
    parking: '',
    bedrooms: '',
    bathrooms_full: '',
    bathrooms_half: '',
    spaces: '',
    price: '',
    status: 'disponible',
  }
}

function fromRow(row: UnitImport): FormState {
  return {
    category: row.category,
    unit_code: row.unit_code,
    plan_group: row.plan_group ?? '',
    floor_label: row.floor_label ?? '',
    floor_number: row.floor_number == null ? '' : String(row.floor_number),
    area_internal_m2: row.area_internal_m2 == null ? '' : String(row.area_internal_m2),
    area_exterior_m2: row.area_exterior_m2 == null ? '' : String(row.area_exterior_m2),
    parking: row.parking == null ? '' : String(row.parking),
    bedrooms: row.bedrooms == null ? '' : String(row.bedrooms),
    bathrooms_full: row.bathrooms_full == null ? '' : String(row.bathrooms_full),
    bathrooms_half: row.bathrooms_half == null ? '' : String(row.bathrooms_half),
    spaces: row.spaces.join(', '),
    price: row.price == null ? '' : String(row.price),
    status: row.status,
  }
}

function toPayload(form: FormState): UnitsImportWrite {
  return {
    category: form.category,
    unit_code: form.unit_code.trim(),
    plan_group: form.plan_group.trim() || null,
    floor_label: form.floor_label.trim() || null,
    floor_number: toNum(form.floor_number),
    area_internal_m2: toNum(form.area_internal_m2),
    area_exterior_m2: toNum(form.area_exterior_m2),
    parking: toNum(form.parking),
    bedrooms: toNum(form.bedrooms),
    bathrooms_full: toNum(form.bathrooms_full),
    bathrooms_half: toNum(form.bathrooms_half),
    spaces: spacesFromInput(form.spaces),
    price: toNum(form.price),
    status: form.status,
  }
}

interface UnitsImportModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  row: UnitImport | null
}

export function UnitsImportModal({ isOpen, onClose, onSaved, row }: UnitsImportModalProps) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const isEdit = Boolean(row)

  useEffect(() => {
    if (!isOpen) return
    setForm(row ? fromRow(row) : emptyForm())
  }, [isOpen, row])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.unit_code.trim()) {
      toast.error('El código de unidad es obligatorio')
      return
    }
    setLoading(true)
    try {
      const payload = toPayload(form)
      if (row) {
        await updateUnitsImportAction(row.id, payload)
        toast.success('Unidad actualizada')
      } else {
        await createUnitsImportAction(payload)
        toast.success('Unidad creada')
      }
      onSaved()
      onClose()
    } catch {
      toast.error(row ? 'Error al actualizar la unidad' : 'Error al crear la unidad')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? `Editar ${row?.unit_code}` : 'Nueva unidad'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            id="unit_code"
            label="Código *"
            placeholder="Ej: A-201"
            value={form.unit_code}
            onChange={(e) => update('unit_code', e.target.value)}
          />
          <Select
            id="category"
            label="Categoría"
            options={UNIT_IMPORT_CATEGORY_OPTIONS}
            value={form.category}
            onChange={(e) => update('category', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            id="plan_group"
            label="Grupo"
            placeholder="Ej: Tipo A"
            value={form.plan_group}
            onChange={(e) => update('plan_group', e.target.value)}
          />
          <Input
            id="floor_label"
            label="Piso (etiqueta)"
            placeholder="Ej: Piso 2"
            value={form.floor_label}
            onChange={(e) => update('floor_label', e.target.value)}
          />
          <Input
            id="floor_number"
            label="Nro. piso"
            type="number"
            value={form.floor_number}
            onChange={(e) => update('floor_number', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            id="bedrooms"
            label="Habitaciones"
            type="number"
            min="0"
            step="0.5"
            value={form.bedrooms}
            onChange={(e) => update('bedrooms', e.target.value)}
          />
          <Input
            id="bathrooms_full"
            label="Baños completos"
            type="number"
            min="0"
            step="1"
            value={form.bathrooms_full}
            onChange={(e) => update('bathrooms_full', e.target.value)}
          />
          <Input
            id="bathrooms_half"
            label="Baños sociales"
            type="number"
            min="0"
            step="1"
            value={form.bathrooms_half}
            onChange={(e) => update('bathrooms_half', e.target.value)}
          />
          <Input
            id="parking"
            label="Parqueos"
            type="number"
            min="0"
            step="1"
            value={form.parking}
            onChange={(e) => update('parking', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            id="area_internal_m2"
            label="Área interna (m²)"
            type="number"
            step="0.01"
            value={form.area_internal_m2}
            onChange={(e) => update('area_internal_m2', e.target.value)}
          />
          <Input
            id="area_exterior_m2"
            label="Área exterior (m²)"
            type="number"
            step="0.01"
            value={form.area_exterior_m2}
            onChange={(e) => update('area_exterior_m2', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            id="price"
            label="Precio"
            type="number"
            step="0.01"
            placeholder="128000"
            value={form.price}
            onChange={(e) => update('price', e.target.value)}
          />
          <Select
            id="status"
            label="Estado"
            options={UNIT_STATUS_OPTIONS}
            value={form.status}
            onChange={(e) => update('status', e.target.value as UnitStatus)}
          />
        </div>

        <Textarea
          id="spaces"
          label="Espacios"
          placeholder="Sala, cocina, terraza (separados por coma)"
          value={form.spaces}
          onChange={(e) => update('spaces', e.target.value)}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear unidad'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
