'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Viewer, events } from '@photo-sphere-viewer/core'
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin'
import { toast } from 'sonner'
import { roomHotspotHtml } from '@/components/tour/createTourArrow'
import type { TourPlacedHotspot } from '@/types/tour'
import { cn } from '@/lib/utils'
import '@photo-sphere-viewer/core/index.css'
import '@photo-sphere-viewer/markers-plugin/index.css'
import '@/components/tour/tour-viewer.css'

type RoomOption = { slug: string; label: string }

export function TypologyHotspotEditor({
  typologyCode,
  panoUrl,
  rooms,
}: {
  typologyCode: string
  panoUrl: string | null
  rooms: RoomOption[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const [hotspots, setHotspots] = useState<TourPlacedHotspot[]>([])
  const [pending, setPending] = useState<{ yaw: number; pitch: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [panoError, setPanoError] = useState(false)

  const roomChoices =
    rooms.length > 0
      ? rooms
      : [
          { slug: 'bano-completo', label: 'Baño' },
          { slug: 'cocina', label: 'Cocina' },
          { slug: 'sala', label: 'Sala' },
        ]

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
      hotspots.map((item) => ({
        id: item.id,
        position: { yaw: item.yaw, pitch: item.pitch },
        html: roomHotspotHtml(item.label),
        anchor: 'center center' as const,
        size: { width: 92, height: 78 },
        tooltip: item.label,
      })),
    )
  }, [hotspots, panoUrl])

  const placeRoom = (room: RoomOption) => {
    if (!pending) return
    const next = [
      ...hotspots.filter((item) => item.slug !== room.slug),
      {
        id: room.slug,
        slug: room.slug,
        label: room.label,
        yaw: pending.yaw,
        pitch: pending.pitch,
      },
    ]
    setPending(null)
    setHotspots(next)
    void persist(next)
  }

  const removeRoom = (slug: string) => {
    const next = hotspots.filter((item) => item.slug !== slug)
    setHotspots(next)
    void persist(next)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#3a3d36]">
        Tocá el lugar del 360 (la puerta del baño, la cocina…) y elegí el ambiente. El showroom usa
        esos puntos.
      </p>
      <div className="relative overflow-hidden bg-[#111]" style={{ height: 380 }}>
        <div ref={containerRef} className="h-full w-full" />
        {!panoUrl || panoError ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm text-white/70">
            {!panoUrl
              ? 'No encuentro el 360 de esta tipología. Subilo en Ambientes y volvé a esta pestaña.'
              : 'No se pudo abrir ese 360. Probá recargar o subir de nuevo el panorama en Ambientes.'}
          </div>
        ) : null}
        {pending ? (
          <div className="absolute inset-x-2 bottom-2 z-10 border border-white/15 bg-[#14110e]/88 p-3 backdrop-blur-md">
            <p className="text-[10px] font-medium tracking-[0.18em] text-[#BDA27E] uppercase">
              ¿Qué ambiente es?
            </p>
            {roomChoices.length === 0 ? (
              <p className="mt-2 text-xs text-white/70">
                Esta tipología no tiene ambientes. Cargá baños o espacios en la unidad.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {roomChoices.map((room) => (
                  <button
                    key={room.slug}
                    type="button"
                    onClick={() => placeRoom(room)}
                    className="border border-white/20 bg-white/8 px-2.5 py-1 text-[11px] text-[#f7f3ee] hover:bg-white/16"
                  >
                    {room.label}
                  </button>
                ))}
              </div>
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
            {hotspots.length === 0
              ? 'Todavía no hay puntos. Si no clavás ninguno, el showroom sigue usando el círculo automático.'
              : `${hotspots.length} punto(s) en esta tipología.`}
          </span>
        ) : null}
      </div>
      {hotspots.length > 0 ? (
        <ul className="divide-y divide-[#2B1A18]/8 border border-[#2B1A18]/10">
          {hotspots.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-[#3a3d36]">{item.label}</span>
              <button
                type="button"
                onClick={() => removeRoom(item.slug)}
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
