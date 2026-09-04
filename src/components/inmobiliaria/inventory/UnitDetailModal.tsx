'use client'

import { Modal } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { PriceText } from '@/components/inmobiliaria/shared/PriceText'
import { formatNumber, formatCurrency } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { UNIT_STATUS_OPTIONS } from '@/types/inmobiliaria'
import type { Unit, UnitMedia, UnitStatus, Project } from '@/types/inmobiliaria'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
  updateUnit,
  getUnit,
  uploadUnitMedia,
  deleteUnitMedia,
  setUnitCoverMedia,
} from '@/services/inmobiliaria.service'
import { prepareImageForWebUpload } from '@/lib/images/prepareImageForWebUpload'
import { toast } from 'sonner'
import Image from 'next/image'
import {
  Bath,
  BedDouble,
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
  Loader2,
  Upload,
  Trash2,
  Images,
  LayoutList,
} from 'lucide-react'

type UnitDetailTab = 'ficha' | 'imagenes'

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

const defaultEditForm = {
  project_id: '',
  unit_number: '',
  category: 'Departamento',
  unit_subtype: '',
  unit_type_id: '',
  plan_group: '',
  floor: '',
  floor_number: '',
  area_internal_m2: '',
  area_exterior_m2: '',
  area_terrace_covered_m2: '',
  area_terrace_open_m2: '',
  area_total_m2: '',
  bedrooms: '',
  bathrooms_full: '',
  bathrooms_half: '',
  parking_assigned: '0',
  spaces: '',
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
    unit_type_id: unit.unit_type_id ?? '',
    plan_group: unit.plan_group ?? '',
    floor: unit.floor ?? '',
    floor_number: unit.floor_number != null ? String(unit.floor_number) : '',
    area_internal_m2: unit.area_internal_m2 != null ? String(unit.area_internal_m2) : '',
    area_exterior_m2: unit.area_exterior_m2 != null ? String(unit.area_exterior_m2) : '',
    area_terrace_covered_m2: unit.area_terrace_covered_m2 != null ? String(unit.area_terrace_covered_m2) : '',
    area_terrace_open_m2: unit.area_terrace_open_m2 != null ? String(unit.area_terrace_open_m2) : '',
    area_total_m2: unit.area_total_m2 != null ? String(unit.area_total_m2) : '',
    bedrooms: unit.bedrooms != null ? String(unit.bedrooms) : '',
    bathrooms_full: (unit.bathrooms_full ?? unit.bathrooms) != null ? String(unit.bathrooms_full ?? unit.bathrooms) : '',
    bathrooms_half: unit.bathrooms_half != null ? String(unit.bathrooms_half) : '',
    parking_assigned: String(unit.parking_assigned ?? 0),
    spaces: (unit.spaces ?? []).join(', '),
    cost_per_m2_internal: unit.cost_per_m2_internal != null ? String(unit.cost_per_m2_internal) : '',
    published_commercial_price: unit.published_commercial_price != null ? String(unit.published_commercial_price) : '',
    status: unit.status,
    description: unit.description ?? '',
  }
}

interface UnitDetailModalProps {
  unit: Unit | null
  projects: Project[]
  unitTypes?: { id: string; name: string }[]
  isOpen: boolean
  onClose: () => void
  onStatusChange?: (unitId: string, status: UnitStatus) => void
  onUnitUpdated?: (unit: Unit) => void
  readOnly?: boolean
}

export function UnitDetailModal({
  unit,
  projects,
  unitTypes = [],
  isOpen,
  onClose,
  onStatusChange,
  onUnitUpdated,
  readOnly = false,
}: UnitDetailModalProps) {
  const { supabase } = useAuth()
  const [newStatus, setNewStatus] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(defaultEditForm)
  const [resolvedUnit, setResolvedUnit] = useState<Unit | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [mediaUploading, setMediaUploading] = useState(false)
  const [detailTab, setDetailTab] = useState<UnitDetailTab>('ficha')

  const reloadUnitDetail = useCallback(async () => {
    if (!unit?.id) return
    const u = await getUnit(supabase, unit.id)
    setResolvedUnit(u)
    return u
  }, [supabase, unit?.id])

  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false)
      setDetailTab('ficha')
    }
  }, [isOpen])

  useEffect(() => {
    if (unit) {
      setForm(unitToFormFields(unit))
      setIsEditing(false)
      setNewStatus('')
    }
  }, [unit?.id])

  useEffect(() => {
    if (!isOpen || !unit?.id) {
      setResolvedUnit(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    getUnit(supabase, unit.id)
      .then((u) => {
        if (!cancelled) setResolvedUnit(u)
      })
      .catch(() => {
        if (!cancelled) toast.error('No se pudieron cargar los datos completos de la unidad')
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, unit?.id, supabase])

  if (!unit) return null

  const displayUnit = resolvedUnit ?? unit
  const unitMedia = displayUnit.unit_media ?? []
  const tenantForMedia = displayUnit.tenant_id

  const updateField = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  const handleSaveStatus = () => {
    if (onStatusChange && newStatus && newStatus !== displayUnit.status) {
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
      const bathroomsFull = toNum(form.bathrooms_full)
      await updateUnit(supabase, unit.id, {
        project_id: form.project_id,
        unit_number: form.unit_number.trim(),
        category: form.category,
        unit_subtype: form.unit_subtype || null,
        unit_type_id: form.unit_type_id || null,
        plan_group: form.plan_group.trim() || null,
        floor: form.floor || null,
        floor_number: toNum(form.floor_number),
        area_internal_m2: toNum(form.area_internal_m2),
        area_exterior_m2: toNum(form.area_exterior_m2),
        area_terrace_covered_m2: toNum(form.area_terrace_covered_m2),
        area_terrace_open_m2: toNum(form.area_terrace_open_m2),
        area_total_m2: toNum(form.area_total_m2),
        bedrooms: toNum(form.bedrooms),
        bathrooms: bathroomsFull,
        bathrooms_full: bathroomsFull,
        bathrooms_half: toNum(form.bathrooms_half),
        parking_assigned: Number(form.parking_assigned) || 0,
        spaces: spacesFromInput(form.spaces),
        cost_per_m2_internal: toNum(form.cost_per_m2_internal),
        published_commercial_price: toNum(form.published_commercial_price),
        status: form.status as UnitStatus,
        description: form.description || null,
      })
      const full = await getUnit(supabase, unit.id)
      const project = projects.find((p) => p.id === full.project_id)
      const merged = { ...full, project: project ?? full.project } as Unit
      setResolvedUnit(merged)
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
    setForm(unitToFormFields(displayUnit))
    setIsEditing(false)
  }

  const projectName = (displayUnit.project as unknown as { name: string })?.name ?? '—'

  const handleUnitMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : []
    e.target.value = ''
    if (!picked.length || !tenantForMedia) return

    const hadNoImages = unitMedia.length === 0
    setMediaUploading(true)
    let ok = 0
    try {
      for (let i = 0; i < picked.length; i++) {
        const raw = picked[i]
        try {
          const file = await prepareImageForWebUpload(raw)
          await uploadUnitMedia(supabase, {
            tenantId: tenantForMedia,
            projectId: displayUnit.project_id,
            unitId: displayUnit.id,
            file,
            setAsCover: hadNoImages && i === 0,
          })
          ok += 1
        } catch (err) {
          console.error(err)
          toast.error(`No se pudo subir: ${raw.name}`)
        }
      }
      if (ok === picked.length) {
        toast.success(ok === 1 ? 'Imagen subida' : `${ok} imágenes subidas`)
      } else if (ok > 0) {
        toast.success(`Se subieron ${ok} de ${picked.length} imagen(es)`)
      } else {
        toast.error('No se pudo subir ninguna imagen')
      }
      await reloadUnitDetail()
    } finally {
      setMediaUploading(false)
    }
  }

  const handleDeleteUnitMedia = async (mediaId: string) => {
    if (!confirm('¿Eliminar esta imagen?')) return
    try {
      await deleteUnitMedia(supabase, mediaId)
      toast.success('Imagen eliminada')
      await reloadUnitDetail()
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const handleSetUnitCover = async (mediaId: string) => {
    try {
      await setUnitCoverMedia(supabase, displayUnit.id, mediaId)
      toast.success('Portada actualizada')
      await reloadUnitDetail()
    } catch {
      toast.error('Error al guardar portada')
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Editar unidad ${displayUnit.unit_number}` : `Unidad ${displayUnit.unit_number}`}
      size="lg"
      headerActions={
        !isEditing && !readOnly ? (
          <button
            type="button"
            onClick={() => {
              setDetailTab('ficha')
              setIsEditing(true)
            }}
            title="Editar"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-[#3a3d36] transition-colors cursor-pointer"
          >
            <Pencil size={18} aria-hidden />
            <span className="sr-only">Editar</span>
          </button>
        ) : null
      }
    >
      {isEditing ? (
        <form onSubmit={handleSaveEdit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            <Select
              id="edit-unit_type_id"
              label="Tipología"
              placeholder="Sin tipología"
              options={unitTypes.map((item) => ({ value: item.id, label: item.name }))}
              value={form.unit_type_id}
              onChange={(e) => updateField('unit_type_id', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              id="edit-plan_group"
              label="Grupo"
              placeholder="Ej: Tipo A"
              value={form.plan_group}
              onChange={(e) => updateField('plan_group', e.target.value)}
            />
            <Input
              id="edit-floor"
              label="Piso (etiqueta)"
              placeholder="Ej: Piso 2"
              value={form.floor}
              onChange={(e) => updateField('floor', e.target.value)}
            />
            <Input
              id="edit-floor_number"
              label="Nro. piso"
              type="number"
              value={form.floor_number}
              onChange={(e) => updateField('floor_number', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              id="edit-area_int"
              label="Área interna (m²)"
              type="number"
              step="0.01"
              value={form.area_internal_m2}
              onChange={(e) => updateField('area_internal_m2', e.target.value)}
            />
            <Input
              id="edit-area_ext"
              label="Área exterior (m²)"
              type="number"
              step="0.01"
              value={form.area_exterior_m2}
              onChange={(e) => updateField('area_exterior_m2', e.target.value)}
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
          <div className="rounded-xl border border-[#8b917c]/25 bg-[#8b917c]/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex shrink-0 items-center gap-1 rounded-lg bg-white px-2 py-2 text-[#8b917c] shadow-sm">
                <BedDouble size={16} aria-hidden />
                <Bath size={16} aria-hidden />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#3a3d36]">Habitaciones y baños</h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  Quedan guardados en la unidad y se ven en la tabla y ficha de inventario.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                id="edit-bedrooms"
                label="Habitaciones"
                type="number"
                step="0.5"
                min="0"
                placeholder="Ej: 2"
                value={form.bedrooms}
                onChange={(e) => updateField('bedrooms', e.target.value)}
              />
              <Input
                id="edit-bathrooms_full"
                label="Baños completos"
                type="number"
                step="1"
                min="0"
                placeholder="Ej: 2"
                value={form.bathrooms_full}
                onChange={(e) => updateField('bathrooms_full', e.target.value)}
              />
              <Input
                id="edit-bathrooms_half"
                label="Baños sociales"
                type="number"
                step="1"
                min="0"
                placeholder="Ej: 1"
                value={form.bathrooms_half}
                onChange={(e) => updateField('bathrooms_half', e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
            id="edit-spaces"
            label="Espacios"
            placeholder="Sala, cocina, terraza (separados por coma)"
            value={form.spaces}
            onChange={(e) => updateField('spaces', e.target.value)}
          />
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
          {/* Pestañas: ficha vs galería */}
          <div className="-mt-1 flex gap-1 overflow-x-auto border-b border-gray-200">
            {(
              [
                { id: 'ficha' as const, label: 'Ficha', icon: LayoutList },
                { id: 'imagenes' as const, label: 'Imágenes', icon: Images },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setDetailTab(id)}
                className={`flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  detailTab === id
                    ? 'border-[#3a3d36] text-[#3a3d36]'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {detailTab === 'ficha' ? (
            <>
          {/* Header: estado + categoría */}
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={displayUnit.status} type="unit" />
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <Tag size={14} className="text-gray-800" />
              {displayUnit.category}
            </div>
            {displayUnit.typology_code && (
              <span className="text-sm text-gray-400">• {displayUnit.typology_code}</span>
            )}
            {displayUnit.unit_subtype && (
              <span className="text-sm text-gray-400">• {displayUnit.unit_subtype}</span>
            )}
          </div>

          {/* Información general */}
          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Información general</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoRow icon={<Building2 size={15} className="text-gray-800" />} label="Proyecto" value={projectName} />
              <InfoRow icon={<Layers size={15} className="text-gray-800" />} label="Tipología" value={displayUnit.typology_code ?? '—'} />
              <InfoRow icon={<Layers size={15} className="text-gray-800" />} label="Grupo" value={displayUnit.plan_group ?? '—'} />
              <InfoRow icon={<Layers size={15} className="text-gray-800" />} label="Piso" value={displayUnit.floor ?? '—'} />
              <InfoRow icon={<BedDouble size={15} className="text-gray-800" />} label="Habitaciones" value={displayUnit.bedrooms != null ? String(displayUnit.bedrooms) : '—'} />
              <InfoRow icon={<Bath size={15} className="text-gray-800" />} label="Baños completos" value={(displayUnit.bathrooms_full ?? displayUnit.bathrooms) != null ? String(displayUnit.bathrooms_full ?? displayUnit.bathrooms) : '—'} />
              <InfoRow icon={<Bath size={15} className="text-gray-800" />} label="Baños sociales" value={displayUnit.bathrooms_half != null ? String(displayUnit.bathrooms_half) : '—'} />
              <InfoRow icon={<Car size={15} className="text-gray-800" />} label="Parqueos asignados" value={String(displayUnit.parking_assigned ?? 0)} />
              <InfoRow icon={<DollarSign size={15} className="text-gray-800" />} label="Costo / m²" value={displayUnit.cost_per_m2_internal ? formatCurrency(Number(displayUnit.cost_per_m2_internal)) : '—'} />
            </div>
          </div>

          {/* Áreas */}
          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Superficies</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoRow
                icon={<Ruler size={15} className="text-gray-800" />}
                label="Área interna"
                value={displayUnit.area_internal_m2 ? `${formatNumber(Number(displayUnit.area_internal_m2))} m²` : '—'}
              />
              <InfoRow
                icon={<Ruler size={15} className="text-gray-800" />}
                label="Área exterior"
                value={displayUnit.area_exterior_m2 ? `${formatNumber(Number(displayUnit.area_exterior_m2))} m²` : '—'}
              />
              <InfoRow
                icon={<Umbrella size={15} className="text-gray-800" />}
                label="Terraza cubierta"
                value={displayUnit.area_terrace_covered_m2 ? `${formatNumber(Number(displayUnit.area_terrace_covered_m2))} m²` : '—'}
              />
              <InfoRow
                icon={<Sun size={15} className="text-gray-800" />}
                label="Terraza descubierta"
                value={displayUnit.area_terrace_open_m2 ? `${formatNumber(Number(displayUnit.area_terrace_open_m2))} m²` : '—'}
              />
              <InfoRow
                icon={<SquareDashed size={15} className="text-gray-800" />}
                label="Área total"
                value={displayUnit.area_total_m2 ? `${formatNumber(Number(displayUnit.area_total_m2))} m²` : '—'}
              />
            </div>
          </div>

          {(displayUnit.spaces ?? []).length > 0 && (
            <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText size={15} className="text-gray-800" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Espacios</h4>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{displayUnit.spaces.join(' · ')}</p>
            </div>
          )}

          {/* Precio comercial */}
          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Precio comercial</h4>
            </div>
            <PriceText value={displayUnit.published_commercial_price} size="lg" />
          </div>

          {/* Descripción */}
          {displayUnit.description && (
            <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText size={15} className="text-gray-800" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Descripción</h4>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{displayUnit.description}</p>
            </div>
          )}

          {!readOnly && (
          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <RefreshCw size={15} className="text-gray-800" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Cambiar estado</h4>
            </div>
            <div className="flex gap-3">
              <Select
                options={UNIT_STATUS_OPTIONS}
                value={newStatus || displayUnit.status}
                onChange={(e) => setNewStatus(e.target.value)}
                className="flex-1"
              />
              <Button onClick={handleSaveStatus} disabled={!newStatus || newStatus === displayUnit.status || !onStatusChange}>
                Guardar
              </Button>
            </div>
          </div>
          )}
            </>
          ) : (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-[#3a3d36]">Galería de la unidad</h3>
              </div>

              <div className="flex flex-col gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  {detailLoading && <Loader2 size={14} className="animate-spin text-gray-400" aria-hidden />}
                  <span>
                    {unitMedia.length === 0 && !detailLoading
                      ? 'Sin imágenes aún.'
                      : `${unitMedia.length} imagen${unitMedia.length === 1 ? '' : 'es'}`}
                  </span>
                </div>
                {!readOnly && (
                <label className="inline-flex sm:shrink-0">
                  <input
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    onChange={handleUnitMediaUpload}
                    disabled={mediaUploading || detailLoading}
                  />
                  <span
                    className={`inline-flex items-center gap-2 rounded-lg bg-[#3a3d36] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#3d2a24] ${mediaUploading || detailLoading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
                  >
                    {mediaUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                    Subir imágenes
                  </span>
                </label>
                )}
              </div>

              {unitMedia.length === 0 && !detailLoading ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/30 py-12 text-center">
                  <Images className="mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden />
                  <p className="text-sm text-gray-500">Aún no hay fotos en esta unidad.</p>
                  <p className="mt-1 text-xs text-gray-400">Usa «Subir imágenes» para agregar la primera.</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {unitMedia.map((m) => (
                    <UnitInventoryPhotoCard
                      key={m.id}
                      media={m}
                      readOnly={readOnly}
                      onDelete={() => handleDeleteUnitMedia(m.id)}
                      onSetCover={() => handleSetUnitCover(m.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function UnitInventoryPhotoCard({
  media,
  onDelete,
  onSetCover,
  readOnly = false,
}: {
  media: UnitMedia
  onDelete: () => void
  onSetCover: () => void
  readOnly?: boolean
}) {
  const alt = media.file_name ?? 'Foto de la unidad'
  const isImage = media.mime_type?.startsWith('image/') ?? true

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="relative aspect-[4/3] bg-gray-200">
        {isImage ? (
          <Image src={media.url} alt={alt} fill className="object-cover" sizes="(max-width: 768px) 100vw, 50vw" />
        ) : (
          <a href={media.url} target="_blank" rel="noreferrer" className="flex h-full items-center justify-center p-4 text-sm text-[#3a3d36] underline">
            Ver archivo
          </a>
        )}
        {media.is_cover && (
          <span className="absolute left-2 top-2 rounded bg-[#3a3d36] px-2 py-0.5 text-[10px] font-bold text-white">
            PORTADA
          </span>
        )}
      </div>
      {!readOnly && (
      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 p-3">
        {!media.is_cover && isImage && (
          <button type="button" onClick={onSetCover} className="cursor-pointer text-xs font-semibold text-[#8b917c] hover:underline">
            Usar como portada
          </button>
        )}
        <button type="button" onClick={onDelete} className="ml-auto flex cursor-pointer items-center gap-1 text-xs text-red-500 hover:underline">
          <Trash2 size={12} /> Quitar
        </button>
      </div>
      )}
    </div>
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
        <p className="crm-num text-sm font-medium leading-snug text-gray-800">{value}</p>
      </div>
    </div>
  )
}
