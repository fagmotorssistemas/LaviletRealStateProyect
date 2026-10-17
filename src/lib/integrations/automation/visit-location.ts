import { object,text,type Row } from './data'

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Retired prose classifier. Location disclosure needs a typed current request. */
export function mentionsVisitLocation(_reply: string): boolean { void _reply;  return false }

export type LocationRequestKind = 'general' | 'request' | 'clarification'

// Match the question within a batch of inbound messages as well as on its own.
// Mentioning a unit's location or asking about nearby amenities is not a map request.
export function locationRequestKind(_current: string, interpreted: unknown = {}): LocationRequestKind | null {
  const row = object(interpreted), semantics = object(row.semantica_turno || row.turn_semantics || row)
  const kind = object(semantics.routing).location_kind
  return ['general', 'request', 'clarification'].includes(text(kind)) ? kind as LocationRequestKind : null
}

/** Coarse project facts have their own authority; never use a complete street
 * address as the short location description in an ordinary introduction. */
export function generalProjectLocation(info: Row): Row {
  const project = object(info.proyecto || info.project), configured = object(info.ubicacion_general || info.general_location)
  const source = text(project.address || info.address)
  const sector = text(configured.sector || configured.neighborhood || project.sector || project.neighborhood).trim()
    || (/\bpuertas del sol\b/.test(normalized(source)) ? 'Puertas del Sol' : '')
  const city = text(configured.city || configured.ciudad || project.city || project.ciudad).trim()
    || (/\bcuenca\b/.test(normalized(source)) ? 'Cuenca' : '')
  return { ...(sector ? { sector } : {}), ...(city ? { city } : {}) }
}

export function locationAnswer(info: Row, kind: LocationRequestKind = 'request') {
  if (kind === 'general') {
    const place = generalProjectLocation(info)
    const label = [text(place.sector), text(place.city)].filter(Boolean).join(', ')
    return label ? `La Vilet se ubica en ${label}.` : ''
  }
  const address = text(object(info.proyecto).address || info.address).trim()
  const map = text(info.ubicacion || info.map_url).trim()
  if (!address && !/^https:\/\//.test(map)) return ''
  if(info.estado_proyecto) return withVisitLocation('Esta es la dirección de atención registrada para el proyecto. Las visitas se coordinan según los lugares habilitados.',info,true)
  const launch = info.modo_comercial === 'lanzamiento'
  const intro = launch
    ? kind === 'clarification'
      ? 'Esa ubicación corresponde a nuestra oficina de atención y al terreno donde se construirá La Vilet.'
      : 'Puede encontrarnos en nuestra oficina de atención, en el terreno donde se construirá La Vilet.'
    : kind === 'clarification' ? 'Esa ubicación corresponde al proyecto La Vilet.' : 'Esta es la ubicación del proyecto La Vilet.'
  return withVisitLocation(intro, info, true)
}

// Location is delivered as verified content after composition, so a stylistic
// rewrite cannot omit it or replace the map with a promise to send it later.
export function withVisitLocation(reply: string, info: Row, force = false) {
  // A sales invitation is not permission to send a map. Callers must establish
  // an explicit location request or an actual appointment confirmation.
  if (!force || object(info.location_disclosure).exact_location_allowed === false) return reply
  const address = text(object(info.proyecto).address || info.address).trim()
  const map = text(info.ubicacion || info.map_url).trim()
  const parts: string[] = []
  if (object(info.location_disclosure).address_allowed !== false && address && !reply.toLocaleLowerCase('es').includes(address.toLocaleLowerCase('es'))) parts.push(`Dirección: ${address}`)
  if (object(info.location_disclosure).map_allowed !== false && /^https:\/\//.test(map) && !reply.includes(map)) parts.push(`Mapa: ${map}`)
  return parts.length ? `${reply.trim()}\n\n${parts.join('\n')}` : reply
}
