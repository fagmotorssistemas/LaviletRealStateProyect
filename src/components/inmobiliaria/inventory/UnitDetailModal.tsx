'use client'

import { Modal } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { PriceText } from '@/components/inmobiliaria/shared/PriceText'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { UNIT_STATUS_OPTIONS } from '@/types/inmobiliaria'
import type { Unit, UnitStatus, Project } from '@/types/inmobiliaria'
import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { updateUnit } from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import {
  Building2,
  Layers,
  Tag,
  Ruler,
  SquareDashed,
  Sun,
  Umbrella,
  Car,
  DollarSign,
  FileText,
  RefreshCw,
  Pencil,
} from 'lucide-react'

const categoryOptions = [
  { value: 'Departamento', label: 'Departamento' },
  { value: 'Local Comercial', label: 'Local Comercial' },
  { value: 'Suite', label: 'Suite' },
  { value: 'Oficina', label: 'Oficina' },
  { value: 'Parqueadero', label: 'Parqueadero' },
]

const subtypeOptions = [
  { value: 'suite', label: 'Suite' },
  { value: '1_dormitorio', label: '1 Dormitorio' },
  { value: '2_dormitorios', label: '2 Dormitorios' },
  { value: '2_5_dormitorios', label: '2.5 Dormitorios' },
  { value: 'local', label: 'Local' },
  { value: 'oficina', label: 'Oficina' },
]

const defaultEditForm = {
  project_id: '',
  unit_number: '',
  category: 'Departamento',
  unit_subtype: '',
  floor: '',
  area_internal_m2: '',
  area_terrace_covered_m2: '',
  area_terrace_open_m2: '',
  area_total_m2: '',
  parking_assigned: '0',
  cost_per_m2_internal: '',
  published_commercial_price: '',
  status: 'disponible' as UnitStatus,
  description: '',
}

function unitToFormFields(unit: Unit) {
  return {
    project_id: unit.project_id,
    unit_number: unit.unit_number,
    category: unit.category,
    unit_subtype: unit.unit_subtype ?? '',
    floor: unit.floor ?? '',
    area_internal_m2: unit.area_internal_m2 != null ? String(unit.area_internal_m2) : '',
    area_terrace_covered_m2: unit.area_terrace_covered_m2 != null ? String(unit.area_terrace_covered_m2) : '',
    area_terrace_open_m2: unit.area_terrace_open_m2 != null ? String(unit.area_terrace_open_m2) : '',
    area_total_m2: unit.area_total_m2 != null ? String(unit.area_total_m2) : '',
    parking_assigned: String(unit.parking_assigned ?? 0),
    cost_per_m2_internal: unit.cost_per_m2_internal != null ? String(unit.cost_per_m2_internal) : '',
    published_commercial_price: unit.published_commercial_price != null ? String(unit.published_commercial_price) : '',
    status: unit.status,
    description: unit.description ?? '',
  }
}

interface UnitDetailModalProps {
  unit: Unit | null
  projects: Project[]
  isOpen: boolean
  onClose: () => void
  onStatusChange: (unitId: string, status: UnitStatus) => void
  onUnitUpdated?: (unit: Unit) => void
}

export function UnitDetailModal({
  unit,
  projects,
  isOpen,
  onClose,
  onStatusChange,
  onUnitUpdated,
}: UnitDetailModalProps) {
  const { supabase } = useAuth()
  const [newStatus, setNewStatus] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(defaultEditForm)

  useEffect(() => {
    if (!isOpen) setIsEditing(false)
  }, [isOpen])

  useEffect(() => {
    if (unit) {
      setForm(unitToFormFields(unit))
      setIsEditing(false)
      setNewStatus('')
    }
  }, [unit?.id])

  if (!unit) return null

  const updateField = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  const handleSaveStatus = () => {
    if (newStatus && newStatus !== unit.status) {
      onStatusChange(unit.id, newStatus as UnitStatus)
    }
    setNewStatus('')
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.project_id || !form.unit_number.trim()) {
      toast.error('Proyecto y número de unidad son obligatorios')
      return
    }
    setSaving(true)
    try {
      const row = await updateUnit(supabase, unit.id, {
        project_id: form.project_id,
        unit_number: form.unit_number.trim(),
        category: form.category,
        unit_subtype: form.unit_subtype || null,
        floor: form.floor || null,
        area_internal_m2: form.area_internal_m2 ? Number(form.area_internal_m2) : null,
        area_terrace_covered_m2: form.area_terrace_covered_m2 ? Number(form.area_terrace_covered_m2) : null,
        area_terrace_open_m2: form.area_terrace_open_m2 ? Number(form.area_terrace_open_m2) : null,
        area_total_m2: form.area_total_m2 ? Number(form.area_total_m2) : null,
        parking_assigned: Number(form.parking_assigned) || 0,
        cost_per_m2_internal: form.cost_per_m2_internal ? Number(form.cost_per_m2_internal) : null,
        published_commercial_price: form.published_commercial_price ? Number(form.published_commercial_price) : null,
        status: form.status as UnitStatus,
        description: form.description || null,
      })
      const project = projects.find((p) => p.id === row.project_id)
      const merged = { ...row, project: project ?? unit.project } as Unit
      onUnitUpdated?.(merged)
      toast.success('Unidad actualizada')
      setIsEditing(false)
    } catch {
      toast.error('Error al guardar los cambios')
    } finally {
      setSaving(false)
    }
  }

  const cancelEdit = () => {
    setForm(unitToFormFields(unit))
    setIsEditing(false)
  }

  const projectName = (unit.project as unknown as { name: string })?.name ?? '—'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Editar unidad ${unit.unit_number}` : `Unidad ${unit.unit_number}`}
      size="lg"
      headerActions={
        !isEditing ? (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            title="Editar"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-[#2B1A18] transition-colors cursor-pointer"
          >
            <Pencil size={18} aria-hidden />
            <span className="sr-only">Editar</span>
          </button>
        ) : null
      }
    >
      {isEditing ? (
        <form onSubmit={handleSaveEdit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Select
              id="edit-project"
              label="Proyecto *"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Seleccionar proyecto"
              value={form.project_id}
              onChange={(e) => updateField('project_id', e.target.value)}
            />
            <Input
              id="edit-unit_number"
              label="Nro. Unidad *"
              placeholder="Ej: 201"
              value={form.unit_number}
              onChange={(e) => updateField('unit_number', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Select
              id="edit-category"
              label="Categoría"
              options={categoryOptions}
              value={form.category}
              onChange={(e) => updateField('category', e.target.value)}
            />
            <Select
              id="edit-subtype"
              label="Subtipo"
              options={subtypeOptions}
              placeholder="Seleccionar"
              value={form.unit_subtype}
              onChange={(e) => updateField('unit_subtype', e.target.value)}
            />
            <Input
              id="edit-floor"
              label="Piso"
              placeholder="Ej: PB, 2, 5"
              value={form.floor}
              onChange={(e) => updateField('floor', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="edit-area_int"
              label="Área depto. (m²)"
              type="number"
              step="0.01"
              value={form.area_internal_m2}
              onChange={(e) => updateField('area_internal_m2', e.target.value)}
            />
            <Input
              id="edit-area_ter_cov"
              label="Terraza cubierta (m²)"
              type="number"
              step="0.01"
              value={form.area_terrace_covered_m2}
              onChange={(e) => updateField('area_terrace_covered_m2', e.target.value)}
            />
            <Input
              id="edit-area_ter_open"
              label="Terraza descubierta (m²)"
              type="number"
              step="0.01"
              value={form.area_terrace_open_m2}
              onChange={(e) => updateField('area_terrace_open_m2', e.target.value)}
            />
            <Input
              id="edit-area_total"
              label="Área total (m²)"
              type="number"
              step="0.01"
              value={form.area_total_m2}
              onChange={(e) => updateField('area_total_m2', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Input
              id="edit-parking"
              label="Parqueos"
              type="number"
              value={form.parking_assigned}
              onChange={(e) => updateField('parking_assigned', e.target.value)}
            />
            <Input
              id="edit-cost_m2"
              label="Costo/m²"
              type="number"
              step="0.01"
              value={form.cost_per_m2_internal}
              onChange={(e) => updateField('cost_per_m2_internal', e.target.value)}
            />
            <Input
              id="edit-price"
              label="Precio comercial"
              type="number"
              step="0.01"
              value={form.published_commercial_price}
              onChange={(e) => updateField('published_commercial_price', e.target.value)}
            />
            <Select
              id="edit-status"
              label="Estado"
              options={UNIT_STATUS_OPTIONS}
              value={form.status}
              onChange={(e) => updateField('status', e.target.value)}
            />
          </div>
          <Textarea
            id="edit-desc"
            label="Descripción"
            placeholder="Descripción opcional..."
            value={form.description}
            onChange={(e) => updateField('description', e.target.value)}
          />
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-5">
          {/* Header: estado + categoría */}
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={unit.status} type="unit" />
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <Tag size={14} className="text-gray-800" />
              {unit.category}
            </div>
            {unit.unit_subtype && (
              <span className="text-sm text-gray-400">• {unit.unit_subtype}</span>
            )}
          </div>

          {/* Información general */}
          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Información general</h4>
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={<Building2 size={15} className="text-gray-800" />} label="Proyecto" value={projectName} />
              <InfoRow icon={<Layers size={15} className="text-gray-800" />} label="Piso" value={unit.floor ?? '—'} />
              <InfoRow icon={<Car size={15} className="text-gray-800" />} label="Parqueos asignados" value={String(unit.parking_assigned ?? 0)} />
              <InfoRow icon={<DollarSign size={15} className="text-gray-800" />} label="Costo / m²" value={unit.cost_per_m2_internal ? `$${Number(unit.cost_per_m2_internal).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'} />
            </div>
          </div>

          {/* Áreas */}
          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Superficies</h4>
            <div className="grid grid-cols-2 gap-4">
              <InfoRow
                icon={<Ruler size={15} className="text-gray-800" />}
                label="Área del departamento"
                value={unit.area_internal_m2 ? `${Number(unit.area_internal_m2).toLocaleString('en-US', { minimumFractionDigits: 2 })} m²` : '—'}
              />
              <InfoRow
                icon={<Umbrella size={15} className="text-gray-800" />}
                label="Terraza cubierta"
                value={unit.area_terrace_covered_m2 ? `${Number(unit.area_terrace_covered_m2).toLocaleString('en-US', { minimumFractionDigits: 2 })} m²` : '—'}
              />
              <InfoRow
                icon={<Sun size={15} className="text-gray-800" />}
                label="Terraza descubierta"
                value={unit.area_terrace_open_m2 ? `${Number(unit.area_terrace_open_m2).toLocaleString('en-US', { minimumFractionDigits: 2 })} m²` : '—'}
              />
              <InfoRow
                icon={<SquareDashed size={15} className="text-gray-800" />}
                label="Área total"
                value={unit.area_total_m2 ? `${Number(unit.area_total_m2).toLocaleString('en-US', { minimumFractionDigits: 2 })} m²` : '—'}
              />
            </div>
          </div>

          {/* Precio comercial */}
          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Precio comercial</h4>
            </div>
            <PriceText value={unit.published_commercial_price} size="lg" />
          </div>

          {/* Descripción */}
          {unit.description && (
            <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText size={15} className="text-gray-800" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Descripción</h4>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{unit.description}</p>
            </div>
          )}

          {/* Cambiar estado */}
          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <RefreshCw size={15} className="text-gray-800" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Cambiar estado</h4>
            </div>
            <div className="flex gap-3">
              <Select
                options={UNIT_STATUS_OPTIONS}
                value={newStatus || unit.status}
                onChange={(e) => setNewStatus(e.target.value)}
                className="flex-1"
              />
              <Button onClick={handleSaveStatus} disabled={!newStatus || newStatus === unit.status}>
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 leading-tight">{label}</p>
        <p className="text-sm font-medium leading-snug text-gray-800">{value}</p>
      </div>
    </div>
  )
}
