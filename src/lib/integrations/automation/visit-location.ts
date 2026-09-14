import { object, text, type Row } from './data'

export function mentionsVisitLocation(reply: string) {
  return /\b(?:visita|visitarnos|oficina|direcci[oó]n|ubicaci[oó]n|terreno|recibirle|recibirlo|recibirla)\b|le esperamos/i.test(reply)
}

// Location is delivered as verified content after composition, so a stylistic
// rewrite cannot omit it or replace the map with a promise to send it later.
export function withVisitLocation(reply: string, info: Row, force = false) {
  if (!force && !mentionsVisitLocation(reply)) return reply
  const address = text(object(info.proyecto).address || info.address).trim()
  const map = text(info.ubicacion || info.map_url).trim()
  const parts: string[] = []
  if (address && !reply.toLocaleLowerCase('es').includes(address.toLocaleLowerCase('es'))) parts.push(`Dirección: ${address}`)
  if (/^https:\/\//.test(map) && !reply.includes(map)) parts.push(`Mapa: ${map}`)
  return parts.length ? `${reply.trim()}\n\n${parts.join('\n')}` : reply
}
