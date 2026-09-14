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

export type LocationRequestKind = 'request' | 'clarification'

// Match the question within a batch of inbound messages as well as on its own.
// Mentioning a unit's location or asking about nearby amenities is not a map request.
export function locationRequestKind(current: string): LocationRequestKind | null {
  const value = normalized(current)
  if (/\b(?:esa|esta|la|el|ese|este)\s+(?:ubicacion|direccion|mapa)(?:\s+que\s+(?:me\s+)?(?:envio|mando|compartio))?\s+(?:de que|de donde|a que|que es|corresponde a)\b|\b(?:de que|de donde|a que (?:lugar|sitio))\s+(?:es|corresponde)\s+(?:(?:esa|esta|la|el|ese|este)\s+)?(?:ubicacion|direccion|mapa)\b/.test(value)) return 'clarification'
  if (/\b(?:no|ni)\s+(?:me\s+)?(?:envie|mande|comparta|pase|quiero|necesito)\b[^.!?]{0,30}\b(?:ubicacion|direccion|mapa)\b/.test(value)) return null
  if (/\b(?:donde\s+(?:queda|quedan|esta|estan|se encuentra|se ubica)|como\s+(?:llego|llegar|llegamos)|(?:cual|que)\s+es\s+(?:(?:la|su)\s+)?(?:direccion|ubicacion)|en que\s+(?:direccion|calle|sector)\s+(?:esta|queda|se encuentra))\b/.test(value)) return 'request'
  if (/\b(?:envie\w*|envia\w*|mand\w*|compart\w*|pas\w*|dame|deme)\b[^.!?]{0,45}\b(?:ubicacion|direccion|mapa)\b/.test(value)
    || /\b(?:necesito|quiero|puedo)\s+(?:(?:saber|conocer|ver)\s+)?(?:(?:la|su|el)\s+)?(?:ubicacion|direccion|mapa)\b/.test(value)) return 'request'
  if (/^(?:(?:ya|si|bueno|pero|y|esta bien|me dice|por favor)\s+)*(?:donde|(?:la|su)\s+(?:ubicacion|direccion)|ubicacion|direccion|mapa)[\s?¿.!]*$/.test(value)) return 'request'
  return null
}

export function locationAnswer(info: Row, kind: LocationRequestKind = 'request') {
  const address = text(object(info.proyecto).address || info.address).trim()
  const map = text(info.ubicacion || info.map_url).trim()
  if (!address && !/^https:\/\//.test(map)) return ''
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
  if (!force) return reply
  const address = text(object(info.proyecto).address || info.address).trim()
  const map = text(info.ubicacion || info.map_url).trim()
  const parts: string[] = []
  if (address && !reply.toLocaleLowerCase('es').includes(address.toLocaleLowerCase('es'))) parts.push(`Dirección: ${address}`)
  if (/^https:\/\//.test(map) && !reply.includes(map)) parts.push(`Mapa: ${map}`)
  return parts.length ? `${reply.trim()}\n\n${parts.join('\n')}` : reply
}
