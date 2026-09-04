import type { TourLightMode, TourRoomScene } from '@/types/tour'
import type { TourWidth } from '@/lib/tour/pickTourWidth'

export const TOUR_SCENE_LIGHTS: { slug: TourLightMode; label: string }[] = [
  { slug: 'dia', label: 'Día' },
  { slug: 'noche', label: 'Noche' },
]

export type RoomSceneKey = {
  room: string
  finish: string | null
  light: TourLightMode
}

const ROOM_HEAD_RE =
  /^(tour-360|dormitorio-\d+|bano-completo-\d+|bano-social-\d+|sala|comedor|cocina|estar|estudio|lavado|despensa|terraza|balcon|bodega|dormitorio|bano-completo|bano-social)(?:_(.+))?$/

export function sceneToken(finish: string | null | undefined, light: TourLightMode) {
  return finish ? `${finish}_${light}` : light
}

export function roomSceneFileName(key: RoomSceneKey, width?: 4096 | 8192) {
  const base = `${key.room}_${sceneToken(key.finish, key.light)}`
  if (width === 8192) return `${base}_8192.webp`
  return `${base}.webp`
}

export function parseRoomSceneFileName(fileName: string): {
  room: string
  finish: string | null
  light: TourLightMode | null
  width: 2048 | 4096 | 8192 | null
} | null {
  let base = fileName.replace(/\.[^.]+$/, '')
  let width: 2048 | 4096 | 8192 | null = null
  const widthMatch = base.match(/_(2048|4096|8192)$/i)
  if (widthMatch) {
    width = Number(widthMatch[1]) as 2048 | 4096 | 8192
    base = base.slice(0, -widthMatch[0].length)
  }

  let light: TourLightMode | null = null
  if (base.endsWith('_dia')) {
    light = 'dia'
    base = base.slice(0, -4)
  } else if (base.endsWith('_noche')) {
    light = 'noche'
    base = base.slice(0, -6)
  }

  const match = base.match(ROOM_HEAD_RE)
  if (!match) return null
  return {
    room: match[1],
    finish: match[2] || null,
    light,
    width,
  }
}

export function fileMatchesRoom(fileName: string, room: string) {
  const parsed = parseRoomSceneFileName(fileName)
  if (parsed?.room === room) return true
  if (room === 'tour-360') {
    return /(?:^|[._-])(360|pano|equirect|panorama)(?:[._-]|$)/i.test(fileName.replace(/\.[^.]+$/, ''))
  }
  const base = fileName.replace(/\.[^.]+$/, '')
  return base === room || base.startsWith(`${room}_`)
}

export function isLegacySceneFile(fileName: string, room?: string) {
  if (/_8192\b/i.test(fileName)) return false
  const parsed = parseRoomSceneFileName(fileName)
  if (!parsed) return false
  if (room && parsed.room !== room) return false
  return parsed.finish == null && parsed.light == null
}

export function findLegacyRoomAsset<T extends { file_name: string }>(assets: T[], room: string) {
  const exact = assets.find((item) => item.file_name === (room === 'tour-360' ? 'tour-360.webp' : `${room}.webp`))
  if (exact) return exact
  const parsedLegacy = assets.find((item) => isLegacySceneFile(item.file_name, room))
  if (parsedLegacy) return parsedLegacy
  if (room !== 'tour-360') return undefined
  return assets.find((item) => {
    if (/_8192\b/i.test(item.file_name)) return false
    const parsed = parseRoomSceneFileName(item.file_name)
    if (parsed?.finish || parsed?.light) return false
    return /(?:^|[._-])(360|pano|equirect|panorama)(?:[._-]|$)/i.test(item.file_name.replace(/\.[^.]+$/, ''))
  })
}

export function fileMatchesScene(
  fileName: string,
  room: string,
  finish: string | null,
  light: TourLightMode,
) {
  const parsed = parseRoomSceneFileName(fileName)
  if (!parsed || parsed.room !== room || parsed.light !== light) return false
  if (finish == null) return parsed.finish == null
  return parsed.finish === finish
}

export function sceneCombos(
  finishes: Array<{ slug: string; name?: string }>,
): Array<{ finish: string | null; light: TourLightMode; label: string }> {
  const lights = TOUR_SCENE_LIGHTS
  if (finishes.length === 0) {
    return lights.map((item) => ({
      finish: null,
      light: item.slug,
      label: item.label,
    }))
  }
  return finishes.flatMap((finish) =>
    lights.map((item) => ({
      finish: finish.slug,
      light: item.slug,
      label: `${finish.name ?? finish.slug} · ${item.label}`,
    })),
  )
}

export function pickRoomScene(
  scenes: TourRoomScene[] | undefined,
  finish: string | null | undefined,
  light: TourLightMode,
): TourRoomScene | undefined {
  if (!scenes?.length) return undefined
  const wanted = finish || null
  return (
    scenes.find((item) => item.finish === wanted && item.light === light) ??
    scenes.find((item) => item.finish == null && item.light === light) ??
    scenes.find((item) => item.finish === wanted && item.light === 'dia') ??
    scenes.find((item) => item.finish == null && item.light === 'dia') ??
    scenes.find((item) => item.light === light) ??
    scenes[0]
  )
}

export function buildRoomScenes(
  assets: Array<{ file_name: string; url: string }>,
  room: string,
): TourRoomScene[] {
  const groups = new Map<string, TourRoomScene>()
  for (const item of assets) {
    if (!fileMatchesRoom(item.file_name, room)) continue
    const parsed = parseRoomSceneFileName(item.file_name)
    const finish = parsed?.finish ?? null
    const light = parsed?.light ?? 'dia'
    const key = sceneToken(finish, light)
    const current =
      groups.get(key) ??
      ({
        key,
        finish,
        light,
        url: item.url,
        file_name: item.file_name,
        widths: {},
      } satisfies TourRoomScene)
    const width = parsed?.width
    if (width) {
      current.widths = { ...current.widths, [String(width)]: item.url }
      if (width === 4096) {
        current.url = item.url
        current.file_name = item.file_name
      }
    } else {
      current.url = item.url
      current.file_name = item.file_name
      if (room === 'tour-360') {
        current.widths = { ...current.widths, '4096': item.url }
      }
    }
    groups.set(key, current)
  }
  return [...groups.values()]
}

export function pickSceneUrl(
  scene: TourRoomScene | undefined,
  width?: TourWidth,
): string | null {
  if (!scene) return null
  const widths = scene.widths ?? {}
  if (width && width >= 8192 && widths['8192']) return widths['8192']
  if (widths['4096']) return widths['4096']
  if (widths['2048']) return widths['2048']
  return scene.url
}
