import type { TourWidth } from '@/lib/tour/pickTourWidth'

export type TourLight = 'dia' | 'noche'

export interface PanoramaKey {
  typology: string
  room: string
  /** null = ambiente neutro (p. ej. balcón), sin acabado en el filename. */
  finish: string | null
  light: TourLight
}

/** tipologia_ambiente_acabado_luz  |  tipologia_ambiente_luz (neutro) */
export function panoramaBaseName(key: PanoramaKey): string {
  if (!key.finish) return `${key.typology}_${key.room}_${key.light}`
  return `${key.typology}_${key.room}_${key.finish}_${key.light}`
}

/** {base}_{2048|4096}.webp */
export function panoramaFileName(key: PanoramaKey, width: TourWidth): string {
  return `${panoramaBaseName(key)}_${width}.webp`
}

export function panoramaPublicUrl(
  key: PanoramaKey,
  width: TourWidth,
  basePath = '/tours/demo',
): string {
  return `${basePath}/${panoramaFileName(key, width)}`
}

export function roomVariantKeys(
  typology: string,
  room: string,
  finishes: Array<string | null>,
  lights: readonly TourLight[],
): PanoramaKey[] {
  const list = finishes.length > 0 ? finishes : [null]
  return list.flatMap((finish) => lights.map((light) => ({ typology, room, finish, light })))
}
