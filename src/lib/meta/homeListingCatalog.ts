/** Feed Meta Home Listings (Advantage+ catalog). IDs = units.id = Pixel/CAPI content_ids. */

export const HOME_LISTING_CATALOG_HEADERS = [
  'home_listing_id',
  'name',
  'description',
  'availability',
  'price',
  'image[0].url',
  'image[0].tag[0]',
  'url',
  'address.addr1',
  'address.city',
  'address.region',
  'address.postal_code',
  'address.country',
  'address.unit_number',
  'latitude',
  'longitude',
  'neighborhood[0]',
  'num_baths',
  'num_beds',
  'property_type',
  'listing_type',
  'area_size',
  'area_unit',
  'parking_spaces',
  'home_listing_group_id',
  'virtual_tour_url',
  'custom_label_0',
  'custom_label_1',
] as const

export type HomeListingCatalogHeader = (typeof HOME_LISTING_CATALOG_HEADERS)[number]

export type HomeListingAvailability =
  | 'for_sale'
  | 'for_rent'
  | 'sale_pending'
  | 'recently_sold'
  | 'off_market'
  | 'available_soon'

export type HomeListingUnitInput = {
  id: string
  unit_number: string
  category: string | null
  status: string | null
  is_published: boolean | null
  published_commercial_price: number | null
  bedrooms: number | null
  bathrooms: number | null
  bathrooms_full: number | null
  area_internal_m2: number | null
  area_total_m2: number | null
  floor: string | null
  description: string | null
  typology_code: string | null
  parking_assigned: number | null
  project_id: string
}

export type HomeListingProjectInput = {
  id: string
  name: string
  address: string | null
  city: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  neighborhood: string | null
  region: string | null
  postalCode: string | null
  siteOrigin: string
  commercialImageUrl: string | null
}

export type HomeListingImageAsset = {
  typologyCode: string
  fileName: string
  storagePath: string
  publicUrl: string
}

export type HomeListingUnitMedia = {
  unitId: string
  url: string
  isCover: boolean
  sortOrder: number
  mimeType: string | null
}

export type HomeListingRow = Record<HomeListingCatalogHeader, string>

export type HomeListingExclusion = {
  unitId: string
  unitNumber: string
  reason: string
}

export type HomeListingBuildResult = {
  rows: HomeListingRow[]
  excluded: HomeListingExclusion[]
  csv: string
}

const RESIDENTIAL = new Set(['suite', 'departamento', 'penthouse'])
const COMMERCIAL = new Set(['local'])

export function mapUnitAvailability(
  status: string | null | undefined,
  isPublished: boolean | null | undefined,
): HomeListingAvailability {
  const published = isPublished !== false
  const value = String(status || '').toLowerCase()
  if (!published || value === 'deshabilitado') return 'off_market'
  if (value === 'vendido') return 'recently_sold'
  if (value === 'reservado' || value === 'en_proceso' || value === 'bajo_contrato') return 'sale_pending'
  if (value === 'en_preventa') return 'available_soon'
  if (value === 'disponible') return 'for_sale'
  return 'off_market'
}

export function mapPropertyType(category: string | null | undefined): string | null {
  const value = String(category || '').toLowerCase()
  if (RESIDENTIAL.has(value)) return 'apartment'
  if (COMMERCIAL.has(value)) return 'other'
  return null
}

export function formatHomeListingPrice(amount: number, currency = 'USD'): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  const whole = Math.round(amount)
  return `${whole.toLocaleString('en-US')} ${currency}`
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function rowsToHomeListingCsv(rows: HomeListingRow[]): string {
  const lines = [HOME_LISTING_CATALOG_HEADERS.join(',')]
  for (const row of rows) {
    lines.push(HOME_LISTING_CATALOG_HEADERS.map((key) => csvEscape(row[key] ?? '')).join(','))
  }
  return `${lines.join('\n')}\n`
}

function bathsOf(unit: HomeListingUnitInput): number | null {
  if (unit.bathrooms != null && Number.isFinite(Number(unit.bathrooms))) return Number(unit.bathrooms)
  if (unit.bathrooms_full != null && Number.isFinite(Number(unit.bathrooms_full))) {
    return Number(unit.bathrooms_full)
  }
  return null
}

function areaOf(unit: HomeListingUnitInput): number | null {
  if (unit.area_internal_m2 != null && Number(unit.area_internal_m2) > 0) {
    return Math.round(Number(unit.area_internal_m2) * 100) / 100
  }
  if (unit.area_total_m2 != null && Number(unit.area_total_m2) > 0) {
    return Math.round(Number(unit.area_total_m2) * 100) / 100
  }
  return null
}

function categoryLabel(category: string | null): string {
  const value = String(category || '').toLowerCase()
  if (value === 'suite') return 'Suite'
  if (value === 'departamento') return 'Departamento'
  if (value === 'penthouse') return 'Penthouse'
  if (value === 'local') return 'Local comercial'
  return 'Unidad'
}

function buildDescription(unit: HomeListingUnitInput, projectName: string): string {
  if (unit.description?.trim()) {
    return unit.description.trim().slice(0, 5000)
  }
  const parts: string[] = []
  parts.push(`${categoryLabel(unit.category)} ${unit.unit_number} en ${projectName}.`)
  if (unit.bedrooms != null) parts.push(`${unit.bedrooms} dormitorio${Number(unit.bedrooms) === 1 ? '' : 's'}.`)
  const baths = bathsOf(unit)
  if (baths != null) parts.push(`${baths} baño${baths === 1 ? '' : 's'}.`)
  const area = areaOf(unit)
  if (area != null) parts.push(`Área ${area} m².`)
  if (unit.floor) parts.push(`${unit.floor}.`)
  return parts.join(' ').slice(0, 5000)
}

function pickUnitMediaUrl(media: HomeListingUnitMedia[]): string | null {
  const usable = [...media]
    .filter((row) => /^https:\/\//i.test(row.url))
    .filter((row) => {
      const mime = String(row.mimeType || '').toLowerCase()
      if (mime && !mime.startsWith('image/')) return false
      return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(row.url) || mime.startsWith('image/')
    })
    .sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.sortOrder - b.sortOrder)
  return usable[0]?.url ?? null
}

function scoreTypologyAsset(fileName: string): number {
  const name = fileName.toLowerCase()
  let score = 0
  if (/\.(png|jpe?g|gif)$/i.test(name)) score += 20
  if (/sala|living|comedor|vista-sala|cocina/.test(name)) score += 8
  if (/_dia\b|dia\./.test(name)) score += 4
  if (/360|tour/.test(name)) score -= 6
  if (/bano|baño|dormitorio|closet/.test(name)) score -= 2
  return score
}

export function pickTypologyImageUrl(
  typologyCode: string | null,
  assets: HomeListingImageAsset[],
): { url: string; tag: string } | null {
  if (!typologyCode) return null
  const matches = assets
    .filter((asset) => asset.typologyCode === typologyCode && asset.publicUrl)
    .sort((a, b) => scoreTypologyAsset(b.fileName) - scoreTypologyAsset(a.fileName))
  const best = matches[0]
  if (!best) return null
  return { url: best.publicUrl, tag: best.fileName.replace(/\.[^.]+$/, '').slice(0, 100) }
}

export function publicListingUrl(siteOrigin: string, unitNumber: string): string {
  const origin = siteOrigin.replace(/\/$/, '')
  return `${origin}/tour?unidad=${encodeURIComponent(unitNumber)}`
}

export function buildHomeListingCatalog(input: {
  units: HomeListingUnitInput[]
  project: HomeListingProjectInput
  typologyImages: HomeListingImageAsset[]
  unitMedia: HomeListingUnitMedia[]
}): HomeListingBuildResult {
  const excluded: HomeListingExclusion[] = []
  const rows: HomeListingRow[] = []
  const mediaByUnit = new Map<string, HomeListingUnitMedia[]>()
  for (const media of input.unitMedia) {
    const list = mediaByUnit.get(media.unitId) || []
    list.push(media)
    mediaByUnit.set(media.unitId, list)
  }

  const project = input.project
  if (!project.address?.trim()) {
    return {
      rows: [],
      excluded: input.units.map((unit) => ({
        unitId: unit.id,
        unitNumber: unit.unit_number,
        reason: 'proyecto_sin_direccion',
      })),
      csv: rowsToHomeListingCsv([]),
    }
  }
  if (project.latitude == null || project.longitude == null) {
    return {
      rows: [],
      excluded: input.units.map((unit) => ({
        unitId: unit.id,
        unitNumber: unit.unit_number,
        reason: 'proyecto_sin_coordenadas',
      })),
      csv: rowsToHomeListingCsv([]),
    }
  }

  const city = project.city?.trim() || ''
  const country = project.country?.trim() || ''
  const region = project.region?.trim() || ''
  const neighborhood = project.neighborhood?.trim() || ''
  if (!city || !country || !region || !neighborhood) {
    const reason = !city
      ? 'proyecto_sin_ciudad'
      : !country
        ? 'proyecto_sin_pais'
        : !region
          ? 'proyecto_sin_region'
          : 'proyecto_sin_barrio'
    return {
      rows: [],
      excluded: input.units.map((unit) => ({
        unitId: unit.id,
        unitNumber: unit.unit_number,
        reason,
      })),
      csv: rowsToHomeListingCsv([]),
    }
  }

  for (const unit of input.units) {
    const propertyType = mapPropertyType(unit.category)
    if (!propertyType) {
      excluded.push({
        unitId: unit.id,
        unitNumber: unit.unit_number,
        reason: `categoria_no_soportada:${unit.category || 'null'}`,
      })
      continue
    }

    const price = formatHomeListingPrice(Number(unit.published_commercial_price))
    if (!price) {
      excluded.push({
        unitId: unit.id,
        unitNumber: unit.unit_number,
        reason: 'sin_precio_comercial_publicado',
      })
      continue
    }

    const mediaUrl = pickUnitMediaUrl(mediaByUnit.get(unit.id) || [])
    const typologyImage = pickTypologyImageUrl(unit.typology_code, input.typologyImages)
    let imageUrl = mediaUrl || typologyImage?.url || null
    let imageTag = typologyImage?.tag || categoryLabel(unit.category)
    if (!imageUrl && COMMERCIAL.has(String(unit.category || '').toLowerCase()) && project.commercialImageUrl) {
      imageUrl = project.commercialImageUrl
      imageTag = 'Locales comerciales'
    }
    if (!imageUrl) {
      excluded.push({
        unitId: unit.id,
        unitNumber: unit.unit_number,
        reason: unit.typology_code
          ? `sin_imagen_publicable:${unit.typology_code}`
          : 'sin_imagen_publicable',
      })
      continue
    }

    const availability = mapUnitAvailability(unit.status, unit.is_published)
    const listingUrl = publicListingUrl(project.siteOrigin, unit.unit_number)
    const baths = bathsOf(unit)
    const area = areaOf(unit)
    const empty = ''
    rows.push({
      home_listing_id: unit.id,
      name: `${categoryLabel(unit.category)} ${unit.unit_number} — ${project.name}`.slice(0, 200),
      description: buildDescription(unit, project.name),
      availability,
      price,
      'image[0].url': imageUrl,
      'image[0].tag[0]': imageTag,
      url: listingUrl,
      'address.addr1': project.address.trim(),
      'address.city': city,
      'address.region': region,
      'address.postal_code': project.postalCode?.trim() || empty,
      'address.country': country,
      'address.unit_number': unit.unit_number,
      latitude: String(project.latitude),
      longitude: String(project.longitude),
      'neighborhood[0]': neighborhood,
      num_baths: baths == null ? empty : String(baths),
      num_beds: unit.bedrooms == null ? empty : String(unit.bedrooms),
      property_type: propertyType,
      listing_type: empty,
      area_size: area == null ? empty : String(area),
      area_unit: area == null ? empty : 'sq_m',
      parking_spaces:
        unit.parking_assigned == null || Number(unit.parking_assigned) < 0
          ? empty
          : String(unit.parking_assigned),
      home_listing_group_id: project.id,
      virtual_tour_url: listingUrl,
      custom_label_0: String(unit.category || ''),
      custom_label_1: unit.typology_code || empty,
    })
  }

  rows.sort((a, b) => a['address.unit_number'].localeCompare(b['address.unit_number'], 'es'))
  return { rows, excluded, csv: rowsToHomeListingCsv(rows) }
}

/** Convierte URL pública de storage object a render JPEG cuando el archivo es WebP. */
export function homeListingImagePublicUrl(
  supabaseUrl: string,
  bucket: string,
  storagePath: string,
  fileName: string,
): string {
  const base = supabaseUrl.replace(/\/$/, '')
  const encodedPath = storagePath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  if (/\.(png|jpe?g|gif)$/i.test(fileName)) {
    return `${base}/storage/v1/object/public/${bucket}/${encodedPath}`
  }
  return `${base}/storage/v1/render/image/public/${bucket}/${encodedPath}?width=1200&quality=80`
}
