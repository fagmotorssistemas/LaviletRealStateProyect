'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, Plus, Save, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { FloorPlanViewer } from '@/components/floor-plan/FloorPlanViewer'
import { Button } from '@/components/ui/Button'
import { FLOOR_PLAN_FLOORS } from '@/lib/tour/floorPlanHotspots'
import {
  apartmentsToZones,
  zonesToApartments,
  type FloorPlanFloorSummary,
  type FloorPlanZonesDoc,
} from '@/lib/tour/floorPlanZones'
import type { Apartment } from '@/lib/floor-plan/types'
import type { TypologyAsset } from '@/types/inmobiliaria'
import { cn } from '@/lib/utils'

type AssetRow = TypologyAsset & { public_url: string }

type TypologyFloorZonesPanelProps = {
  typologyCode: string
  assets: AssetRow[]
}

function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('No se pudo leer la imagen'))
    img.src = url
  })
}

export function TypologyFloorZonesPanel({ typologyCode }: TypologyFloorZonesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [floor, setFloor] = useState(1)
  const [floorSummaries, setFloorSummaries] = useState<FloorPlanFloorSummary[]>(
    FLOOR_PLAN_FLOORS.map((n) => ({ floor: n, imageUrl: null, zoneCount: 0, updatedAt: null })),
  )
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [dragging, setDragging] = useState(false)

  const selected = useMemo(
    () => apartments.find((item) => item.id === selectedId) ?? null,
    [apartments, selectedId],
  )

  const currentSummary = useMemo(
    () => floorSummaries.find((item) => item.floor === floor) ?? null,
    [floorSummaries, floor],
  )

  const applyImage = useCallback(async (url: string | null) => {
    if (!url) {
      setImageUrl(null)
      setNatural(null)
      setScale(1)
      setOffset({ x: 0, y: 0 })
      return
    }
    const size = await loadImageSize(url)
    setImageUrl(url)
    setNatural(size)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const refreshSummaries = useCallback(async () => {
    if (!typologyCode) return
    const res = await fetch(
      `/api/floor-plan-zones?typology_code=${encodeURIComponent(typologyCode)}&list=1`,
      { credentials: 'same-origin' },
    )
    const json = (await res.json()) as { floors?: FloorPlanFloorSummary[]; error?: string }
    if (!res.ok) throw new Error(json.error || 'No se pudieron listar los pisos')
    if (json.floors) setFloorSummaries(json.floors)
  }, [typologyCode])

  const loadDoc = useCallback(async () => {
    if (!typologyCode) return
    setLoading(true)
    try {
      const [docRes] = await Promise.all([
        fetch(
          `/api/floor-plan-zones?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}`,
          { credentials: 'same-origin' },
        ),
        refreshSummaries().catch(() => undefined),
      ])
      const json = (await docRes.json()) as { doc?: FloorPlanZonesDoc | null; error?: string }
      if (!docRes.ok) throw new Error(json.error || 'No se pudo cargar')
      const doc = json.doc
      if (doc?.imageUrl) {
        await applyImage(doc.imageUrl)
        setApartments(zonesToApartments(doc.zones))
      } else {
        await applyImage(null)
        setApartments(doc?.zones ? zonesToApartments(doc.zones) : [])
      }
      setSelectedId(null)
      setEditMode(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el piso')
      await applyImage(null)
      setApartments([])
    } finally {
      setLoading(false)
    }
  }, [typologyCode, floor, applyImage, refreshSummaries])

  useEffect(() => {
    void loadDoc()
  }, [loadDoc])

  const uploadFloorImage = async (list: FileList | File[] | null) => {
    const file = list ? Array.from(list)[0] : null
    if (!file) return
    const ok =
      file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name)
    if (!ok) {
      toast.error('El archivo no es una imagen')
      return
    }
    setUploading(true)
    try {
      const body = new FormData()
      body.set('typology_code', typologyCode)
      body.set('floor', String(floor))
      body.set('file', file)
      const res = await fetch('/api/floor-plan-zones', {
        method: 'POST',
        body,
        credentials: 'same-origin',
      })
      const json = (await res.json()) as {
        imageUrl?: string
        doc?: FloorPlanZonesDoc
        error?: string
      }
      if (!res.ok || !json.imageUrl) throw new Error(json.error || 'No se pudo subir el plano')
      await applyImage(json.imageUrl)
      if (json.doc?.zones) setApartments(zonesToApartments(json.doc.zones))
      await refreshSummaries()
      toast.success(`Plano del piso ${floor} guardado`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo subir el plano')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeFloorImage = async () => {
    if (!typologyCode) return
    if (!window.confirm(`¿Quitar la imagen del plano del piso ${floor}? Las zonas se mantienen.`)) {
      return
    }
    setRemoving(true)
    try {
      const res = await fetch(
        `/api/floor-plan-zones?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}&scope=image`,
        { method: 'DELETE', credentials: 'same-origin' },
      )
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error || 'No se pudo quitar la imagen')
      await applyImage(null)
      await refreshSummaries()
      toast.success(`Imagen del piso ${floor} eliminada`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo quitar la imagen')
    } finally {
      setRemoving(false)
    }
  }

  const clearFloorAll = async () => {
    if (!typologyCode) return
    if (
      !window.confirm(
        `¿Borrar plano y zonas del piso ${floor}? Esta acción no se puede deshacer.`,
      )
    ) {
      return
    }
    setRemoving(true)
    try {
      const res = await fetch(
        `/api/floor-plan-zones?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}&scope=all`,
        { method: 'DELETE', credentials: 'same-origin' },
      )
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error || 'No se pudo borrar el piso')
      await applyImage(null)
      setApartments([])
      setSelectedId(null)
      setEditMode(false)
      await refreshSummaries()
      toast.success(`Piso ${floor} limpio`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo borrar el piso')
    } finally {
      setRemoving(false)
    }
  }

  const addApartment = () => {
    if (!natural) return
    const w = natural.width
    const h = natural.height
    const id = `D${String(apartments.length + 1).padStart(2, '0')}`
    const poly: Apartment['polygon'] = [
      [Math.round(w * 0.35), Math.round(h * 0.3)],
      [Math.round(w * 0.55), Math.round(h * 0.3)],
      [Math.round(w * 0.55), Math.round(h * 0.5)],
      [Math.round(w * 0.35), Math.round(h * 0.5)],
    ]
    const apt: Apartment = {
      id,
      polygon: poly,
      bbox: {
        x: poly[0][0],
        y: poly[0][1],
        width: poly[1][0] - poly[0][0],
        height: poly[2][1] - poly[0][1],
      },
      center: [(poly[0][0] + poly[1][0]) / 2, (poly[0][1] + poly[2][1]) / 2],
      confidence: 1,
      needsReview: true,
    }
    setApartments((prev) => [...prev, apt])
    setSelectedId(id)
    setEditMode(true)
  }

  const renameSelected = (nextId: string) => {
    if (!selected) return
    const trimmed = nextId.trim()
    if (!trimmed) return
    setApartments((prev) =>
      prev.map((item) => (item.id === selected.id ? { ...item, id: trimmed } : item)),
    )
    setSelectedId(trimmed)
  }

  const deleteSelected = () => {
    if (!selected) return
    setApartments((prev) => prev.filter((item) => item.id !== selected.id))
    setSelectedId(null)
    setEditMode(false)
  }

  const onSave = async () => {
    if (!typologyCode || !natural || !imageUrl) {
      toast.error('Subí un plano antes de guardar las zonas')
      return
    }
    setSaving(true)
    try {
      const doc: FloorPlanZonesDoc = {
        floor,
        typologyCode,
        imageUrl,
        imageWidth: natural.width,
        imageHeight: natural.height,
        zones: apartmentsToZones(apartments, natural.width, natural.height),
        updatedAt: new Date().toISOString(),
      }
      const res = await fetch('/api/floor-plan-zones', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ doc }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error || 'No se pudo guardar')
      await refreshSummaries()
      toast.success(`Piso ${floor}: ${apartments.length} zona(s) guardada(s)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-[#3a3d36]">Planos por piso</p>
        <p className="text-xs text-[#8a8d87]">
          Subí, reemplazá o quitá la imagen de cada piso, y marcá las zonas de departamento.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {floorSummaries.map((item) => {
          const active = item.floor === floor
          return (
            <button
              key={item.floor}
              type="button"
              onClick={() => setFloor(item.floor)}
              className={cn(
                'overflow-hidden rounded-xl border text-left transition-colors',
                active
                  ? 'border-[#787D62] ring-2 ring-[#787D62]/25'
                  : 'border-[#2B1A18]/10 hover:border-[#2B1A18]/25',
              )}
            >
              <div className="relative aspect-[4/3] bg-[#f4f4ef]">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={`Piso ${item.floor}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[#b0b3ab]">
                    <ImagePlus size={18} />
                  </div>
                )}
              </div>
              <div className="space-y-0.5 px-2 py-1.5">
                <p className="text-xs font-semibold text-[#3a3d36]">Piso {item.floor}</p>
                <p className="text-[11px] text-[#8a8d87]">
                  {item.imageUrl ? `${item.zoneCount} zona(s)` : 'Sin plano'}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      <div className="rounded-xl border border-[#2B1A18]/10 bg-[#fafaf7] p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[#3a3d36]">Piso {floor}</p>
            <p className="text-xs text-[#8a8d87]">
              {currentSummary?.imageUrl
                ? `${currentSummary.zoneCount} zona(s) · imagen cargada`
                : 'Todavía no hay imagen para este piso'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!typologyCode || uploading || loading || removing}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} className="mr-1.5" />
              {imageUrl ? 'Reemplazar foto' : 'Subir foto'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!imageUrl || uploading || loading || removing}
              onClick={() => void removeFloorImage()}
            >
              <Trash2 size={14} className="mr-1.5" />
              {removing ? 'Quitando…' : 'Quitar foto'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={
                (!imageUrl && apartments.length === 0) || uploading || loading || removing
              }
              onClick={() => void clearFloorAll()}
            >
              Borrar piso
            </Button>
          </div>
        </div>

        <div
          className={cn(
            'flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-4 text-center text-sm',
            dragging
              ? 'border-[#2B1A18]/30 bg-white text-[#3a3d36]'
              : 'border-[#2B1A18]/15 bg-white/70 text-[#555850]',
          )}
          onDragEnter={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void uploadFloorImage(e.dataTransfer.files)
          }}
        >
          <p>
            {uploading
              ? 'Subiendo plano…'
              : `Arrastrá acá el plano del piso ${floor}, o usá “Subir foto”`}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
            className="hidden"
            disabled={!typologyCode || uploading}
            onChange={(e) => void uploadFloorImage(e.target.files)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={addApartment}
          disabled={!natural || !imageUrl || loading}
        >
          <Plus size={14} className="mr-1.5" />
          Agregar departamento
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!selected}
          onClick={() => setEditMode((v) => !v)}
        >
          {editMode ? 'Listo' : 'Editar zona'}
        </Button>
        <Button type="button" variant="secondary" disabled={!selected} onClick={deleteSelected}>
          <Trash2 size={14} className="mr-1.5" />
          Quitar zona
        </Button>
        <Button
          type="button"
          onClick={() => void onSave()}
          disabled={saving || loading || !natural || !imageUrl}
        >
          <Save size={14} className="mr-1.5" />
          {saving ? 'Guardando…' : 'Guardar zonas'}
        </Button>
      </div>

      {selected ? (
        <label className="block text-xs text-[#555850]">
          Código / etiqueta del depto seleccionado
          <input
            value={selected.id}
            onChange={(e) => renameSelected(e.target.value)}
            className="mt-1 h-9 w-full max-w-xs rounded-md border border-[#2B1A18]/12 bg-white px-3 text-sm text-[#2B1A18]"
          />
        </label>
      ) : null}

      <div className="h-[min(62dvh,640px)]">
        {natural && imageUrl ? (
          <FloorPlanViewer
            imageUrl={imageUrl}
            width={natural.width}
            height={natural.height}
            apartments={apartments}
            selectedId={selectedId}
            editMode={editMode}
            onSelect={setSelectedId}
            onApartmentsChange={setApartments}
            scale={scale}
            offset={offset}
            onScaleChange={setScale}
            onOffsetChange={setOffset}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl bg-[#f4f4ef] text-sm text-[#8a8d87]">
            {loading ? 'Cargando piso…' : 'Subí una foto del plano para este piso'}
          </div>
        )}
      </div>

      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {apartments.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={cn(
                'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm',
                selectedId === item.id
                  ? 'border-[#787D62] bg-[#787D62]/10 text-[#3a3d36]'
                  : 'border-[#2B1A18]/10 bg-white text-[#555850]',
              )}
            >
              <span className="font-medium">{item.id}</span>
              <span className="text-xs text-[#8a8d87]">{item.polygon.length} pts</span>
            </button>
          </li>
        ))}
        {apartments.length === 0 && !loading ? (
          <li className="text-xs text-[#8a8d87] sm:col-span-2 lg:col-span-3">
            Todavía no hay zonas. Tocá “Agregar departamento” y ajustá el polígono.
          </li>
        ) : null}
      </ul>
    </div>
  )
}
