'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { UNIT_STATUS_OPTIONS } from '@/types/inmobiliaria'
import type { Project } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { createUnit, uploadUnitMedia } from '@/services/inmobiliaria.service'
import { prepareImageForWebUpload } from '@/lib/images/prepareImageForWebUpload'
import { toast } from 'sonner'
import { ImagePlus, X } from 'lucide-react'

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

interface CreateUnitModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  projects: Project[]
  tenantId: string
}

export function CreateUnitModal({ isOpen, onClose, onCreated, projects, tenantId }: CreateUnitModalProps) {
  const { supabase } = useAuth()
  const [loading, setLoading] = useState(false)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [form, setForm] = useState({
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
    status: 'disponible',
    description: '',
  })

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.project_id || !form.unit_number) {
      toast.error('Proyecto y número de unidad son obligatorios')
      return
    }
    setLoading(true)
    try {
      const created = await createUnit(supabase, {
        tenant_id: tenantId,
        project_id: form.project_id,
        unit_number: form.unit_number,
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
        status: form.status as 'disponible',
        description: form.description || null,
      })
      let uploadFailures = 0
      for (let i = 0; i < imageFiles.length; i++) {
        const raw = imageFiles[i]
        try {
          const file = await prepareImageForWebUpload(raw)
          await uploadUnitMedia(supabase, {
            tenantId,
            projectId: form.project_id,
            unitId: created.id,
            file,
            setAsCover: i === 0 && imageFiles.length > 0,
          })
        } catch {
          uploadFailures += 1
          toast.error(`No se pudo subir: ${raw.name}`)
        }
      }
      if (imageFiles.length === 0) {
        toast.success('Unidad creada exitosamente')
      } else if (uploadFailures === 0) {
        toast.success('Unidad creada e imágenes subidas')
      } else if (uploadFailures === imageFiles.length) {
        toast.error('Unidad creada, pero ninguna imagen se pudo subir')
      } else {
        toast.success('Unidad creada; algunas imágenes no se subieron')
      }
      onCreated()
      onClose()
      setImageFiles([])
      setForm({ project_id: '', unit_number: '', category: 'Departamento', unit_subtype: '', floor: '', area_internal_m2: '', area_terrace_covered_m2: '', area_terrace_open_m2: '', area_total_m2: '', parking_assigned: '0', cost_per_m2_internal: '', published_commercial_price: '', status: 'disponible', description: '' })
    } catch {
      toast.error('Error al crear la unidad')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nueva Unidad" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Select id="project" label="Proyecto *" options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="Seleccionar proyecto" value={form.project_id} onChange={(e) => update('project_id', e.target.value)} />
          <Input id="unit_number" label="Nro. Unidad *" placeholder="Ej: 201" value={form.unit_number} onChange={(e) => update('unit_number', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Select id="category" label="Categoría" options={categoryOptions} value={form.category} onChange={(e) => update('category', e.target.value)} />
          <Select id="subtype" label="Subtipo" options={subtypeOptions} placeholder="Seleccionar" value={form.unit_subtype} onChange={(e) => update('unit_subtype', e.target.value)} />
          <Input id="floor" label="Piso" placeholder="Ej: PB, 2, 5" value={form.floor} onChange={(e) => update('floor', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input id="area_int" label="Área depto. (m²)" type="number" step="0.01" value={form.area_internal_m2} onChange={(e) => update('area_internal_m2', e.target.value)} />
          <Input id="area_ter_cov" label="Terraza cubierta (m²)" type="number" step="0.01" value={form.area_terrace_covered_m2} onChange={(e) => update('area_terrace_covered_m2', e.target.value)} />
          <Input id="area_ter_open" label="Terraza descubierta (m²)" type="number" step="0.01" value={form.area_terrace_open_m2} onChange={(e) => update('area_terrace_open_m2', e.target.value)} />
          <Input id="area_total" label="Área total (m²)" type="number" step="0.01" value={form.area_total_m2} onChange={(e) => update('area_total_m2', e.target.value)} />
        </div>
        <div className="grid grid-cols-4 gap-4">
          <Input id="parking" label="Parqueos" type="number" value={form.parking_assigned} onChange={(e) => update('parking_assigned', e.target.value)} />
          <Input id="cost_m2" label="Costo/m²" type="number" step="0.01" placeholder="1500" value={form.cost_per_m2_internal} onChange={(e) => update('cost_per_m2_internal', e.target.value)} />
          <Input id="price" label="Precio comercial" type="number" step="0.01" placeholder="128000" value={form.published_commercial_price} onChange={(e) => update('published_commercial_price', e.target.value)} />
          <Select id="status" label="Estado" options={UNIT_STATUS_OPTIONS} value={form.status} onChange={(e) => update('status', e.target.value)} />
        </div>
        <Textarea id="desc" label="Descripción" placeholder="Descripción opcional de la unidad..." value={form.description} onChange={(e) => update('description', e.target.value)} />
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-800">Fotos de la unidad (opcional)</p>
          <p className="text-xs text-gray-500">
           La primera foto queda como portada.
          </p>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 hover:bg-gray-100">
            <ImagePlus size={18} className="text-gray-500" />
            <span>Agregar imágenes</span>
            <input
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={(e) => {
                const list = e.target.files ? Array.from(e.target.files) : []
                e.target.value = ''
                setImageFiles((prev) => [...prev, ...list])
              }}
            />
          </label>
          {imageFiles.length > 0 && (
            <ul className="flex flex-wrap gap-2 pt-1">
              {imageFiles.map((f, idx) => (
                <li
                  key={`${f.name}-${idx}-${f.size}`}
                  className="flex items-center gap-1 rounded-md border border-gray-100 bg-white px-2 py-1 text-xs text-gray-700"
                >
                  <span className="max-w-[180px] truncate">{f.name}</span>
                  <button
                    type="button"
                    className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    onClick={() => setImageFiles((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="Quitar archivo"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Creando...' : 'Crear Unidad'}</Button>
        </div>
      </form>
    </Modal>
  )
}
