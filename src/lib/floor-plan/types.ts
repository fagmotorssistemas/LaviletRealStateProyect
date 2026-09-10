export type Point = [number, number]

export type BoundingBox = {
  x: number
  y: number
  width: number
  height: number
}

export type ApartmentKind = 'polygon' | 'circle'

export type Apartment = {
  id: string
  polygon: Point[]
  bbox: BoundingBox
  center: [number, number]
  area?: number
  confidence: number
  needsReview?: boolean
  labelConfidence?: number
  /** Zona circular (polígono aproximado para el showroom). */
  kind?: ApartmentKind
  /**
   * Control de curva cuadrática por arista (mismo índice que el vértice de inicio).
   * `null` / ausente = lado recto. Longitud = polygon.length.
   */
  curves?: (Point | null)[]
}
