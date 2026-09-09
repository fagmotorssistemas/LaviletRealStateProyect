'use client'

import { useEffect, useId, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { SITE } from '@/lib/marketing/site'
import { cn } from '@/lib/utils'

type LaviletMapProps = {
  className?: string
  zoom?: number
}

export function LaviletMap({ className, zoom = 17 }: LaviletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const reactId = useId().replace(/:/g, '')

  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return

    const { lat, lng, label } = SITE.location
    const map = L.map(el, {
      center: [lat, lng],
      zoom,
      scrollWheelZoom: false,
      zoomControl: false,
      attributionControl: true,
      dragging: true,
    })
    mapRef.current = map

    L.control.zoom({ position: 'bottomleft' }).addTo(map)

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19,
      },
    ).addTo(map)

    const siteIcon = L.divIcon({
      className: 'lavilet-map-marker',
      html: `
        <div class="lavilet-map-pin-wrap">
          <div class="lavilet-map-pulse-wrap">
            <span class="lavilet-map-ring lavilet-map-ring-1"></span>
            <span class="lavilet-map-ring lavilet-map-ring-2"></span>
            <span class="lavilet-map-ring lavilet-map-ring-3"></span>
            <div class="lavilet-map-site"></div>
          </div>
          <span class="lavilet-map-label">${label}</span>
        </div>`,
      // Dejamos el anclaje en el punto exacto de coordenadas
      iconSize: [1, 1],
      iconAnchor: [0, 0],
    })
    L.marker([lat, lng], { icon: siteIcon }).addTo(map)

    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)
    const t = window.setTimeout(onResize, 160)

    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', onResize)
      map.remove()
      mapRef.current = null
    }
  }, [zoom, reactId])

  return (
    <div className={cn('lavilet-map relative h-full w-full overflow-hidden bg-[#ebe4da]', className)}>
      <div ref={containerRef} className="absolute inset-0 z-0 h-full w-full" />
    </div>
  )
}
