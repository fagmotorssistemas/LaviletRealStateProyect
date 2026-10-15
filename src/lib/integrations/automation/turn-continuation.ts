import { object, text, type Row } from './data'
import { replyQuestionText } from './reply-question'

/** A question selected by the current journey is a turn obligation, not a style suggestion. */
export function turnContinuation(audit: Row = {}, verified: Row = {}) {
  const journey = object(verified.siguiente_paso_comercial || audit.commercial_journey)
  const question = text(journey.question), id = text(journey.question_id)
  return { required: !!id && !!question, action: text(journey.action) || null,
    question_id: id || null, suggested_question: question || null,
    response_connection: id && question ? 'answer_to_pending_decision' : null,
    instruction: text(journey.instruction), selection_scope: journey.selection_scope || null }
}

export function turnContinuationIssues(reply: string, audit: Row = {}, verified: Row = {}) {
  return turnContinuation(audit, verified).required && !replyQuestionText(reply)
    ? ['required_continuation_missing'] : []
}

export const CONVERSATION_BRIDGE_RULES = `CONEXIÓN ENTRE RESPUESTA Y DECISIÓN PENDIENTE: con response_connection=answer_to_pending_decision, atienda primero la consulta actual y enlace esa respuesta con el siguiente paso que sigue vigente. Si la consulta es distinta de la decisión pendiente, retome esta última mediante una transición breve y pertinente a lo que el cliente acaba de preguntar y a lo ya conocido. No reinicie la presentación del proyecto, su ubicación ni una lista de categorías solo para volver a formular la pregunta; esa información sí puede aparecer cuando responde a la consulta actual. Esta obligación prevalece sobre una instrucción genérica de presentar categorías antes de preguntarlas. La conexión puede integrarse en la pregunta o resultar del significado conjunto de respuesta y pregunta: no exige un conector, una frase literal ni una oración adicional si ya hay una relación clara. Conserve la respuesta válida, las alternativas y la finalidad de la decisión pendiente; no agregue preguntas ni sustituya la continuación por otra oferta. Evalúe la relación real entre ambas partes, no solo que exista una pregunta o que los metadatos describan un próximo paso. Con response_connection=null no cree otra continuación. La ausencia de conexión cuando se retoma una decisión distinta, o reiniciar la presentación para retomarla, incumple esta obligación del turno; no es información faltante del proyecto ni requiere un asesor.`

export const TURN_CONTINUATION_RULES = `CONTINUIDAD DE LA CONVERSACIÓN: responda primero las consultas actuales usando datos y decisiones conocidos. Una duda intermedia conserva el estado. continuacion_del_turno describe un objetivo, no una frase para copiar: decida cómo formular una continuación amable y útil. No vuelva a solicitar datos resueltos, preferencias declaradas indiferentes ni una presentación ignorada o rechazada. Cuando varias dudas requieren atención, puede dejar internamente pendiente la captura sin repetirla inmediatamente. Describa en question la pregunta realmente escrita; sus metadatos nunca sustituyen el mensaje. No inicie gestiones por una pregunta informativa. Respete cierres, negativas y espera del equipo.
${CONVERSATION_BRIDGE_RULES}`
