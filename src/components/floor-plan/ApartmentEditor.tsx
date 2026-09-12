'use client'

import { useRef } from 'react'
import type { Apartment, Point } from '@/lib/floor-plan/types'
import {
  applyPolygonMeta,
  circleRadiusFromApartment,
  edgeMidpoint,
  normalizeCurves,
  polygonToSvgPath,
  rebuildCircleApartment,
} from '@/lib/floor-plan/geometry'
import type { FloorPlanOverlayAlign } from '@/lib/tour/floorPlanZones'
import { invertOverlayAlignPoint } from '@/lib/tour/floorPlanZones'

type ApartmentEditorProps = {
  apartment: Apartment
  scale: number
  overlayAlign?: FloorPlanOverlayAlign | null
  onChange: (next: Apartment) => void
  /** Mientras se arrastra un handle, el padre apaga hits de otras zonas. */
  onDragActiveChange?: (active: boolean) => void
}

function clientToImagePoint(
  event: PointerEvent | React.PointerEvent,
  svg: SVGSVGElement,
  width: number,
  height: number,
  align?: FloorPlanOverlayAlign | null,
): Point {
  const rect = svg.getBoundingClientRect()
  const rawX = ((event.clientX - rect.left) / rect.width) * width
  const rawY = ((event.clientY - rect.top) / rect.height) * height
  const inverted = invertOverlayAlignPoint(rawX, rawY, width, height, align)
  return [Math.round(inverted.x), Math.round(inverted.y)]
}

function handleRadius(scale: number) {
  return Math.max(5, Math.min(90, 7.5 / Math.max(scale, 0.05)))
}

/**
 * Gestos (sin mezclar):
 * - Arrastrar vértice = mover
 * - Clic derecho en vértice = borrar (mín. 3)
 * - Arrastrar + = crear/mover curva
 * - Clic derecho en + curvo = volver a recta
 * - Doble clic en + = agregar vértice en ese lado
 */
export function ApartmentEditor({
  apartment,
  scale,
  overlayAlign = null,
  onChange,
  onDragActiveChange,
}: ApartmentEditorProps) {
  const rHandle = handleRadius(scale)
  // Vértices: hit un poco más chico para no tapar el + del lado.
  const rHit = rHandle * 1.75
  const rMid = rHandle * 0.7
  const rMidHit = Math.max(rMid * 2.4, rHandle * 1.6)
  const stroke = 0.5 / Math.max(scale, 0.05)
  const guideStroke = 0.28 / Math.max(scale, 0.05)
  const guideDash = `${3.5 / Math.max(scale, 0.05)} ${4.5 / Math.max(scale, 0.05)}`
  const handleStroke = 1.25 / Math.max(scale, 0.05)
  const apartmentRef = useRef(apartment)
  apartmentRef.current = apartment

  const startDrag = (
    event: React.PointerEvent<SVGElement>,
    onMove: (point: Point) => void,
  ) => {
    event.stopPropagation()
    event.preventDefault()
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const width = Number(svg.viewBox.baseVal.width) || 1
    const height = Number(svg.viewBox.baseVal.height) || 1
    const target = event.currentTarget
    const pointerId = event.pointerId
    try {
      target.setPointerCapture(pointerId)
    } catch {
      /* ignore */
    }

    let finished = false
    onDragActiveChange?.(true)

    const cleanup = () => {
      if (finished) return
      finished = true
      try {
        target.releasePointerCapture(pointerId)
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
      onDragActiveChange?.(false)
    }

    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault()
      onMove(clientToImagePoint(moveEvent, svg, width, height, overlayAlign))
    }
    const handleUp = () => cleanup()

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
  }

  if (apartment.kind === 'circle') {
    const [cx, cy] = apartment.center
    const radius = circleRadiusFromApartment(apartment)
    const hx = cx + radius
    const hy = cy

    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="rgba(26, 39, 68, 0.12)"
          stroke="rgba(26, 39, 68, 0.95)"
          strokeWidth={stroke}
          className="pointer-events-none"
        />
        <circle
          cx={cx}
          cy={cy}
          r={rHit}
          fill="transparent"
          className="cursor-grab active:cursor-grabbing"
          data-vertex-handle="1"
          onPointerDown={(event) => {
            const origin: Point = [cx, cy]
            const svg = event.currentTarget.ownerSVGElement
            if (!svg) return
            const width = Number(svg.viewBox.baseVal.width) || 1
            const height = Number(svg.viewBox.baseVal.height) || 1
            const start = clientToImagePoint(event, svg, width, height, overlayAlign)
            startDrag(event, (point) => {
              onChange(
                rebuildCircleApartment(
                  apartmentRef.current,
                  origin[0] + (point[0] - start[0]),
                  origin[1] + (point[1] - start[1]),
                  radius,
                ),
              )
            })
          }}
        />
        <circle
          cx={cx}
          cy={cy}
          r={rHandle}
          fill="#1a2744"
          stroke="#fff"
          strokeWidth={handleStroke}
          className="pointer-events-none"
        />
        <circle
          cx={hx}
          cy={hy}
          r={rHit * 0.85}
          fill="transparent"
          className="cursor-ew-resize active:cursor-grabbing"
          data-vertex-handle="1"
          onPointerDown={(event) => {
            startDrag(event, (point) => {
              const current = apartmentRef.current
              const [ccx, ccy] = current.center
              onChange(
                rebuildCircleApartment(
                  current,
                  ccx,
                  ccy,
                  Math.max(8, Math.hypot(point[0] - ccx, point[1] - ccy)),
                ),
              )
            })
          }}
        />
        <circle
          cx={hx}
          cy={hy}
          r={rHandle * 0.8}
          fill="#787D62"
          stroke="#fff"
          strokeWidth={handleStroke}
          className="pointer-events-none"
        />
      </g>
    )
  }

  const curves = normalizeCurves(apartment.polygon, apartment.curves)

  const setEdgeCurve = (edgeIndex: number, control: Point | null) => {
    const current = apartmentRef.current
    if (current.kind === 'circle') return
    const nextCurves = [...normalizeCurves(current.polygon, current.curves)]
    nextCurves[edgeIndex] = control
    onChange({
      ...current,
      ...applyPolygonMeta(current.polygon, nextCurves),
      needsReview: false,
    })
  }

  const insertVertexOnEdge = (edgeIndex: number) => {
    const current = apartmentRef.current
    if (current.kind === 'circle') return
    const a = current.polygon[edgeIndex]
    const b = current.polygon[(edgeIndex + 1) % current.polygon.length]
    const mid = edgeMidpoint(a, b)
    const insertAt = edgeIndex + 1
    const polygon = [
      ...current.polygon.slice(0, insertAt),
      mid,
      ...current.polygon.slice(insertAt),
    ]
    const nextCurves = [...normalizeCurves(current.polygon, current.curves)]
    nextCurves.splice(insertAt, 0, null)
    nextCurves[edgeIndex] = null
    onChange({
      ...current,
      ...applyPolygonMeta(polygon, nextCurves),
      needsReview: false,
    })
  }

  const removeVertex = (vertexIndex: number) => {
    const current = apartmentRef.current
    if (current.kind === 'circle') return
    if (current.polygon.length <= 3) return
    const polygon = current.polygon.filter((_, i) => i !== vertexIndex)
    const kept = normalizeCurves(current.polygon, current.curves).filter(
      (_, i) => i !== vertexIndex,
    )
    const clearIdx = vertexIndex === 0 ? kept.length - 1 : vertexIndex - 1
    if (clearIdx >= 0 && clearIdx < kept.length) kept[clearIdx] = null
    onChange({
      ...current,
      ...applyPolygonMeta(polygon, kept),
      needsReview: false,
    })
  }

  return (
    <g>
      <path
        d={polygonToSvgPath(apartment.polygon, curves)}
        fill="rgba(120, 125, 98, 0.08)"
        stroke="#787D62"
        strokeWidth={stroke}
        className="pointer-events-none"
      />

      {/* Vértices debajo: el + del lado queda arriba y no se confunde al curvar. */}
      {apartment.polygon.map((point, index) => (
        <g key={`${apartment.id}-v-${index}`}>
          <circle
            cx={point[0]}
            cy={point[1]}
            r={rHit}
            fill="transparent"
            className="cursor-grab active:cursor-grabbing"
            data-vertex-handle="1"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              const vertexIndex = index
              startDrag(event, ([x, y]) => {
                const current = apartmentRef.current
                if (current.kind === 'circle') return
                const polygon = current.polygon.map((p, i) =>
                  i === vertexIndex ? ([x, y] as Point) : p,
                )
                onChange({
                  ...current,
                  ...applyPolygonMeta(
                    polygon,
                    normalizeCurves(current.polygon, current.curves),
                  ),
                  needsReview: false,
                })
              })
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              removeVertex(index)
            }}
          />
          <circle
            cx={point[0]}
            cy={point[1]}
            r={rHandle}
            fill="#1a2744"
            stroke="#fff"
            strokeWidth={handleStroke}
            className="pointer-events-none"
          />
        </g>
      ))}

      {apartment.polygon.map((point, index) => {
        const next = apartment.polygon[(index + 1) % apartment.polygon.length]
        const control = curves[index]
        const handle = control ?? edgeMidpoint(point, next)
        const curved = Boolean(control)
        const edgeIndex = index

        return (
          <g key={`${apartment.id}-edge-${index}`}>
            {curved ? (
              <>
                <line
                  x1={point[0]}
                  y1={point[1]}
                  x2={handle[0]}
                  y2={handle[1]}
                  stroke="rgba(120, 125, 98, 0.65)"
                  strokeWidth={guideStroke}
                  strokeDasharray={guideDash}
                  className="pointer-events-none"
                />
                <line
                  x1={handle[0]}
                  y1={handle[1]}
                  x2={next[0]}
                  y2={next[1]}
                  stroke="rgba(120, 125, 98, 0.65)"
                  strokeWidth={guideStroke}
                  strokeDasharray={guideDash}
                  className="pointer-events-none"
                />
              </>
            ) : null}
            <circle
              cx={handle[0]}
              cy={handle[1]}
              r={rMidHit}
              fill="transparent"
              className="cursor-grab active:cursor-grabbing"
              data-vertex-handle="1"
              onPointerDown={(event) => {
                if (event.button !== 0) return
                startDrag(event, (point) => {
                  setEdgeCurve(edgeIndex, point)
                })
              }}
              onDoubleClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                // Doble clic en + = agregar vértice (no al soltar un arrastre).
                insertVertexOnEdge(edgeIndex)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (!curved) return
                setEdgeCurve(edgeIndex, null)
              }}
            />
            <circle
              cx={handle[0]}
              cy={handle[1]}
              r={rMid}
              fill={curved ? '#787D62' : '#fff'}
              stroke="#787D62"
              strokeWidth={handleStroke}
              className="pointer-events-none"
            />
            <text
              x={handle[0]}
              y={handle[1]}
              textAnchor="middle"
              dominantBaseline="central"
              className="pointer-events-none select-none"
              style={{
                fontSize: Math.max(8, 9 / Math.max(scale, 0.05)),
                fill: curved ? '#fff' : '#787D62',
                fontWeight: 700,
              }}
            >
              +
            </text>
          </g>
        )
      })}
    </g>
  )
}
