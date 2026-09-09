'use client'

import type { Apartment } from '@/lib/floor-plan/types'
import { polygonToSvgPoints } from '@/lib/floor-plan/api'
import { cn } from '@/lib/utils'

type ApartmentPolygonProps = {
  apartment: Apartment
  selected: boolean
  hovered: boolean
  editing: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

export function ApartmentPolygon({
  apartment,
  selected,
  hovered,
  editing,
  onHover,
  onSelect,
}: ApartmentPolygonProps) {
  const active = selected || hovered
  return (
    <polygon
      points={polygonToSvgPoints(apartment.polygon)}
      fill="transparent"
      stroke={
        selected
          ? 'rgba(26, 39, 68, 0.95)'
          : hovered
            ? 'rgba(26, 39, 68, 0.7)'
            : 'transparent'
      }
      strokeWidth={selected ? 3 : hovered ? 2 : 0}
      vectorEffect="non-scaling-stroke"
      className={cn('cursor-pointer', editing && selected && 'pointer-events-none')}
      onMouseEnter={() => onHover(apartment.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(apartment.id)
      }}
    />
  )
}
