import {
  panoramaPublicUrl,
  roomVariantKeys,
  type PanoramaKey,
  type TourLight,
} from '@/lib/tour/panoramaPath'
import type { TourWidth } from '@/lib/tour/pickTourWidth'

export const DEMO_TYPOLOGY = 'tipo_a'
export const DEMO_ROOM = 'sala'
export const DEMO_FINISHES = ['nogal', 'roble'] as const
export const DEMO_LIGHTS: readonly TourLight[] = ['dia', 'noche']

export const FINISH_LABELS: Record<(typeof DEMO_FINISHES)[number], string> = {
  nogal: 'Nogal',
  roble: 'Roble',
}

export function demoKey(finish: string | null, light: TourLight): PanoramaKey {
  return {
    typology: DEMO_TYPOLOGY,
    room: DEMO_ROOM,
    finish,
    light,
  }
}

export function demoPanoramaUrl(
  key: Pick<PanoramaKey, 'finish' | 'light'>,
  width: TourWidth,
): string {
  return panoramaPublicUrl(demoKey(key.finish ?? null, key.light), width)
}

export function demoRoomVariantUrls(width: TourWidth, current?: string): string[] {
  return roomVariantKeys(DEMO_TYPOLOGY, DEMO_ROOM, [...DEMO_FINISHES], DEMO_LIGHTS)
    .map((key) => panoramaPublicUrl(key, width))
    .filter((url) => url !== current)
}

export function demoCaption(finish: string, light: TourLight): string {
  const finishLabel = FINISH_LABELS[finish as keyof typeof FINISH_LABELS] ?? finish
  return `Sala · ${finishLabel} · ${light === 'dia' ? 'Día' : 'Noche'}`
}
