'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { Apartment, Point } from '@/lib/floor-plan/types'
import { ApartmentPolygon } from '@/components/floor-plan/ApartmentPolygon'
import { ApartmentEditor } from '@/components/floor-plan/ApartmentEditor'
import { polygonToSvgPoints } from '@/lib/floor-plan/api'
import type { FloorPlanOverlayAlign } from '@/lib/tour/floorPlanZones'
import { DEFAULT_OVERLAY_ALIGN } from '@/lib/tour/floorPlanZones'

type FloorPlanViewerProps = {
  imageUrl: string
  width: number
  height: number
  apartments: Apartment[]
  selectedId: string | null
  editMode: boolean
  /** Puntos del trazo libre en curso (null = no está dibujando). */
  draftPoints?: Point[] | null
  onDraftPointsChange?: (points: Point[] | null) => void
  onDraftComplete?: (points: Point[]) => void
  onSelect: (id: string | null) => void
  onApartmentsChange: (next: Apartment[]) => void
  scale: number
  offset: { x: number; y: number }
  onScaleChange: (scale: number) => void
  onOffsetChange: (offset: { x: number; y: number }) => void
  /** Solo visual: desplaza el overlay de zonas (p. ej. ajuste fino 3D). */
  overlayAlign?: FloorPlanOverlayAlign | null
}

function clientToImage(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  width: number,
  height: number,
): Point {
  const rect = svg.getBoundingClientRect()
  const x = ((clientX - rect.left) / rect.width) * width
  const y = ((clientY - rect.top) / rect.height) * height
  return [Math.round(x), Math.round(y)]
}

function applyPolygonMeta(polygon: Point[]) {
  const xs = polygon.map((p) => p[0])
  const ys = polygon.map((p) => p[1])
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const x1 = Math.max(...xs)
  const y1 = Math.max(...ys)
  return {
    polygon,
    bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    center: [(x0 + x1) / 2, (y0 + y1) / 2] as [number, number],
  }
}

export function FloorPlanViewer({
  imageUrl,
  width,
  height,
  apartments,
  selectedId,
  editMode,
  draftPoints = null,
  onDraftPointsChange,
  onDraftComplete,
  onSelect,
  onApartmentsChange,
  scale,
  offset,
  onScaleChange,
  onOffsetChange,
  overlayAlign = null,
}: FloorPlanViewerProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  )
  const drawing = Boolean(draftPoints)
  const selected = useMemo(
    () => apartments.find((item) => item.id === selectedId) ?? null,
    [apartments, selectedId],
  )

  const handleSize = Math.max(8, Math.min(28, 12 / Math.max(scale, 0.05)))
  const closeHit = Math.max(14, 18 / Math.max(scale, 0.05))

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaY > 0 ? 0.9 : 1.1
      onScaleChange(Math.min(8, Math.max(0.05, scale * delta)))
    },
    [onScaleChange, scale],
  )

  const updateApartment = (next: Apartment) => {
    onApartmentsChange(apartments.map((item) => (item.id === next.id ? next : item)))
  }

  const addVertexNear = (point: Point) => {
    if (!selected || !editMode || selected.kind === 'circle') return
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
    updateApartment({
      ...selected,
      ...applyPolygonMeta(polygon),
      needsReview: false,
    })
  }

  const tryCloseDraft = (points: Point[]) => {
    if (points.length < 3) return false
    onDraftComplete?.(points)
    onDraftPointsChange?.(null)
    setCursor(null)
    return true
  }

  const addDraftPoint = (point: Point) => {
    if (!draftPoints || !onDraftPointsChange) return
    if (draftPoints.length >= 3) {
      const [fx, fy] = draftPoints[0]
      if (Math.hypot(point[0] - fx, point[1] - fy) <= closeHit) {
        tryCloseDraft(draftPoints)
        return
      }
    }
    onDraftPointsChange([...draftPoints, point])
  }

  const draftPreview =
    draftPoints && draftPoints.length > 0 && cursor
      ? [...draftPoints, cursor]
      : draftPoints ?? []

  const align = overlayAlign ?? DEFAULT_OVERLAY_ALIGN
  const alignTransform = `translate(${(align.offsetX / 100) * width} ${(align.offsetY / 100) * height}) translate(${width / 2} ${height / 2}) scale(${align.scale}) translate(${-width / 2} ${-height / 2})`

  return (
    <div
      className="relative h-full min-h-[360px] w-full overflow-hidden rounded-2xl bg-[#1a1714] ring-1 ring-[#2B1A18]/10"
      style={{ cursor: drawing ? 'crosshair' : undefined }}
      onWheel={onWheel}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        if ((event.target as HTMLElement).closest('[data-vertex-handle="1"]')) return
        if (!drawing && (event.target as HTMLElement).closest('polygon, circle')) return
        panRef.current = {
          x: event.clientX,
          y: event.clientY,
          ox: offset.x,
          oy: offset.y,
          moved: false,
        }
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (drawing) {
          const svg = event.currentTarget.querySelector('svg')
          if (svg instanceof SVGSVGElement) {
            setCursor(clientToImage(event.clientX, event.clientY, svg, width, height))
          }
        }
        if (!panRef.current) return
        const dx = event.clientX - panRef.current.x
        const dy = event.clientY - panRef.current.y
        if (Math.hypot(dx, dy) > 4) panRef.current.moved = true
        if (!panRef.current.moved) return
        onOffsetChange({ x: panRef.current.ox + dx, y: panRef.current.oy + dy })
      }}
      onPointerUp={(event) => {
        const pan = panRef.current
        panRef.current = null
        if (!pan) return
        if (pan.moved) return
        if (drawing) {
          const svg = event.currentTarget.querySelector('svg')
          if (!(svg instanceof SVGSVGElement)) return
          addDraftPoint(clientToImage(event.clientX, event.clientY, svg, width, height))
          return
        }
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
            event.preventDefault()
            if (drawing && draftPoints) {
              if (draftPoints.length >= 3) tryCloseDraft(draftPoints)
              return
            }
            if (!editMode || !selected || selected.kind === 'circle') return
            const point = clientToImage(event.clientX, event.clientY, event.currentTarget, width, height)
            addVertexNear(point)
          }}
        >
          <g transform={alignTransform}>
            {apartments.map((apartment) => (
              <ApartmentPolygon
                key={apartment.id}
                apartment={apartment}
                selected={apartment.id === selectedId}
                hovered={apartment.id === hoveredId}
                editing={editMode && !drawing}
                onHover={setHoveredId}
                onSelect={(id) => {
                  if (drawing) return
                  onSelect(id)
                }}
              />
            ))}

            {drawing && draftPreview.length > 0 ? (
              <g>
                {draftPreview.length >= 2 ? (
                  <polyline
                    points={polygonToSvgPoints(draftPreview)}
                    fill="none"
                    stroke="rgba(120, 125, 98, 0.95)"
                    strokeWidth={Math.max(2, 2.5 / Math.max(scale, 0.05))}
                    strokeDasharray={`${8 / Math.max(scale, 0.05)} ${6 / Math.max(scale, 0.05)}`}
                    vectorEffect="non-scaling-stroke"
                    className="pointer-events-none"
                  />
                ) : null}
                {draftPoints && draftPoints.length >= 3 ? (
                  <polygon
                    points={polygonToSvgPoints(draftPoints)}
                    fill="rgba(120, 125, 98, 0.12)"
                    stroke="none"
                    className="pointer-events-none"
                  />
                ) : null}
                {(draftPoints ?? []).map((point, index) => (
                  <circle
                    key={`draft-${index}`}
                    cx={point[0]}
                    cy={point[1]}
                    r={index === 0 ? handleSize * 1.15 : handleSize}
                    fill={index === 0 ? '#787D62' : '#1a2744'}
                    stroke="#fff"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    className="pointer-events-none"
                  />
                ))}
              </g>
            ) : null}

            {editMode && !drawing && selected ? (
              <ApartmentEditor apartment={selected} scale={scale} onChange={updateApartment} />
            ) : null}
          </g>
        </svg>
      </div>
    </div>
  )
}
