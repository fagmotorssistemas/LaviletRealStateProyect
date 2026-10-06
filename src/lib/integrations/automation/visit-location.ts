import { object, text, type Row } from './data'

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export function mentionsVisitLocation(reply: string) {
  // A catalog can describe prices "según ubicación y tamaño" or office space.
  // Only a real destination or an invitation to attend in person needs a map.
  const value = normalized(reply)
  return value.split(/(?<=[.!?])\s+|\n+/).some(sentence => {
    if (/\b(?:no|sin)\s+(?:(?:es necesario|hace falta|necesita|necesitamos|podemos)\s+)?(?:una?\s+)?(?:visita|visitar|venir|acudir|reunion presencial)|\b(?:cancelad[ao]|cancelamos|cancelar)\b/.test(sentence)) return false
    const physical = /\b(?:oficina|terreno|proyecto|la vilet|presencial|en persona)\b/.test(sentence)
    if (/\b(?:videollamada|reunion virtual|visita virtual|tour virtual|recorrido virtual|por zoom|por telefono)\b/.test(sentence)
      && !/\b(?:en persona|presencial|(?:en|a) nuestra oficina|(?:en|al) (?:el )?terreno)\b/.test(sentence)) return false
    return /\b(?:direccion|mapa)\s*:/.test(sentence)
      || /\b(?:esta es|esa es|le comparto|le envio|aqui tiene)\s+(?:la|nuestra)\s+(?:ubicacion|direccion)\b/.test(sentence)
      || /\b(?:ubicacion|direccion|mapa)\s+(?:corresponde|es la de|es del|del terreno|de nuestra oficina)\b/.test(sentence)
      || /\b(?:oficina|terreno|la vilet)\s+(?:esta|queda|se encuentra|se ubica)\s+(?:en|donde|junto|aqui)\b/.test(sentence)
      || /\b(?:en|a)\s+(?:la misma|nuestra|la)\s+direccion\b/.test(sentence)
      || /\b(?:puede|pueden)\s+(?:encontrarnos|visitarnos)\b/.test(sentence)
      || /\b(?:le|les)\s+esperamos\b/.test(sentence)
      || (physical && /\b(?:visitar|visitarnos|visita|recibirle|recibirlo|recibirla|recibirles|venir|acudir|reunirnos)\b|\bconocer\s+(?:(?:en persona|personalmente)\s+)?(?:(?:el|la|nuestro|nuestra)\s+)?(?:terreno|oficina)\b/.test(sentence)
        && /\b(?:puede|podemos|gustaria|gusta|quiere|desea|invitamos|coordinar|coordinamos|agendar|agendamos|programar|programamos|recibir|recibiremos|recibirle|recibirlo|recibirla|recibirles|esperamos|confirmada|proponemos)\b/.test(sentence))
  })
}

export type LocationRequestKind = 'general' | 'request' | 'clarification'

// Match the question within a batch of inbound messages as well as on its own.
// Mentioning a unit's location or asking about nearby amenities is not a map request.
export function locationRequestKind(current: string): LocationRequestKind | null {
  const value = normalized(current)
  if (/\b(?:esa|esta|la|el|ese|este)\s+(?:ubicacion|direccion|mapa)(?:\s+que\s+(?:me\s+)?(?:envio|mando|compartio))?\s+(?:de que|de donde|a que|que es|corresponde a)\b|\b(?:de que|de donde|a que (?:lugar|sitio))\s+(?:es|corresponde)\s+(?:(?:esa|esta|la|el|ese|este)\s+)?(?:ubicacion|direccion|mapa)\b/.test(value)) return 'clarification'
  const clauses = value.split(/[\n.!?;]+|(?:,\s*|\s+)(?:pero|solo|solamente|ademas|tambien)\s+/)
    .filter(clause => !/\b(?:no|ni)\s+(?:me\s+)?(?:envie|mande|comparta|pase|quiero|necesito)\b[^.!?]{0,40}\b(?:ubicacion|direccion|mapa)\b/.test(clause))
  const general = clauses.some(clause => /\b(?:en|de)\s+que\s+(?:ciudad|sector|zona|barrio|provincia)|\b(?:cual|que)\s+(?:es\s+)?(?:la|el)?\s*(?:ciudad|sector|zona|barrio|provincia)\b/.test(clause))
  const exact = clauses.some(clause => /\b(?:como\s+(?:llego|llegar|llegamos)|(?:cual|que)\s+es\s+(?:(?:la|su)\s+)?(?:direccion|ubicacion)|en que\s+(?:direccion|calle)\s+(?:esta|queda|se encuentra))\b/.test(clause)
    || /\b(?:envie\w*|envia\w*|mand\w*|compart\w*|pas\w*|dame|deme)\b[^.!?]{0,45}\b(?:ubicacion|direccion|mapa)\b/.test(clause)
    || /\b(?:necesito|quiero|puedo)\s+(?:(?:saber|conocer|ver)\s+)?(?:(?:la|su|el)\s+)?(?:ubicacion|direccion|mapa)\b/.test(clause)
    || /\b(?:necesito|quiero|quisiera|deseo)\b[^.!?]{0,120}\b(?:mapa|direccion|ubicacion exacta)\b/.test(clause)
    || /^(?:(?:ya|si|bueno|pero|y|esta bien|me dice|por favor)\s+)*(?:donde|(?:la|su)\s+(?:ubicacion|direccion)|ubicacion|direccion|mapa)[\s,]*$/.test(clause.trim().replace(/^[¿¡]\s*/, '')))
  if (exact) return 'request'
  if (general) return 'general'
  if (clauses.some(clause => /\bdonde\s+(?:queda|quedan|esta|estan|se encuentra|se ubica)\b/.test(clause)
    && !/\b(?:departamento|apartamento|suite|penthouse|local)\s*(?:numero\s*)?\d+\b/.test(clause))) return 'request'
  return null
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
