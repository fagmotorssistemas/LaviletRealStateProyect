import type { TourLightMode, TourRoomScene } from '@/types/tour'
import {
  assetRevision,
  pointerIsCoarse,
  publicAssetVersion,
  tourCoarsePanoUrl,
  tourDisplayUrl,
  variantIsCurrent,
  type TourWidth,
} from '@/lib/tour/pickTourWidth'
import { roomsShareSlot, roomSlugAliases, isExcludedTourSpace } from '@/lib/tour/tourRooms'

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
  /^(tour-360|vista-[a-z0-9-]+|dormitorio-\d+|bano-completo-\d+|bano-social-\d+|sala|comedor|cocina|estar|estudio|lavado|despensa|terraza|balcon|dormitorio|bano-completo|bano-social)(?:_(.+))?$/

export function sceneToken(finish: string | null | undefined, light: TourLightMode) {
  return finish ? `${finish}_${light}` : light
}

export function roomSceneFileName(
  key: RoomSceneKey,
  width?: 2048 | 4096 | 8192,
  ext: string = 'webp',
) {
  const safeExt = (ext.replace(/^\./, '').toLowerCase() || 'webp').replace(/jpeg/, 'jpg')
  const base = `${key.room}_${sceneToken(key.finish, key.light)}`
  if (width === 2048 || width === 4096 || width === 8192) return `${base}_${width}.${safeExt}`
  return `${base}.${safeExt}`
}

/** Cada subida lleva un id nuevo en el nombre para no reutilizar la URL cacheada. */
export function withSceneRevision(fileName: string, revision = Date.now()) {
  const ext = (fileName.match(/\.([^.]+)$/)?.[1] || 'webp').toLowerCase()
  const base = fileName.replace(/\.[^.]+$/, '').replace(/-r\d+$/i, '')
  return `${base}-r${revision}.${ext}`
}

export function parseRoomSceneFileName(fileName: string): {
  room: string
  finish: string | null
  light: TourLightMode | null
  width: 2048 | 4096 | 8192 | null
} | null {
  let base = fileName.replace(/\.[^.]+$/, '').replace(/-r\d+$/i, '')
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
  if (isExcludedTourSpace(match[1])) return null
  return {
    room: match[1],
    finish: match[2] || null,
    light,
    width,
  }
}

export function finishesMatch(left: string | null, right: string | null) {
  if (left === right) return true
  if (!left || !right) return false
  const groups = [
    ['nogal', 'acabado-1'],
    ['roble', 'acabado-2'],
  ]
  return groups.some((group) => group.includes(left) && group.includes(right))
}

/** Agrupa aliases de acabado para no mostrar el mismo render en dos celdas del admin. */
export function canonicalFinishSlug(finish: string | null | undefined): string | null {
  if (finish == null || finish === '') return null
  if (finish === 'nogal' || finish === 'acabado-1') return 'acabado-1'
  if (finish === 'roble' || finish === 'acabado-2') return 'acabado-2'
  return finish
}

export function fileMatchesRoom(fileName: string, room: string) {
  const parsed = parseRoomSceneFileName(fileName)
  if (parsed && roomsShareSlot(parsed.room, room)) return true
  if (room === 'tour-360') {
    return /(?:^|[._-])(360|pano|equirect|panorama)(?:[._-]|$)/i.test(fileName.replace(/\.[^.]+$/, ''))
  }
  const base = fileName.replace(/\.[^.]+$/, '')
  return roomSlugAliases(room).some((alias) => base === alias || base.startsWith(`${alias}_`))
}

export function isLegacySceneFile(fileName: string, room?: string) {
  if (/_(?:2048|4096|8192)\b/i.test(fileName)) return false
  const parsed = parseRoomSceneFileName(fileName)
  if (!parsed) return false
  if (room && !roomsShareSlot(parsed.room, room)) return false
  return parsed.finish == null && parsed.light == null
}

export function findLegacyRoomAsset<T extends { file_name: string }>(assets: T[], room: string) {
  const exact = assets.find((item) =>
    roomSlugAliases(room).some((alias) => {
      const base = item.file_name.replace(/\.[^.]+$/, '')
      return alias === 'tour-360' ? base === 'tour-360' : base === alias
    }),
  )
  if (exact) return exact
  const parsedLegacy = assets.find((item) =>
    roomSlugAliases(room).some((alias) => isLegacySceneFile(item.file_name, alias)),
  )
  if (parsedLegacy) return parsedLegacy
  if (room !== 'tour-360') return undefined
  return assets.find((item) => {
    if (/_(?:2048|4096|8192)\b/i.test(item.file_name)) return false
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
  options?: { exactRoom?: boolean },
) {
  const parsed = parseRoomSceneFileName(fileName)
  if (!parsed || parsed.light !== light) return false
  const roomOk = options?.exactRoom
    ? parsed.room === room
    : roomsShareSlot(parsed.room, room)
  if (!roomOk) return false
  if (finish == null) return parsed.finish == null
  // En grilla admin (exactRoom): mismo acabado o el mismo alias canónico, sin cruzar ambientes.
  if (options?.exactRoom) {
    return (
      parsed.finish === finish ||
      canonicalFinishSlug(parsed.finish) === canonicalFinishSlug(finish)
    )
  }
  return finishesMatch(parsed.finish, finish)
}

/** Los dos acabados tienen al menos una imagen con URL. */
export function hasImagesInBothFinishes(
  rooms: Array<{ scenes?: Array<{ finish: string | null; url?: string | null }> }> | undefined,
  finishes: Array<{ slug: string }> | undefined,
): boolean {
  const wanted = [
    ...new Set(
      (finishes ?? []).map((item) => canonicalFinishSlug(item.slug)).filter((slug): slug is string => Boolean(slug)),
    ),
  ]
  if (wanted.length < 2) return false
  const present = new Set<string>()
  for (const room of rooms ?? []) {
    for (const scene of room.scenes ?? []) {
      if (!scene.url) continue
      const slug = canonicalFinishSlug(scene.finish)
      if (slug) present.add(slug)
    }
  }
  return wanted.every((slug) => present.has(slug))
}

/** Ese ambiente, con la luz actual, tiene url en los dos acabados. */
export function hasBothFinishesForRoom(
  room: { scenes?: Array<{ finish: string | null; light?: string | null; url?: string | null }> } | null | undefined,
  finishes: Array<{ slug: string }> | undefined,
  light: string,
): boolean {
  const wanted = [
    ...new Set(
      (finishes ?? []).map((item) => canonicalFinishSlug(item.slug)).filter((slug): slug is string => Boolean(slug)),
    ),
  ]
  if (wanted.length < 2) return false
  const present = new Set<string>()
  for (const scene of room?.scenes ?? []) {
    if (!scene.url || (scene.light && scene.light !== light)) continue
    const slug = canonicalFinishSlug(scene.finish)
    if (slug) present.add(slug)
  }
  return wanted.every((slug) => present.has(slug))
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
    scenes.find((item) => finishesMatch(item.finish, wanted) && item.light === light) ??
    scenes.find((item) => item.finish === wanted && item.light === light) ??
    scenes.find((item) => item.finish == null && item.light === light) ??
    scenes.find((item) => finishesMatch(item.finish, wanted) && item.light === 'dia') ??
    scenes.find((item) => item.finish === wanted && item.light === 'dia') ??
    scenes.find((item) => item.finish == null && item.light === 'dia') ??
    scenes.find((item) => item.light === light) ??
    scenes[0]
  )
}

function preferSceneFile(
  currentUrl: string | undefined,
  currentName: string | undefined,
  nextUrl: string,
  nextName: string,
) {
  const currentWebp = /\.webp$/i.test(currentName || '')
  const nextWebp = /\.webp$/i.test(nextName)
  const currentPng = /\.png$/i.test(currentName || '')
  const nextPng = /\.png$/i.test(nextName)
  if (currentWebp && nextPng) return false
  if (currentPng && nextWebp) return true
  const currentVersion = publicAssetVersion(currentUrl)
  const nextVersion = publicAssetVersion(nextUrl)
  if (nextVersion !== currentVersion) return nextVersion > currentVersion
  return sceneFilePreference(nextName) >= sceneFilePreference(currentName || '')
}

/** Prioriza WebP (convertido) sobre PNG/JPG pesados del mismo ambiente. */
function sceneFilePreference(fileName: string): number {
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
  if (ext === 'webp') return 3
  if (ext === 'jpg' || ext === 'jpeg') return 2
  if (ext === 'png') return 1
  return 0
}

export function buildRoomScenes(
  assets: Array<{ file_name: string; url: string }>,
  room: string,
): TourRoomScene[] {
  const groups = new Map<string, TourRoomScene>()
  const widthNames = new Map<string, Partial<Record<'2048' | '4096' | '8192', string>>>()
  for (const item of assets) {
    if (!fileMatchesRoom(item.file_name, room)) continue
    const parsed = parseRoomSceneFileName(item.file_name)
    const finish = canonicalFinishSlug(parsed?.finish ?? null)
    const light = parsed?.light ?? 'dia'
    const key = sceneToken(finish, light)
    const current =
      groups.get(key) ??
      ({
        key,
        finish,
        light,
        url: '',
        file_name: '',
        widths: {},
      } satisfies TourRoomScene)
    const width = parsed?.width
    if (width) {
      const slot = String(width) as '2048' | '4096' | '8192'
      const existing = current.widths?.[slot]
      if (!existing || publicAssetVersion(item.url) >= publicAssetVersion(existing)) {
        current.widths = { ...current.widths, [slot]: item.url }
        widthNames.set(key, { ...widthNames.get(key), [slot]: item.file_name })
      }
    } else if (
      !current.file_name ||
      preferSceneFile(current.url, current.file_name, item.url, item.file_name)
    ) {
      current.url = item.url
      current.file_name = item.file_name
      current.finish = finish
      if (room === 'tour-360') {
        current.widths = { ...current.widths, '4096': item.url }
      }
    }
    groups.set(key, current)
  }
  return [...groups.values()].flatMap((scene): TourRoomScene[] => {
    const pngBaseUrl = /\.png(?:$|\?)/i.test(scene.url) || /\.png$/i.test(scene.file_name)
    const names = widthNames.get(scene.key) ?? {}
    const widths = Object.fromEntries(
      Object.entries(scene.widths ?? {})
        .filter(([slot, value]) => {
          if (!value || pngBaseUrl) return Boolean(value)
          const variantRev = assetRevision(names[slot as '2048' | '4096' | '8192']) ?? assetRevision(value)
          const baseRev = assetRevision(scene.file_name) ?? assetRevision(scene.url)
          if (!variantRev && !baseRev) return true
          return variantRev !== null && variantRev === baseRev
        })
        .map(([key, value]) => [key, value ? tourDisplayUrl(value) : value]),
    )
    const webpWidths = Object.fromEntries(
      Object.entries(widths).filter(([, value]) => typeof value === 'string' && !/\.png(?:$|\?)/i.test(value)),
    ) as TourRoomScene['widths']
    const pngBase = /\.png(?:$|\?)/i.test(scene.url)
    const url = pngBase
      ? webpWidths?.['8192'] || webpWidths?.['4096'] || webpWidths?.['2048'] || ''
      : scene.url || webpWidths?.['8192'] || webpWidths?.['4096'] || webpWidths?.['2048'] || ''
    if (!url || /\.png(?:$|\?)/i.test(url)) return []
    return [{
      ...scene,
      url: tourDisplayUrl(url),
      file_name: pngBase ? url : scene.file_name,
      widths: webpWidths,
    }]
  })
}

export function pickSceneUrl(
  scene: TourRoomScene | undefined,
  width?: TourWidth,
  options?: { coarse?: boolean },
): string | null {
  if (!scene) return null
  const widths = scene.widths ?? {}
  const prefer = width ?? 8192
  const revisionBase = /\.png(?:$|\?)/i.test(scene.url) ? undefined : scene.url
  const webp = (url?: string) => Boolean(url && variantIsCurrent(url, revisionBase) && !/\.png(?:$|\?)/i.test(url))
  if (pointerIsCoarse(options?.coarse)) {
    if (webp(widths['4096'])) return tourDisplayUrl(widths['4096']!)
    if (webp(widths['2048'])) return tourDisplayUrl(widths['2048']!)
    return tourCoarsePanoUrl(scene.url, widths['8192'])
  }
  if (prefer >= 8192 && webp(widths['8192'])) return tourDisplayUrl(widths['8192']!)
  if (prefer >= 4096 && (webp(widths['4096']) || webp(widths['8192']))) {
    const url = webp(widths['4096']) ? widths['4096']! : widths['8192']!
    return tourDisplayUrl(url)
  }
  if (webp(widths['2048'])) return tourDisplayUrl(widths['2048']!)
  if (scene.url && !/\.png(?:$|\?)/i.test(scene.url)) return tourDisplayUrl(scene.url)
  return null
}
