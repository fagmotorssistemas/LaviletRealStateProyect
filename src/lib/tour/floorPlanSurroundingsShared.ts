export type SurroundingsLayer = {
  x: number
  y: number
  scale: number
  /** Grados. En el fondo queda en 0. En el plano inclina la imagen. */
  rotation: number
}

export type SurroundingsPlanFile = {
  path: string
  url: string
  width: number
  height: number
}

export const DEFAULT_SURROUNDINGS_LAYER: SurroundingsLayer = { x: 0, y: 0, scale: 1, rotation: 0 }

export type SurroundingsPlanPlacement = {
  centerX: number
  centerY: number
  width: number
  height: number
  rotation: number
}

export type FloorPlanSurroundingsDoc = {
  typologyCode: string
  originalPath: string | null
  originalUrl: string | null
  originalWidth: number
  originalHeight: number
  capturePath: string | null
  captureUrl: string | null
  captureWidth: number
  captureHeight: number
  /** Desplazamiento y zoom del fondo. scale 1 = encajar en el visor. */
  background: SurroundingsLayer
  /** Desplazamiento y zoom del plano. El mismo tamaño para todos los pisos. */
  planLayer: SurroundingsLayer
  plans: Record<string, SurroundingsPlanFile>
  updatedAt: string
}

export type SurroundingsCrop = {
  x: number
  y: number
  width: number
  height: number
}
