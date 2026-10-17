import { object,text,type Row } from './data'

/** A writer objective derived from the saved operation, never from draft prose. */
export function visitIntakePlan(audit: Row): Row {
  if (audit.source !== 'visit_intake') return {}
  const action = text(audit.action), slot = object(audit.preference)
  if (action === 'submitted') return {
    phase: audit.registration_verified === true && !!text(audit.request_id) ? 'awaiting_advisor' : 'registration_unverified',
    request_id: audit.registration_verified === true ? text(audit.request_id) || null : null,
    missing_fields: [], requires_question: false,
    instruction: audit.registration_verified === true && !!text(audit.request_id)
      ? 'Comunique la solicitud registrada y la revisión de agenda que sigue. Reconozca brevemente la preferencia; no vuelva a pedirla ni añada una advertencia de falta de confirmación.'
      : 'Explique la ayuda necesaria para comprobar el registro, sin atribuir una solicitud guardada ni una cita al cliente.',
  }
  if (action !== 'collecting') return {}
  const exactTime = slot.confidence === 'exact' && Number.isFinite(Date.parse(text(slot.start_time)))
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(text(slot.requested_date)) || exactTime
  const hasTime = slot.has_time === true || exactTime
  const missing = [!hasDate && 'date', !hasTime && 'time', audit.needs_location === true && 'destination'].filter(Boolean)
  const question = audit.needs_location === true ? '¿En cuál de los lugares habilitados le gustaría que le recibamos?'
    : !hasDate && !hasTime ? '¿Qué día y a qué hora le gustaría visitarnos?'
      : !hasDate ? '¿Qué día le gustaría visitarnos a esa hora?'
        : !hasTime ? '¿A qué hora le gustaría visitarnos ese día?'
          : '¿Se refiere a ese horario por la mañana o por la tarde?'
  return { phase: 'collecting', request_id: null, missing_fields: missing.length ? missing : ['time_precision'],
    requires_question: true, question_id: audit.needs_location === true ? 'visit_destination' : 'visit_date_time', question,
    instruction: 'La coordinación todavía necesita el dato indicado. Continúe con una pregunta breve sobre ese dato; no termine repitiendo una preferencia como si ya hubiera avanzado el registro. Si la fuente es ambigua, aclare únicamente esa ambigüedad y conserve los datos ya resueltos. La pregunta es una referencia de intención con redacción libre.' }
}

export const VISIT_INTAKE_STATE_RULES = 'estado_operativo.coordination contiene el resultado estructurado de la coordinación de cita. Con phase=collecting, atienda la consulta y pregunte solamente el dato pendiente; reconocer una fecha no sustituye completar esa coordinación. Con phase=awaiting_advisor comunique la solicitud efectivamente registrada y la revisión de agenda que sigue, sin repetir datos ni pedir otro permiso. Con phase=registration_unverified explique la ayuda para comprobar el registro. Estas fases son controles internos: exprese el avance y el próximo paso en positivo, con cercanía y sin coletillas como «esto no confirma» o «su cita todavía no está confirmada». Una cita efectivamente confirmada se comunica únicamente a partir del resultado correspondiente.'
