import { object, text, type Row } from './data'
import { replyQuestionText } from './reply-question'

/** A question selected by the current journey is a turn obligation, not a style suggestion. */
export function turnContinuation(audit: Row = {}, verified: Row = {}) {
  const journey = object(verified.siguiente_paso_comercial || audit.commercial_journey)
  const question = text(journey.question), id = text(journey.question_id)
  return { required: !!id && !!question, action: text(journey.action) || null,
    question_id: id || null, suggested_question: question || null,
    instruction: text(journey.instruction), selection_scope: journey.selection_scope || null }
}

export function turnContinuationIssues(reply: string, audit: Row = {}, verified: Row = {}) {
  return turnContinuation(audit, verified).required && !replyQuestionText(reply)
    ? ['required_continuation_missing'] : []
}

export const TURN_CONTINUATION_RULES = `CONTINUIDAD DE LA CONVERSACIÓN: responda primero todas las consultas actuales y después retome el siguiente paso vigente, usando los datos y decisiones ya conocidos. Una consulta intermedia no borra ese paso. Si continuacion_del_turno.required=true, incluya en reply una pregunta que cumpla question_id y su finalidad. Su formulación es libre; su presencia y finalidad son obligatorias, aunque ya haya respondido la duda o entregado el brochure. No basta describirla en question.next_decision. No la sustituya por «¿desea más información?» si corresponde elegir tipo, planta, unidad, presupuesto u otra decisión concreta. No vuelva a solicitar datos resueltos ni una presentación que el lead haya ignorado o rechazado; siga la etapa vigente. No inicie gestiones por una pregunta informativa. Con required=false no invente una pregunta: respete cierres, negativas, espera del equipo y preguntas operativas definidas por otras obligaciones.`
