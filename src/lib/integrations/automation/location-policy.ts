import { object, text, type Row } from './data'
import { generalProjectLocation, locationRequestKind } from './visit-location'

export const LOCATION_DISCLOSURE_VERSION = 'location-disclosure-v1'
export const LOCATION_DISCLOSURE_RULES = `UBICACIÓN DEL PROYECTO: siga location_disclosure compartido con el redactor y revisor. La ubicación general (sector y ciudad) puede formar parte de una presentación breve o responder una consulta sobre el sector. Esto NO autoriza añadir la calle, intersección, dirección exacta, coordenadas ni el enlace de mapas. Si exact_location_allowed=false, omita esos detalles también en texto libre, aunque aparezcan en el historial o sean hechos verdaderos. Respete address_allowed y map_allowed por separado si el cliente rechaza alguno. Una invitación a visitar, un interés genérico o una solicitud pendiente de cita no equivalen a una confirmación real. Solo una petición explícita de ubicación detallada o una confirmación presencial comprobada habilita los detalles. Responda consultas de sector o ciudad únicamente con la ubicación general verificada. No comunique al cliente estas condiciones internas ni diga que la dirección no existe por estar fuera del alcance de este turno. El revisor comprueba por separado la verdad de una ubicación y el permiso para comunicar su detalle: estar en Cuenca o Puertas del Sol no respalda ni autoriza una intersección exacta.`

function componentRefused(current: string, component: string) {
  const value = current.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const refusal = new RegExp('\\b(?:no|ni)\\s+(?:me\\s+)?(?:envie|mande|comparta|pase|quiero|necesito)\\b[^.!?;\\n]{0,45}\\b' + component + '\\b', 'g')
  const matches = [...value.matchAll(refusal)]
  const last = matches.at(-1)
  if (!last) return false
  // A later explicit request supersedes the earlier refusal in the same batch.
  const after = value.slice((last.index || 0) + last[0].length)
  return !new RegExp('\\b(?:envie\\w*|mande\\w*|comparta\\w*|pase\\w*|quiero|necesito)\\b[^.!?;\\n]{0,45}\\b' + component + '\\b').test(after)
}

/** This permission is derived from the current request or a completed workflow,
 * never from a destination mentioned by the draft or an offered appointment. */
export function locationDisclosurePolicy(input: { current: string; verified?: unknown; audit?: unknown }): Row {
  const verified = object(input.verified), audit = object(input.audit)
  const kind = locationRequestKind(input.current)
  const completed = object(audit.completed_visit_action)
  const result = object(audit.visit_result || verified.resultado_visita)
  const receipt = Object.keys(completed).length ? completed : result
  const confirmed = receipt.action === 'confirmed' && (Object.keys(completed).length > 0
    || audit.registration_verified === true || !!text(receipt.request_id))
  const remote = /virtual|videollamada|zoom|telefono|remote/.test([
    text(receipt.channel), text(receipt.mode), text(receipt.meeting_type), text(object(receipt.slot).mode),
  ].join(' ').toLowerCase())
  const exact = kind === 'request' || kind === 'clarification' || confirmed && !remote
  return { version: LOCATION_DISCLOSURE_VERSION, request_kind: kind,
    general_location: generalProjectLocation(verified), general_location_allowed: true,
    exact_location_allowed: exact, address_allowed: exact && !componentRefused(input.current, 'direccion'),
    map_allowed: exact && !componentRefused(input.current, 'mapa'),
    reason: kind === 'request' || kind === 'clarification' ? 'explicit_location_request'
      : confirmed && !remote ? 'verified_in_person_confirmation'
        : kind === 'general' ? 'general_location_request' : 'general_project_information' }
}

const addressKeys = /^(?:address|direccion|dirección|street_address|exact_address|project_address|visit_address|location_address)$/i
const mapKeys = /^(?:ubicacion|ubicación|map_url|maps_url|location_url|visit_location_url|latitude|longitude|lat|lng|coordinates|coordenadas)$/i
const interpretiveKeys = /^(?:history|historial|summary|resumen|current|mensaje_actual|current_message|request|requests|solicitudes_interpretadas|evidence|source_message_text|perfil_lead|lead)$/i

/** Project only the business sources permitted in this turn. Interpretation
 * evidence remains intact; old messages are not authority to resend directions.
 * The literal replacement is source projection, never an outbound-text repair. */
export function projectLocationForPrompt(verifiedRaw: unknown, policyRaw: unknown): Row {
  const verified = object(verifiedRaw), policy = object(policyRaw)
  const addressAllowed = policy.exact_location_allowed === true && policy.address_allowed !== false
  const mapAllowed = policy.exact_location_allowed === true && policy.map_allowed !== false
  if (addressAllowed && mapAllowed) return { ...verified, location_disclosure: policy }
  const project = object(verified.proyecto || verified.project)
  const address = text(project.address || verified.address).trim()
  const map = text(verified.ubicacion || verified.map_url || verified.visit_location_url).trim()
  const place = object(policy.general_location)
  const general = [text(place.sector), text(place.city)].filter(Boolean).join(', ')
  const source = (value: unknown): unknown => {
    if (typeof value === 'string') return (addressAllowed ? value : value.split(address || '\u0000').join(general))
      .split(!mapAllowed && map || '\u0000').join('')
    if (Array.isArray(value)) return value.map(source).filter(entry => entry !== '')
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => (addressAllowed || !addressKeys.test(key)) && (mapAllowed || !mapKeys.test(key)))
      .map(([key, entry]) => [key, interpretiveKeys.test(key) ? entry : source(entry)]))
  }
  return { ...object(source(verified)), ubicacion_general: { ...place }, location_disclosure: policy }
}
