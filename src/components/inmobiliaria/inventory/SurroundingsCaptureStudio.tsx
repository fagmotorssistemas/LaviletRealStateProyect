'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import {
  FLOOR_PLAN_DEFAULT_FLOOR,
  FLOOR_PLAN_LEVELS,
  floorPlanLevelLabel,
  floorPlanStorageKey,
} from '@/lib/tour/floorPlanHotspots'
import {
  DEFAULT_SURROUNDINGS_LAYER,
  type FloorPlanSurroundingsDoc,
  type SurroundingsLayer,
} from '@/lib/tour/floorPlanSurroundingsShared'
import { cn } from '@/lib/utils'
import { createClient as createBrowserSupabase } from '@/lib/supabase/client'

type Target = 'background' | 'plan'
type LocalShot = { url: string; width: number; height: number }

async function ensureAuthCookies() {
  const supabase = createBrowserSupabase()
  const { data, error } = await supabase.auth.getUser()
  if (data.user && !error) return
  const refreshed = await supabase.auth.refreshSession()
  if (refreshed.error || !refreshed.data.session) {
    throw new Error('Sesión vencida. Volvé a iniciar sesión.')
  }
}

function loadDrawable(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image()
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo leer la imagen para la captura'))
    img.src = url
  })
}

function downloadBlob(blob: Blob, name: string) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

function readImage(file: File) {
  const url = URL.createObjectURL(file)
  return new Promise<{ url: string; width: number; height: number }>((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen'))
    }
    img.src = url
  })
}

type SurroundingsCaptureStudioProps = {
  typologyCode: string
}

export function SurroundingsCaptureStudio({ typologyCode }: SurroundingsCaptureStudioProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const planInputRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<number | null>(null)
  const planFilesRef = useRef<Record<string, File>>({})
  const layersRef = useRef({
    background: DEFAULT_SURROUNDINGS_LAYER,
    planLayer: DEFAULT_SURROUNDINGS_LAYER,
    target: 'plan' as Target,
  })
  const [doc, setDoc] = useState<FloorPlanSurroundingsDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<'background' | 'plan' | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [floor, setFloor] = useState(FLOOR_PLAN_DEFAULT_FLOOR)
  const [target, setTarget] = useState<Target>('plan')
  const [stepPx, setStepPx] = useState(1)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [background, setBackground] = useState<SurroundingsLayer>(DEFAULT_SURROUNDINGS_LAYER)
  const [planLayer, setPlanLayer] = useState<SurroundingsLayer>(DEFAULT_SURROUNDINGS_LAYER)
  const [localBackground, setLocalBackground] = useState<LocalShot | null>(null)
  const [localPlans, setLocalPlans] = useState<Record<string, LocalShot>>({})

  const floorKey = floorPlanStorageKey(floor)
  const savedPlan = doc?.plans?.[floorKey] ?? null
  const localPlan = localPlans[floorKey] ?? null
  const backgroundUrl = localBackground?.url ?? (doc?.originalUrl
    ? `${doc.originalUrl}${doc.originalUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(doc.updatedAt)}`
    : null)
  const backgroundSize = localBackground ?? (doc?.originalUrl
    ? { width: doc.originalWidth, height: doc.originalHeight }
    : null)
  const planUrl = localPlan?.url ?? (savedPlan
    ? `${savedPlan.url}${savedPlan.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(doc?.updatedAt || '')}`
    : null)

  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      setStage({ w: rect.width, h: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch(`/api/floor-plan-surroundings?typology_code=${encodeURIComponent(typologyCode)}`, {
      credentials: 'same-origin',
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { doc?: FloorPlanSurroundingsDoc | null }
        if (cancelled || !res.ok || !json.doc) return
        setDoc(json.doc)
        setBackground(json.doc.background)
        setPlanLayer(json.doc.planLayer)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [typologyCode])

  const persistLayers = useCallback(
    (nextBackground: SurroundingsLayer, nextPlan: SurroundingsLayer) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void fetch('/api/floor-plan-surroundings', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            typology_code: typologyCode,
            background: nextBackground,
            planLayer: nextPlan,
          }),
        })
      }, 400)
    },
    [typologyCode],
  )

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (target === 'background') {
        setBackground((current) => {
          const next = { ...current, x: current.x + dx, y: current.y + dy }
          setPlanLayer((plan) => {
            persistLayers(next, plan)
            return plan
          })
          return next
        })
        return
      }
      setPlanLayer((current) => {
        const next = { ...current, x: current.x + dx, y: current.y + dy }
        setBackground((bg) => {
          persistLayers(bg, next)
          return bg
        })
        return next
      })
    },
    [persistLayers, target],
  )

  layersRef.current = { background, planLayer, target }

  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const { background: bg, planLayer: plan, target: which } = layersRef.current
      const factor = event.deltaY > 0 ? 0.92 : 1.08
      const nextScale = (value: number) => Math.min(4, Math.max(0.25, value * factor))
      if (which === 'background') {
        const next = { ...bg, scale: nextScale(bg.scale) }
        setBackground(next)
        persistLayers(next, plan)
        return
      }
      const next = { ...plan, scale: nextScale(plan.scale) }
      setPlanLayer(next)
      persistLayers(bg, next)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [persistLayers])

  const setScale = (scale: number) => {
    const nextScale = Math.min(4, Math.max(0.25, scale))
    if (target === 'background') {
      const next = { ...background, scale: nextScale }
      setBackground(next)
      persistLayers(next, planLayer)
      return
    }
    const next = { ...planLayer, scale: nextScale }
    setPlanLayer(next)
    persistLayers(background, next)
  }

  const setRotation = (degrees: number) => {
    if (!Number.isFinite(degrees)) return
    let rotation = degrees % 360
    if (rotation > 180) rotation -= 360
    if (rotation < -180) rotation += 360
    if (target === 'background') {
      const next = { ...background, rotation }
      setBackground(next)
      persistLayers(next, planLayer)
      return
    }
    const next = { ...planLayer, rotation }
    setPlanLayer(next)
    persistLayers(background, next)
  }

  const capture = async () => {
    if (!backgroundUrl || !backgroundSize || !planUrl || stage.w < 2 || stage.h < 2 || bgW < 2) {
      toast.error('Subí el fondo y el plano del piso antes de capturar.')
      return
    }
    const planNatW = localPlan?.width ?? savedPlan?.width ?? 1
    const planNatH = localPlan?.height ?? savedPlan?.height ?? 1
    const planFit = planBox > 0 ? Math.min(planBox / planNatW, planBox / planNatH) : 0
    const planDrawW = planNatW * planFit
    const planDrawH = planNatH * planFit
    if (planDrawW < 2 || planDrawH < 2) {
      toast.error('El plano no tiene un tamaño válido.')
      return
    }
    const exportScale = Math.min(backgroundSize.width / bgW, 4096 / Math.max(stage.w, stage.h))
    const canvasW = Math.max(2, Math.round(stage.w * exportScale))
    const canvasH = Math.max(2, Math.round(stage.h * exportScale))
    const bgLeft = (stage.w - bgW) / 2 + background.x
    const bgTop = (stage.h - bgH) / 2 + background.y
    const planLeft = (stage.w - planBox) / 2 + planLayer.x
    const planTop = (stage.h - planBox) / 2 + planLayer.y
    setCapturing(true)
    try {
      const [bgImage, planImage] = await Promise.all([loadDrawable(backgroundUrl), loadDrawable(planUrl)])
      const canvas = document.createElement('canvas')
      canvas.width = canvasW
      canvas.height = canvasH
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No se pudo armar la captura')
      ctx.fillStyle = '#14110e'
      ctx.fillRect(0, 0, canvasW, canvasH)
      const bgCx = (bgLeft + bgW / 2) * exportScale
      const bgCy = (bgTop + bgH / 2) * exportScale
      ctx.save()
      ctx.translate(bgCx, bgCy)
      ctx.rotate(((background.rotation || 0) * Math.PI) / 180)
      ctx.drawImage(bgImage, (-bgW * exportScale) / 2, (-bgH * exportScale) / 2, bgW * exportScale, bgH * exportScale)
      ctx.restore()
      const box = planBox * exportScale
      const cx = planLeft * exportScale + box / 2
      const cy = planTop * exportScale + box / 2
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(((planLayer.rotation || 0) * Math.PI) / 180)
      ctx.drawImage(
        planImage,
        (-planDrawW * exportScale) / 2,
        (-planDrawH * exportScale) / 2,
        planDrawW * exportScale,
        planDrawH * exportScale,
      )
      ctx.restore()
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('No se pudo crear el archivo'))),
          'image/webp',
          0.92,
        )
      })
      downloadBlob(blob, `alrededores-${floorKey}.webp`)
      toast.success('Se descargó la captura con el fondo y el piso girado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo capturar')
    } finally {
      setCapturing(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const step = event.shiftKey ? stepPx * 10 : stepPx
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        nudge(-step, 0)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        nudge(step, 0)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        nudge(0, -step)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        nudge(0, step)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nudge, stepPx])

  const upload = async (role: 'background' | 'plan', file: File | undefined) => {
    if (!file) return
    setUploading(role)
    try {
      const shot = await readImage(file)
      if (role === 'plan') planFilesRef.current[floorKey] = file
      if (role === 'background') {
        setLocalBackground((prev) => {
          if (prev) URL.revokeObjectURL(prev.url)
          return shot
        })
      } else {
        setLocalPlans((prev) => {
          const old = prev[floorKey]
          if (old) URL.revokeObjectURL(old.url)
          return { ...prev, [floorKey]: shot }
        })
      }
      await ensureAuthCookies()
      const body = new FormData()
      body.set('typology_code', typologyCode)
      body.set('role', role)
      body.set('file', file)
      if (role === 'plan') body.set('floor', String(floor))
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 90_000)
      let res: Response
      try {
        res = await fetch('/api/floor-plan-surroundings', {
          method: 'POST',
          body,
          credentials: 'same-origin',
          signal: controller.signal,
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error('La subida tardó demasiado. Probá de nuevo; la foto ya se ve en el visor.')
        }
        throw error
      } finally {
        window.clearTimeout(timer)
      }
      const json = (await res.json().catch(() => ({}))) as {
        doc?: FloorPlanSurroundingsDoc
        error?: string
      }
      if (!res.ok || !json.doc) throw new Error(json.error || 'No se pudo guardar')
      setDoc(json.doc)
      toast.success(role === 'plan' ? `Plano de ${floorPlanLevelLabel(floor)} listo para superponer` : 'Fondo guardado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo subir')
    } finally {
      setUploading(null)
      if (role === 'background' && backgroundInputRef.current) backgroundInputRef.current.value = ''
      if (role === 'plan' && planInputRef.current) planInputRef.current.value = ''
    }
  }

  const active = target === 'background' ? background : planLayer
  const bgFit = backgroundSize && stage.w > 0
    ? Math.min(stage.w / backgroundSize.width, stage.h / backgroundSize.height)
    : 1
  const bgW = backgroundSize ? backgroundSize.width * bgFit * background.scale : 0
  const bgH = backgroundSize ? backgroundSize.height * bgFit * background.scale : 0
  const planBox = Math.round(Math.min(stage.w, stage.h) * 0.62 * planLayer.scale)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" disabled={uploading !== null || capturing} onClick={() => backgroundInputRef.current?.click()}>
            <Upload size={14} className="mr-1.5" />
            {uploading === 'background' ? 'Guardando fondo…' : backgroundUrl ? 'Reemplazar fondo' : 'Subir fondo'}
          </Button>
          <label className="flex items-center gap-2 text-xs text-[#555850]">
            Piso
            <select
              value={String(floor)}
              onChange={(event) => setFloor(Number(event.target.value))}
              className="h-9 max-w-[220px] rounded-md border border-[#2B1A18]/15 bg-white px-2 text-sm text-[#3a3d36]"
            >
              {FLOOR_PLAN_LEVELS.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.shortLabel} · {level.label}
                  {doc?.plans?.[level.storageKey] || localPlans[level.storageKey] ? '' : ' · sin plano'}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="secondary" disabled={uploading !== null || capturing} onClick={() => planInputRef.current?.click()}>
            <Upload size={14} className="mr-1.5" />
            {uploading === 'plan' ? 'Guardando plano…' : planUrl ? 'Reemplazar plano' : 'Subir plano'}
          </Button>
          <Button
            type="button"
            disabled={!backgroundUrl || !planUrl || capturing || !backgroundSize}
            onClick={() => void capture()}
          >
            <Camera size={14} className="mr-1.5" />
            {capturing ? 'Capturando…' : 'Capturar copia'}
          </Button>
          <input
            ref={backgroundInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(event) => void upload('background', event.target.files?.[0])}
          />
          <input
            ref={planInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(event) => void upload('plan', event.target.files?.[0])}
          />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[#2B1A18]/12 bg-white p-0.5">
            {([
              ['background', 'Fondo'],
              ['plan', 'Plano'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTarget(id)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-xs font-semibold',
                  target === id ? 'bg-[#1a2744] text-white' : 'text-[#555850] hover:bg-[#f4f4ef]',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex min-w-[160px] flex-1 items-center gap-2 text-xs text-[#555850]">
            Zoom
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.01}
              value={active.scale}
              onChange={(event) => setScale(Number(event.target.value))}
              className="min-w-[90px] flex-1"
            />
            <span className="w-10 tabular-nums">{Math.round(active.scale * 100)}%</span>
          </label>
          <label className="flex min-w-[150px] items-center gap-2 text-xs text-[#555850]">
            Paso
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={stepPx}
              onChange={(event) => setStepPx(Number(event.target.value))}
              className="min-w-[72px] flex-1"
              aria-label="Sensibilidad del movimiento"
            />
            <span className="w-8 tabular-nums">{stepPx}px</span>
          </label>
          <Button type="button" variant="secondary" onClick={() => nudge(0, -stepPx)} aria-label="Subir">
            <ArrowUp size={14} />
          </Button>
          <Button type="button" variant="secondary" onClick={() => nudge(0, stepPx)} aria-label="Bajar">
            <ArrowDown size={14} />
          </Button>
          <Button type="button" variant="secondary" onClick={() => nudge(-stepPx, 0)} aria-label="Izquierda">
            <ArrowLeft size={14} />
          </Button>
          <Button type="button" variant="secondary" onClick={() => nudge(stepPx, 0)} aria-label="Derecha">
            <ArrowRight size={14} />
          </Button>
          <label className="flex min-w-[200px] flex-1 items-center gap-2 text-xs text-[#555850]">
            Giro del {target === 'background' ? 'fondo' : 'plano'}
            <input
              type="range"
              min={-180}
              max={180}
              step={0.1}
              value={active.rotation || 0}
              onChange={(event) => setRotation(Number(event.target.value))}
              className="min-w-[80px] flex-1"
            />
            <input
              type="number"
              step={0.1}
              value={Number((active.rotation || 0).toFixed(1))}
              onChange={(event) => setRotation(Number(event.target.value))}
              className="h-8 w-16 rounded-md border border-[#2B1A18]/15 bg-white px-1.5 text-sm tabular-nums text-[#3a3d36]"
              aria-label="Grados de la capa elegida"
            />
            °
          </label>
      </div>

      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-[#14110e]"
        style={{ overscrollBehavior: 'none' }}
      >
        {backgroundUrl && backgroundSize ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backgroundUrl}
            alt="Fondo de alrededores"
            draggable={false}
            className="absolute max-w-none select-none"
            style={{
              width: bgW,
              height: bgH,
              left: (stage.w - bgW) / 2 + background.x,
              top: (stage.h - bgH) / 2 + background.y,
              transform: `rotate(${background.rotation || 0}deg)`,
              transformOrigin: 'center center',
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/70">
            {loading ? 'Cargando…' : 'Subí la foto real de los alrededores'}
          </div>
        )}
        {planUrl && planBox > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={planUrl}
            alt={`Plano ${floorPlanLevelLabel(floor)}`}
            draggable={false}
            className="pointer-events-none absolute object-contain"
            style={{
              width: planBox,
              height: planBox,
              left: (stage.w - planBox) / 2 + planLayer.x,
              top: (stage.h - planBox) / 2 + planLayer.y,
              transform: `rotate(${planLayer.rotation || 0}deg)`,
              transformOrigin: 'center center',
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
