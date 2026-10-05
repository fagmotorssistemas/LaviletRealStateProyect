import { object, text, type Row } from './data'
import { catalogQuery, filterCatalog } from './catalog-dialogue'
import { normalized } from './sdr-rules'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const ids = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : []
const names: Record<string, string> = { departamento: 'departamentos', penthouse: 'penthouses', suite: 'suites' }
const list = (values: string[]) => new Intl.ListFormat('es', { type: 'conjunction' }).format(values)

/** Prepare one client-led change of search, without treating exploration as a selection. */
export function preferenceOptionsReply(info: Row): { reply: string; audit: Row } | null {
  const reference = object(info.referencia_unidad), context = object(info.property_context || reference.context)
  const transition = object(context.preference_transition), change = object(context.query_transition)
  const reason = text(reference.reason || change.reason)
  const query = catalogQuery(reference.query || context.query)
  const catalog = filterCatalog(rows(info.catalogo), catalogQuery({ group: 'residential', operation: 'search', filters: {} }))
  const previousBedrooms = Number(transition.source_bedrooms || object(change.before).bedrooms || object(object(change.before).filters).bedrooms) || null
  const auditFor = (units: Row[], question: Row, stage: string, extra: Row = {}) => ({ source: 'preference_options', verified_catalog: true,
    catalog_query: query, catalog_results: { units, unit_ids: units.map(unit => unit.id), complete: true },
    offered_unit_ids: units.map(unit => unit.id), selected_unit_ids: [], focused_unit_ids: [], comparison_unit_ids: [],
    pending_question: question, progressive_selection: { stage, reason, question: question.question, criteria: query.filters,
      candidate_ids: units.map(unit => unit.id), client_requested_change: true, preference_kind: transition.kind }, ...extra })
  if (reason === 'cheaper_requires_bedrooms_confirmation') {
    const question = previousBedrooms
      ? `¿Desea que mantengamos los ${previousBedrooms} dormitorios al buscar opciones más económicas?`
      : '¿Cuántos dormitorios desea que tengan las opciones más económicas?'
    return { reply: question, audit: auditFor([], { id: 'property_bedrooms', act: previousBedrooms ? 'confirm_bedrooms' : 'other', question,
      candidate_ids: [], proposed_query: catalogQuery({ ...query, group: 'residential', category: null, scope: 'catalog', operation: 'search', selector: null,
        filters: { ...query.filters, bedrooms: previousBedrooms } }) }, 'confirm_bedrooms') }
  }
  if (['fewer_requires_bedroom_count', 'cheaper_requires_bedroom_count', 'bedroom_confirmation_declined'].includes(reason)) {
    const question = '¿Cuántos dormitorios le gustaría que tenga la vivienda?'
    return { reply: question, audit: auditFor([], { id: 'property_bedrooms', act: 'other', question }, 'choose_bedrooms') }
  }
  const startsFewer = reason === 'requested_fewer_bedrooms'
  const startsCheaper = reason === 'requested_cheaper_options' || transition.kind === 'cheaper' && reason === 'accepted_bedroom_confirmation'
  if (!startsFewer && !startsCheaper) return null
  let choices = filterCatalog(catalog, { ...query, group: 'residential', scope: 'catalog' })
  // Relative requests need a real upper bound. Never offer the old count again.
  if ((startsFewer || transition.fewer_bedrooms === true) && previousBedrooms && query.filters.bedrooms === null && !query.filters.bedrooms_any?.length) choices = choices.filter(unit => Number(unit.bedrooms) > 0 && Number(unit.bedrooms) < previousBedrooms)
  let sourceUnits: Row[] = [], priceVerified = true
  if (startsCheaper) {
    const sourceIds = ids(transition.source_selected_ids).length ? ids(transition.source_selected_ids) : ids(transition.source_offered_ids)
    sourceUnits = catalog.filter(unit => sourceIds.includes(text(unit.id)))
    priceVerified = object(info.politica_comercial).precios_autorizados === true && sourceIds.length > 0
      && sourceUnits.length === new Set(sourceIds).size && sourceUnits.every(unit => Number(unit.published_commercial_price) > 0)
    if (priceVerified) {
      const ceiling = Math.min(...sourceUnits.map(unit => Number(unit.published_commercial_price)))
      choices = choices.filter(unit => Number(unit.published_commercial_price) > 0 && Number(unit.published_commercial_price) < ceiling)
    }
  }
  const categories = ['departamento', 'penthouse', 'suite'].filter(category => choices.some(unit => unit.category === category))
  if (!categories.length) {
    const question = '¿Qué otro requisito estaría dispuesto a ajustar para revisar alternativas?'
    return { reply: `No aparecen opciones disponibles que cumplan este cambio${startsCheaper ? ' y tengan un precio verificado menor' : ''}. ${question}`,
      audit: auditFor([], { id: 'property_category', act: 'other', question }, 'no_matching_options') }
  }
  const descriptions = categories.map(category => {
    const counts = [...new Set(choices.filter(unit => unit.category === category).map(unit => Number(unit.bedrooms)).filter(value => value > 0))].sort((a, b) => a - b)
    return `${names[category]}${counts.length ? ` de ${list(counts.map(String))} ${counts.length === 1 && counts[0] === 1 ? 'dormitorio' : 'dormitorios'}` : ''}`
  })
  const question = categories.length === 1 ? `¿Le gustaría obtener más información de ${categories[0] === 'suite' ? 'las' : 'los'} ${descriptions[0]}?`
    : '¿Con cuál de estas opciones le gustaría continuar?'
  const proposed = { ...query, group: 'residential', category: categories.length === 1 ? categories[0] : null, operation: 'search', scope: 'offered', selector: null }
  const pendingQuestion = { id: 'property_category', act: categories.length === 1 ? 'explore_alternatives' : 'choose_category', question,
    candidate_ids: choices.map(unit => unit.id), target_ids: [], proposed_query: proposed }
  const intro = startsCheaper && !priceVerified
    ? `Podemos revisar ${list(descriptions)}, aunque todavía no hay precios comparables verificados para afirmar cuáles son más económicos.`
    : `Contamos con ${startsCheaper ? 'opciones más económicas: ' : 'estas opciones: '}${list(descriptions)}.`
  return { reply: `${intro} ${question}`, audit: auditFor(choices, pendingQuestion, 'choose_category', {
    catalog_query: proposed, query_transition: change,
    ...(sourceUnits.length ? { alternative_results: { units: sourceUnits, unit_ids: sourceUnits.map(unit => unit.id) } } : {}),
    alternative_phase: 'preference_category', price_comparison_verified: startsCheaper ? priceVerified : null }) }
}

export const PROGRESSIVE_OPTIONS_RULES = `CONTINUIDAD DE LAS OPCIONES SOLICITADAS:
estado_operativo.progressive_selection expresa el próximo paso y las opciones pertinentes. Explique por qué cumplen los requisitos conocidos (por ejemplo, los dormitorios) con datos verificados; no suponga que el cliente conoce los filtros internos. No amplíe categorías, dormitorios ni precios por iniciativa del bot. Ofrezca cambios solo si el cliente los pide; pedir menos dormitorios modifica ese requisito, aunque no mencione precio. Pedir más barato sin cantidad requiere aclarar si conserva los dormitorios, no reducirlos automáticamente. Un cambio de dormitorios no prueba que el precio sea menor.
Atienda primero la consulta actual. Tras cotizar varias opciones, invite a conocer detalles; tras compararlas, pregunte cuál desea conocer mejor. Un sí a ver opciones no elige una unidad. Cuando el cliente identifica una unidad, comparta su recorrido verificado. No envíe recorridos de varias unidades para una comparación ni cambie una selección al mostrar alternativas.
Para seleccionar, primero presente las plantas compatibles sin números de unidad y pregunte en qué planta le gustaría revisar opciones. Una vez definida la planta, muestre números y características si hay varias unidades. Si queda una sola compatible, preséntela con sus características y enlace 360 autorizado sin darla por elegida todavía. Si responde que hay una que le interesa sin identificarla, pregunte cuál sin repetir el catálogo.
Si progressive_selection contiene question, úsela como propuesta de continuación: invite a detalles, a elegir categoría/planta/unidad o a aclarar dormitorios según stage cuando siga siendo pertinente. La solicitud actual interpretada prevalece: si pide reservar, financiamiento o una visita, responda esa solicitud sin repetir una pregunta comercial anterior. El revisor comprueba la pertinencia y el propósito, no el texto ni el número de preguntas.
Después de un recorrido individual siga post_tour_continuation: pregunte presupuesto solo si falta, aclare total frente a entrada solo si es ambiguo y respete un presupuesto conocido o aplazado. No añada otra pregunta comercial si ya existe una solicitud operativa o de perfil prioritaria.`

const finalQuestion = (reply: string) => (reply.replace(/https?:\/\/\S+/g, '').match(/¿[^¿?]+\?|[^.!?\n]+\?/g)?.at(-1) || '').trim()

/** A recommendation for the writer/reviewer, never a deterministic rejection. */
export function progressiveQuestionObservations(reply: string, audit: Row, purpose?: string) {
  const plan = object(audit.progressive_selection)
  if (!text(plan.question || object(audit.post_tour_continuation).question) || audit.profile_introduction) return []
  if (!finalQuestion(reply)) return ['commercial_next_question_missing']
  const question = normalized(finalQuestion(reply))
  if (['offer_details', 'choose_unit', 'choose_category', 'choose_floor', 'confirm_bedrooms', 'choose_bedrooms'].includes(text(plan.stage))
    && (/presupuesto|financiamiento|credito|agend|coordinar.*visita|visita (?:presencial|a la oficina)/.test(question)
      || ['coordinate_visit', 'choose_financing_partner', 'collect_financing_required'].includes(purpose || ''))) return ['commercial_next_question_changed']
  return []
}

/** Keep the authorized referent when the writer changes only the question's wording. */
export function progressivePendingQuestion(reply: string, audit: Row): Row {
  // Do not attach the old selection act to a differently purposed question.
  // Its content can still be accepted by semantic review for the current goal.
  const writtenQuestion = object(object(audit.turn_completeness).question)
  if (audit.profile_introduction || progressiveQuestionObservations(reply, audit, text(writtenQuestion.purpose)).length) return {}
  const plan = object(audit.progressive_selection), tour = object(audit.post_tour_continuation)
  if (!text(plan.question) && !text(tour.question)) return {}
  const question = finalQuestion(reply)
  const pending = object(audit.pending_question)
  return question && text(pending.id) ? { ...pending, question } : {}
}
