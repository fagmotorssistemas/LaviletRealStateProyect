import { object, text, type Row } from './data'

const lockedSources = new Set([
  'visit_intake', 'visit_status', 'visit_option_choice', 'visit_acceptance_clarification',
  'property_unit_selected', 'property_budget_deferred', 'property_budget_confirmed',
  'property_floor_comparison', 'property_floor_options',
  'property_living_options', 'unit_alternative', 'unit_alternative_journey',
  'accepted_unit_alternative', 'accepted_price_option', 'budget_options',
  'financing_selection_required', 'financing_question', 'team_attendance',
])

/** Locks decisions and facts, not their conversational wording. */
export function responsePlan(baseReply: string, audit: Row) {
  const source = text(audit.source)
  const uncovered = Array.isArray(audit.uncovered_requests) ? audit.uncovered_requests : []
  const locked = audit.coverage_complete !== false && !uncovered.length
    && (lockedSources.has(source) || source === 'unit_price' && audit.verified_price_only === true)
  return {
    source,
    locked,
    protected_facts: object(audit.catalog_results).units || [],
    covered_requests: Array.isArray(audit.covered_requests) ? audit.covered_requests : [],
    required_links: [...baseReply.matchAll(/https?:\/\/[^\s)]+/g)].map(match => match[0]),
    required_numbers: [...baseReply.matchAll(/\b\d[\d.,]*\b/g)].map(match => match[0]),
    next_question: text(baseReply.match(/[^?¿\n]*\?\s*$/)?.[0]).trim() || null,
  }
}

export const FINAL_WRITER_RULES = `Actúe como redactor final de todas las rutas conversacionales de La Vilet, no solo de la presentación del proyecto.
Use contrato_redaccion para expresar con naturalidad la decisión ya tomada. No elija otra ruta, unidad, acción ni siguiente paso. Adapte la extensión a lo que pide el cliente: una aceptación continúa la propuesta pendiente; una comparación explica diferencias; una consulta concreta recibe primero su respuesta. No convierta un resumen en una lista de fichas.
Conserve los hechos, condiciones, cifras y enlaces obligatorios. No añada brochure, saludo, invitación ni pregunta por costumbre: respete el contrato y el modo comercial del contexto.
El saludo lo aplica el sistema después de redactar: no añada saludos nuevos. Si decisiones_protegidas=true, solo mejore la expresión, sin añadir hechos ni preguntas; conserve literalmente la pregunta_siguiente cuando exista.
Puede mejorar una base correcta pero poco natural. Si ya es clara y pertinente, consérvela. Nunca invente datos para embellecerla.`

export function finalWriterContract(baseReply: string, audit: Row = {}) {
  const plan = responsePlan(baseReply, audit)
  return {
    version: 'final-writer-v1', ruta: plan.source || 'commercial',
    decisiones_protegidas: plan.locked,
    objetivo: 'Responder las solicitudes actuales conservando la decisión y el próximo paso de la respuesta base.',
    hechos_protegidos: plan.protected_facts,
    cifras_obligatorias: plan.required_numbers, enlaces_obligatorios: plan.required_links,
    pregunta_siguiente: plan.next_question,
    pregunta_pendiente: object(audit.pending_question),
    presentacion: object(audit.alternative_presentation),
    accion: text(audit.action) || null,
    saludo: { responsable: 'sistema', texto: text(audit.writer_greeting) || null },
  }
}
