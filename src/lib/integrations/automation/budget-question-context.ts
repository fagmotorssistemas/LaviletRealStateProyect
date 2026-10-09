import { object, text } from './data'
import { normalized } from './sdr-rules'

/** The question supplies the scope of a reply, never its amount, approval or
 * consent. Questions that offer two monetary roles deliberately stay open. */
export function budgetQuestionBasis(raw: unknown): 'total_budget' | 'down_payment' | null {
  const question = object(raw)
  if (question.id !== 'budget_amount') return null
  const value = normalized(text(question.question))
  const total = /\b(?:presupuesto|monto|importe|valor|capital)\s+total\b|\btotal\s+(?:para|de)\s+(?:la\s+)?compra\b/.test(value)
  const initial = /\bentrada\b|\b(?:capital|aporte|pago)\s+inicial\b/.test(value)
  return total && !initial ? 'total_budget' : initial && !total ? 'down_payment' : null
}

export const BUDGET_QUESTION_CONTEXT_RULES = `PRESUPUESTO EN CONTEXTO: una respuesta monetaria directa a la pregunta pendiente sobre presupuesto TOTAL para la compra declara total_budget y budget.status=maximum_total, aunque el cliente conteste solo «unos 200 mil». La finalidad queda aclarada por la pregunta; la cifra y su evidence proceden exclusivamente del mensaje actual. maximum_total identifica el papel del dinero, no convierte toda estimación en un máximo rígido. Preserve expresiones aproximadas y rangos en la cita y no presente sus extremos como límites definitivos. Una declaración actual explícita de entrada prevalece sobre la pregunta de total: use down_payment e initial_capital. Si pregunta total O entrada, si la pregunta es genérica o si el cliente mantiene una duda real sobre la finalidad, use amount y aclare el rol. No use una pregunta histórica para atribuir finalidad cuando el mensaje actual no la responde; un sí sin cifra no inventa dinero. Una finalidad ya confirmada se conserva en memoria y no se vuelve a preguntar en un turno de aceptación o consulta. Esto no autoriza financiamiento, selección, visita ni reserva.`
