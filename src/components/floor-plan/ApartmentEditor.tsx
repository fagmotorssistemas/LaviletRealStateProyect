'use client'

import type { Apartment, Point } from '@/lib/floor-plan/types'
import {
  circleRadiusFromApartment,
  rebuildCircleApartment,
} from '@/lib/floor-plan/geometry'

type ApartmentEditorProps = {
  apartment: Apartment
  scale: number
  onChange: (next: Apartment) => void
}

function clientToImagePoint(
  event: PointerEvent | React.PointerEvent,
  svg: SVGSVGElement,
  width: number,
  height: number,
): Point {
  const rect = svg.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * width
  const y = ((event.clientY - rect.top) / rect.height) * height
  return [Math.round(x), Math.round(y)]
}

function handleRadius(scale: number) {
  return Math.max(8, Math.min(28, 12 / Math.max(scale, 0.05)))
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

export function ApartmentEditor({ apartment, scale, onChange }: ApartmentEditorProps) {
  const rHandle = handleRadius(scale)

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
          strokeWidth={Math.max(2, 2 / Math.max(scale, 0.05))}
          vectorEffect="non-scaling-stroke"
          className="pointer-events-none"
        />
        <circle
          cx={cx}
          cy={cy}
          r={rHandle}
          fill="#1a2744"
          stroke="#fff"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          className="cursor-grab active:cursor-grabbing"
          data-vertex-handle="1"
          onPointerDown={(event) => {
            event.stopPropagation()
            const svg = event.currentTarget.ownerSVGElement
            if (!svg) return
            const width = Number(svg.viewBox.baseVal.width) || 1
            const height = Number(svg.viewBox.baseVal.height) || 1
            const target = event.currentTarget
            target.setPointerCapture(event.pointerId)
            const start = clientToImagePoint(event, svg, width, height)
            const origin: Point = [cx, cy]

            const onMove = (moveEvent: PointerEvent) => {
              const [x, y] = clientToImagePoint(moveEvent, svg, width, height)
              const nx = origin[0] + (x - start[0])
              const ny = origin[1] + (y - start[1])
              onChange(rebuildCircleApartment(apartment, nx, ny, radius))
            }
            const onUp = () => {
              target.releasePointerCapture(event.pointerId)
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
        />
        <circle
          cx={hx}
          cy={hy}
          r={rHandle * 0.85}
          fill="#787D62"
          stroke="#fff"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          className="cursor-ew-resize active:cursor-grabbing"
          data-vertex-handle="1"
          onPointerDown={(event) => {
            event.stopPropagation()
            const svg = event.currentTarget.ownerSVGElement
            if (!svg) return
            const width = Number(svg.viewBox.baseVal.width) || 1
            const height = Number(svg.viewBox.baseVal.height) || 1
            const target = event.currentTarget
            target.setPointerCapture(event.pointerId)

            const onMove = (moveEvent: PointerEvent) => {
              const [x, y] = clientToImagePoint(moveEvent, svg, width, height)
              const nextR = Math.max(8, Math.hypot(x - cx, y - cy))
              onChange(rebuildCircleApartment(apartment, cx, cy, nextR))
            }
            const onUp = () => {
              target.releasePointerCapture(event.pointerId)
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
        />
      </g>
    )
  }

  return (
    <g>
      {apartment.polygon.map((point, index) => (
        <circle
          key={`${apartment.id}-v-${index}`}
          cx={point[0]}
          cy={point[1]}
          r={rHandle}
          fill="#1a2744"
          stroke="#fff"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          className="cursor-grab active:cursor-grabbing"
          data-vertex-handle="1"
          onPointerDown={(event) => {
            event.stopPropagation()
            const svg = event.currentTarget.ownerSVGElement
            if (!svg) return
            const width = Number(svg.viewBox.baseVal.width) || 1
            const height = Number(svg.viewBox.baseVal.height) || 1
            const target = event.currentTarget
            target.setPointerCapture(event.pointerId)

            const onMove = (moveEvent: PointerEvent) => {
              const [x, y] = clientToImagePoint(moveEvent, svg, width, height)
              const polygon = apartment.polygon.map((p, i) => (i === index ? ([x, y] as Point) : p))
              onChange({
                ...apartment,
                ...applyPolygonMeta(polygon),
                needsReview: false,
              })
            }
            const onUp = () => {
              target.releasePointerCapture(event.pointerId)
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (apartment.polygon.length <= 3) return
            const polygon = apartment.polygon.filter((_, i) => i !== index)
            onChange({
              ...apartment,
              ...applyPolygonMeta(polygon),
            })
          }}
        />
      ))}
    </g>
  )
}
