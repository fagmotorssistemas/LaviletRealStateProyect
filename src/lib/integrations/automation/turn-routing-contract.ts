import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'

const enumeration = (values: string[]) => ({ type: 'string', enum: values })
const fields = {
  repair_requested: { type: 'boolean' }, team_attendance: { type: 'boolean' }, visit_help: { type: 'boolean' },
  visit_response: enumeration(['accept', 'counterproposal', 'reject', 'cancel', 'question', 'unclear', 'none']),
  proposal_id: { type: ['string', 'null'] }, option_index: { type: ['integer', 'null'], minimum: 1, maximum: 3 },
  all_options_declined: { type: 'boolean' },
  location_target: enumeration(['project', 'office', 'both', 'none']),
  location_kind: enumeration(['general', 'request', 'clarification', 'none']),
  address_preference: enumeration(['allow', 'decline', 'unspecified']), map_preference: enumeration(['allow', 'decline', 'unspecified']),
  visual_preference: enumeration(['allow', 'decline', 'unspecified']),
  visual_target: enumeration(['unit', 'project', 'both', 'none']),
  visual_only: { type: 'boolean' }, photo_requested: { type: 'boolean' }, house_request: { type: 'boolean' },
  evidence: { type: 'string' }, confidence: enumeration(['high', 'medium', 'low']),
}
export const TURN_ROUTING_SCHEMA = { type: 'object', additionalProperties: false, properties: fields, required: Object.keys(fields) }
export const TURN_ROUTING_RULES = `routing interpreta por IA la función actual que necesita el enrutamiento. repair_requested reclama una repetición o interpretación equivocada; team_attendance consulta si alguien del equipo acudirá; visit_help pide ayuda para elegir horario. visit_response se refiere exclusivamente a la propuesta vigente cuyo ID debe copiarse en proposal_id. accept acepta sin condiciones; counterproposal cambia la preferencia; reject rechaza un horario; cancel cancela la visita; question consulta sin decidir; unclear deja una decisión ambigua. Un tema diferente es none. option_index indica la opción inequívoca de la propuesta, empezando en 1, nunca una opción inventada ni una deducción del código. Si acepta el horario por su fecha u hora, identifique la única opción coincidente; si hay varias no elija. all_options_declined solo cuando rechaza todas las opciones. Una aceptación de propuesta requiere además action_authority.visit=accept/self/project/operation. location_target distingue ubicación del proyecto y oficina. visual_target distingue recorrido de unidad y proyecto; visual_only solo si no solicita nada más. house_request identifica que busca una casa. evidence cita literalmente el mensaje actual. No copie señales de una solicitud anterior ni de un mensaje del bot. No use ninguna señal como autorización independiente.`
  + '\nlocation_kind distingue consulta general de sector/ciudad, petición de dirección/mapa y aclaración de una ubicación enviada. address_preference y map_preference conservan por separado su permiso o rechazo explícito actual; unspecified si no decide. visual_preference conserva si rechaza o permite el material visual, sin atribuir una negativa por otro tema.'
  + '\nphoto_requested identifica una solicitud actual de imágenes, renders o fotografías. No equivale a enviar archivos adjuntos ni implica una visita física. visual_target conserva el espacio al que se refiere; una solicitud de recorrido 360 por sí sola no pide fotografías.'

/** Interpretation is supplied by the model. Only schema and provenance are checked here. */
export function normalizedTurnRouting(raw: unknown, current: string): Row {
  const row = object(raw), evidence = text(row.evidence)
  if (!acceptedExtractorConfidence(row.confidence) || !evidence.trim()
    || !current.normalize('NFKC').includes(evidence.normalize('NFKC'))) return {}
  const result: Row = { evidence, confidence: row.confidence }
  for (const [key, schema] of Object.entries(fields)) {
    if ('enum' in schema) result[key] = schema.enum.includes(text(row[key])) ? row[key]
      : schema.enum.includes('unspecified') ? 'unspecified' : 'none'
    else if (schema.type === 'boolean') result[key] = row[key] === true
  }
  result.proposal_id = text(row.proposal_id) || null
  result.option_index = Number.isInteger(row.option_index) && Number(row.option_index) >= 1 && Number(row.option_index) <= 3 ? row.option_index : null
  return result
}
