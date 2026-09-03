import { buildTourNodes, type TourNodesResult } from '@/lib/tour/buildTourNodes'
import type { TourWidth } from '@/lib/tour/pickTourWidth'
import type { PanoramaVariants, TourHotspot, TourLightMode, TourUnitSummary } from '@/types/tour'

export const MOCK_TOUR_UNIT_TYPE_SLUG = 'tipo_a'
export const MOCK_TOUR_UNIT_TYPE_NAME = 'Tipo A'

export const MOCK_TOUR_FINISHES = [
  { slug: 'nogal', name: 'Nogal' },
  { slug: 'roble', name: 'Roble' },
] as const

export const MOCK_TOUR_LIGHTS: { slug: TourLightMode; label: string }[] = [
  { slug: 'dia', label: 'Día' },
  { slug: 'noche', label: 'Noche' },
]

const HOTSPOTS: Record<string, TourHotspot[]> = {
  sala: [
    { id: 'sala-to-cocina', type: 'link', yaw: 1.57, pitch: 0, tooltip: 'Ir a cocina', target_room: 'cocina' },
    { id: 'sala-to-dormitorio', type: 'link', yaw: -1.57, pitch: 0, tooltip: 'Ir a dormitorio', target_room: 'dormitorio' },
    { id: 'sala-to-balcon', type: 'link', yaw: 3.14, pitch: 0, tooltip: 'Ir al balcón', target_room: 'balcon' },
    { id: 'sala-info-1', type: 'info', yaw: 0.5, pitch: 0.2, tooltip: 'Ventanales doble altura' },
  ],
  cocina: [
    { id: 'cocina-to-sala', type: 'link', yaw: 3.14, pitch: 0, tooltip: 'Ir a sala', target_room: 'sala' },
  ],
  dormitorio: [
    { id: 'dormitorio-to-sala', type: 'link', yaw: 0, pitch: 0, tooltip: 'Ir a sala', target_room: 'sala' },
  ],
  balcon: [
    { id: 'balcon-to-sala', type: 'link', yaw: 0, pitch: 0, tooltip: 'Volver a sala', target_room: 'sala' },
  ],
}

const ROOMS = [
  { room: 'sala', label: 'Sala', mapX: 50, mapY: 50, mapHeading: 0, initialYaw: 0, neutral: false },
  { room: 'cocina', label: 'Cocina', mapX: 50, mapY: 22, mapHeading: 180, initialYaw: 1.57, neutral: false },
  { room: 'dormitorio', label: 'Dormitorio', mapX: 80, mapY: 62, mapHeading: 270, initialYaw: -1.57, neutral: false },
  { room: 'balcon', label: 'Balcón', mapX: 20, mapY: 50, mapHeading: 90, initialYaw: 3.14, neutral: true },
] as const

const TOUR_360_URL = '/tours/demo/tour_360.png?v=6'

function variantsFor(): { url: string; variants: PanoramaVariants } {
  return {
    url: TOUR_360_URL,
    variants: {
      '4096': { url: TOUR_360_URL },
      '2048': { url: TOUR_360_URL },
    },
  }
}

/**
 * Mismo retorno que getTourNodes: nodos del plugin virtual-tour para
 * una tipología + acabado + luz. El balcón (finish null) entra siempre.
 */
export async function getMockTourNodes(
  _unitTypeSlug: string,
  finishSlug: string,
  light: TourLightMode,
  preferredWidth = 4096,
): Promise<TourNodesResult> {
  const sources = ROOMS.map((room) => {
    const finish = room.neutral ? null : finishSlug
    const { url, variants } = variantsFor()
    return {
      id: `mock:${room.room}:${finish ?? 'neutral'}:${light}`,
      room: room.room,
      roomLabel: room.label,
      url,
      variants,
      hotspots: HOTSPOTS[room.room] ?? [],
      initialYaw: room.initialYaw,
      initialPitch: 0,
      mapX: room.mapX,
      mapY: room.mapY,
      mapHeading: room.mapHeading,
      finishSlug: finish,
    }
  })

  return buildTourNodes(sources, preferredWidth)
}

/** Variantes del ambiente actual (acabados × luces, o solo luces si es neutro). */
export function getMockRoomVariantUrls(_room: string, _width: TourWidth): string[] {
  return [TOUR_360_URL]
}

export function getMockTourUnits(): TourUnitSummary[] {
  return [
    {
      id: 'mock-unit-a-302',
      unit_number: 'A-302',
      floor: '3',
      published_commercial_price: 185000,
      status: 'disponible',
      area_total_m2: 78.5,
      bedrooms: 2,
      bathrooms: 2,
      slug: 'a-302',
    },
    {
      id: 'mock-unit-a-405',
      unit_number: 'A-405',
      floor: '4',
      published_commercial_price: 192000,
      status: 'reservado',
      area_total_m2: 78.5,
      bedrooms: 2,
      bathrooms: 2,
      slug: 'a-405',
    },
    {
      id: 'mock-unit-a-501',
      unit_number: 'A-501',
      floor: '5',
      published_commercial_price: 210000,
      status: 'disponible',
      area_total_m2: 86,
      bedrooms: 2,
      bathrooms: 2,
      slug: 'a-501',
    },
  ]
}

export function getMockTourCatalog() {
  return {
    unitTypeSlug: MOCK_TOUR_UNIT_TYPE_SLUG,
    unitTypeName: MOCK_TOUR_UNIT_TYPE_NAME,
    finishes: MOCK_TOUR_FINISHES.map((f) => ({ slug: f.slug, name: f.name })),
    lights: MOCK_TOUR_LIGHTS,
  }
}
