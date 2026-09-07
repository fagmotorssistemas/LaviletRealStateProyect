import { firstRoomAlias, TOUR_PANO_SLUG, VISTA_PREFIX } from '@/lib/tour/tourRooms'

const GENERIC_SECTIONS = new Set(['360', 'tour 360', 'vistas', 'showroom', TOUR_PANO_SLUG])

const FEMININE = new Set(['cocina', 'sala', 'terraza', 'despensa'])

export function dwellSectionKey(slug: string) {
  const trimmed = slug.trim()
  if (!trimmed) return ''
  if (trimmed === TOUR_PANO_SLUG || trimmed === '360') return TOUR_PANO_SLUG
  const withoutVista = trimmed.startsWith(VISTA_PREFIX) ? trimmed.slice(VISTA_PREFIX.length) : trimmed
  return firstRoomAlias(withoutVista)
}

export function isGenericTourSection(slugOrLabel: string | null | undefined) {
  const value = (slugOrLabel ?? '').trim().toLowerCase()
  if (!value) return true
  return GENERIC_SECTIONS.has(value) || value === TOUR_PANO_SLUG
}

function sectionWithArticle(label: string) {
  const text = label.trim()
  const lower = text.toLowerCase()
  if (lower.startsWith('baño') || lower.startsWith('bano')) return `el ${text.toLowerCase()}`
  if (lower.startsWith('dormitorio')) return `el ${text.toLowerCase()}`
  if (lower.startsWith('área') || lower.startsWith('area')) {
    return `el ${text.replace(/^area/i, 'área')}`
  }
  if (lower === 'estar' || lower === 'estudio' || lower === 'comedor' || lower === 'balcón' || lower === 'balcon' || lower === 'bodega') {
    return `el ${lower.replace('balcon', 'balcón')}`
  }
  if (FEMININE.has(lower)) return `la ${lower}`
  return `la sección de ${lower}`
}

export function tourGateCopy(typology: string | null | undefined, roomLabel: string | null | undefined) {
  const code = (typology ?? '').trim()
  const room = (roomLabel ?? '').trim()
  const hasRoom = Boolean(room) && !isGenericTourSection(room)
  const closing =
    'Déjenos su WhatsApp y le enviaremos los planos y el precio de las unidades disponibles.'

  if (code && hasRoom) {
    return `Notamos que le interesó la tipología ${code}, en particular ${sectionWithArticle(room)}. ${closing}`
  }
  if (code) {
    return `Notamos que le interesó la tipología ${code}. ${closing}`
  }
  return closing
}
