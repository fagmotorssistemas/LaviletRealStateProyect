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
  onSelect: (id: string, opts?: { additive?: boolean }) => void
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
    ? 'rgba(61, 155, 74, 0.95)'
    : hovered
      ? 'rgba(120, 125, 98, 0.9)'
      : 'rgba(255, 255, 255, 0.55)'
  // Si está en edición, el editor dibuja el contorno: acá casi no trazar para no engrosar.
  const strokeWidth = editing && selected ? 0 : selected ? 0.85 : hovered ? 0.7 : 0.55
  const fill = selected
    ? 'rgba(61, 155, 74, 0.32)'
    : hovered
      ? 'rgba(120, 125, 98, 0.28)'
      : 'rgba(120, 125, 98, 0.18)'
  // Clickeable en el plano; la zona seleccionada cede eventos a los handles de edición.
  const className = cn('cursor-pointer')
  const handlers = {
    onMouseEnter: () => onHover(apartment.id),
    onMouseLeave: () => onHover(null),
    onPointerDown: (event: React.PointerEvent) => {
      if (editing && selected) return
      event.stopPropagation()
      onSelect(apartment.id, {
        additive: event.ctrlKey || event.metaKey || event.shiftKey,
      })
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
