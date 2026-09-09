'use client'

import type { Apartment, Point } from '@/lib/floor-plan/types'

type ApartmentEditorProps = {
  apartment: Apartment
  onChange: (next: Apartment) => void
}

function clientToImagePoint(
  event: React.PointerEvent<SVGSVGElement>,
  svg: SVGSVGElement,
  width: number,
  height: number,
): Point {
  const rect = svg.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * width
  const y = ((event.clientY - rect.top) / rect.height) * height
  return [Math.round(x), Math.round(y)]
}

export function ApartmentEditor({ apartment, onChange }: ApartmentEditorProps) {
  return (
    <g>
      {apartment.polygon.map((point, index) => (
        <circle
          key={`${apartment.id}-v-${index}`}
          cx={point[0]}
          cy={point[1]}
          r={6}
          fill="#1a2744"
          stroke="#fff"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={(event) => {
            event.stopPropagation()
            const svg = event.currentTarget.ownerSVGElement
            if (!svg) return
            const width = Number(svg.viewBox.baseVal.width) || 1
            const height = Number(svg.viewBox.baseVal.height) || 1
            const target = event.currentTarget
            target.setPointerCapture(event.pointerId)

            const onMove = (moveEvent: PointerEvent) => {
              const [x, y] = clientToImagePoint(
                moveEvent as unknown as React.PointerEvent<SVGSVGElement>,
                svg,
                width,
                height,
              )
              const polygon = apartment.polygon.map((p, i) => (i === index ? ([x, y] as Point) : p))
              const xs = polygon.map((p) => p[0])
              const ys = polygon.map((p) => p[1])
              const x0 = Math.min(...xs)
              const y0 = Math.min(...ys)
              const x1 = Math.max(...xs)
              const y1 = Math.max(...ys)
              onChange({
                ...apartment,
                polygon,
                bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
                center: [(x0 + x1) / 2, (y0 + y1) / 2],
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
            const xs = polygon.map((p) => p[0])
            const ys = polygon.map((p) => p[1])
            const x0 = Math.min(...xs)
            const y0 = Math.min(...ys)
            const x1 = Math.max(...xs)
            const y1 = Math.max(...ys)
            onChange({
              ...apartment,
              polygon,
              bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
              center: [(x0 + x1) / 2, (y0 + y1) / 2],
            })
          }}
        />
      ))}
    </g>
  )
}
