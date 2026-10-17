import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { currentQuote } from './current-quote'

export const TURN_COMMUNICATION_KINDS = ['greeting_only', 'courtesy_only', 'substantive', 'ambiguous', 'reaction_only'] as const
export type TurnCommunicationKind = typeof TURN_COMMUNICATION_KINDS[number]
export type TurnCommunication = {
  kind: TurnCommunicationKind
  evidence: string
  confidence: 'high' | 'medium' | 'low'
  greeting_present: boolean
}

export const communicationSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: [...TURN_COMMUNICATION_KINDS] },
    evidence: { type: 'string', description: 'Cita literal del turno actual que respalda la función comunicativa del conjunto.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    greeting_present: { type: 'boolean', description: 'Existe una fórmula social de saludo dentro del turno, aunque también haya una consulta sustantiva.' },
  },
  required: ['kind', 'evidence', 'confidence', 'greeting_present'],
}

export const COMMUNICATION_INTERPRETATION_RULES = `communication identifica por IA la función comunicativa del turno completo; no depende de listas de saludos, idioma, ortografía ni palabras clave del código. Lea todos los mensajes actuales juntos, incluidas muletillas, audios transcritos y correcciones. greeting_only significa que solo está iniciando o retomando el contacto con un saludo social, aunque incluya vacilaciones o formas coloquiales. courtesy_only es una cortesía de cierre o devolución sin consulta, decisión, dato solicitado ni autorización nueva. reaction_only es una reacción sin contenido que requiera respuesta. substantive identifica una consulta, declaración, respuesta a la pregunta pendiente, decisión, autorización o rechazo que deba atenderse. ambiguous significa que no puede determinar qué solicita; no equivale a una necesidad comercial sin categoría.
La presencia de un saludo no convierte todo el turno en greeting_only: saludo más consulta, aceptación, rechazo, baja o datos pendientes es substantive y conserva todas esas solicitudes. Un sí que responde a una decisión pendiente es substantive, no una cortesía ni una nueva autorización genérica. Un saludo y una muletilla no declaran interés en vivienda o comercio. greeting_present registra el saludo de forma independiente, sin autorizar repetir una bienvenida ya entregada. evidence cita literalmente el turno actual; el historial ayuda a resolver respuestas y referencias, pero no aporta una petición nueva. Si la función comunicativa es ambigua o la confianza es baja, pida ayuda abierta para entender la consulta, sin iniciar calificación por faltarle datos al perfil. Esta interpretación se realiza en la misma extracción del turno; no redacta el mensaje al cliente ni decide operaciones.
INTEGRIDAD DEL LOTE: revise cada mensajes_actuales por separado y después integre el turno completo en el JSON. Un segundo mensaje que añade una característica no sustituye una elección declarada en el primero; solo una corrección o rechazo real la modifica. Una preferencia puede ser breve, coloquial o tener errores: «mejor suites» seguido de «quiero algo pequeño» declara categoría suite y una preferencia por tamaño compacto, no solo una búsqueda residencial genérica. «Mejor algo comercial» puede declarar locales según el contexto, sin exigir la palabra local. Registre la preferencia en category_choice y property, además de las demás consultas y datos. Una duda sobre el brochure junto con nombre conserva ambas cosas. No limite requests ni las declaraciones al último mensaje. Antes de entregar el JSON compruebe que ninguna consulta, respuesta o elección actual se perdió al atender otra; las citas de cada campo pueden corresponder a mensajes distintos del mismo lote. Una aceptación de una propuesta conversacional se interpreta contra esa propuesta real, aunque no fuera una pregunta literal; no la convierta por rutina en reacción o cierre. Esto no autoriza trámites ni una elección que el cliente no haya declarado.`

/** Validate the model's structured interpretation and its source. This function
 * does not recognize words or infer meaning from customer/writer prose. */
export function normalizedTurnCommunication(raw: unknown, current: string): TurnCommunication {
  const value = object(raw), evidence = currentQuote(value.evidence, current) || ''
  const validKind = TURN_COMMUNICATION_KINDS.includes(value.kind as TurnCommunicationKind)
  const confidence = ['high', 'medium', 'low'].includes(text(value.confidence))
    ? value.confidence as TurnCommunication['confidence'] : 'low'
  const grounded = !!evidence
  if (!validKind || !grounded || typeof value.greeting_present !== 'boolean' || !acceptedExtractorConfidence(confidence))
    return { kind: 'ambiguous', evidence: grounded ? evidence : '', confidence: 'low', greeting_present: false }
  return { kind: value.kind as TurnCommunicationKind, evidence, confidence, greeting_present: value.greeting_present }
}

/** Planning consumes the model's metadata, never a vocabulary of greetings.
 * null distinguishes an older context without the field from an uncertain
 * interpretation that must not start commercial discovery. */
export function turnCommunicationKind(value: unknown): TurnCommunicationKind | null {
  const row = object(value), communication = Object.hasOwn(row, 'communication') ? object(row.communication) : row
  if (!Object.hasOwn(communication, 'kind')) return null
  return TURN_COMMUNICATION_KINDS.includes(communication.kind as TurnCommunicationKind)
    && acceptedExtractorConfidence(communication.confidence) && !!text(communication.evidence).trim()
    ? communication.kind as TurnCommunicationKind : 'ambiguous'
}

export function communicationWritingGoal(kind: Exclude<TurnCommunicationKind, 'substantive'>): string {
  const goals: Record<Exclude<TurnCommunicationKind, 'substantive'>, string> = {
    greeting_only: 'Atienda el saludo con una bienvenida amable cuando el contrato autorice iniciar la conversación, identifique el proyecto y ofrezca ayuda mediante una invitación abierta. Si ya recibió la bienvenida, retome con naturalidad. No presuponga intención de compra, categoría ni finalidad y no solicite perfil, presupuesto, dormitorios o unidad por faltarle esos datos. Conserve internamente las decisiones y gestiones vigentes; el saludo no las reinicia ni exige repetirlas. Redacción libre, sin una frase obligatoria.',
    courtesy_only: 'Responda brevemente la cortesía si corresponde, con redacción propia y sin reiniciar la bienvenida, el catálogo ni una pregunta comercial. Conserve las decisiones y gestiones pendientes sin exigir otra respuesta ni atribuir una autorización nueva.',
    reaction_only: 'La intervención es una reacción sin consulta ni decisión nueva. No inicie una respuesta comercial ni capture datos; conserve la conversación y las gestiones vigentes.',
    ambiguous: 'Invite amablemente a aclarar en qué podemos ayudarle o qué desea consultar, con una pregunta abierta y redacción libre. No reduzca esa aclaración a elegir vivienda o local ni solicite nombre, residencia, presupuesto, dormitorios o una unidad por faltarle datos al perfil. Conserve la memoria y no inicie gestiones.',
  }
  return goals[kind]
}

/** Shape shared by planning and the continuation contract. There is no forced
 * question text and no operational authorization in a social/uncertain turn. */
export function communicationOnlyPlan(kind: Exclude<TurnCommunicationKind, 'substantive'>): Row {
  return {
    version: 'commercial-journey-v1', action: kind === 'ambiguous' ? 'clarify_current_request' : kind,
    communication_kind: kind, instruction: communicationWritingGoal(kind),
    question: '', question_id: '', question_act: 'other', continuation_optional: true,
    preserve_commercial_state: true, financing_offer_allowed: false, visit_offer_allowed: false,
  }
}

/** A missing CRM field never turns a social or unresolved message into a sales
 * request. The fallback protects legacy uncertain turns until they are read by
 * the common extractor; it looks only at typed current intent/evidence. */
export function communicationPlanForTurn(info: Row, audit: Row = {}): Row | null {
  const semantics = object(info.semantica_turno), intent = object(info.contrato_turno)
  const communication = Object.hasOwn(semantics, 'communication') ? semantics.communication
    : Object.hasOwn(intent, 'communication') ? intent.communication : audit.communication
  const kind = turnCommunicationKind(communication)
  if (kind && kind !== 'substantive') return communicationOnlyPlan(kind)
  const requests = [info.solicitudes_interpretadas, semantics.requests, intent.requests]
    .flatMap(value => Array.isArray(value) ? value.map(object) : [])
  const hasCurrentRequest = requests.some(request => request.source !== 'pending'
    && request.domain !== 'courtesy' && acceptedExtractorConfidence(request.confidence)
    && !!text(request.evidence).trim())
  const unresolvedScope = audit.source === 'scope_clarification' || intent.objective === 'clarify_scope'
  return unresolvedScope && !hasCurrentRequest ? communicationOnlyPlan('ambiguous') : null
}
