import { object, text, type Row } from './data'
import { catalogQuery, filterCatalog } from './catalog-dialogue'
import { normalized } from './sdr-rules'
import { deliveredPendingQuestion } from './continuation-question'

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
Siga siguiente_paso_comercial como decisión vigente, por encima de una pregunta anterior de progressive_selection o post_tour_continuation. El descubrimiento sigue uso → presupuesto → necesidades y dormitorios → tipo → planta → unidades → elección, omitiendo datos resueltos y respetando negativas o presupuesto aplazado. Atienda primero todas las consultas actuales y retome la única decisión pendiente; cotizar o comparar no obliga a ofrecer más detalles ni a reabrir una elección.
estado_operativo.progressive_selection conserva las opciones pertinentes y sus requisitos conocidos. Explique brevemente por qué cumplen esos requisitos con datos verificados; no amplíe categorías, dormitorios ni precios por iniciativa del bot. Tener opciones asequibles no autoriza reducir dormitorios ni sustituir preferencias; si no gustan, aclare el motivo cuando falte y conserve lo conocido. Pedir menos dormitorios modifica ese requisito, aunque no mencione precio. Pedir más barato sin cantidad requiere aclarar si conserva los dormitorios, no reducirlos automáticamente. Un cambio de dormitorios no prueba que el precio sea menor.
Un sí a ver opciones acepta esa exploración, no elige tipo ni unidad. Presente todos los tipos compatibles y pregunte cuál prefiere; después resuma dimensiones y plantas del tipo elegido, preguntando planta sólo si hay varias. Con la planta definida o única, muestre números y características de las unidades y continúe con la elección que falte. Una sola compatible tampoco queda elegida automáticamente. Cuando el cliente identifica una unidad o pide su recorrido, comparta el enlace 360 verificado correspondiente. Un recorrido general anterior no sustituye al individual. No envíe recorridos de varias unidades para una comparación ni cambie una selección al mostrar alternativas.
Una limitación de cabida restringe promesas ante una duda espacial concreta; no se verbaliza como advertencia genérica de que las opciones podrían no servir a la familia. Después de un recorrido individual conserve la unidad de interés y siga el plan vigente: pregunte presupuesto únicamente si aún falta y no está pospuesto; aclare total frente a entrada solo si es ambiguo. Las solicitudes operativas o la presentación autorizada tienen prioridad. Una aceptación de financiamiento conserva ese interés y retoma primero la selección pendiente, sin adelantar datos financieros.`

const finalQuestion = (reply: string) => (reply.replace(/https?:\/\/\S+/g, '').match(/¿[^¿?]+\?|[^.!?\n]+\?/g)?.at(-1) || '').trim()

/** A recommendation for the writer/reviewer, never a deterministic rejection. */
export function progressiveQuestionObservations(reply: string, audit: Row, purpose?: string) {
  const plan = object(audit.progressive_selection), journey = object(audit.commercial_journey)
  if (audit.profile_introduction) return []
  // The resolved journey can supersede a legacy selection/tour suggestion.
  // Its semantic obligation is checked by turn review, not by the old stage.
  if (text(journey.action)) return text(journey.question) && !finalQuestion(reply) ? ['commercial_next_question_missing'] : []
  if (!text(plan.question || object(audit.post_tour_continuation).question)) return []
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
  const journey = object(audit.commercial_journey)
  if (text(journey.action)) return text(journey.question)
    ? deliveredPendingQuestion(reply, { metadata: writtenQuestion, plan: journey, candidates: [object(audit.pending_question)] }) : {}
  const plan = object(audit.progressive_selection), tour = object(audit.post_tour_continuation)
  if (!text(plan.question) && !text(tour.question)) return {}
  const question = finalQuestion(reply)
  const pending = object(audit.pending_question)
  return question && text(pending.id) ? { ...pending, question } : {}
}
