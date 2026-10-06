import { finishesMatch, pickRoomScene, pickSceneUrl } from '@/lib/tour/roomScene'
import type { TourFinishOption, TourLightMode, TourRoomScene, TourTypologyOption } from '@/types/tour'

export type GaleriaStill = {
  id: string
  label: string
  url: string
  /** Slug del ambiente (vista-sala → sala / slug de tipología). */
  roomSlug?: string
  finish?: string | null
  light?: string | null
}

export type GaleriaStillsOptions = {
  /** Si se pasa, solo escenas de ese acabado (no mezcla con otros). */
  finish?: string | null
  /** Si se pasa, solo escenas de esa luz (día/noche separados del acabado). */
  light?: TourLightMode | null
  /** true = todas las celdas acabado×luz (ficha). Default false con filtros. */
  allScenes?: boolean
  /** Locales: la galería es la lista de renders, sin ambientes ni 360. */
  rendersOnly?: boolean
  /**
   * Galería showroom: un still por ambiente.
   * Acabado y luz al azar; la etiqueta es solo el nombre del ambiente.
   */
  randomPerRoom?: boolean
  /** Semilla estable para no cambiar la foto al re-render. */
  seed?: number
  /** Solo la escena exacta de acabado y luz. Si no está, el ambiente no entra. */
  strict?: boolean
  /** La etiqueta es el nombre del ambiente, sin día, noche ni acabado. */
  roomLabelOnly?: boolean
}

function finishLabel(finishes: TourFinishOption[] | undefined, slug: string | null) {
  if (!slug) return null
  const hit = finishes?.find((item) => item.slug === slug)
  if (hit?.name) return hit.name
  return slug.replace(/-/g, ' ')
}

function lightLabel(light: string | null | undefined) {
  if (light === 'noche') return 'Noche'
  if (light === 'dia') return 'Día'
  return light || null
}

function stillLabelFromFile(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function mulberry32(seed: number) {
  let a = seed >>> 0 || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickRandomScene(scenes: TourRoomScene[], rand: () => number): TourRoomScene | undefined {
  if (scenes.length === 0) return undefined
  const index = Math.min(scenes.length - 1, Math.floor(rand() * scenes.length))
  return scenes[index]
}

/** La sala abre la ficha y la galería. El resto sigue el recorrido del departamento. */
const ROOM_PRESENT_ORDER = [
  'sala',
  'comedor',
  'estar',
  'estudio',
  'cocina',
  'dormitorio',
  'bano-completo',
  'bano-social',
  'lavado',
  'despensa',
  'terraza',
  'balcon',
]

function presentRank(slug: string) {
  const key = slug.replace(/^vista-/, '').replace(/-\d+$/, '')
  const index = ROOM_PRESENT_ORDER.indexOf(key)
  return index < 0 ? ROOM_PRESENT_ORDER.length : index
}

/**
 * Imágenes de Galería CRM.
 * - randomPerRoom: un still por ambiente (acabado/luz random; label = ambiente).
 * - finish/light: un still por ambiente filtrado.
 * - allScenes: todas las celdas acabado×luz + extras (ficha).
 */
export function buildGaleriaStills(
  typology: TourTypologyOption | null | undefined,
  finishes?: TourFinishOption[],
  options?: GaleriaStillsOptions,
): GaleriaStill[] {
  if (!typology) return []

  if (typology.category === 'local' || options?.rendersOnly) {
    return (typology.renders ?? [])
      .filter((render) => Boolean(render.url))
      .map((render) => ({
        id: render.id || render.file_name,
        label: stillLabelFromFile(render.file_name) || 'Render',
        url: render.url,
      }))
  }

  const allScenes = options?.allScenes === true
  const randomPerRoom = options?.randomPerRoom === true && !allScenes
  const filterFinish = allScenes || randomPerRoom ? null : (options?.finish ?? null)
  const filterLight = allScenes || randomPerRoom ? null : (options?.light ?? null)
  const rand = mulberry32((options?.seed ?? 1) ^ (typology.code?.length ?? 0) * 9973)

  const items: GaleriaStill[] = []
  const seen = new Set<string>()

  const add = (
    id: string,
    label: string,
    url: string | null | undefined,
    meta?: { roomSlug?: string; finish?: string | null; light?: string | null },
  ) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    items.push({
      id,
      label,
      url,
      roomSlug: meta?.roomSlug,
      finish: meta?.finish,
      light: meta?.light,
    })
  }

  const rooms = [...(typology.vistas ?? [])].sort((a, b) => {
    const rank = presentRank(a.slug) - presentRank(b.slug)
    if (rank !== 0) return rank
    return a.slug.localeCompare(b.slug, 'es')
  })

  for (const room of rooms) {
    const scenes = [...(room.scenes ?? [])]

    if (randomPerRoom) {
      const scene = pickRandomScene(scenes, rand)
      const url = pickSceneUrl(scene) ?? scene?.url ?? room.url
      if (!url) continue
      add(`${room.slug}:random`, room.label, url, {
        roomSlug: room.slug,
        finish: scene?.finish ?? null,
        light: scene?.light ?? null,
      })
      continue
    }

    if (!allScenes && (filterFinish != null || filterLight != null)) {
      const light = (filterLight ?? 'dia') as TourLightMode
      const exact = scenes.find(
        (scene) =>
          Boolean(pickSceneUrl(scene) ?? scene.url) &&
          (filterLight == null || scene.light === filterLight) &&
          (filterFinish == null || finishesMatch(scene.finish, filterFinish)),
      )
      const scene = options?.strict
        ? exact
        : (pickRoomScene(scenes, filterFinish, light) ??
          (scenes.length
            ? scenes.find((s) => (filterLight ? s.light === filterLight : true) && finishesMatch(s.finish, filterFinish ?? null))
            : undefined))
      const url = pickSceneUrl(scene) ?? scene?.url ?? (options?.strict ? null : room.url)
      if (!url) continue
      const parts = options?.roomLabelOnly
        ? [room.label]
        : [
            room.label,
            finishLabel(finishes, scene?.finish ?? filterFinish),
            lightLabel(scene?.light ?? filterLight),
          ].filter(Boolean)
      add(`${room.slug}:${filterFinish ?? 'x'}:${filterLight ?? 'x'}`, parts.join(' · ') || room.label, url, {
        roomSlug: room.slug,
        finish: scene?.finish ?? filterFinish,
        light: scene?.light ?? filterLight,
      })
      continue
    }

    const sorted = [...scenes].sort((a, b) => {
      const fa = a.finish || ''
      const fb = b.finish || ''
      if (fa !== fb) return fa.localeCompare(fb, 'es')
      return (a.light || '').localeCompare(b.light || '', 'es')
    })

    for (const scene of sorted) {
      const url = pickSceneUrl(scene) ?? scene.url
      if (!url) continue
      const parts = [
        room.label,
        finishLabel(finishes, scene.finish),
        lightLabel(scene.light),
      ].filter(Boolean)
      add(
        `${room.slug}:${scene.key || scene.file_name || url}`,
        parts.join(' · ') || room.label,
        url,
        { roomSlug: room.slug, finish: scene.finish, light: scene.light },
      )
    }

    if (sorted.length === 0 && room.url) {
      add(room.slug, room.label, room.url, { roomSlug: room.slug })
    }
  }

  // En galería por ambiente no mezclamos renders sueltos (sin sección clara).
  if (!randomPerRoom) {
    for (const render of typology.renders ?? []) {
      if (!render.url) continue
      add(render.id || render.file_name, stillLabelFromFile(render.file_name) || 'Imagen', render.url)
    }
  }

  return items
}

/** Índice en B alineado al still A (mismo roomSlug o mismo label base). */
export function matchGaleriaStillIndex(
  stillsA: GaleriaStill[],
  indexA: number,
  stillsB: GaleriaStill[],
): number {
  if (stillsB.length === 0) return 0
  const current = stillsA[Math.min(Math.max(0, indexA), stillsA.length - 1)]
  if (!current) return 0
  if (current.roomSlug) {
    const byRoom = stillsB.findIndex((item) => item.roomSlug === current.roomSlug)
    if (byRoom >= 0) return byRoom
  }
  const base = current.label.split(' · ')[0]?.trim()
  if (base) {
    const byLabel = stillsB.findIndex((item) => item.label.split(' · ')[0]?.trim() === base)
    if (byLabel >= 0) return byLabel
  }
  return Math.min(indexA, stillsB.length - 1)
}
