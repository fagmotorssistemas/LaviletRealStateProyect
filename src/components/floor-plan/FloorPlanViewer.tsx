'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { Apartment, Point } from '@/lib/floor-plan/types'
import { ApartmentPolygon } from '@/components/floor-plan/ApartmentPolygon'
import { ApartmentEditor } from '@/components/floor-plan/ApartmentEditor'

type FloorPlanViewerProps = {
  imageUrl: string
  width: number
  height: number
  apartments: Apartment[]
  selectedId: string | null
  editMode: boolean
  onSelect: (id: string | null) => void
  onApartmentsChange: (next: Apartment[]) => void
  scale: number
  offset: { x: number; y: number }
  onScaleChange: (scale: number) => void
  onOffsetChange: (offset: { x: number; y: number }) => void
}

export function FloorPlanViewer({
  imageUrl,
  width,
  height,
  apartments,
  selectedId,
  editMode,
  onSelect,
  onApartmentsChange,
  scale,
  offset,
  onScaleChange,
  onOffsetChange,
}: FloorPlanViewerProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const selected = useMemo(
    () => apartments.find((item) => item.id === selectedId) ?? null,
    [apartments, selectedId],
  )

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaY > 0 ? 0.9 : 1.1
      onScaleChange(Math.min(6, Math.max(0.4, scale * delta)))
    },
    [onScaleChange, scale],
  )

  const updateApartment = (next: Apartment) => {
    onApartmentsChange(apartments.map((item) => (item.id === next.id ? next : item)))
  }

  const addVertexNear = (point: Point) => {
    if (!selected || !editMode) return
    // Insertar en el segmento más cercano
    const poly = selected.polygon
    let bestI = 0
    let bestD = Infinity
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const mx = (a[0] + b[0]) / 2
      const my = (a[1] + b[1]) / 2
      const d = (mx - point[0]) ** 2 + (my - point[1]) ** 2
      if (d < bestD) {
        bestD = d
        bestI = i + 1
      }
    }
    const polygon = [...poly.slice(0, bestI), point, ...poly.slice(bestI)]
    updateApartment({ ...selected, polygon })
  }

  return (
    <div
      className="relative h-full min-h-[360px] w-full overflow-hidden rounded-2xl bg-[#1a1714] ring-1 ring-[#2B1A18]/10"
      onWheel={onWheel}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        if ((event.target as HTMLElement).closest('polygon, circle')) return
        panRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!panRef.current) return
        const dx = event.clientX - panRef.current.x
        const dy = event.clientY - panRef.current.y
        onOffsetChange({ x: panRef.current.ox + dx, y: panRef.current.oy + dy })
      }}
      onPointerUp={() => {
        panRef.current = null
      }}
      onClick={() => {
        if (!editMode) onSelect(null)
      }}
    >
      <div
        className="absolute left-1/2 top-1/2 origin-center"
        style={{
          width,
          height,
          transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
        }}
      >
        {/* Imagen original intacta */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Plano arquitectónico"
          width={width}
          height={height}
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
        />

        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          onDoubleClick={(event) => {
            if (!editMode || !selected) return
            const svg = event.currentTarget
            const rect = svg.getBoundingClientRect()
            const x = Math.round(((event.clientX - rect.left) / rect.width) * width)
            const y = Math.round(((event.clientY - rect.top) / rect.height) * height)
            addVertexNear([x, y])
          }}
        >
          {apartments.map((apartment) => (
            <ApartmentPolygon
              key={apartment.id}
              apartment={apartment}
              selected={apartment.id === selectedId}
              hovered={apartment.id === hoveredId}
              editing={editMode}
              onHover={setHoveredId}
              onSelect={onSelect}
            />
          ))}
          {editMode && selected ? (
            <ApartmentEditor apartment={selected} onChange={updateApartment} />
          ) : null}
        </svg>
      </div>
    </div>
  )
}
