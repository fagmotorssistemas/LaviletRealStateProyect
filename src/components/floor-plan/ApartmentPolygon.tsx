'use client'

import type { CSSProperties } from 'react'
import type { Apartment } from '@/lib/floor-plan/types'
import { polygonToSvgPoints } from '@/lib/floor-plan/api'
import {
  circleRadiusFromApartment,
  polygonToSvgPath,
} from '@/lib/floor-plan/geometry'
import { cn } from '@/lib/utils'

type ApartmentPolygonProps = {
  apartment: Apartment
  selected: boolean
  hovered: boolean
  editing: boolean
  /** Apaga hits para poder arrastrar puntos encima de zonas vecinas. */
  suppressHits?: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

export function ApartmentPolygon({
  apartment,
  selected,
  hovered,
  editing,
  suppressHits = false,
  onHover,
  onSelect,
}: ApartmentPolygonProps) {
  const stroke = selected
    ? 'rgba(26, 39, 68, 0.55)'
    : hovered
      ? 'rgba(120, 125, 98, 0.7)'
      : 'rgba(26, 39, 68, 0.28)'
  // Si está en edición, el editor dibuja el contorno: acá casi no trazar para no engrosar.
  const strokeWidth = editing && selected ? 0 : selected ? 0.7 : hovered ? 0.6 : 0.5
  const fill = selected
    ? 'rgba(26, 39, 68, 0.16)'
    : hovered
      ? 'rgba(120, 125, 98, 0.14)'
      : 'rgba(26, 39, 68, 0.06)'
  // Clickeable en el plano; la zona seleccionada cede eventos a los handles de edición.
  const className = cn('cursor-pointer')
  const handlers = {
    onMouseEnter: () => onHover(apartment.id),
    onMouseLeave: () => onHover(null),
    onPointerDown: (event: React.PointerEvent) => {
      if (editing && selected) return
      event.stopPropagation()
      onSelect(apartment.id)
    },
  }
  const shapeStyle: CSSProperties = {
    // Mientras se edita / arrastra, las otras zonas no deben robar el pointer.
    pointerEvents: suppressHits || (editing && selected) ? 'none' : 'all',
    cursor: 'pointer',
  }

  if (apartment.kind === 'circle') {
    const [cx, cy] = apartment.center
    const r = circleRadiusFromApartment(apartment)
    return (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
        style={shapeStyle}
        data-zone-id={apartment.id}
        className={className}
        {...handlers}
      />
    )
  }

  const hasCurves = apartment.curves?.some(Boolean)
  if (hasCurves) {
    return (
      <path
        d={polygonToSvgPath(apartment.polygon, apartment.curves)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
        style={shapeStyle}
        data-zone-id={apartment.id}
        className={className}
        {...handlers}
      />
    )
  }

  return (
    <polygon
      points={polygonToSvgPoints(apartment.polygon)}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
      style={shapeStyle}
      data-zone-id={apartment.id}
      className={className}
      {...handlers}
    />
  )
}
