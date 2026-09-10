'use client'
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { ProjectVisitLocation } from '@/lib/inmobiliaria/projectLocation'

export default function ProjectLocationMap({ point, onChange }: { point: ProjectVisitLocation | null; onChange: (value: ProjectVisitLocation) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const changed = useRef(onChange)
  useEffect(() => { changed.current = onChange }, [onChange])
  useEffect(() => {
    if (!container.current) return
    const view = L.map(container.current, { center: [-2.89234, -79.030352], zoom: 17, scrollWheelZoom: false })
    map.current = view
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri', maxZoom: 19 }).addTo(view)
    view.on('click', (event: L.LeafletMouseEvent) => changed.current({ latitude: event.latlng.lat, longitude: event.latlng.lng }))
    const resize = new ResizeObserver(() => view.invalidateSize())
    resize.observe(container.current)
    return () => { resize.disconnect(); view.remove(); map.current = null; marker.current = null }
  }, [])
  useEffect(() => {
    const view = map.current
    if (!view || !point) return
    const position: L.LatLngExpression = [point.latitude, point.longitude]
    if (!marker.current) {
      const icon = L.divIcon({ className: '', html: '<span style="display:block;width:24px;height:24px;border:4px solid white;border-radius:50%;background:#65744d;box-shadow:0 2px 10px #0005"></span>', iconSize: [24, 24], iconAnchor: [12, 12] })
      marker.current = L.marker(position, { draggable: true, icon, title: 'Ubicación del proyecto' }).addTo(view)
      marker.current.on('dragend', () => {
        const next = marker.current?.getLatLng()
        if (next) changed.current({ latitude: next.lat, longitude: next.lng })
      })
    } else marker.current.setLatLng(position)
    if (!view.getBounds().contains(position)) view.panTo(position)
  }, [point])
  return <div ref={container} aria-label="Mapa: seleccione el punto de encuentro" className="relative z-0 h-[420px] w-full overflow-hidden rounded-2xl border border-[#dfe5d5] sm:h-[520px]" />
}

