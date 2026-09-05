export type TourRoomDef = {
  slug: string
  label: string
}

export type TourRoomSpec = {
  bedrooms?: number | null
  bathrooms_full?: number | null
  bathrooms_half?: number | null
  spaces?: string[] | null
}

const SPACE_ALIASES: Record<string, TourRoomDef> = {
  sala: { slug: 'sala', label: 'Sala' },
  comedor: { slug: 'comedor', label: 'Comedor' },
  cocina: { slug: 'cocina', label: 'Cocina' },
  estar: { slug: 'estar', label: 'Estar' },
  estudio: { slug: 'estudio', label: 'Estudio' },
  lavado: { slug: 'lavado', label: 'Área de lavado' },
  'area-de-lavado': { slug: 'lavado', label: 'Área de lavado' },
  despensa: { slug: 'despensa', label: 'Despensa' },
  terraza: { slug: 'terraza', label: 'Terraza' },
  balcon: { slug: 'balcon', label: 'Balcón' },
  balcones: { slug: 'balcon', label: 'Balcón' },
  bodega: { slug: 'bodega', label: 'Bodega' },
}

const SPACE_ORDER = [
  'sala',
  'comedor',
  'estar',
  'estudio',
  'cocina',
  'lavado',
  'despensa',
  'terraza',
  'balcon',
  'bodega',
] as const

const ROOM_SLUG_RE =
  /^(sala|comedor|cocina|estar|estudio|lavado|despensa|terraza|balcon|bodega|dormitorio(?:-\d+)?|bano-completo(?:-\d+)?|bano-social(?:-\d+)?)$/

/** @deprecated Usar buildTourRooms. Se deja para archivos demo. */
export const TOUR_ROOMS: TourRoomDef[] = [
  { slug: 'sala', label: 'Sala' },
  { slug: 'cocina', label: 'Cocina' },
  { slug: 'bano', label: 'Baño' },
  { slug: 'dormitorio', label: 'Dormitorio' },
  { slug: 'balcon', label: 'Balcón' },
]

export type TourRoomSlug = string

export const VISTA_PREFIX = 'vista-'

export function vistaRoomSlug(room: string) {
  return room.startsWith(VISTA_PREFIX) ? room : `${VISTA_PREFIX}${room}`
}

export function isVistaRoomSlug(value: string) {
  return value.startsWith(VISTA_PREFIX) && value.length > VISTA_PREFIX.length
}

export const TOUR_PANO_SLUG = 'tour-360'
export const TOUR_PANO_LABEL = '360'
export const TOUR_PANO_FILE = 'tour-360.webp'
export const TOUR_PANO_FILE_8192 = 'tour-360_8192.webp'
export const TOUR_PANO_ROOM: TourRoomDef = { slug: TOUR_PANO_SLUG, label: TOUR_PANO_LABEL }

export function tourPanoFileName(width: 4096 | 8192) {
  return width === 8192 ? TOUR_PANO_FILE_8192 : TOUR_PANO_FILE
}

function slugifySpace(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function mapSpace(raw: string): TourRoomDef | null {
  const key = slugifySpace(raw)
  if (!key) return null
  if (SPACE_ALIASES[key]) return SPACE_ALIASES[key]
  if (/^dormitorio/.test(key) || /^habitacion/.test(key) || /^bano/.test(key)) return null
  return { slug: key, label: raw.trim() }
}

function numbered(base: string, label: string, count: number): TourRoomDef[] {
  if (count <= 0) return []
  if (count === 1) return [{ slug: base, label }]
  return Array.from({ length: count }, (_, index) => ({
    slug: `${base}-${index + 1}`,
    label: `${label} ${index + 1}`,
  }))
}

export function buildTourRooms(spec: TourRoomSpec): TourRoomDef[] {
  const fromSpaces = new Map<string, TourRoomDef>()
  for (const raw of spec.spaces ?? []) {
    const mapped = mapSpace(raw)
    if (mapped) fromSpaces.set(mapped.slug, mapped)
  }

  const rooms: TourRoomDef[] = []
  const seen = new Set<string>()
  const add = (item: TourRoomDef) => {
    if (seen.has(item.slug)) return
    seen.add(item.slug)
    rooms.push(item)
  }

  for (const slug of SPACE_ORDER) {
    if (slug === 'lavado' || slug === 'despensa' || slug === 'terraza' || slug === 'balcon' || slug === 'bodega') {
      continue
    }
    const item = fromSpaces.get(slug)
    if (item) add(item)
  }

  for (const item of numbered('dormitorio', 'Dormitorio', spec.bedrooms ?? 0)) add(item)
  for (const item of numbered('bano-completo', 'Baño completo', spec.bathrooms_full ?? 0)) add(item)
  for (const item of numbered('bano-social', 'Baño social', spec.bathrooms_half ?? 0)) add(item)

  for (const slug of ['lavado', 'despensa', 'terraza', 'balcon', 'bodega'] as const) {
    const item = fromSpaces.get(slug)
    if (item) add(item)
  }

  for (const item of fromSpaces.values()) add(item)
  return rooms
}

export function unionTourRooms(specs: TourRoomSpec[]): TourRoomDef[] {
  const bySlug = new Map<string, TourRoomDef>()
  for (const spec of specs) {
    for (const room of buildTourRooms(spec)) {
      bySlug.set(room.slug, room)
    }
  }
  const order = [
    ...SPACE_ORDER.slice(0, 5),
    'dormitorio',
    'bano-completo',
    'bano-social',
    ...SPACE_ORDER.slice(5),
  ]
  return [...bySlug.values()].sort((a, b) => {
    const ai = order.findIndex((slug) => a.slug === slug || a.slug.startsWith(`${slug}-`))
    const bi = order.findIndex((slug) => b.slug === slug || b.slug.startsWith(`${slug}-`))
    if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    return a.slug.localeCompare(b.slug, 'es')
  })
}

export function isTourRoomSlug(value: string): boolean {
  return value === TOUR_PANO_SLUG || ROOM_SLUG_RE.test(value) || isVistaRoomSlug(value)
}

export function tourRoomLabel(slug: string) {
  if (slug === TOUR_PANO_SLUG) return TOUR_PANO_LABEL
  if (slug === 'bano-completo') return 'Baño completo'
  if (slug === 'bano-social') return 'Baño social'
  if (slug === 'dormitorio') return 'Dormitorio'
  const numberedBath = slug.match(/^bano-completo-(\d+)$/)
  if (numberedBath) return `Baño completo ${numberedBath[1]}`
  const numberedSocial = slug.match(/^bano-social-(\d+)$/)
  if (numberedSocial) return `Baño social ${numberedSocial[1]}`
  const numberedBed = slug.match(/^dormitorio-(\d+)$/)
  if (numberedBed) return `Dormitorio ${numberedBed[1]}`
  return SPACE_ALIASES[slug]?.label ?? TOUR_ROOMS.find((room) => room.slug === slug)?.label ?? slug
}

export function tourRoomFileName(slug: string) {
  if (slug === TOUR_PANO_SLUG) return TOUR_PANO_FILE
  return `${slug}.webp`
}

export function assetMatchesRoom(fileName: string, slug: string) {
  if (slug === TOUR_PANO_SLUG) return isTourPanoramaFileName(fileName)
  if (isTourPanoramaFileName(fileName)) return false
  const base = fileName.replace(/\.[^.]+$/, '')
  return (
    fileName === tourRoomFileName(slug) ||
    base === slug ||
    fileName.startsWith(`${slug}.`) ||
    base.startsWith(`${slug}_`)
  )
}

/** El único 360 de la tipología: `tour-360.webp`, `pano.webp`, etc. */
export function isTourPanoramaFileName(fileName: string) {
  return /(?:^|[._-])(360|pano|equirect|panorama)(?:[._-]|$)/i.test(fileName.replace(/\.[^.]+$/, ''))
}

export function typologyPanoramaAsset<T extends { file_name: string }>(assets: T[]): T | undefined {
  return (
    assets.find((item) => item.file_name === TOUR_PANO_FILE) ??
    assets.find((item) => isTourPanoramaFileName(item.file_name))
  )
}

export function typologyPanoramaVariants<T extends { file_name: string }>(assets: T[]): T[] {
  return assets.filter((item) => isTourPanoramaFileName(item.file_name))
}

export function panoWidthFromFileName(fileName: string): 2048 | 4096 | 8192 | null {
  if (!isTourPanoramaFileName(fileName)) return null
  if (/_8192\b/i.test(fileName)) return 8192
  if (/_2048\b/i.test(fileName)) return 2048
  return 4096
}

export function stillAssetForRoom<T extends { file_name: string }>(assets: T[], slug: string): T | undefined {
  if (slug === TOUR_PANO_SLUG) return undefined
  return assets.find((item) => assetMatchesRoom(item.file_name, slug))
}

export function roomSlugFromNode(node: { id: string; data?: { room?: string } } | null | undefined) {
  const fromData = node?.data?.room?.trim()
  if (fromData) return fromData
  const id = node?.id ?? ''
  if (isTourRoomSlug(id)) return id
  const match = id.match(/(sala|comedor|cocina|estar|estudio|lavado|despensa|terraza|balcon|bodega|dormitorio(?:-\d+)?|bano-completo(?:-\d+)?|bano-social(?:-\d+)?)/)
  return match?.[1] ?? id
}
