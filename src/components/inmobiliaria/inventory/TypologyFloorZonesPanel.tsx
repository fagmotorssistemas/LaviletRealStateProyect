'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ImagePlus, Maximize2, Minimize2, Minus, PenLine, Plus, Save, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { listUnitsImportAction } from '@/app/inmobiliaria/inventario-2/actions'
import { FloorPlanViewer } from '@/components/floor-plan/FloorPlanViewer'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { FLOOR_PLAN_DEFAULT_FLOOR, FLOOR_PLAN_FLOORS, FLOOR_PLAN_SCOPE, floorPlanLevelLabel, unitFloorNumber } from '@/lib/tour/floorPlanHotspots'
import {
  apartmentsToZones,
  DEFAULT_OVERLAY_ALIGN,
  floorPlanVariantHasMedia,
  getFloorPlanOverlayAlign,
  getFloorPlanVariantMedia,
  parseOverlayAlign,
  withFloorPlanVariants,
  zonesToApartments,
  type FloorPlanFloorSummary,
  type FloorPlanOverlayAlign,
  type FloorPlanVariant,
  type FloorPlanZonesDoc,
} from '@/lib/tour/floorPlanZones'
import { invalidateFloorPlanCache } from '@/lib/tour/floorPlanClientCache'
import type { Apartment, Point } from '@/lib/floor-plan/types'
import type { UnitImport } from '@/types/inmobiliaria'
import { cn } from '@/lib/utils'
import { createClient as createBrowserSupabase } from '@/lib/supabase/client'

type TypologyFloorZonesPanelProps = {
  /** @deprecated Los planos son del edificio; se ignora. */
  typologyCode?: string
}

/** Refresca cookies de sesión antes de mutaciones a /api (el proxy a veces llega tarde). */
async function ensureAuthCookies() {
  const supabase = createBrowserSupabase()
  const { data, error } = await supabase.auth.getUser()
  if (data.user && !error) return
  const refreshed = await supabase.auth.refreshSession()
  if (refreshed.error || !refreshed.data.session) {
    throw new Error('Sesión vencida. Volvé a iniciar sesión.')
  }
}

function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('No se pudo leer la imagen'))
    img.src = url
  })
}

function fitScaleForView(naturalW: number, naturalH: number, viewW: number, viewH: number) {
  if (!naturalW || !naturalH || !viewW || !viewH) return 1
  const next = Math.min(viewW / naturalW, viewH / naturalH)
  return Math.min(8, Math.max(0.05, Number(next.toFixed(4))))
}

export function TypologyFloorZonesPanel(_props: TypologyFloorZonesPanelProps) {
  const typologyCode = FLOOR_PLAN_SCOPE
  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewerBoxRef = useRef<HTMLDivElement>(null)
  /** Invalida cargas en vuelo para que no pisen un upload recién terminado. */
  const loadGenRef = useRef(0)
  const [floor, setFloor] = useState(FLOOR_PLAN_DEFAULT_FLOOR)
  const [planVariant, setPlanVariant] = useState<FloorPlanVariant>('3d')
  const [zonesDoc, setZonesDoc] = useState<FloorPlanZonesDoc | null>(null)
  const [floorSummaries, setFloorSummaries] = useState<FloorPlanFloorSummary[]>(
    FLOOR_PLAN_FLOORS.map((n) => ({
      floor: n,
      imageUrl: null,
      imageUrl2d: null,
      imageUrl3d: null,
      htmlUrl3d: null,
      zoneCount: 0,
      updatedAt: null,
    })),
  )
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [htmlUrl, setHtmlUrl] = useState<string | null>(null)
  /** Fuerza remount del iframe preview tras cada subida/borrado. */
  const [htmlPreviewNonce, setHtmlPreviewNonce] = useState(0)
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
  const [fullscreen, setFullscreen] = useState(false)
  const [draftPoints, setDraftPoints] = useState<Point[] | null>(null)
  const [units, setUnits] = useState<UnitImport[]>([])
  const [assignOpen, setAssignOpen] = useState(false)
  const [showAllUnits, setShowAllUnits] = useState(false)

  const selected = useMemo(
    () => apartments.find((item) => item.id === selectedId) ?? null,
    [apartments, selectedId],
  )

  const usedUnitCodes = useMemo(
    () => new Set(apartments.map((item) => item.id.trim().toLowerCase())),
    [apartments],
  )

  const unitsOnFloor = useMemo(() => {
    return units.filter((unit) => {
      if (unit.floor_number != null && Number.isFinite(unit.floor_number) && unit.floor_number === floor) {
        return true
      }
      return unitFloorNumber({ floor: unit.floor || unit.floor_label, unit_number: unit.unit_number }) === floor
    })
  }, [units, floor])

  const unitOptions = useMemo(() => {
    const source = showAllUnits || unitsOnFloor.length === 0 ? units : unitsOnFloor
    return source.map((unit) => {
      const code = unit.unit_number.trim()
      const taken =
        usedUnitCodes.has(code.toLowerCase()) &&
        selected?.id.trim().toLowerCase() !== code.toLowerCase()
      const bits = [
        code,
        unit.floor || unit.floor_label || (unit.floor_number != null ? `Piso ${unit.floor_number}` : null),
        unit.typology_code,
        taken ? 'ya asignada' : null,
      ].filter(Boolean)
      return { value: code, label: bits.join(' · ') }
    })
  }, [showAllUnits, unitsOnFloor, units, usedUnitCodes, selected?.id])

  useEffect(() => {
    let cancelled = false
    void listUnitsImportAction({ page: 1, pageSize: 500 }).then((res) => {
      if (cancelled) return
      if (res.error) {
        toast.error(res.error)
        return
      }
      setUnits(res.data ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setShowAllUnits(false)
  }, [floor])

  const currentSummary = useMemo(
    () => floorSummaries.find((item) => item.floor === floor) ?? null,
    [floorSummaries, floor],
  )

  const applyImage = useCallback(async (url: string | null) => {
    setHtmlUrl(null)
    if (!url) {
      setImageUrl(null)
      setNatural(null)
      setScale(1)
      setOffset({ x: 0, y: 0 })
      return null as { width: number; height: number } | null
    }
    const size = await loadImageSize(url)
    const box = viewerBoxRef.current?.getBoundingClientRect()
    const fitted = box
      ? fitScaleForView(size.width, size.height, box.width, box.height)
      : Math.min(1, 900 / Math.max(size.width, size.height))
    setImageUrl(url)
    setNatural(size)
    setScale(fitted)
    setOffset({ x: 0, y: 0 })
    return size
  }, [])

  const applyHtml = useCallback((url: string | null, width = 2048, height = 970) => {
    setImageUrl(null)
    if (!url) {
      setHtmlUrl(null)
      setNatural(null)
      setScale(1)
      setOffset({ x: 0, y: 0 })
      return
    }
    setHtmlUrl(url)
    setNatural({ width, height })
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const minScaleForView = useCallback(() => {
    if (!natural) return 0.05
    const box = viewerBoxRef.current?.getBoundingClientRect()
    if (!box) return 0.05
    return fitScaleForView(natural.width, natural.height, box.width, box.height)
  }, [natural])

  const zoomBy = (factor: number) => {
    const min = minScaleForView()
    setScale((value) => Math.min(8, Math.max(min, Number((value * factor).toFixed(4)))))
  }

  const clampScale = useCallback(
    (next: number) => Math.min(8, Math.max(minScaleForView(), Number(next.toFixed(4)))),
    [minScaleForView],
  )

  const resetView = () => {
    if (!natural) return
    const box = viewerBoxRef.current?.getBoundingClientRect()
    if (!box) return
    setScale(fitScaleForView(natural.width, natural.height, box.width, box.height))
    setOffset({ x: 0, y: 0 })
  }

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
    const gen = ++loadGenRef.current
    setLoading(true)
    try {
      const [docRes] = await Promise.all([
        fetch(
          `/api/floor-plan-zones?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}`,
          { credentials: 'same-origin' },
        ),
        refreshSummaries().catch(() => undefined),
      ])
      if (gen !== loadGenRef.current) return
      const json = (await docRes.json()) as { doc?: FloorPlanZonesDoc | null; error?: string }
      if (!docRes.ok) throw new Error(json.error || 'No se pudo cargar')
      const doc = json.doc ? withFloorPlanVariants(json.doc) : null
      setZonesDoc(doc)
      const nextVariant: FloorPlanVariant = floorPlanVariantHasMedia(doc?.variants['3d'])
        ? '3d'
        : floorPlanVariantHasMedia(doc?.variants['2d'])
          ? '2d'
          : '3d'
      setPlanVariant(nextVariant)
      const media = getFloorPlanVariantMedia(doc, nextVariant)
      if (media.htmlUrl) {
        const bust = `${media.htmlUrl}${media.htmlUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
        applyHtml(bust, media.imageWidth || 2048, media.imageHeight || 970)
        if (gen !== loadGenRef.current) return
        setApartments(doc?.zones ? zonesToApartments(doc.zones, media.imageWidth, media.imageHeight) : [])
      } else if (media.imageUrl) {
        const bust = `${media.imageUrl}${media.imageUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
        const size = await applyImage(bust)
        if (gen !== loadGenRef.current) return
        setApartments(
          doc?.zones
            ? zonesToApartments(
                doc.zones,
                size?.width || media.imageWidth || undefined,
                size?.height || media.imageHeight || undefined,
              )
            : [],
        )
      } else {
        await applyImage(null)
        if (gen !== loadGenRef.current) return
        setApartments(doc?.zones ? zonesToApartments(doc.zones) : [])
      }
      setSelectedId(null)
      setEditMode(false)
      setAssignOpen(false)
      setDraftPoints(null)
    } catch (error) {
      if (gen !== loadGenRef.current) return
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el piso')
      setZonesDoc(null)
      await applyImage(null)
      setApartments([])
    } finally {
      if (gen === loadGenRef.current) setLoading(false)
    }
  }, [typologyCode, floor, applyImage, applyHtml, refreshSummaries])

  const switchPlanVariant = async (next: FloorPlanVariant) => {
    if (next === planVariant) return
    // Conserva zonas en % y las reaplica sobre la otra imagen.
    const flushedZones =
      natural && (imageUrl || htmlUrl)
        ? apartmentsToZones(apartments, natural.width, natural.height)
        : zonesDoc?.zones ?? apartmentsToZones(apartments, 1000, 1000)

    const base =
      zonesDoc ??
      withFloorPlanVariants({
        floor,
        typologyCode,
        imageUrl: null,
        imageWidth: 1,
        imageHeight: 1,
        variants: {
          '2d': { imageUrl: null, htmlUrl: null, imageWidth: 1, imageHeight: 1 },
          '3d': { imageUrl: null, htmlUrl: null, imageWidth: 1, imageHeight: 1 },
        },
        zones: flushedZones,
        updatedAt: new Date().toISOString(),
      })

    let nextDoc = withFloorPlanVariants({ ...base, zones: flushedZones, floor, typologyCode })

    // Persistí las zonas al cambiar de variante para que 2D/3D queden sincronizadas.
    if (natural && (imageUrl || htmlUrl) && flushedZones.length > 0) {
      try {
        await ensureAuthCookies()
        const variants = {
          ...nextDoc.variants,
          [planVariant]: {
            imageUrl: imageUrl ? imageUrl.split('?')[0] : null,
            htmlUrl: htmlUrl ? htmlUrl.split('?')[0] : null,
            imageWidth: natural.width,
            imageHeight: natural.height,
          },
        }
        const preferred = floorPlanVariantHasMedia(variants['2d']) ? variants['2d'] : variants['3d']
        const res = await fetch('/api/floor-plan-zones', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            doc: {
              ...nextDoc,
              variants,
              imageUrl: preferred.imageUrl,
              imageWidth: preferred.imageWidth || 1,
              imageHeight: preferred.imageHeight || 1,
              zones: flushedZones,
            },
          }),
        })
        const json = (await res.json()) as { doc?: FloorPlanZonesDoc; error?: string }
        if (res.ok && json.doc) nextDoc = withFloorPlanVariants(json.doc)
      } catch {
        // Si falla el auto-guardado, igual cambiamos de vista con las zonas en memoria.
      }
    }

    setZonesDoc(nextDoc)
    setPlanVariant(next)
    setDraftPoints(null)
    setSelectedId(null)
    setEditMode(false)
    setAssignOpen(false)

    const media = getFloorPlanVariantMedia(nextDoc, next)
    if (media.htmlUrl) {
      const bust = `${media.htmlUrl}${media.htmlUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
      applyHtml(bust, media.imageWidth || 2048, media.imageHeight || 970)
      setApartments(zonesToApartments(nextDoc.zones, media.imageWidth || 2048, media.imageHeight || 970))
      toast.message('Viendo HTML 3D · mismas zonas (dibujá en 2D)')
    } else if (media.imageUrl) {
      const bust = `${media.imageUrl}${media.imageUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
      await applyImage(bust)
      const size = await loadImageSize(bust)
      setApartments(zonesToApartments(nextDoc.zones, size.width, size.height))
      toast.message(`Viendo plano ${next.toUpperCase()} · mismas zonas`)
    } else {
      await applyImage(null)
      setApartments(zonesToApartments(nextDoc.zones, 1000, 1000))
      toast.message(
        next === '3d'
          ? 'Subí el HTML o la imagen 3D: las zonas del 2D ya están listas'
          : 'Subí el plano 2D para este nivel',
      )
    }
  }

  useEffect(() => {
    void loadDoc()
  }, [loadDoc])

  const uploadFloorImage = async (list: FileList | File[] | null) => {
    const file = list ? Array.from(list)[0] : null
    if (!file) return
    const isHtml =
      file.type === 'text/html' ||
      file.type === 'application/xhtml+xml' ||
      /\.html?$/i.test(file.name)
    const isImage =
      file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name)
    if (isHtml && planVariant !== '3d') {
      toast.error('El HTML interactivo se sube en la pestaña 3D')
      return
    }
    if (!isHtml && !isImage) {
      toast.error('Usá una imagen o un archivo .html')
      return
    }
    if (!typologyCode) {
      toast.error('Seleccioná una tipología primero')
      return
    }
    setUploading(true)
    loadGenRef.current += 1
    try {
      await ensureAuthCookies()
      const body = new FormData()
      body.set('typology_code', typologyCode)
      body.set('floor', String(floor))
      body.set('variant', planVariant)
      body.set('file', file)
      const res = await fetch('/api/floor-plan-zones', {
        method: 'POST',
        body,
        credentials: 'same-origin',
      })
      const raw = await res.text()
      let json: {
        imageUrl?: string | null
        htmlUrl?: string | null
        doc?: FloorPlanZonesDoc
        error?: string
      } = {}
      try {
        json = raw ? (JSON.parse(raw) as typeof json) : {}
      } catch {
        throw new Error(
          res.status === 413
            ? 'El archivo es demasiado grande'
            : `No se pudo subir el plano (${res.status})`,
        )
      }
      if (!res.ok || (!json.imageUrl && !json.htmlUrl)) {
        throw new Error(json.error || `No se pudo subir el plano (${res.status})`)
      }
      if (json.htmlUrl) {
        const bust = `${json.htmlUrl}${json.htmlUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
        applyHtml(bust)
        setHtmlPreviewNonce((n) => n + 1)
      } else if (json.imageUrl) {
        const bust = `${json.imageUrl}${json.imageUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
        await applyImage(bust)
      }
      if (json.doc) {
        const normalized = withFloorPlanVariants(json.doc)
        setZonesDoc(normalized)
        const media = getFloorPlanVariantMedia(normalized, planVariant)
        setApartments(
          zonesToApartments(
            normalized.zones,
            media.imageWidth > 1 ? media.imageWidth : 2048,
            media.imageHeight > 1 ? media.imageHeight : 970,
          ),
        )
        if (json.htmlUrl) setHtmlPreviewNonce((n) => n + 1)
      }
      await refreshSummaries()
      invalidateFloorPlanCache(floor, typologyCode || FLOOR_PLAN_SCOPE)
      toast.success(
        isHtml
          ? `HTML 3D de ${floorPlanLevelLabel(floor)} guardado`
          : `Plano ${planVariant.toUpperCase()} de ${floorPlanLevelLabel(floor)} guardado`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo subir el plano')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeFloorImage = async () => {
    if (!typologyCode) return
    if (
      !window.confirm(
        `¿Quitar el ${planVariant === '3d' ? '3D/HTML' : 'plano 2D'} de ${floorPlanLevelLabel(floor)}? Las zonas se mantienen.`,
      )
    ) {
      return
    }
    setRemoving(true)
    try {
      const res = await fetch(
        `/api/floor-plan-zones?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}&scope=image&variant=${planVariant}`,
        { method: 'DELETE', credentials: 'same-origin' },
      )
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error || 'No se pudo quitar el archivo')
      await applyImage(null)
      setHtmlUrl(null)
      setHtmlPreviewNonce((n) => n + 1)
      if (zonesDoc) {
        const next = withFloorPlanVariants({
          ...zonesDoc,
          variants: {
            ...zonesDoc.variants,
            [planVariant]: { imageUrl: null, htmlUrl: null, imageWidth: 1, imageHeight: 1 },
          },
        })
        setZonesDoc(next)
      }
      await refreshSummaries()
      invalidateFloorPlanCache(floor, typologyCode || FLOOR_PLAN_SCOPE)
      toast.success(`Imagen ${planVariant.toUpperCase()} de ${floorPlanLevelLabel(floor)} eliminada`)
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
        `¿Borrar plano y zonas de ${floorPlanLevelLabel(floor)}? Esta acción no se puede deshacer.`,
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
      toast.success(`${floorPlanLevelLabel(floor)} limpio`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo borrar el piso')
    } finally {
      setRemoving(false)
    }
  }

  const startPointDraw = () => {
    if (!natural || !imageUrl) return
    setDraftPoints([])
    setSelectedId(null)
    setEditMode(false)
  }

  const cancelPointDraw = () => {
    setDraftPoints(null)
  }

  const undoDraftPoint = () => {
    setDraftPoints((prev) => {
      if (!prev || prev.length === 0) return prev
      const next = prev.slice(0, -1)
      return next
    })
  }

  const closeDraftIfReady = () => {
    if (!draftPoints || draftPoints.length < 3) {
      toast.error('Marcá al menos 3 puntos para cerrar la zona')
      return
    }
    completeDraft(draftPoints)
  }

  const completeDraft = (points: Point[]) => {
    if (points.length < 3) return
    const id = `D${String(apartments.length + 1).padStart(2, '0')}`
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    const x1 = Math.max(...xs)
    const y1 = Math.max(...ys)
    const apt: Apartment = {
      id,
      kind: 'polygon',
      polygon: points,
      bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      center: [(x0 + x1) / 2, (y0 + y1) / 2],
      confidence: 1,
      needsReview: true,
    }
    setApartments((prev) => [...prev, apt])
    setDraftPoints(null)
    setSelectedId(id)
    setEditMode(false)
    setAssignOpen(true)
    toast.success('Zona creada — elegí la unidad de la lista')
  }

  const draftPointsRef = useRef<Point[] | null>(null)
  draftPointsRef.current = draftPoints

  useEffect(() => {
    if (draftPoints == null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }
      const points = draftPointsRef.current
      if (points == null) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setDraftPoints(null)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (points.length >= 3) completeDraft(points)
        return
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        setDraftPoints((prev) => (prev && prev.length > 0 ? prev.slice(0, -1) : prev))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // completeDraft es estable en la práctica para este flujo; no re-suscribir en cada punto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftPoints == null])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && draftPointsRef.current == null) setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Solo al entrar a pantalla completa — no al agregar cada punto.
    requestAnimationFrame(() => resetView())
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen])

  const selectZone = (id: string, openEditor = true) => {
    setSelectedId(id)
    setDraftPoints(null)
    setAssignOpen(false)
    if (openEditor) setEditMode(true)
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

  const assignUnit = (unitNumber: string) => {
    if (!selectedId || !unitNumber) return
    const previousId = selectedId
    setApartments((prev) =>
      prev.map((item) => (item.id === previousId ? { ...item, id: unitNumber, needsReview: false } : item)),
    )
    setSelectedId(unitNumber)
    setAssignOpen(false)
    toast.success(`Zona asignada a unidad ${unitNumber}`)
  }

  const deleteSelected = () => {
    if (!selected) return
    setApartments((prev) => prev.filter((item) => item.id !== selected.id))
    setSelectedId(null)
    setEditMode(false)
    setAssignOpen(false)
  }

  const overlayAlign = useMemo(
    () => getFloorPlanOverlayAlign(zonesDoc, planVariant),
    [zonesDoc, planVariant],
  )

  const nudgeOverlayAlign = (patch: Partial<FloorPlanOverlayAlign>) => {
    const current = getFloorPlanOverlayAlign(zonesDoc, planVariant)
    const next = parseOverlayAlign({ ...current, ...patch })
    setZonesDoc((prev) => {
      const base =
        prev ??
        withFloorPlanVariants({
          floor,
          typologyCode,
          imageUrl: null,
          imageWidth: 1,
          imageHeight: 1,
          variants: {
            '2d': { imageUrl: null, htmlUrl: null, imageWidth: 1, imageHeight: 1 },
            '3d': { imageUrl: null, htmlUrl: null, imageWidth: 1, imageHeight: 1 },
          },
          zones: apartmentsToZones(apartments, natural?.width || 1000, natural?.height || 1000),
          updatedAt: new Date().toISOString(),
        })
      return withFloorPlanVariants({
        ...base,
        align: {
          ...base.align,
          [planVariant]: next,
        },
      })
    })
  }

  const onSave = async () => {
    if (!typologyCode || !natural || !(imageUrl || htmlUrl)) {
      toast.error('Subí un plano (2D o HTML 3D) antes de guardar las zonas')
      return
    }
    setSaving(true)
    try {
      await ensureAuthCookies()
      const zones = apartmentsToZones(apartments, natural.width, natural.height)
      const base =
        zonesDoc ??
        withFloorPlanVariants({
          floor,
          typologyCode,
          imageUrl: imageUrl ? imageUrl.split('?')[0] : null,
          imageWidth: natural.width,
          imageHeight: natural.height,
          variants: {
            '2d': { imageUrl: null, htmlUrl: null, imageWidth: 1, imageHeight: 1 },
            '3d': { imageUrl: null, htmlUrl: null, imageWidth: 1, imageHeight: 1 },
          },
          align: {
            '2d': { ...DEFAULT_OVERLAY_ALIGN },
            '3d': { ...DEFAULT_OVERLAY_ALIGN },
          },
          zones,
          updatedAt: new Date().toISOString(),
        })
      const variants = {
        ...base.variants,
        [planVariant]: {
          imageUrl: imageUrl ? imageUrl.split('?')[0] : null,
          htmlUrl: htmlUrl ? htmlUrl.split('?')[0] : null,
          imageWidth: natural.width,
          imageHeight: natural.height,
        },
      }
      const preferred = floorPlanVariantHasMedia(variants['2d']) ? variants['2d'] : variants['3d']
      const doc: FloorPlanZonesDoc = {
        ...base,
        floor,
        typologyCode,
        variants,
        align: {
          '2d': parseOverlayAlign(base.align?.['2d']),
          '3d': parseOverlayAlign(base.align?.['3d']),
        },
        imageUrl: preferred.imageUrl,
        imageWidth: preferred.imageWidth || natural.width,
        imageHeight: preferred.imageHeight || natural.height,
        zones,
        updatedAt: new Date().toISOString(),
      }
      const res = await fetch('/api/floor-plan-zones', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ doc }),
      })
      const json = (await res.json()) as { doc?: FloorPlanZonesDoc; error?: string }
      if (!res.ok && res.status === 401) {
        await ensureAuthCookies()
        const retry = await fetch('/api/floor-plan-zones', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ doc }),
        })
        const retryJson = (await retry.json()) as { doc?: FloorPlanZonesDoc; error?: string }
        if (!retry.ok) throw new Error(retryJson.error || 'No se pudo guardar')
        if (retryJson.doc) setZonesDoc(withFloorPlanVariants(retryJson.doc))
      } else {
        if (!res.ok) throw new Error(json.error || 'No se pudo guardar')
        if (json.doc) setZonesDoc(withFloorPlanVariants(json.doc))
      }
      await refreshSummaries()
      toast.success(
        `${floorPlanLevelLabel(floor)}: ${apartments.length} zona(s) guardada(s) · valen para 2D y 3D`,
      )
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
          Dibujá en <span className="font-medium text-[#3a3d36]">2D</span>. En{' '}
          <span className="font-medium text-[#3a3d36]">3D</span> subí el HTML interactivo (o una
          imagen); las mismas zonas se reutilizan. Si quedan corridas, usá el ajuste fino.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10">
        {floorSummaries.map((item) => {
          const active = item.floor === floor
          const label = floorPlanLevelLabel(item.floor)
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
                    alt={label}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[#b0b3ab]">
                    <ImagePlus size={18} />
                  </div>
                )}
              </div>
              <div className="space-y-0.5 px-2 py-1.5">
                <p className="text-xs font-semibold leading-snug text-[#3a3d36]">{label}</p>
                <p className="text-[11px] text-[#8a8d87]">
                  {item.zoneCount ? `${item.zoneCount} zona(s)` : 'Sin zonas'}
                  {item.imageUrl2d || item.imageUrl3d
                    ? ` · ${[item.imageUrl2d ? '2D' : null, item.imageUrl3d ? '3D' : null].filter(Boolean).join('+')}`
                    : ' · Sin plano'}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      <div className="rounded-xl border border-[#2B1A18]/10 bg-[#fafaf7] p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[#3a3d36]">{floorPlanLevelLabel(floor)}</p>
            <p className="text-xs text-[#8a8d87]">
              {imageUrl
                ? `${apartments.length} zona(s) · plano ${planVariant.toUpperCase()}`
                : `Sin ${planVariant.toUpperCase()} — las zonas se comparten igual`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[#2B1A18]/12 bg-white p-0.5">
              {(['2d', '3d'] as const).map((item) => {
                const active = planVariant === item
                const has =
                  item === '2d'
                    ? Boolean(currentSummary?.imageUrl2d)
                    : Boolean(currentSummary?.imageUrl3d || currentSummary?.htmlUrl3d)
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => void switchPlanVariant(item)}
                    className={cn(
                      'rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
                      active
                        ? 'bg-[#1a2744] text-white'
                        : 'text-[#555850] hover:bg-[#f4f4ef]',
                    )}
                    title={
                      has
                        ? `Ver plano ${item.toUpperCase()}`
                        : `Sin foto ${item.toUpperCase()} aún`
                    }
                  >
                    {item}
                    {!has ? ' ·' : ''}
                  </button>
                )
              })}
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={!typologyCode || uploading || loading || removing}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} className="mr-1.5" />
              {imageUrl || htmlUrl
                ? `Reemplazar ${planVariant.toUpperCase()}`
                : `Subir ${planVariant.toUpperCase()}`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!(imageUrl || htmlUrl) || uploading || loading || removing}
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
              : planVariant === '3d'
                ? `Arrastrá acá el HTML interactivo o una imagen 3D de ${floorPlanLevelLabel(floor)}`
                : `Arrastrá acá el plano 2D de ${floorPlanLevelLabel(floor)}, o usá “Subir”`}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={
              planVariant === '3d'
                ? 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif,.html,text/html'
                : 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif'
            }
            className="hidden"
            disabled={!typologyCode || uploading}
            onChange={(e) => void uploadFloorImage(e.target.files)}
          />
        </div>

        {planVariant === '3d' && (imageUrl || htmlUrl) ? (
          <div className="mt-3 rounded-lg border border-[#2B1A18]/10 bg-white px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold text-[#3a3d36]">Ajuste fino 3D</p>
              <span className="text-[11px] text-[#8a8d87]">
                Mueve solo las zonas (no la foto). Después tocá Guardar.
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="secondary"
                onClick={() => nudgeOverlayAlign({ offsetX: overlayAlign.offsetX - 0.4 })}
                aria-label="Mover zonas a la izquierda"
              >
                <ArrowLeft size={14} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => nudgeOverlayAlign({ offsetX: overlayAlign.offsetX + 0.4 })}
                aria-label="Mover zonas a la derecha"
              >
                <ArrowRight size={14} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => nudgeOverlayAlign({ offsetY: overlayAlign.offsetY - 0.4 })}
                aria-label="Mover zonas arriba"
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => nudgeOverlayAlign({ offsetY: overlayAlign.offsetY + 0.4 })}
                aria-label="Mover zonas abajo"
              >
                <ArrowDown size={14} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => nudgeOverlayAlign({ scale: overlayAlign.scale - 0.01 })}
                aria-label="Achicar zonas"
              >
                <Minus size={14} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => nudgeOverlayAlign({ scale: overlayAlign.scale + 0.01 })}
                aria-label="Agrandar zonas"
              >
                <Plus size={14} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => nudgeOverlayAlign({ ...DEFAULT_OVERLAY_ALIGN })}
              >
                Reset
              </Button>
              <span className="text-[11px] tabular-nums text-[#8a8d87]">
                x {overlayAlign.offsetX.toFixed(1)} · y {overlayAlign.offsetY.toFixed(1)} · ×
                {overlayAlign.scale.toFixed(2)}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {draftPoints == null ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={startPointDraw}
              disabled={!natural || !imageUrl || loading}
            >
              <PenLine size={14} className="mr-1.5" />
              Dibujar punto a punto
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!selected}
              onClick={() => {
                setSelectedId(null)
                setEditMode(false)
              }}
            >
              Listo
            </Button>
            {selected ? (
              <p className="w-full text-xs text-[#555850] sm:w-auto">
                Clic zona → puntos · arrastrar “+” = curva · doble clic “+” = agregar punto · clic
                derecho en curva = recta · clic derecho en punto = borrar · Guardar al terminar
              </p>
            ) : null}
            <Button type="button" variant="secondary" disabled={!selected} onClick={deleteSelected}>
              <Trash2 size={14} className="mr-1.5" />
              Quitar zona
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-[#555850]">
              Clic = punto · doble clic / Enter = cerrar · clic en el 1º = cerrar · Backspace = deshacer
              · Esc = cancelar
              {draftPoints.length > 0 ? ` · ${draftPoints.length} punto(s)` : ''}
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={!draftPoints.length}
              onClick={undoDraftPoint}
            >
              Deshacer punto
            </Button>
            <Button
              type="button"
              onClick={closeDraftIfReady}
              disabled={draftPoints.length < 3}
            >
              Cerrar zona ({draftPoints.length})
            </Button>
            <Button type="button" variant="secondary" onClick={cancelPointDraw}>
              Cancelar
            </Button>
          </>
        )}
        <Button
          type="button"
          onClick={() => void onSave()}
          disabled={saving || loading || !natural || !imageUrl || draftPoints != null}
        >
          <Save size={14} className="mr-1.5" />
          {saving ? 'Guardando…' : 'Guardar zonas'}
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            disabled={!imageUrl}
            onClick={() => zoomBy(0.8)}
            aria-label="Alejar"
            title="Alejar"
          >
            <Minus size={14} />
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!imageUrl}
            onClick={() => zoomBy(1.25)}
            aria-label="Acercar"
            title="Acercar"
          >
            <Plus size={14} />
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!imageUrl || !natural}
            onClick={resetView}
          >
            Ajustar
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!imageUrl || !natural}
            onClick={() => setFullscreen(true)}
            title="Pantalla completa"
          >
            <Maximize2 size={14} className="mr-1.5" />
            Pantalla completa
          </Button>
          <span className="px-1 text-[11px] tabular-nums text-[#8a8d87]">
            {Math.round(scale * 100)}%
          </span>
        </div>
      </div>

      {selected && draftPoints == null ? (
        <div
          className={cn(
            'space-y-2 rounded-xl border p-3',
            assignOpen
              ? 'border-[#787D62] bg-[#787D62]/10'
              : 'border-[#2B1A18]/10 bg-[#fafaf7]',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[#3a3d36]">
              {assignOpen ? 'Asignar unidad a esta zona' : `Zona · ${selected.id}`}
            </p>
            {!assignOpen ? (
              <Button type="button" variant="secondary" onClick={() => setAssignOpen(true)}>
                Cambiar unidad
              </Button>
            ) : null}
          </div>
          {assignOpen ? (
            <>
              <Select
                label="Unidad"
                placeholder={
                  unitOptions.length
                    ? 'Seleccioná una unidad…'
                    : 'No hay unidades cargadas'
                }
                options={unitOptions}
                value={
                  unitOptions.some((item) => item.value === selected.id) ? selected.id : ''
                }
                onChange={(e) => {
                  if (e.target.value) assignUnit(e.target.value)
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                {unitsOnFloor.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs text-[#787D62] underline-offset-2 hover:underline"
                    onClick={() => setShowAllUnits((v) => !v)}
                  >
                    {showAllUnits
                      ? `Ver solo ${floorPlanLevelLabel(floor)}`
                      : 'Ver todas las unidades'}
                  </button>
                ) : (
                  <span className="text-xs text-[#8a8d87]">
                    Mostrando todas (ninguna filtrada por este nivel)
                  </span>
                )}
                <span className="text-xs text-[#8a8d87]">o escribí el código:</span>
                <input
                  value={selected.id}
                  onChange={(e) => renameSelected(e.target.value)}
                  placeholder="Ej. 208"
                  className="h-8 w-28 rounded-md border border-[#2B1A18]/12 bg-white px-2 text-sm text-[#2B1A18]"
                />
                <Button type="button" variant="secondary" onClick={() => setAssignOpen(false)}>
                  Listo
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <div ref={fullscreen ? undefined : viewerBoxRef} className="h-[min(62dvh,640px)]">
        {!fullscreen && htmlUrl ? (
          <div className="overflow-hidden rounded-xl border border-[#2B1A18]/10 bg-white">
            <iframe
              key={`floor-html-${typologyCode}-${floor}-${zonesDoc?.updatedAt || ''}-${htmlPreviewNonce}`}
              src={`/api/tour/floor-plan-html?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}&v=${encodeURIComponent(zonesDoc?.updatedAt || String(Date.now()))}&fresh=1&_=${htmlPreviewNonce}`}
              title="Vista previa HTML 3D"
              className="h-[min(52vh,420px)] w-full border-0"
              style={{ pointerEvents: 'none' }}
            />
            <p className="border-t border-[#2B1A18]/8 px-3 py-2 text-xs text-[#8a8d87]">
              Vista previa del HTML. Las zonas se dibujan en 2D; acá solo alineás el overlay.
            </p>
          </div>
        ) : null}
        {!fullscreen && natural && imageUrl ? (
          <FloorPlanViewer
            imageUrl={imageUrl}
            width={natural.width}
            height={natural.height}
            apartments={apartments}
            selectedId={selectedId}
            editMode={editMode}
            draftPoints={draftPoints}
            onDraftPointsChange={setDraftPoints}
            onDraftComplete={completeDraft}
            onSelect={(id) => {
              if (draftPoints != null) return
              setSelectedId(id)
              if (id) {
                setAssignOpen(false)
                setEditMode(true)
              }
            }}
            onApartmentsChange={setApartments}
            scale={scale}
            offset={offset}
            onScaleChange={(next) => setScale(clampScale(next))}
            onOffsetChange={setOffset}
            overlayAlign={overlayAlign}
          />
        ) : !fullscreen ? (
          <div className="flex h-full items-center justify-center rounded-2xl bg-[#f4f4ef] text-sm text-[#8a8d87]">
            {loading ? 'Cargando piso…' : 'Subí una foto del plano para este piso'}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl bg-[#f4f4ef] text-sm text-[#8a8d87]">
            Editor en pantalla completa
          </div>
        )}
      </div>

      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {apartments.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => selectZone(item.id, true)}
              className={cn(
                'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm',
                selectedId === item.id
                  ? 'border-[#787D62] bg-[#787D62]/10 text-[#3a3d36]'
                  : 'border-[#2B1A18]/10 bg-white text-[#555850]',
              )}
            >
              <span className="font-medium">{item.id}</span>
              <span className="text-xs text-[#8a8d87]">
                {item.kind === 'circle' ? 'redonda' : `${item.polygon.length} pts`}
                {item.curves?.some(Boolean) ? ' · curvas' : ''}
              </span>
            </button>
          </li>
        ))}
        {apartments.length === 0 && !loading ? (
          <li className="text-xs text-[#8a8d87] sm:col-span-2 lg:col-span-3">
            Todavía no hay zonas. Usá “Dibujar punto a punto”. Arrastrá “+” para curvar; doble clic en “+” para agregar puntos.
          </li>
        ) : null}
      </ul>

      {fullscreen && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex flex-col bg-[#14110e] p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-white/95 px-3 py-2 shadow-lg">
                <p className="mr-2 text-sm font-semibold text-[#3a3d36]">
                  {floorPlanLevelLabel(floor)} · zonas
                </p>
                {draftPoints == null ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={startPointDraw}
                      disabled={!natural || !imageUrl || loading}
                    >
                      <PenLine size={14} className="mr-1.5" />
                      Punto a punto
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!selected}
                      onClick={() => {
                        setSelectedId(null)
                        setEditMode(false)
                      }}
                    >
                      Listo
                    </Button>
                    {selected ? (
                      <span className="text-xs text-[#555850]">
                        Arrastrar “+” = curva · doble clic “+” = punto
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!selected}
                      onClick={deleteSelected}
                    >
                      <Trash2 size={14} className="mr-1.5" />
                      Quitar
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-[#555850]">
                      {draftPoints.length} pts · Enter cierra · Esc cancela
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!draftPoints.length}
                      onClick={undoDraftPoint}
                    >
                      Deshacer
                    </Button>
                    <Button
                      type="button"
                      onClick={closeDraftIfReady}
                      disabled={draftPoints.length < 3}
                    >
                      Cerrar ({draftPoints.length})
                    </Button>
                    <Button type="button" variant="secondary" onClick={cancelPointDraw}>
                      Cancelar
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  onClick={() => void onSave()}
                  disabled={saving || loading || !natural || !imageUrl || draftPoints != null}
                >
                  <Save size={14} className="mr-1.5" />
                  {saving ? 'Guardando…' : 'Guardar'}
                </Button>
                {selected && draftPoints == null ? (
                  <div className="flex min-w-[220px] flex-1 flex-wrap items-center gap-2">
                    <div className="min-w-[200px] flex-1">
                      <Select
                        label={assignOpen ? 'Asignar unidad' : 'Unidad'}
                        placeholder="Seleccioná unidad…"
                        options={unitOptions}
                        value={
                          unitOptions.some((item) => item.value === selected.id)
                            ? selected.id
                            : ''
                        }
                        onChange={(e) => {
                          if (e.target.value) assignUnit(e.target.value)
                        }}
                      />
                    </div>
                    {unitsOnFloor.length > 0 ? (
                      <button
                        type="button"
                        className="text-[11px] text-[#787D62] underline-offset-2 hover:underline"
                        onClick={() => setShowAllUnits((v) => !v)}
                      >
                        {showAllUnits ? 'Solo este nivel' : 'Todas'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <Button type="button" variant="secondary" onClick={() => zoomBy(0.8)}>
                    <Minus size={14} />
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => zoomBy(1.25)}>
                    <Plus size={14} />
                  </Button>
                  <Button type="button" variant="secondary" onClick={resetView}>
                    Ajustar
                  </Button>
                  <span className="px-1 text-[11px] tabular-nums text-[#8a8d87]">
                    {Math.round(scale * 100)}%
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setDraftPoints(null)
                      setFullscreen(false)
                    }}
                  >
                    <Minimize2 size={14} className="mr-1.5" />
                    Salir
                  </Button>
                </div>
              </div>
              <div ref={viewerBoxRef} className="min-h-0 flex-1">
                {natural && imageUrl ? (
                  <FloorPlanViewer
                    imageUrl={imageUrl}
                    width={natural.width}
                    height={natural.height}
                    apartments={apartments}
                    selectedId={selectedId}
                    editMode={editMode}
                    draftPoints={draftPoints}
                    onDraftPointsChange={setDraftPoints}
                    onDraftComplete={completeDraft}
                    onSelect={(id) => {
                      if (draftPoints != null) return
                      setSelectedId(id)
                      if (id) {
                        setAssignOpen(false)
                        setEditMode(true)
                      }
                    }}
                    onApartmentsChange={setApartments}
                    scale={scale}
                    offset={offset}
                    onScaleChange={(next) => setScale(clampScale(next))}
                    onOffsetChange={setOffset}
                    overlayAlign={overlayAlign}
                  />
                ) : null}
              </div>
              <p className="mt-2 text-center text-[11px] text-white/55">
                {draftPoints != null
                  ? 'Dibujo libre: clic en cada esquina · doble clic o Enter para cerrar · arrastrá para pan'
                  : 'Esc para salir · arrastrá el plano · rueda para zoom'}
              </p>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
