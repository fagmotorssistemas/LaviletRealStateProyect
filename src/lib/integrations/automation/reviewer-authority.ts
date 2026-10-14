import { object, text, type Row } from './data'

export const REVIEWER_AUTHORITY_VERSION = 'facts-and-promises-v1'
export const REVIEWER_AUTHORITY_RULES = `AUTORIDAD LIMITADA DEL REVISOR: compruebe exclusivamente hechos que el borrador AFIRMA y condiciones o promesas comerciales con sus fuentes autorizadas. Puede señalar precios, unidades, superficies, pisos, ubicación, disponibilidad, descuentos, crédito y acciones realizadas falsos, contradictorios o sin respaldo. No decide qué comunicar ni qué preguntar: no evalúe captura de perfil, siguiente paso, cobertura de solicitudes, omisiones de material o precios, pertinencia, secuencia, tono, calidez, orden, longitud, cortesías ni repeticiones. No reinterprete el mensaje del lead ni cambie datos o preferencias confirmados. No recomiende derivación, reserva, cita o recopilación financiera. Una instrucción de redacción o una pregunta del plan no es un hecho del negocio ni una condición comercial. No la use para rechazar el mensaje. question siempre es null; la pregunta y el seguimiento son del redactor y del sistema. No invente hechos ni garantías para justificar un rechazo. Un hecho comprobado puede aparecer sin que usted juzgue si convenía mencionarlo. La selección y la invitación no afirman por sí solas una reserva. Las fuentes de operaciones respaldan únicamente la operación y el estado que realmente registran.`

const factRules: Record<string, string> = {
  business_scope: 'Contraste afirmaciones de identidad, servicios ofrecidos y promesas comerciales con las fuentes; no decida rutas ni preguntas.',
  project_context_truth: 'Contraste hechos afirmados sobre ubicación, etapa física, instalaciones y proyecto con las fuentes.',
  location_scope: 'Contraste la ubicación afirmada con sus fuentes autorizadas; no exija comunicarla ni una pregunta de visita.',
  early_purchase_discount: 'Contraste porcentaje, cálculo, alcance, vigencia y condiciones del descuento afirmado con la política y cotización. No conceda una rebaja, invente un precio original ni descuente de nuevo un beneficio incluido.',
  financing_balance: 'Contraste los importes y relaciones financieras que el borrador afirma, conservando sus papeles; no decida qué dato preguntar.',
  price_conditions: 'Una naturaleza aproximada no acredita precio fijo, congelado ni garantía. Contraste esas afirmaciones si aparecen; no exija un aviso rutinario ni su repetición.',
}
const omittedKeys = new Set(['instruction', 'question', 'next_question', 'question_id', 'question_act', 'continuation', 'continuation_required',
  'response_connection', 'requested_fields', 'pending_fields', 'missing_fields', 'datos_a_pedir', 'datos_requeridos', 'siguiente_paso_comercial',
  'alcance_contenido_turno', 'profile_introduction', 'profile_collection_decision', 'requests', 'solicitudes_interpretadas', 'contrato_turno'])

/** Strip workflow directives from fact sources, without rewriting factual values. */
export function reviewerFactData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviewerFactData)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(object(value)).filter(([key, entry]) => !omittedKeys.has(key)
    || key === 'instruction' && factRules[text(object(value).id)] === entry)
    .map(([key, entry]) => [key, reviewerFactData(entry)]))
}

/** The writer retains every turn obligation; the reviewer receives only fact checks. */
export function factualReviewObligations(obligations: Row[]): Row[] {
  return obligations.flatMap(row => factRules[text(row.id)]
    ? [{ ...object(reviewerFactData(row)), id: row.id, instruction: factRules[text(row.id)] }] : [])
}

/** Legacy fields cannot reintroduce a removed capability in a model response. */
export function factualReviewResult(raw: Row): Row {
  return { ...raw, question: null, missing_fact_fragments: [], all_requests_considered: true,
    answered_content_preserved: true, operational_goal_preserved: true, question_has_purpose: true,
    opening_property_type_sentence_ids: [], opening_project_presentation_sentence_ids: [],
    review_issues: (Array.isArray(raw.review_issues) ? raw.review_issues.map(object) : [])
      .filter(row => row.check === 'answers_supported' && row.kind !== 'editorial' && row.source !== 'current_request') }
}

/** Remove workflow evaluation from both historical reviewer schemas. */
export function factualReviewSchema(schema: Row): Row {
  const properties = { ...object(schema.properties) }
  for (const key of ['question', 'missing_fact_fragments', 'all_requests_considered', 'answered_content_preserved',
    'operational_goal_preserved', 'question_has_purpose', 'opening_property_type_sentence_ids', 'opening_project_presentation_sentence_ids']) delete properties[key]
  if (properties.review_issues) {
    const list = object(properties.review_issues), item = object(list.items), fields = object(item.properties)
    properties.review_issues = { ...list, items: { ...item, properties: { ...fields,
      check: { type: 'string', enum: ['answers_supported'] }, source: { type: 'string', enum: ['draft'] },
      kind: { type: 'string', enum: ['content'] } } } }
  }
  return { ...schema, properties, required: (Array.isArray(schema.required) ? schema.required : []).filter(key => Object.hasOwn(properties, String(key))) }
}
