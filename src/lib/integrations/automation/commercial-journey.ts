import { object, text, type Row } from './data'
import { selectedFinancingUnit } from './financing-stage'
import { leadBudget, budgetQuestion, reviewedFinancingCovers } from './budget-state'
import { catalogQuery, filterCatalog, partitionCatalog, type CatalogQuery } from './catalog-dialogue'
import { botVisitPolicy, visitInvitation } from '@/lib/inmobiliaria/botVisits'
import { replyQuestions } from './reply-question'
import { normalizedPropertyQuery } from './turn-semantics'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const ids = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : []

/** A code-resolved informational reference does not accept the proposed change. */
export function proposalInformationContext(info: Row): Row {
  const context = object(info.property_context), pending = object(context.pending_question)
  const reference = object(context.proposal_information)
  return reference.version === 'proposal-information-v1' && reference.active === true
    && reference.informational_only === true && pending.id === 'property_requirements'
    && pending.act === 'explore_alternatives' && reference.pending_question_id === pending.id
    && Object.keys(object(reference.query)).length ? reference : {}
}

/** Prefer a verified change to one physical requirement; never relax several
 * constraints, the customer's price limit or an explicitly indispensable count. */
function alternativeRequirement(catalog: Row[], query: CatalogQuery, excluded: Set<string>, scopedIds?: string[]) {
  if (query.filters.bedrooms_required === true) return null
  const fields = new Set(rows(query.requirements).filter(r => r.strength === 'required'
    && !['published_commercial_price', 'unmodeled', 'spaces'].includes(text(r.field))).map(r => text(r.field)))
  if (query.filters.bedrooms !== null || query.filters.bedrooms_any?.length) fields.add('bedrooms')
  if (query.filters.floor_number !== null) fields.add('floor_number')
  if (query.filters.min_area_m2 !== null || query.filters.max_area_m2 !== null) fields.add('area_internal_m2')
  const proposals: { field: string; query: CatalogQuery; units: Row[] }[] = []
  for (const field of fields) {
    const filters = { ...query.filters }
    if (field === 'bedrooms') Object.assign(filters, { bedrooms: null, bedrooms_any: [], bedrooms_operator: null, bedrooms_upper: null, bedrooms_required: false })
    if (field === 'floor_number') filters.floor_number = null
    if (field === 'area_internal_m2') Object.assign(filters, { min_area_m2: null, max_area_m2: null })
    let proposed = catalogQuery({ ...query, operation: 'search', selector: null, filters,
      requirements: rows(query.requirements).filter(r => r.field !== field) })
    let units = filterCatalog(catalog, proposed, scopedIds).filter(unit => !excluded.has(text(unit.category))
      && unit[field] != null && unit[field] !== '' && Number.isFinite(Number(unit[field])))
    if (!units.length) continue
    if (field === 'bedrooms' && units.every(unit => typeof unit.bedrooms === 'number' && Number.isFinite(unit.bedrooms) && unit.bedrooms > 0)) {
      const requested = query.filters.bedrooms ?? query.filters.bedrooms_any?.[0]
        ?? rows(query.requirements).find(r => r.field === field && typeof r.value === 'number')?.value
      // A smaller, nearest available count is a proposal to review, not an
      // assertion that it accommodates the household or satisfies the need.
      const count = typeof requested === 'number' ? units.reduce((best, unit) =>
        Math.abs(Number(unit.bedrooms) - requested) < Math.abs(best - requested) ? Number(unit.bedrooms) : best, Number(units[0].bedrooms)) : null
      if (count !== null) {
        proposed = catalogQuery({ ...proposed, filters: { ...proposed.filters, bedrooms: count } })
        units = filterCatalog(units, proposed)
      }
    }
    proposals.push({ field, query: proposed, units })
  }
  // Several independently viable changes need a choice, not an arbitrary one.
  return proposals.length === 1 ? proposals[0] : null
}

export const COMMERCIAL_JOURNEY_RULES = `Siga siguiente_paso_comercial después de atender la consulta actual. La presentación pide nombre y residencia actual y ofrece el brochure antes del descubrimiento; no repita datos confirmados ni el brochure ya enviado. Descubra uso, necesidades, presupuesto y unidad usando lo conocido. No ofrezca inmuebles de otros proyectos. Una aceptación de financiamiento conserva el interés y vuelve a la selección pendiente, nunca descarta al lead por comparar su efectivo con el precio total. No afirme que el crédito resolverá o no resolverá la diferencia sin evaluación. El financiamiento solo se ofrece ante presupuesto insuficiente comprobado, presupuesto expresamente no definido o solicitud del lead. Una cifra suficiente no invita a financiar. No confunda ausencia de presupuesto con declaración de no tenerlo. La pregunta tras explicar financiamiento es si desea continuar, no si desea que se lo explique otra vez. Para ofrecer reserva hace falta unidad elegida, ficha comercial y cobertura suficiente; datos financieros completos no son aprobación. La aceptación de una oferta de reserva inicia una solicitud al equipo, no reserva inventario ni cobra. La visita espontánea va después de declinar la reserva; también puede ayudar a comparar opciones ante indecisión o atender una petición explícita. No repita invitaciones declinadas. Si rechaza reserva y visita, deje abierta la atención sin otra pregunta obligatoria. No describa estados internos como «hemos registrado/confirmado su interés».` 

/** Customer answers are persisted independently of whether our reply succeeds. */
export function interpretCommercialJourney(previous: Row, semantics: Row, pending: Row, selectedIds: unknown): Row {
  const next = { ...previous }, answer = object(semantics.answer_to_previous)
  const selected = ids(selectedIds)
  if (answer.confidence === 'high' && answer.question_id === pending.id) {
    if (pending.id === 'reservation_invitation' && answer.kind === 'negative') {
      const targets = ids(pending.target_ids)
      next.reservation_declined_ids = [...new Set([...ids(previous.reservation_declined_ids), ...targets])]
    }
    if (pending.id === 'visit_invitation' && answer.kind === 'negative') next.visit_declined = true
  }
  const reservation = object(semantics.reservation)
  if (reservation.kind === 'declined' && reservation.confidence === 'high' && selected.length === 1)
    next.reservation_declined_ids = [...new Set([...ids(next.reservation_declined_ids), ...selected])]
  return next
}

export function purchaseReadiness(info: Row): Row {
  const unit = selectedFinancingUnit(info), budget = leadBudget(info)
  const finance = object(info.financiamiento), journey = object(finance.journey)
  const financingAccepted = journey.status !== 'declined' && (journey.accepted === true || object(finance.current).explicit_consent === true)
  const price = Number(unit?.published_commercial_price)
  const priceKnown = object(info.politica_comercial).precios_autorizados === true && Number.isFinite(price) && price > 0
  // Review results are operational facts supplied by staff, never LLM output.
  const reviewedCoverage = financingAccepted && reviewedFinancingCovers(info, unit)
  const cash = !!unit && priceKnown && budget.confidence === 'high'
    && (['amount', 'maximum_total'].includes(text(budget.status)) && Number(budget.amount) >= price
      || budget.status === 'sufficient_for_selected_unit' && budget.unit_id === unit.id)
  return { selected_unit_id: unit?.id || null, selected_unit_number: unit?.unit_number || null,
    budget, financing_accepted: financingAccepted, price: priceKnown ? price : null,
    coverage: reviewedCoverage ? 'reviewed_financing' : cash && !financingAccepted ? 'declared_budget' : 'unconfirmed',
    can_offer_reservation: reviewedCoverage || cash && !financingAccepted }
}

/** One shared next step for writer, reviewer, memory and the lead card. */
export function commercialJourneyPlan(info: Row, audit: Row = {}): Row {
  const state = object(info.recorrido_comercial), readiness = purchaseReadiness(info)
  const budget = object(readiness.budget), finance = object(info.financiamiento)
  const lead = object(info.lead), profile = object(info.perfil_lead)
  const context = object(info.property_context), query = object(context.query)
  const proposalInformation = proposalInformationContext(info)
  const filters = object(query.filters), memory = object(info.hechos_confirmados)
  const category = text(query.category || context.preference_category || lead.preferred_category)
  const purpose = text(lead.purchase_purpose || object(memory.qualification).proposito)
  const profileDone = !!text(profile.full_name) && !!text(profile.residence_city || profile.residence_country)
  const stage = object(info.etapa_financiamiento), accepted = readiness.financing_accepted === true
  const selected = text(readiness.selected_unit_id)
  const policy = object(info.politica_visitas), sales = object(info._sales_memory)
  const visitDeclined = state.visit_declined === true || sales.visit_declined === true
  const visitPending = object(info.coordinacion_visita).status === 'collecting'
    || rows(info.propuestas).some(p => ['confirmed', 'awaiting_advisor', 'awaiting_client'].includes(text(p.status)))
  const visitPolicy = botVisitPolicy({ bot_visits: { allow_suggestions: policy.allowSuggestions, launch_destination: policy.launchDestination } }, text(info.modo_comercial))
  if (policy.readiness) visitPolicy.readiness = policy.readiness as NonNullable<typeof visitPolicy.readiness>
  const plan = (action: string, instruction: string, question = '', questionId = ''): Row => ({
    version: 'commercial-journey-v1', action, instruction, question, question_id: questionId,
    selected_unit_id: selected || null, readiness, profile_complete: profileDone,
    financing_offer_allowed: false, visit_offer_allowed: false,
  })
  if (audit.profile_introduction && !['', 'none'].includes(text(object(audit.profile_introduction).question_purpose)))
    return plan('introduction', 'Responda y solicite los datos de presentación pendientes según profile_introduction. No añada otra pregunta comercial.')
  if (audit.source === 'clarify_previous_choice') return plan('clarify_choice', 'Aclare cuál de las alternativas prefiere. Un sí ambiguo no elige una unidad ni autoriza trámites.')
  if (audit.action || audit.reservation || audit.financing_collection || /^(?:advisor|visit_|financing_handoff)/.test(text(audit.source)))
    return plan('current_operation', 'Conserve la gestión y la pregunta operativa actual. No añada una oferta de reserva, financiamiento ni visita.')
  if (object(info.financing_quote).orientation_only === true) return plan('financing_orientation',
    'Responda la consulta de entrada y cuotas con las referencias verificadas y sus límites. No repita la invitación al trámite ni pida datos personales. Si falta unidad, retome las preferencias ya conocidas para elegir una referencia; si faltan condiciones, explique cuáles sin derivar automáticamente.')
  if (visitPending) return plan('visit_pending', 'Atienda la consulta y la coordinación de visita vigente; no añada otras invitaciones.')
  if (sales.passive_sales === true) return plan('leave_open', 'Responda la consulta sin ofertas proactivas. El cliente pidió limitarse a información.')

  const selectionQuery = catalogQuery({ ...query, category: category || null, filters: { ...filters, bedrooms: filters.bedrooms ?? lead.preferred_bedrooms } })
  const scopedIds = selectionQuery.scope === 'offered' ? ids(context.offered_ids)
    : selectionQuery.scope === 'comparison' ? ids(context.comparison_ids)
      : selectionQuery.scope === 'selected' ? ids(context.selected_ids) : undefined
  const excluded = new Set(ids(context.excluded_categories))
  // Retrieval may legitimately project an empty result. Planning still uses
  // the complete verification snapshot, never a top-k sample as inventory.
  const planningCatalog = rows(Array.isArray(info.catalogo_verificacion) ? info.catalogo_verificacion : info.catalogo)
  const partition = partitionCatalog(planningCatalog, selectionQuery, scopedIds)
  const candidates = partition.units.filter(unit => !excluded.has(text(unit.category)))
  const unknownIds = partition.unknown.filter(unit => !excluded.has(text(unit.category))).map(unit => text(unit.id))
  const labels: Record<string, string> = { suite: 'las suites', departamento: 'los departamentos', penthouse: 'los penthouses', local: 'los locales comerciales' }
  const categories = Object.keys(labels).filter(category => candidates.some(unit => unit.category === category))
  const floors = [...new Set(candidates.map(unit => unit.floor_number).filter(value => typeof value === 'number'))]
  const selectionScope = { categories, unit_ids: candidates.map(unit => text(unit.id)).filter(Boolean), floors }
  const clarifyRequirements = (): Row => {
    const complete = object(info.catalog_read).complete === true && !unknownIds.length
      && (audit.verified_catalog !== true || object(audit.catalog_results).complete === true && !ids(object(audit.catalog_results).unknown_unit_ids).length)
    const pendingProposal = object(context.pending_question)
    const pendingQuery = catalogQuery(pendingProposal.proposed_query)
    const pendingUnits = Object.keys(proposalInformation).length
      ? filterCatalog(planningCatalog, pendingQuery, ids(pendingProposal.candidate_ids))
        .filter(unit => !excluded.has(text(unit.category))) : []
    const alternative = Object.keys(proposalInformation).length
      ? pendingUnits.length ? { field: text(object(pendingProposal.requirement_change).field)
        || (pendingQuery.filters.bedrooms !== selectionQuery.filters.bedrooms ? 'bedrooms' : 'other'), query: pendingQuery, units: pendingUnits } : null
      : alternativeRequirement(planningCatalog, selectionQuery, excluded, scopedIds)
    const bedroomCount = alternative?.field === 'bedrooms' ? alternative.query.filters.bedrooms : null
    const strict = selectionQuery.filters.bedrooms_required === true
    const declined = object(context.requirements_declined)
    const adjustmentDeclined = Object.keys(declined).length > 0
      && JSON.stringify(normalizedPropertyQuery({ ...object(declined.original_query), operation: 'search', selector: null }))
        === JSON.stringify(normalizedPropertyQuery({ ...selectionQuery, operation: 'search', selector: null }))
    const informationMissing = !complete && !alternative
    const question = strict || adjustmentDeclined || informationMissing ? '' : bedroomCount !== null
      ? `¿Aceptaría revisar alternativas de ${bedroomCount} dormitorios?`
      : '¿Estaría dispuesto a ajustar ese requisito para revisar las alternativas disponibles?'
    return { ...plan('clarify_requirements',
      `${complete ? 'La consulta completa no tiene coincidencias con todos los requisitos actuales.'
        : 'No hay coincidencias confirmadas en el alcance consultado; faltan fichas o datos para afirmar ausencia en todo el proyecto.'} Reconozca el presupuesto solo si fue declarado, sin afirmar que alcanza para alternativas incompatibles. Explique el requisito que cambia y pregunte si aceptaría revisar ese cambio antes de pedir presupuesto, planta, unidad o financiamiento. No garantice que otra cantidad de dormitorios acomode a la familia.${alternative && !strict && !adjustmentDeclined ? ` ${Object.keys(proposalInformation).length ? 'Responda primero la consulta informativa sobre la propuesta pendiente con su referente verificado, incluidos precios autorizados si se preguntan. Después conecte esa respuesta con la decisión todavía pendiente de aceptar explorar el ajuste. Consultar detalles o precios no acepta la propuesta; no vuelva a presentar todo el catálogo ni cambie la necesidad original.' : 'Recomiende brevemente la alternativa verificable, no se limite a enumerar que existe. Explique por qué merece revisarla mediante rangos de área interior y características comunes comprobadas de los grupos requirement_alternatives, distinguiendo las categorías disponibles. Si un área no está verificada, omítala. No enumere números de unidad ni añada precios no solicitados antes de aceptar la alternativa. La recomendación invita a valorar otra opción, no afirma que satisfaga el requisito original ni que sea adecuada para toda la familia.'} La explicación y la pregunta reales deben identificar el mismo ajuste de proposed_query, incluida la cantidad propuesta si existe. El revisor debe comprobar tanto la recomendación sustentada (o la respuesta a la consulta informativa) como esa equivalencia antes de aprobar: un sí autoriza explorar esa propuesta, no otra ni seleccionar una unidad. Admita redacción equivalente sin exigir una frase literal.` : ''}${strict ? ' La cantidad de dormitorios fue declarada indispensable: respétela y no insista en alternativas ni añada una pregunta de ajuste.' : ''}${adjustmentDeclined ? ' El cliente rechazó ajustar esta búsqueda: respete su negativa, no repita la propuesta ni pida presupuesto; atienda la consulta y deje abierta la conversación sin una nueva pregunta obligatoria.' : ''}${informationMissing ? ' Falta información para comprobar este requisito y tampoco hay una alternativa verificada: explique ese límite, sin pedir que cambie una condición cuya ausencia no se ha confirmado.' : ''}`,
      question, question ? 'property_requirements' : ''), question_act: alternative ? 'explore_alternatives' : 'other',
      selection_scope: selectionScope, presentation: 'requirements', requested_query: selectionQuery,
      match_complete: complete, unknown_unit_ids: unknownIds,
      ...(alternative && !strict && !adjustmentDeclined ? { proposed_query: alternative.query, alternative_unit_ids: alternative.units.map(unit => text(unit.id)),
        requirement_change: { field: alternative.field }, recommendation_mode: Object.keys(proposalInformation).length ? 'answer_then_confirm_alternative' : 'brief_verified_summary' } : {}) }
  }
  // Compatibility precedes budget discovery. Money and financing cannot make
  // an unavailable physical feature compatible with the current requirement.
  const physicalRequirements = rows(selectionQuery.requirements).some(r => r.strength === 'required' && r.field !== 'published_commercial_price')
    || selectionQuery.filters.bedrooms !== null || !!selectionQuery.filters.bedrooms_any?.length
    || selectionQuery.filters.floor_number !== null || selectionQuery.filters.min_area_m2 !== null || selectionQuery.filters.max_area_m2 !== null
  const physicalQuery = catalogQuery({ ...selectionQuery,
    requirements: rows(selectionQuery.requirements).filter(r => r.field !== 'published_commercial_price') })
  if (!selected && physicalRequirements && (['search', 'rank', 'none'].includes(selectionQuery.operation) || Object.keys(proposalInformation).length > 0)
    && !filterCatalog(planningCatalog, physicalQuery, scopedIds).some(unit => !excluded.has(text(unit.category)))) return clarifyRequirements()

  const requests = rows(info.solicitudes_interpretadas || object(info.contrato_turno).requests)
  const requestedFinance = requests.some(r => r.domain === 'financing') || object(info.semantica_turno).primary_intent === 'ask_financing'
  const partners = ids(finance.partners)
  const financeDeclined = object(finance.journey).status === 'declined'
  const assessment = object(info.presupuesto_del_turno)
  const insufficient = budget.status === 'insufficient_for_selected_unit' && (!budget.unit_id || budget.unit_id === selected)
    || ['amount', 'maximum_total'].includes(text(budget.status)) && Number(budget.amount) > 0
      && (Number(readiness.price) > Number(budget.amount) || assessment.status === 'below_available_prices')
  const undefinedBudget = budget.status === 'no_defined_budget'
  if (!accepted && partners.length && (requestedFinance || !financeDeclined && (state.financing_offered !== true || object(object(info.semantica_turno).budget).status !== 'not_discussed' && !!object(object(info.semantica_turno).budget).evidence) && (insufficient || undefinedBudget))) {
    const result = plan('offer_financing', 'Explique brevemente el financiamiento con las entidades autorizadas, indique que primero se elige una unidad y pregunte únicamente si desea continuar. No ofrezca contactos ni otros proyectos. No rechace al lead por el presupuesto.',
      '¿Desea que continuemos con el proceso de financiamiento?', 'financing_invitation')
    return { ...result, financing_offer_allowed: true }
  }
  if (selected && budget.answered !== true) return plan('ask_budget', 'Antes de datos financieros o reserva, aclare el presupuesto. Un sí sin monto requiere preguntar cuánto. Una declaración de no tenerlo definido permite continuar.', budgetQuestion(info), 'budget_amount')
  if (accepted && selected && readiness.can_offer_reservation !== true) return plan('continue_financing', stage.instruction ? text(stage.instruction) : 'Continúe con el siguiente dato financiero pendiente; no repita la aceptación ni ofrezca reserva mientras no exista revisión favorable.')
  if (selected && readiness.can_offer_reservation === true && profileDone) {
    if (ids(state.reservation_declined_ids).includes(selected)) {
      if (!visitDeclined && state.visit_offered !== true && visitPolicy.allowSuggestions) return {
        ...plan('offer_visit', 'La reserva fue declinada. Atienda primero el motivo si lo hay; puede ofrecer una visita a la oficina para revisar planos. No vuelva a ofrecer reserva.', visitInvitation(text(info.modo_comercial), visitPolicy), 'visit_invitation'), visit_offer_allowed: true }
      return plan('leave_open', 'Atienda cualquier duda y deje abierta la conversación. No añada preguntas ni vuelva a ofrecer reserva o visita rechazadas.')
    }
    if (!ids(state.reservation_offered_ids).includes(selected)) return plan('offer_reservation',
      'Después de responder, ofrezca iniciar la solicitud de reserva de la unidad elegida. La aceptación pasará al equipo para gestionar condiciones, no reserva inventario. Ofrezca reserva antes que visita.',
      `¿Le gustaría que le ayudemos a iniciar la reserva de la unidad ${text(readiness.selected_unit_number)}?`, 'reservation_invitation')
    return plan('await_reservation', 'Responda las dudas pendientes sin repetir la oferta de reserva ni sustituirla por una visita mientras no la haya declinado.')
  }
  const uncertain = object(object(info.semantica_turno).answer_to_previous)
  const comparing = ids(context.comparison_ids).length > 1 || query.operation === 'compare'
  if (!accepted && !selected && comparing && uncertain.kind === 'uncertain' && uncertain.confidence === 'high'
    && !visitDeclined && state.visit_offered !== true && visitPolicy.allowSuggestions) return {
      ...plan('offer_visit', 'El cliente no decide entre opciones. Ofrezca revisar los planos en la oficina si ayuda a comparar.', visitInvitation(text(info.modo_comercial), visitPolicy), 'visit_invitation'), visit_offer_allowed: true }
  if (selected) return plan('clarify_purchase', 'Responda y aclare únicamente lo necesario para avanzar. Sin cobertura confirmada no ofrezca reserva. Respete la negativa a financiamiento.')
  if (!category && !query.group && !purpose) return plan('discover_use', 'Presente brevemente las categorías disponibles y pregunte vivienda o comercio.', '¿Busca una vivienda o un local para su negocio?', 'property_category')
  if (!purpose) return plan('discover_purpose', 'Pregunte el uso que aún falta sin repetir el tipo de espacio.', category === 'local' ? '¿Lo busca para su propio negocio o para invertir y arrendarlo?' : '¿Lo busca para vivir o como inversión?', 'property_purpose')
  if (category !== 'local' && category !== 'suite' && !filters.bedrooms && !(Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.length) && !lead.preferred_bedrooms)
    return plan('discover_bedrooms', 'Use la familia conocida, pero no convierta personas en dormitorios. Pregunte cuántos necesita.', '¿Cuántos dormitorios necesita?', 'property_bedrooms')
  if (budget.answered !== true) return plan('ask_budget', 'Las necesidades básicas ya se conocen. Pregunte el presupuesto antes de continuar seleccionando unidades.', budgetQuestion(info), 'budget_amount')
  const selection = plan('select_property', accepted
    ? 'Ya aceptó financiamiento: retome las opciones con las preferencias conocidas hasta elegir una unidad concreta. No repita que no alcanza, no pida otra aceptación, cédula ni datos laborales. No exija elegir una planta si ya la conoce.'
    : 'Ayude a comparar y elegir una unidad concreta con las preferencias conocidas. No vuelva a pedir datos ya respondidos.')
  {
    if (!candidates.length) return clarifyRequirements()
    if (!floors.length && categories.length > 1) {
      const options = new Intl.ListFormat('es', { type: 'disjunction' }).format(categories.map(category => labels[category]))
      return { ...selection, question: `¿Prefiere que revisemos ${options}?`, question_id: 'property_category', question_act: 'choose_category',
        selection_scope: selectionScope, instruction: `${text(selection.instruction)} Mantenga abiertas las categorías compatibles; no invente las plantas que faltan en las fichas.` }
    }
    if (candidates.length === 1) return { ...selection, question: `¿Desea continuar con ${text(candidates[0].category)} ${text(candidates[0].unit_number)}?`,
      question_id: 'unit_choice', question_act: 'confirm_unit', selection_scope: selectionScope, presentation: 'single_unit',
      instruction: `${text(selection.instruction)} Presente la única opción compatible con sus características y su recorrido autorizado. Mostrarla no significa que el cliente ya la eligió; confirme si desea continuar con ella.` }
    if (floors.length > 1) {
      const options = new Intl.ListFormat('es', { type: 'disjunction' }).format(categories.map(category => labels[category]))
      return { ...selection, question: `¿En qué planta le gustaría revisar ${options || 'las opciones'}?`, question_id: 'property_floor', question_act: 'choose_floor',
        selection_scope: selectionScope, presentation: 'floors',
        instruction: `${text(selection.instruction)} Presente las plantas de todas las categorías compatibles y pregunte explícitamente en qué planta desea revisar opciones. No enumere números de unidad todavía. No excluya penthouses compatibles del cuerpo ni de la pregunta. No repita las fichas completas.` }
    }
    return { ...selection, question: '¿Cuál de las unidades de esta planta le gustaría revisar?', question_id: 'unit_choice', question_act: 'choose_unit',
      selection_scope: selectionScope, presentation: 'units',
      instruction: `${text(selection.instruction)} La planta está definida. Presente los números y características de las unidades compatibles para que elija una. Si ya indicó que una le interesa sin identificarla, pregunte cuál sin repetir el catálogo.` }
  }
}

export function journeyPendingQuestion(reply: string, plan: Row, approved: boolean): Row {
  if (!approved || !plan.question_id) return {}
  const question = replyQuestions(reply).at(-1)
  if (!question) return {}
  return { id: plan.question_id, act: plan.question_id === 'reservation_invitation' ? 'reservation' : plan.question_id === 'financing_invitation' ? 'financing'
    : text(plan.question_act) || (plan.question_id === 'property_category' ? 'choose_category' : 'other'),
    question, target_ids: plan.selected_unit_id ? [plan.selected_unit_id] : plan.question_act === 'confirm_unit' ? ids(object(plan.selection_scope).unit_ids) : [],
    ...(plan.selection_scope ? { candidate_ids: ids(plan.question_act === 'explore_alternatives' ? plan.alternative_unit_ids : object(plan.selection_scope).unit_ids) } : {}),
    ...(plan.question_act === 'explore_alternatives' && plan.proposed_query ? { proposed_query: plan.proposed_query } : {}) }
}

export function rememberCommercialJourney(previous: Row, plan: Row, pending: Row, approved: boolean): Row {
  if (!approved || !plan.action) return previous
  const next: Row = { ...previous, stage: plan.action, next_step: plan.instruction, selected_unit_id: plan.selected_unit_id || null }
  if (pending.id === 'reservation_invitation' && plan.selected_unit_id)
    next.reservation_offered_ids = [...new Set([...ids(previous.reservation_offered_ids), text(plan.selected_unit_id)])]
  if (pending.id === 'visit_invitation') next.visit_offered = true
  if (pending.id === 'financing_invitation') next.financing_offered = true
  return next
}
