'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Viewer, events } from '@photo-sphere-viewer/core'
import { MarkersPlugin, events as markerEvents } from '@photo-sphere-viewer/markers-plugin'
import { toast } from 'sonner'
import { roomHotspotHtml } from '@/components/tour/createTourArrow'
import { Select } from '@/components/ui/Select'
import type { TourPlacedHotspot } from '@/types/tour'
import { cn } from '@/lib/utils'
import '@photo-sphere-viewer/core/index.css'
import '@photo-sphere-viewer/markers-plugin/index.css'
import '@/components/tour/tour-viewer.css'

type RoomOption = { slug: string; label: string; url: string | null }

export function TypologyHotspotEditor({
  typologyCode,
  rooms,
}: {
  typologyCode: string
  rooms: RoomOption[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const [hotspots, setHotspots] = useState<TourPlacedHotspot[]>([])
  const [editRoom, setEditRoom] = useState(rooms[0]?.slug ?? '')
  const [pending, setPending] = useState<{ yaw: number; pitch: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [panoError, setPanoError] = useState(false)
  const selectedIdRef = useRef<string | null>(null)
  const hotspotsRef = useRef(hotspots)
  const saveTimerRef = useRef<number | null>(null)
  const markerPickRef = useRef(0)
  const endDragRef = useRef<(() => void) | null>(null)
  selectedIdRef.current = selectedId
  hotspotsRef.current = hotspots

  const withPano = rooms.filter((item) => Boolean(item.url))
  const current = withPano.find((item) => item.slug === editRoom) ?? withPano[0]
  const panoUrl = current?.url ?? null
  const here = current?.slug ?? ''
  const targets = withPano.filter((item) => item.slug !== here)
  const herePoints = hotspots.filter((item) => item.from === here)
  const herePointsRef = useRef(herePoints)
  herePointsRef.current = herePoints

  const revisionRef = useRef(0)
  const persist = useCallback(
    async (next: TourPlacedHotspot[]) => {
      const revision = revisionRef.current
      setSaving(true)
      try {
        const res = await fetch('/api/typology-hotspots', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ typology_code: typologyCode, hotspots: next }),
        })
        const payload = (await res.json().catch(() => null)) as { hotspots?: TourPlacedHotspot[]; error?: string } | null
        if (!res.ok) throw new Error(payload?.error || 'No se pudieron guardar los puntos')
        if (revision === revisionRef.current) setHotspots(payload?.hotspots ?? next)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudieron guardar los puntos')
      } finally {
        if (revision === revisionRef.current) setSaving(false)
      }
    },
    [typologyCode],
  )

  const queueSave = useCallback(
    (next: TourPlacedHotspot[]) => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        void persist(next)
      }, 350)
    },
    [persist],
  )

  const markerFor = useCallback((item: TourPlacedHotspot) => ({
    id: item.id,
    position: { yaw: item.yaw, pitch: item.pitch },
    html: roomHotspotHtml(item.label, item.kind === 'look' ? 'look' : 'go', item.id === selectedIdRef.current),
    anchor: 'center center' as const,
    size: { width: 92, height: 78 },
    tooltip: item.label,
    className: 'psv--capture-event',
  }), [])

  const applyPosition = useCallback(
    (id: string, yaw: number, pitch: number, commit: boolean) => {
      let nextYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
      if (nextYaw < 0) nextYaw += Math.PI * 2
      const nextPitch = Math.max(-1.2, Math.min(1.2, pitch))
      const next = hotspotsRef.current.map((item) =>
        item.id === id ? { ...item, yaw: nextYaw, pitch: nextPitch } : item,
      )
      hotspotsRef.current = next
      const moved = next.find((item) => item.id === id)
      const markers = viewerRef.current?.getPlugin<MarkersPlugin>(MarkersPlugin)
      if (markers && moved) {
        try {
          markers.updateMarker(markerFor(moved))
        } catch {
          markers.setMarkers(next.filter((item) => item.from === moved.from).map((item) => markerFor(item)))
        }
      }
      if (!commit) return
      revisionRef.current += 1
      setHotspots(next)
      queueSave(next)
    },
    [markerFor, queueSave],
  )
  const applyPositionRef = useRef(applyPosition)
  applyPositionRef.current = applyPosition
  const draggingRef = useRef(false)

  const nudgeSelected = useCallback(
    (dyaw: number, dpitch: number) => {
      const id = selectedIdRef.current
      const item = hotspotsRef.current.find((point) => point.id === id)
      if (!item) return
      applyPosition(item.id, item.yaw + dyaw, item.pitch + dpitch, true)
    },
    [applyPosition],
  )

  useEffect(() => {
    const ready = rooms.filter((item) => Boolean(item.url))
    if (!ready.some((item) => item.slug === editRoom)) {
      setEditRoom(ready[0]?.slug ?? '')
    }
  }, [rooms, editRoom])

  useEffect(() => {
    if (!typologyCode) {
      setHotspots([])
      return
    }
    let cancelled = false
    setLoading(true)
    setPending(null)
    void fetch(`/api/typology-hotspots?typology_code=${encodeURIComponent(typologyCode)}`, {
      credentials: 'same-origin',
    })
      .then((res) => (res.ok ? res.json() : { hotspots: [] }))
      .then((data: { hotspots?: TourPlacedHotspot[] }) => {
        if (!cancelled) setHotspots(Array.isArray(data.hotspots) ? data.hotspots : [])
      })
      .catch(() => {
        if (!cancelled) setHotspots([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [typologyCode])

  useEffect(() => {
    setSelectedId(null)
  }, [here, typologyCode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }
      if (event.key === 'Escape') {
        setSelectedId(null)
        return
      }
      const step = event.shiftKey ? 0.12 : 0.045
      const move: Record<string, [number, number] | undefined> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      }
      const delta = move[event.key]
      if (!delta) return
      event.preventDefault()
      event.stopPropagation()
      if (!selectedIdRef.current) {
        if (!event.repeat) toast('Hacé clic en un punto del 360 y después usá las flechas.')
        return
      }
      nudgeSelected(delta[0], delta[1])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [nudgeSelected])

  useEffect(() => {
    return () => {
      if (!saveTimerRef.current) return
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      void fetch('/api/typology-hotspots', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ typology_code: typologyCode, hotspots: hotspotsRef.current }),
      })
    }
  }, [typologyCode])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !panoUrl) return
    let cancelled = false
    let viewer: Viewer | null = null
    setPanoError(false)
    setPending(null)

    const markerIdFromEvent = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) return null
      const marker = target.closest('.psv-marker')
      if (!marker || !container.contains(marker)) return null
      const id = marker.id.startsWith('psv-marker-') ? marker.id.slice('psv-marker-'.length) : ''
      if (!id || !herePointsRef.current.some((item) => item.id === id)) return null
      return id
    }

    const stopViewerPan = (event: Event) => {
      if (!markerIdFromEvent(event)) return
      event.preventDefault()
      event.stopPropagation()
    }

    const selectMarker = (event: Event) => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return
      const id = markerIdFromEvent(event)
      if (!id) return
      endDragRef.current?.()
      event.preventDefault()
      event.stopPropagation()
      markerPickRef.current = performance.now()
      selectedIdRef.current = id
      setSelectedId(id)
      setPending(null)
      const startX = event.clientX
      const startY = event.clientY
      const pointerId = event.pointerId
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return
        if (!draggingRef.current && Math.hypot(move.clientX - startX, move.clientY - startY) < 4) return
        draggingRef.current = true
        container.parentElement?.classList.add('is-dragging')
        move.preventDefault()
        const viewer = viewerRef.current
        if (!viewer) return
        const rect = viewer.container.getBoundingClientRect()
        const pos = viewer.dataHelper.viewerCoordsToSphericalCoords({
          x: move.clientX - rect.left,
          y: move.clientY - rect.top,
        })
        if (!pos || !Number.isFinite(pos.yaw) || !Number.isFinite(pos.pitch)) return
        applyPositionRef.current(id, pos.yaw, pos.pitch, false)
      }
      const onUp = (up: PointerEvent) => {
        if (up.pointerId !== pointerId) return
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        endDragRef.current = null
        const dragged = draggingRef.current
        draggingRef.current = false
        container.parentElement?.classList.remove('is-dragging')
        if (!dragged) return
        markerPickRef.current = performance.now()
        const currentPoint = hotspotsRef.current.find((item) => item.id === id)
        if (!currentPoint) return
        applyPositionRef.current(id, currentPoint.yaw, currentPoint.pitch, true)
      }
      endDragRef.current = () => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        draggingRef.current = false
        container.parentElement?.classList.remove('is-dragging')
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
    }

    const start = () => {
      if (cancelled || !container.isConnected) return
      if (container.clientWidth < 16 || container.clientHeight < 16) {
        frame = requestAnimationFrame(start)
        return
      }
      try {
        const instance = new Viewer({
          container,
          panorama: panoUrl,
          navbar: false,
          loadingTxt: 'Cargando…',
          canvasBackground: '#111',
          defaultZoomLvl: 0,
          keyboard: false,
          plugins: [MarkersPlugin.withConfig({})],
        })
        viewer = instance
        viewerRef.current = instance
        const paint = () => {
          const markers = instance.getPlugin<MarkersPlugin>(MarkersPlugin)
          markers?.setMarkers(herePointsRef.current.map((item) => markerFor(item)))
        }
        instance.addEventListener(events.ReadyEvent.type, paint)
        instance.getPlugin<MarkersPlugin>(MarkersPlugin)?.addEventListener(markerEvents.SelectMarkerEvent.type, (event) => {
          if (event.rightClick) return
          markerPickRef.current = performance.now()
          setSelectedId(event.marker.id)
          setPending(null)
        })
        instance.addEventListener(events.ClickEvent.type, (event) => {
          if (event.data.rightclick || event.data.marker) return
          if (event.data.target?.closest('.psv-marker')) return
          if (performance.now() - markerPickRef.current < 500) return
          setSelectedId(null)
          setPending({ yaw: event.data.yaw, pitch: event.data.pitch })
        })
        instance.addEventListener(events.PanoramaErrorEvent.type, () => {
          if (!cancelled) setPanoError(true)
        })
        container.addEventListener('mousedown', stopViewerPan, true)
        container.addEventListener('pointerdown', selectMarker, true)
        container.addEventListener('click', selectMarker, true)
      } catch {
        if (!cancelled) setPanoError(true)
      }
    }

    let frame = requestAnimationFrame(start)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      endDragRef.current?.()
      container.removeEventListener('mousedown', stopViewerPan, true)
      container.removeEventListener('pointerdown', selectMarker, true)
      container.removeEventListener('click', selectMarker, true)
      viewer?.destroy()
      viewerRef.current = null
    }
  }, [panoUrl, markerFor])

  const pointsStamp = herePoints
    .map((item) => `${item.id}:${item.yaw}:${item.pitch}:${item.id === selectedId ? 1 : 0}`)
    .join('|')

  useEffect(() => {
    if (draggingRef.current) return
    const viewer = viewerRef.current
    if (!viewer) return
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin)
    markers?.setMarkers(herePointsRef.current.filter((item) => item.from === here).map((item) => markerFor(item)))
  }, [pointsStamp, panoUrl, markerFor, here])

  const dropQueuedSave = () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    revisionRef.current += 1
  }

  const placeRoom = (room: RoomOption) => {
    if (!pending || !here) return
    dropQueuedSave()
    const next = [
      ...hotspots.filter((item) => !(item.from === here && item.slug === room.slug && item.kind !== 'look')),
      {
        id: `${here}:${room.slug}`,
        from: here,
        slug: room.slug,
        label: room.label,
        yaw: pending.yaw,
        pitch: pending.pitch,
        kind: 'go' as const,
      },
    ]
    setPending(null)
    setHotspots(next)
    void persist(next)
  }

  const placeLook = () => {
    if (!pending || !here) return
    dropQueuedSave()
    const next = [
      ...hotspots,
      {
        id: `${here}:look:${pending.yaw.toFixed(3)}:${pending.pitch.toFixed(3)}`,
        from: here,
        slug: here,
        label: 'Mirar',
        yaw: pending.yaw,
        pitch: pending.pitch,
        kind: 'look' as const,
      },
    ]
    setPending(null)
    setHotspots(next)
    void persist(next)
  }

  const removePoint = (id: string) => {
    dropQueuedSave()
    if (selectedId === id) setSelectedId(null)
    const next = hotspots.filter((item) => item.id !== id)
    setHotspots(next)
    void persist(next)
  }

  const selectedPoint = herePoints.find((item) => item.id === selectedId) ?? null

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#3a3d36]">
        Arrastrá un punto con el cursor para moverlo. Un clic en el vacío clava uno nuevo. Las flechas también lo mueven; con Shift el paso es más grande.
      </p>
      <Select
        label="Ambiente"
        options={withPano.map((item) => ({
          value: item.slug,
          label: item.label,
        }))}
        value={editRoom}
        onChange={(event) => {
          setEditRoom(event.target.value)
          setPending(null)
        }}
      />
      <div className="hotspot-editor relative h-[min(68dvh,720px)] min-h-[520px] overflow-hidden bg-[#111]">
        <div ref={containerRef} className="h-full w-full" />
        {!panoUrl || panoError ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm text-white/70">
            {!panoUrl
              ? `No hay 360 de ${current?.label ?? 'este ambiente'}. Subilo en la pestaña 360 y volvé acá.`
              : 'No se pudo abrir ese 360. Probá recargar o subir de nuevo el panorama.'}
          </div>
        ) : null}
        {selectedPoint ? (
          <div className="absolute top-3 right-3 z-20 border border-white/15 bg-[#14110e]/88 p-2 text-[#f7f3ee] backdrop-blur-md">
            <p className="px-1 text-[10px] tracking-[0.14em] text-[#BDA27E] uppercase">
              {selectedPoint.kind === 'look' ? 'Mirar aquí' : selectedPoint.label}
            </p>
            <div className="mt-1 grid grid-cols-3 gap-1">
              <span />
              <button type="button" aria-label="Subir punto" onClick={() => nudgeSelected(0, 0.045)} className="h-8 bg-white/10 text-sm hover:bg-white/20">↑</button>
              <span />
              <button type="button" aria-label="Mover punto a la izquierda" onClick={() => nudgeSelected(-0.045, 0)} className="h-8 bg-white/10 text-sm hover:bg-white/20">←</button>
              <span />
              <button type="button" aria-label="Mover punto a la derecha" onClick={() => nudgeSelected(0.045, 0)} className="h-8 bg-white/10 text-sm hover:bg-white/20">→</button>
              <span />
              <button type="button" aria-label="Bajar punto" onClick={() => nudgeSelected(0, -0.045)} className="h-8 bg-white/10 text-sm hover:bg-white/20">↓</button>
              <span />
            </div>
          </div>
        ) : null}
        {pending ? (
          <div className="absolute inset-x-2 bottom-2 z-10 border border-white/15 bg-[#14110e]/88 p-3 backdrop-blur-md">
            <p className="text-[10px] font-medium tracking-[0.18em] text-[#BDA27E] uppercase">
              ¿Qué hace este punto?
            </p>
            <button
              type="button"
              onClick={placeLook}
              className="mt-2 border border-[#BDA27E]/50 bg-[#BDA27E]/16 px-2.5 py-1 text-[11px] text-[#f7f3ee] hover:bg-[#BDA27E]/28"
            >
              Solo mirar aquí
            </button>
            {targets.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {targets.map((room) => (
                  <button
                    key={room.slug}
                    type="button"
                    onClick={() => placeRoom(room)}
                    className="border border-white/20 bg-white/8 px-2.5 py-1 text-[11px] text-[#f7f3ee] hover:bg-white/16"
                  >
                    Ir a {room.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-white/70">
                No hay otros ambientes para ir. Podés dejar el punto solo para mirar.
              </p>
            )}
            <button
              type="button"
              onClick={() => setPending(null)}
              className="mt-2 text-[10px] tracking-[0.12em] text-white/50 uppercase underline underline-offset-2"
            >
              Cancelar
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[#8a8d87]">
        {loading ? <span>Cargando puntos…</span> : null}
        {saving ? <span>Guardando…</span> : null}
        {!loading && !saving ? (
          <span>
            {herePoints.length === 0
              ? `Sin puntos en ${current?.label ?? 'este ambiente'}. Tocá el 360 para clavar uno.`
              : `${herePoints.length} punto(s) en ${current?.label ?? 'este ambiente'}.`}
          </span>
        ) : null}
      </div>
      {herePoints.length > 0 ? (
        <ul className="divide-y divide-[#2B1A18]/8 border border-[#2B1A18]/10">
          {herePoints.map((item) => {
            const selected = item.id === selectedId
            return (
              <li
                key={item.id}
                className={cn(
                  'flex items-center justify-between gap-3 px-3 py-2 text-sm',
                  selected && 'bg-[#BDA27E]/15',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(item.id)
                    setPending(null)
                    void viewerRef.current?.animate({
                      yaw: item.yaw,
                      pitch: item.pitch,
                      speed: 800,
                    })
                  }}
                  className="min-w-0 flex-1 text-left text-[#3a3d36]"
                >
                  <span>{item.kind === 'look' ? 'Mirar aquí' : `→ ${item.label}`}</span>
                  {selected ? (
                    <span className="mt-0.5 block text-[10px] tracking-[0.12em] text-[#8c7048] uppercase">
                      Flechas para mover · Esc para soltar
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => removePoint(item.id)}
                  className={cn('text-[11px] text-[#8a5c58] underline underline-offset-2', saving && 'opacity-50')}
                  disabled={saving}
                >
                  Quitar
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
