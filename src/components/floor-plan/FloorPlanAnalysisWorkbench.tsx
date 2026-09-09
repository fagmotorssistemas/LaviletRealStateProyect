'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { PlanUploader } from '@/components/floor-plan/PlanUploader'
import { PlanControls } from '@/components/floor-plan/PlanControls'
import { FloorPlanViewer } from '@/components/floor-plan/FloorPlanViewer'
import { analyzePlan, validatePlanFile } from '@/lib/floor-plan/api'
import type { AnalysisResult, Apartment } from '@/lib/floor-plan/types'
import { cn } from '@/lib/utils'

function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('No se pudo leer la imagen'))
    img.src = url
  })
}

export function FloorPlanAnalysisWorkbench() {
  const [file, setFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }, [imageUrl])

  const selected = useMemo(
    () => apartments.find((item) => item.id === selectedId) ?? null,
    [apartments, selectedId],
  )

  const stats = useMemo(() => {
    const total = apartments.length
    const review = apartments.filter((item) => item.needsReview || item.confidence < 0.7).length
    return { total, review, ok: Math.max(0, total - review) }
  }, [apartments])

  const onPickFile = async (next: File) => {
    const err = validatePlanFile(next)
    if (err) {
      toast.error(err)
      return
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    const url = URL.createObjectURL(next)
    try {
      const size = await loadImageSize(url)
      setFile(next)
      setImageUrl(url)
      setNatural(size)
      setResult(null)
      setApartments([])
      setSelectedId(null)
      setEditMode(false)
      setScale(1)
      setOffset({ x: 0, y: 0 })
    } catch {
      URL.revokeObjectURL(url)
      toast.error('Imagen inválida')
    }
  }

  const onAnalyze = async () => {
    if (!file) return
    setAnalyzing(true)
    try {
      const data = await analyzePlan(file)
      if (!data.success && data.error) {
        toast.error(data.error)
        if (!data.apartments?.length) return
      }
      setResult(data)
      setApartments(data.apartments ?? [])
      setSelectedId(null)
      setEditMode(false)
      if ((data.apartments?.length ?? 0) === 0) {
        toast.message('Sin departamentos detectados', {
          description: 'Podés dibujar/editar manualmente cuando haya resultados parciales.',
        })
      } else {
        toast.success(`Detectados ${data.apartments.length} departamentos`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al analizar')
    } finally {
      setAnalyzing(false)
    }
  }

  const renameSelected = (id: string) => {
    if (!selected) return
    const trimmed = id.trim()
    if (!trimmed) return
    setApartments((prev) =>
      prev.map((item) => (item.id === selected.id ? { ...item, id: trimmed, needsReview: false } : item)),
    )
    setSelectedId(trimmed)
  }

  const deleteSelected = () => {
    if (!selected) return
    setApartments((prev) => prev.filter((item) => item.id !== selected.id))
    setSelectedId(null)
    setEditMode(false)
  }

  const addApartment = () => {
    if (!natural) return
    const w = natural.width
    const h = natural.height
    const id = `unit-${String(apartments.length + 1).padStart(2, '0')}`
    const poly: Apartment['polygon'] = [
      [Math.round(w * 0.4), Math.round(h * 0.35)],
      [Math.round(w * 0.55), Math.round(h * 0.35)],
      [Math.round(w * 0.55), Math.round(h * 0.55)],
      [Math.round(w * 0.4), Math.round(h * 0.55)],
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

  const saveLocal = () => {
    const payload = {
      image: natural,
      apartments,
      labels: result?.labels ?? [],
      commonAreas: result?.commonAreas ?? [],
      savedAt: new Date().toISOString(),
    }
    localStorage.setItem('lavilet-plan-analysis', JSON.stringify(payload))
    toast.success('Guardado localmente')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Análisis de planos"
        description="Subí un plano top-down. OpenCV detecta departamentos como polígonos SVG encima de la imagen original."
      />

      {!imageUrl || !natural ? (
        <PlanUploader onFile={(f) => void onPickFile(f)} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-3">
            <PlanControls
              onZoomIn={() => setScale((s) => Math.min(6, s * 1.15))}
              onZoomOut={() => setScale((s) => Math.max(0.4, s / 1.15))}
              onReset={() => {
                setScale(1)
                setOffset({ x: 0, y: 0 })
              }}
              analyzing={analyzing}
              onAnalyze={() => void onAnalyze()}
              canAnalyze={Boolean(file) && !analyzing}
              editMode={editMode}
              canEdit={Boolean(selected)}
              onToggleEdit={() => setEditMode((v) => !v)}
            />

            <div className="h-[min(70dvh,640px)]">
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
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-[#2B1A18]/55">
              <span>
                Detectados: <strong className="text-[#2B1A18]">{stats.total}</strong>
              </span>
              <span>
                Correctos: <strong className="text-[#2B1A18]">{stats.ok}</strong>
              </span>
              <span>
                Revisar: <strong className="text-[#2B1A18]">{stats.review}</strong>
              </span>
              <span>
                {natural.width}×{natural.height}px
              </span>
              <button
                type="button"
                className="ml-auto text-[#787D62] underline-offset-2 hover:underline"
                onClick={() => {
                  if (imageUrl) URL.revokeObjectURL(imageUrl)
                  setFile(null)
                  setImageUrl(null)
                  setNatural(null)
                  setApartments([])
                  setResult(null)
                }}
              >
                Cambiar imagen
              </button>
            </div>
          </div>

          <aside className="rounded-2xl bg-white p-4 ring-1 ring-[#2B1A18]/10">
            {selected ? (
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-medium tracking-[0.18em] text-[#2B1A18]/40 uppercase">
                    Departamento
                  </p>
                  <input
                    value={selected.id}
                    onChange={(event) => renameSelected(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-[#2B1A18]/12 bg-[#f7f3ee] px-3 py-2 text-lg font-semibold text-[#2B1A18] outline-none focus:border-[#BDA27E]"
                  />
                </div>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#2B1A18]/45">Confianza</dt>
                    <dd className="font-medium text-[#2B1A18]">
                      {Math.round(selected.confidence * 100)}%
                      {selected.needsReview ? (
                        <span className="ml-2 rounded-full bg-[#f3ebe0] px-2 py-0.5 text-[10px] text-[#8a6238] uppercase">
                          Revisar
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#2B1A18]/45">Área (px²)</dt>
                    <dd className="font-medium text-[#2B1A18]">
                      {Math.round(selected.area ?? selected.bbox.width * selected.bbox.height)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#2B1A18]/45">Vértices</dt>
                    <dd className="font-medium text-[#2B1A18]">{selected.polygon.length}</dd>
                  </div>
                </dl>
                <p className="text-[11px] leading-relaxed text-[#2B1A18]/45">
                  En modo edición: arrastrá vértices. Doble clic en el borde para agregar. Clic derecho en
                  un vértice para eliminarlo.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="h-10 rounded-xl bg-[#f7f3ee] text-xs font-semibold tracking-wide text-[#2B1A18] uppercase"
                  >
                    Deseleccionar
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelected}
                    className="h-10 rounded-xl bg-white text-xs font-semibold tracking-wide text-[#8a3b2e] uppercase ring-1 ring-[#8a3b2e]/25"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-[#2B1A18]/55">
                <p>Seleccioná un departamento en el plano (hover muestra el borde).</p>
                <p>Los fills permanecen transparentes; la imagen no se redibuja.</p>
              </div>
            )}

            <div className="mt-5 space-y-2 border-t border-[#2B1A18]/8 pt-4">
              <button
                type="button"
                onClick={addApartment}
                className="flex h-10 w-full items-center justify-center rounded-xl bg-white text-xs font-semibold tracking-wide text-[#2B1A18] uppercase ring-1 ring-[#2B1A18]/12"
              >
                Agregar depto
              </button>
              <button
                type="button"
                onClick={saveLocal}
                disabled={apartments.length === 0}
                className={cn(
                  'flex h-10 w-full items-center justify-center rounded-xl bg-[#2B1A18] text-xs font-semibold tracking-wide text-white uppercase',
                  apartments.length === 0 && 'opacity-50',
                )}
              >
                Guardar
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
