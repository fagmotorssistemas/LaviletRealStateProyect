import { object, text, type Row } from './data'

export const commercialContinuationSources = new Set([
  'property_unit_selected', 'property_budget_deferred', 'property_budget_confirmed',
  'property_floor_comparison', 'property_floor_options', 'property_living_options',
  'unit_alternative', 'unit_alternative_journey', 'accepted_unit_alternative',
  'accepted_price_option', 'budget_options',
])

const lockedSources = new Set([
  'visit_intake', 'visit_status', 'visit_option_choice', 'visit_acceptance_clarification',
  'financing_selection_required', 'financing_question', 'team_attendance',
])

export const COMMERCIAL_CONTINUATION_RULES = `El objetivo comercial es atender la necesidad actual y ayudar a encontrar una opción viable y un próximo paso pertinente. La selección del cliente se conserva mientras no solicite cambiarla. Ofrecer comparar alternativas NO cambia esa selección ni autoriza a afirmar que el cliente eligió otra unidad. Ante una limitación económica puede ofrecer alternativas verificadas o explorar financiamiento y preguntar qué camino prefiere; no está obligado a pedir presupuesto ni a volver a elegir planta o unidad. No repita datos ya solicitados y respondidos. Afirmar que otra opción cuesta menos exige precios comparables verificados. Preserve condiciones de precios referenciales y no prometa aprobación ni condiciones financieras sin respaldo. Una consulta atendida o un cierre del cliente puede terminar sin pregunta; evalúe una continuación útil sin presionar ni preguntar por costumbre.`

/** Locks decisions and facts, not their conversational wording. */
export function responsePlan(baseReply: string, audit: Row) {
  const source = text(audit.source)
  const uncovered = Array.isArray(audit.uncovered_requests) ? audit.uncovered_requests : []
  const locked = audit.coverage_complete !== false && !uncovered.length
    && (lockedSources.has(source) || source === 'unit_price' && audit.verified_price_only === true && audit.price_grounded !== true)
  return {
    source,
    locked,
    protected_facts: [...(Array.isArray(object(audit.catalog_results).units) ? object(audit.catalog_results).units as unknown[] : []),
      ...(Array.isArray(object(audit.alternative_results).units) ? object(audit.alternative_results).units as unknown[] : [])],
    covered_requests: Array.isArray(audit.covered_requests) ? audit.covered_requests : [],
    required_links: [...baseReply.matchAll(/https?:\/\/[^\s)]+/g)].map(match => match[0]),
    required_numbers: [...baseReply.matchAll(/\b\d[\d.,]*\b/g)].map(match => match[0]),
    next_question: text(baseReply.match(/[^?¿\n]*\?\s*$/)?.[0]).trim() || null,
  }
}

export const FINAL_WRITER_RULES = `Actúe como redactor final de todas las rutas conversacionales de La Vilet, no solo de la presentación del proyecto.
${COMMERCIAL_CONTINUATION_RULES}
Use contrato_redaccion y evidencia_turno para responder al cliente con naturalidad. No cambie acciones operativas ni invente selecciones del cliente. Si decisiones_protegidas=false, la base es una orientación: puede reorganizar, resumir y elegir una pregunta útil según la necesidad actual, sin repetir preguntas resueltas. Para una familia aún sin requisitos conocidos, oriente con categorías verificadas y pregunte un dato útil como dormitorios, sin inventar ocupación máxima ni asumir tamaño familiar. Una aceptación continúa la propuesta pendiente; una comparación explica diferencias; una consulta concreta recibe primero su respuesta. No convierta un resumen en una lista de fichas.
No narre su procesamiento interno ni las operaciones que realiza para preparar la respuesta: evite «descarto los penthouses», «me concentro en los departamentos», «he interpretado su intención» o «aplico el filtro». Exprese directamente la información útil para el cliente; por ejemplo, «Los departamentos de 3 dormitorios comparten estas características…». Puede reconocer brevemente su preferencia sin describir el trabajo interno. Esto no impide informar una acción real solicitada por el cliente cuando su resultado esté confirmado en el contexto operativo; nunca la invente.
Conserve los hechos necesarios para responder la consulta, condiciones y enlaces obligatorios. Las cifras_obligatorias del contrato deben conservarse; otras cifras de opciones secundarias pueden omitirse cuando no sean pertinentes, sin alterar los valores que sí mencione. No añada brochure, saludo, invitación ni pregunta por costumbre: respete el contrato y el modo comercial del contexto.
Si recibe apertura_decidida, conserve literalmente su prefix cuando no esté vacío. Si está vacío, la cortesía es opcional: puede añadir una apertura breve pertinente al mensaje actual, sin repetir aperturas recientes. No agregue una fórmula en todos los turnos.
El saludo lo aplica el sistema después de redactar: no añada saludos nuevos. Si decisiones_protegidas=true, solo mejore la expresión, sin añadir hechos ni preguntas; conserve literalmente la pregunta_siguiente cuando exista.
Puede mejorar una base correcta pero poco natural. Si ya es clara y pertinente, consérvela. Nunca invente datos para embellecerla.`

export function finalWriterContract(baseReply: string, audit: Row = {}) {
  const plan = responsePlan(baseReply, audit)
  return {
    version: 'final-writer-v1', ruta: plan.source || 'commercial',
    decisiones_protegidas: plan.locked,
    objetivo: plan.locked ? 'Responder conservando la decisión operativa protegida y su próximo paso.'
      : 'Responder todas las solicitudes actuales con la evidencia del turno y una continuación pertinente al contexto. La base no impone su estructura ni su pregunta.',
    hechos_protegidos: plan.protected_facts,
    price_evidence: audit.price_evidence || null,
    cifras_obligatorias: audit.semantic_review_enabled === true && !plan.locked ? [] : plan.required_numbers, enlaces_obligatorios: plan.required_links,
    pregunta_siguiente: plan.next_question,
    pregunta_pendiente: object(audit.pending_question),
    presentacion: object(audit.alternative_presentation),
    accion: text(audit.action) || null,
    saludo: { responsable: 'sistema', texto: text(audit.writer_greeting) || null },
  }
}
