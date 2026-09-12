'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Apartment, Point } from '@/lib/floor-plan/types'
import { ApartmentPolygon } from '@/components/floor-plan/ApartmentPolygon'
import { ApartmentEditor } from '@/components/floor-plan/ApartmentEditor'
import { polygonToSvgPoints } from '@/lib/floor-plan/api'
import { applyPolygonMeta, normalizeCurves } from '@/lib/floor-plan/geometry'
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
  onApartmentsChange: (next: Apartment[] | ((prev: Apartment[]) => Apartment[])) => void
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

/** Solo translate: el zoom va por width/height CSS (evita blur de scale() en planos grandes). */
function stageTranslate(offset: { x: number; y: number }) {
  return `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`
}

function applyStageLayout(
  node: HTMLDivElement,
  width: number,
  height: number,
  scale: number,
  offset: { x: number; y: number },
) {
  node.style.width = `${width * scale}px`
  node.style.height = `${height * scale}px`
  node.style.transform = stageTranslate(offset)
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
  const [handleDragging, setHandleDragging] = useState(false)
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  )
  const stageRef = useRef<HTMLDivElement>(null)
  const rubberRef = useRef<SVGPolylineElement>(null)
  const scaleRef = useRef(scale)
  const offsetRef = useRef(offset)
  const draftRef = useRef(draftPoints)
  draftRef.current = draftPoints
  scaleRef.current = scale
  offsetRef.current = offset

  const drawing = Boolean(draftPoints)
  const selected = useMemo(
    () => apartments.find((item) => item.id === selectedId) ?? null,
    [apartments, selectedId],
  )

  const handleSize = Math.max(5, Math.min(90, 7.5 / Math.max(scale, 0.05)))
  const closeHit = Math.max(14, 18 / Math.max(scale, 0.05))

  useEffect(() => {
    if (stageRef.current) {
      applyStageLayout(stageRef.current, width, height, scale, offset)
    }
  }, [scale, offset, width, height])

  useEffect(() => {
    setHandleDragging(false)
  }, [selectedId])

  const paintRubber = (cursor: Point | null) => {
    const line = rubberRef.current
    if (!line) return
    const points = draftRef.current
    if (!points || points.length === 0) {
      line.setAttribute('points', '')
      return
    }
    const preview = cursor ? [...points, cursor] : points
    line.setAttribute('points', preview.length >= 2 ? polygonToSvgPoints(preview) : '')
  }

  const updateApartment = (next: Apartment) => {
    onApartmentsChange((prev) => prev.map((item) => (item.id === next.id ? next : item)))
  }

  const addVertexNear = (point: Point) => {
    if (!selected || selected.kind === 'circle') return
    const poly = selected.polygon
    const curves = normalizeCurves(poly, selected.curves)
    let bestI = 0
    let bestD = Infinity
    let bestPoint: Point = point
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len2 = dx * dx + dy * dy || 1
      const t = Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2))
      const px = a[0] + dx * t
      const py = a[1] + dy * t
      const d = (point[0] - px) ** 2 + (point[1] - py) ** 2
      if (d < bestD) {
        bestD = d
        bestI = i + 1
        bestPoint = [Math.round(px), Math.round(py)]
      }
    }
    const edgeIndex = (bestI - 1 + poly.length) % poly.length
    const polygon = [...poly.slice(0, bestI), bestPoint, ...poly.slice(bestI)]
    const nextCurves = [...curves]
    nextCurves.splice(bestI, 0, null)
    nextCurves[edgeIndex] = null
    updateApartment({
      ...selected,
      ...applyPolygonMeta(polygon, nextCurves),
      needsReview: false,
    })
  }

  const tryCloseDraft = (points: Point[]) => {
    if (points.length < 3) return false
    onDraftComplete?.(points)
    onDraftPointsChange?.(null)
    paintRubber(null)
    return true
  }

  const addDraftPoint = (point: Point) => {
    const points = draftRef.current
    if (!points || !onDraftPointsChange) return
    if (points.length >= 3) {
      const [fx, fy] = points[0]
      if (Math.hypot(point[0] - fx, point[1] - fy) <= closeHit) {
        tryCloseDraft(points)
        return
      }
    }
    onDraftPointsChange([...points, point])
  }

  const align = overlayAlign ?? DEFAULT_OVERLAY_ALIGN
  const alignTransform = `translate(${(align.offsetX / 100) * width} ${(align.offsetY / 100) * height}) translate(${width / 2} ${height / 2}) scale(${align.scale}) translate(${-width / 2} ${-height / 2})`

  return (
    <div
      className="relative h-full min-h-[360px] w-full overflow-hidden rounded-2xl bg-white ring-1 ring-[#2B1A18]/10"
      style={{ cursor: drawing ? 'crosshair' : undefined }}
      onWheel={(event) => {
        // No bloquear el scroll del modal: zoom solo con Ctrl/Cmd + rueda.
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        const delta = event.deltaY > 0 ? 0.9 : 1.1
        const next = Math.min(8, Math.max(0.05, Number((scaleRef.current * delta).toFixed(4))))
        scaleRef.current = next
        if (stageRef.current) {
          applyStageLayout(stageRef.current, width, height, next, offsetRef.current)
        }
        onScaleChange(next)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        if ((event.target as HTMLElement).closest('[data-vertex-handle="1"]')) return
        // No iniciar pan al tocar una zona (polygon / path / circle).
        if (
          !drawing &&
          (event.target as HTMLElement).closest('polygon, path, circle')
        ) {
          return
        }
        panRef.current = {
          x: event.clientX,
          y: event.clientY,
          ox: offsetRef.current.x,
          oy: offsetRef.current.y,
          moved: false,
        }
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (drawing) {
          const svg = event.currentTarget.querySelector('svg')
          if (svg instanceof SVGSVGElement) {
            paintRubber(clientToImage(event.clientX, event.clientY, svg, width, height))
          }
        }
        if (!panRef.current) return
        const dx = event.clientX - panRef.current.x
        const dy = event.clientY - panRef.current.y
        if (Math.hypot(dx, dy) > 5) panRef.current.moved = true
        if (!panRef.current.moved) return
        const nextOffset = { x: panRef.current.ox + dx, y: panRef.current.oy + dy }
        offsetRef.current = nextOffset
        if (stageRef.current) {
          stageRef.current.style.transform = stageTranslate(nextOffset)
        }
      }}
      onPointerUp={(event) => {
        const pan = panRef.current
        panRef.current = null
        if (!pan) return
        if (pan.moved) {
          onOffsetChange(offsetRef.current)
          return
        }
        if (drawing) {
          const svg = event.currentTarget.querySelector('svg')
          if (!(svg instanceof SVGSVGElement)) return
          addDraftPoint(clientToImage(event.clientX, event.clientY, svg, width, height))
          return
        }
        // Clic vacío: deseleccionar.
        if (!drawing) onSelect(null)
      }}
    >
      <div
        ref={stageRef}
        className="absolute left-1/2 top-1/2 origin-center"
        style={{
          width: width * scale,
          height: height * scale,
          transform: stageTranslate(offset),
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Plano arquitectónico"
          width={width}
          height={height}
          draggable={false}
          decoding="async"
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill [image-rendering:auto]"
        />

        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          onDoubleClick={(event) => {
            event.preventDefault()
            const points = draftRef.current
            if (drawing && points) {
              if (points.length >= 3) tryCloseDraft(points)
              return
            }
            if (!selected || selected.kind === 'circle') return
            const point = clientToImage(
              event.clientX,
              event.clientY,
              event.currentTarget,
              width,
              height,
            )
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
                editing={Boolean(selectedId) && apartment.id === selectedId && !drawing}
                suppressHits={handleDragging || (Boolean(selectedId) && apartment.id !== selectedId)}
                onHover={setHoveredId}
                onSelect={(id) => {
                  if (drawing || handleDragging) return
                  onSelect(id)
                }}
              />
            ))}

            {drawing ? (
              <g>
                <polyline
                  ref={rubberRef}
                  points={
                    draftPoints && draftPoints.length >= 2
                      ? polygonToSvgPoints(draftPoints)
                      : ''
                  }
                  fill="none"
                  stroke="rgba(120, 125, 98, 0.95)"
                  strokeWidth={Math.max(0.4, 0.6 / Math.max(scale, 0.05))}
                  strokeDasharray={`${3.5 / Math.max(scale, 0.05)} ${4 / Math.max(scale, 0.05)}`}
                  className="pointer-events-none"
                />
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
                    strokeWidth={Math.max(0.8, 1.1 / Math.max(scale, 0.05))}
                    className="pointer-events-none"
                  />
                ))}
              </g>
            ) : null}

            {selected && !drawing ? (
              <ApartmentEditor
                apartment={selected}
                scale={scale}
                onChange={updateApartment}
                onDragActiveChange={setHandleDragging}
              />
            ) : null}
          </g>
        </svg>
      </div>
    </div>
  )
}
