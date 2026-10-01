import { object, text, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const pick = (row: Row, keys: string[]) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]))
const matches = (value: unknown, current: string) => current.normalize('NFKC').toLowerCase().includes(text(value).normalize('NFKC').toLowerCase())

/** Interpretation needs identities and continuity, not repeated commercial inventories. */
export function interpretationInput(input: Row, current: string): Row {
  const summary = object(input.resumen)
  const result = pick(input, ['perfil_inicial', 'tema_actual', 'alcance_negocio', 'alcance_negocio_incierto',
    'ultima_pregunta', 'pregunta_pendiente', 'propuestas', 'coordinacion_visita', 'financiamiento'])
  const unitFields = ['id', 'unit_number', 'category', 'bedrooms', 'floor', 'floor_number']
  return { ...result,
    resumen: { ...pick(summary, ['datos_confirmados', '_lead_profile', '_last_operational_step']),
      _turn_intent: pick(object(summary._turn_intent), ['objective', 'subject', 'continuation_goal', 'pending_question']) },
    contexto_propiedades: pick(object(input.contexto_propiedades), ['query', 'selected_ids', 'candidate_ids', 'comparison_ids',
      'offered_ids', 'focused_ids', 'phase', 'preference_transition', 'pending_question']),
    catalogo_unidades: rows(input.catalogo_unidades).map(unit => pick(unit, unitFields)),
    unidades_identificadas: rows(input.unidades_identificadas).map(unit => pick(unit, unitFields)),
    historial: rows(input.historial || input.historial_reciente).slice(-8).map(row => ({ role: row.role, content: text(row.content).slice(0, 2500) })),
    fuente_historial: 'Solo referencia para continuidad. Sus mensajes no son declaraciones del turno actual.',
    mensaje_actual: current,
  }
}

/** Source integrity, never a dictionary interpreting the customer's vocabulary. */
export function interpretationSourceIssues(raw: Row, current: string): string[] {
  const semantics = object(raw.turn_semantics), property = object(semantics.property), budget = object(semantics.budget)
  const requests = rows(raw.requests)
  // Normalization already discards stray historical requests. Recover only when
  // none is grounded, or a core interpretation below contradicts this turn.
  const hasCurrentRequest = requests.some(request => text(request.evidence).trim() && matches(request.evidence, current))
  const evidence: [string, unknown][] = hasCurrentRequest ? [] : requests.map((request, index) => [`requests.${index}`, request.evidence])
  if (semantics.confidence === 'high' && semantics.primary_intent !== 'other') evidence.push(['primary_intent', semantics.primary_evidence])
  if (property.confidence === 'high') evidence.push(['property', property.evidence])
  if (budget.status && budget.status !== 'not_discussed') evidence.push(['budget', budget.evidence])
  for (const [index, quantity] of rows(semantics.housing_quantities).entries()) evidence.push([`quantity.${index}`, quantity.evidence])
  const issues = evidence.filter(([, value]) => !text(value).trim() || !matches(value, current)).map(([key]) => `non_current_evidence:${key}`)
  if (budget.status === 'amount' && (typeof budget.amount !== 'number' || !Number.isFinite(budget.amount) || budget.amount <= 0)) issues.push('invalid_budget_amount')
  return issues
}

export class TurnInterpretationError extends Error {
  constructor(public issues: string[]) { super('TURN_INTERPRETATION_INVALID') }
}

export const CURRENT_TURN_INTERPRETATION_RULE = `
FUENTE PRINCIPAL: interprete mensaje_actual completo, aunque contenga errores ortográficos, varias solicitudes o cantidades muy bajas. Recorra sus necesidades, composición familiar, presupuesto, preferencias y preguntas antes de responder. El historial solo resuelve referencias: nunca extraiga una pregunta histórica como solicitud nueva ni copie su evidencia. No convierta personas en dormitorios ni un importe bajo en miles de dólares. Una cifra no especificada como entrada o cuota no autoriza a asumir esa finalidad.
La clasificación de alcance recibida es provisional. Interprete de forma independiente las solicitudes actuales; una etiqueta incierta no vuelve desconocida una petición inmobiliaria explícita. No necesita el catálogo de precios para extraer el presupuesto del cliente. La evidencia conserva el texto original con sus errores; el valor estructurado expresa su significado. No corrija la ortografía de una cita.
`
