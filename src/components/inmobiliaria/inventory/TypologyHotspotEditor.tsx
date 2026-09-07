'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Viewer, events } from '@photo-sphere-viewer/core'
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin'
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
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [panoError, setPanoError] = useState(false)

  const current = rooms.find((item) => item.slug === editRoom) ?? rooms[0]
  const panoUrl = current?.url ?? null
  const here = current?.slug ?? ''
  const targets = rooms.filter((item) => item.slug !== here)
  const herePoints = hotspots.filter((item) => item.from === here)

  const persist = useCallback(
    async (next: TourPlacedHotspot[]) => {
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
        setHotspots(payload?.hotspots ?? next)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudieron guardar los puntos')
      } finally {
        setSaving(false)
      }
    },
    [typologyCode],
  )

  useEffect(() => {
    if (!rooms.some((item) => item.slug === editRoom)) {
      setEditRoom(rooms[0]?.slug ?? '')
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
    const container = containerRef.current
    if (!container || !panoUrl) return
    let cancelled = false
    let viewer: Viewer | null = null
    setPanoError(false)
    setPending(null)

    const start = () => {
      if (cancelled || !container.isConnected) return
      if (container.clientWidth < 16 || container.clientHeight < 16) {
        frame = requestAnimationFrame(start)
        return
      }
      try {
        viewer = new Viewer({
          container,
          panorama: panoUrl,
          navbar: false,
          loadingTxt: 'Cargando…',
          canvasBackground: '#111',
          defaultZoomLvl: 0,
          plugins: [MarkersPlugin.withConfig({})],
        })
        viewerRef.current = viewer
        viewer.addEventListener(events.ClickEvent.type, (event) => {
          if (event.data.rightclick || event.data.marker) return
          setPending({ yaw: event.data.yaw, pitch: event.data.pitch })
        })
        viewer.addEventListener(events.PanoramaErrorEvent.type, () => {
          if (!cancelled) setPanoError(true)
        })
      } catch {
        if (!cancelled) setPanoError(true)
      }
    }

    let frame = requestAnimationFrame(start)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      viewer?.destroy()
      viewerRef.current = null
    }
  }, [panoUrl])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin)
    markers?.setMarkers(
      herePoints.map((item) => ({
        id: item.id,
        position: { yaw: item.yaw, pitch: item.pitch },
        html: roomHotspotHtml(item.label, item.kind === 'look' ? 'look' : 'go'),
        anchor: 'center center' as const,
        size: { width: 92, height: 78 },
        tooltip: item.label,
      })),
    )
  }, [herePoints, panoUrl])

  const placeRoom = (room: RoomOption) => {
    if (!pending || !here) return
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
    const next = hotspots.filter((item) => item.id !== id)
    setHotspots(next)
    void persist(next)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#3a3d36]">
        Elegí el ambiente, tocá el 360 y decí si ese punto va a otro ambiente o solo mira ese detalle
        en la misma imagen.
      </p>
      <Select
        label="Ambiente"
        options={rooms.map((item) => ({
          value: item.slug,
          label: item.url ? item.label : `${item.label} · sin 360`,
        }))}
        value={editRoom}
        onChange={(event) => {
          setEditRoom(event.target.value)
          setPending(null)
        }}
      />
      <div className="relative overflow-hidden bg-[#111]" style={{ height: 380 }}>
        <div ref={containerRef} className="h-full w-full" />
        {!panoUrl || panoError ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm text-white/70">
            {!panoUrl
              ? `No hay 360 de ${current?.label ?? 'este ambiente'}. Subilo en la pestaña 360 y volvé acá.`
              : 'No se pudo abrir ese 360. Probá recargar o subir de nuevo el panorama.'}
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
          {herePoints.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-[#3a3d36]">
                {item.kind === 'look' ? 'Mirar aquí' : `→ ${item.label}`}
              </span>
              <button
                type="button"
                onClick={() => removePoint(item.id)}
                className={cn('text-[11px] text-[#8a5c58] underline underline-offset-2', saving && 'opacity-50')}
                disabled={saving}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
