'use client'

import type { Apartment } from '@/lib/floor-plan/types'
import { polygonToSvgPoints } from '@/lib/floor-plan/api'
import { circleRadiusFromApartment } from '@/lib/floor-plan/geometry'
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
  const stroke = selected
    ? 'rgba(26, 39, 68, 0.95)'
    : hovered
      ? 'rgba(26, 39, 68, 0.7)'
      : 'transparent'
  const strokeWidth = selected ? 3 : hovered ? 2 : 0
  const className = cn('cursor-pointer', editing && selected && 'pointer-events-none')
  const handlers = {
    onMouseEnter: () => onHover(apartment.id),
    onMouseLeave: () => onHover(null),
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation()
      onSelect(apartment.id)
    },
  }

  if (apartment.kind === 'circle') {
    const [cx, cy] = apartment.center
    const r = circleRadiusFromApartment(apartment)
    return (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={selected || hovered ? 'rgba(26, 39, 68, 0.14)' : 'transparent'}
        stroke={stroke}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
        className={className}
        {...handlers}
      />
    )
  }

  return (
    <polygon
      points={polygonToSvgPoints(apartment.polygon)}
      fill={selected || hovered ? 'rgba(26, 39, 68, 0.1)' : 'transparent'}
      stroke={stroke}
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
      className={className}
      {...handlers}
    />
  )
}
