import { object, text, type Row } from './data'
import { selectedFinancingUnit } from './financing-stage'
import { leadBudget, budgetQuestion, budgetKindQuestion, reviewedFinancingCovers } from './budget-state'
import { catalogQuery, filterCatalog, partitionCatalog, catalogRequirementAlternative } from './catalog-dialogue'
import { botVisitPolicy, visitInvitation } from '@/lib/inmobiliaria/botVisits'
import { deliveredPendingQuestion } from './continuation-question'
import { normalizedPropertyQuery } from './turn-semantics'
import { VISIT_DIALOGUE_PLAN_VERSION } from './visit-dialogue'

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

export const COMMERCIAL_JOURNEY_RULES = `Siga siguiente_paso_comercial después de atender la consulta actual. La presentación pide nombre y residencia actual y ofrece el brochure antes del descubrimiento; no repita datos confirmados ni el brochure ya enviado. Descubra uso y dormitorios usando lo conocido. Si el requisito no está disponible, recomiende alternativas verificadas con amabilidad y pregunte si desea revisarlas: pueden merecer una comparación por sus espacios, pero no garantice que acomoden a la familia ni anuncie dormitorios adicionales o cambios arquitectónicos. Aceptar revisar un ajuste no elige tipo ni unidad. Después presente todos los tipos compatibles y pregunte cuál prefiere; muestre rangos de dimensiones y plantas reales del tipo elegido y pregunte planta sólo si hay varias. Con la planta definida, muestre números y características de sus unidades antes de preguntar presupuesto desconocido. Si sólo hay una compatible, preséntela con su recorrido 360 autorizado sin darla por elegida. No pregunte por una unidad específica cuando sólo se han presentado tipos ni por planta cuando sólo existe una. Respete datos aportados voluntariamente, presupuesto pospuesto y solicitudes explícitas; no repita pasos ya respondidos. No ofrezca inmuebles de otros proyectos. Una aceptación de financiamiento conserva el interés y vuelve a la selección pendiente, nunca descarta al lead por comparar su efectivo con el precio total. No afirme que el crédito resolverá o no resolverá la diferencia sin evaluación. El financiamiento solo se ofrece ante presupuesto insuficiente comprobado, presupuesto expresamente no definido o solicitud del lead. Una cifra suficiente no invita a financiar. No confunda ausencia de presupuesto con declaración de no tenerlo. La pregunta tras explicar financiamiento es si desea continuar, no si desea que se lo explique otra vez. Para ofrecer reserva hace falta unidad elegida, ficha comercial y cobertura suficiente; datos financieros completos no son aprobación. La aceptación de una oferta de reserva inicia una solicitud al equipo, no reserva inventario ni cobra. La visita espontánea va después de declinar la reserva; también puede ayudar a comparar opciones ante indecisión o atender una petición explícita. No repita invitaciones declinadas. Si rechaza reserva y visita, deje abierta la atención sin otra pregunta obligatoria. No describa estados internos como «hemos registrado/confirmado su interés».`

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
    && (budget.status === 'maximum_total' && Number(budget.amount) >= price
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
  const visitDialogue = object(info.visit_dialogue_plan || audit.visit_dialogue_plan)
  if (visitDialogue.version === VISIT_DIALOGUE_PLAN_VERSION) {
    if (visitDialogue.question_id && visitDialogue.question) return plan('visit_destination', text(visitDialogue.instruction), text(visitDialogue.question), text(visitDialogue.question_id))
    if (visitDialogue.information_only === true) return plan('visit_information', text(visitDialogue.instruction))
    if (visitDialogue.current_kind === 'decline') return plan('leave_open', text(visitDialogue.instruction))
    if (visitDialogue.current_kind === 'other' && ['offered', 'collecting', 'awaiting_advisor', 'awaiting_client', 'confirmed'].includes(text(object(visitDialogue.state).status)))
      return plan('visit_suspended_for_current_query', text(visitDialogue.instruction))
  }
  if (audit.profile_introduction && !['', 'none'].includes(text(object(audit.profile_introduction).question_purpose)))
    return plan('introduction', 'Responda y solicite los datos de presentación pendientes según profile_introduction. No añada otra pregunta comercial.')
  if (audit.source === 'clarify_previous_choice') {
    const pending = object(audit.pending_question)
    return { ...plan('clarify_choice',
      'Aclare cuál de las alternativas de la decisión anterior prefiere. Mantenga el mismo referente, ID y acto de la pregunta pendiente: categoría, planta o unidad. Un sí ambiguo no elige una unidad ni autoriza trámites.',
      text(pending.question), text(pending.id)), question_act: text(pending.act) || 'other',
      selection_scope: { unit_ids: ids(pending.candidate_ids) },
      ...(Object.keys(object(pending.proposed_query)).length ? { proposed_query: pending.proposed_query,
        alternative_unit_ids: ids(pending.candidate_ids) } : {}) }
  }
  if (audit.action || audit.reservation || audit.financing_collection || /^(?:advisor|visit_|financing_handoff)/.test(text(audit.source)))
    return plan('current_operation', 'Conserve la gestión y la pregunta operativa actual. No añada una oferta de reserva, financiamiento ni visita.')
  if (object(info.financing_quote).orientation_only === true) return plan('financing_orientation',
    'Responda la consulta de entrada y cuotas con las referencias verificadas y sus límites. No repita la invitación al trámite ni pida datos personales. Si falta unidad, retome las preferencias ya conocidas para elegir una referencia; si faltan condiciones, explique cuáles sin derivar automáticamente.')
  if (visitPending) return plan('visit_pending', 'Atienda la consulta y la coordinación de visita vigente; no añada otras invitaciones.')
  const engagement = object(info.commercial_engagement)
  const passive = typeof engagement.passive === 'boolean' ? engagement.passive : sales.passive_sales === true
  if (passive && engagement.property_continuation_allowed !== true) return plan('leave_open', 'Responda la consulta sin ofertas proactivas. El cliente pidió limitarse a información.')

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
      : catalogRequirementAlternative(planningCatalog, selectionQuery, excluded, scopedIds)
    const bedroomCount = alternative?.field === 'bedrooms' ? alternative.query.filters.bedrooms : null
    const strict = selectionQuery.filters.bedrooms_required === true
    const declined = object(context.requirements_declined)
    const adjustmentDeclined = Object.keys(declined).length > 0
      && JSON.stringify(normalizedPropertyQuery({ ...object(declined.original_query), operation: 'search', selector: null }))
        === JSON.stringify(normalizedPropertyQuery({ ...selectionQuery, operation: 'search', selector: null }))
    const informationMissing = !complete && !alternative
    const question = strict || adjustmentDeclined || informationMissing ? '' : bedroomCount !== null
      ? `¿Le gustaría revisar las opciones de ${bedroomCount} dormitorios que tenemos disponibles?`
      : alternative ? '¿Estaría dispuesto a ajustar ese requisito para revisar las alternativas disponibles?'
        : '¿Cuál de sus requisitos considera indispensable y cuál podría flexibilizar para buscar alternativas?'
    return { ...plan('clarify_requirements',
      `${complete ? 'La consulta completa no tiene coincidencias con todos los requisitos actuales.'
        : 'No hay coincidencias confirmadas en el alcance consultado; faltan fichas o datos para afirmar ausencia en todo el proyecto.'} Reconozca el presupuesto solo si fue declarado, sin afirmar que alcanza para alternativas incompatibles. Explique el requisito que cambia y pregunte si aceptaría revisar ese cambio antes de pedir presupuesto, planta, unidad o financiamiento. No garantice que otra cantidad de dormitorios acomode a la familia.${alternative && !strict && !adjustmentDeclined ? ` ${Object.keys(proposalInformation).length ? 'Responda primero la consulta informativa sobre la propuesta pendiente con su referente verificado, incluidos precios autorizados si se preguntan. Después conecte esa respuesta con la decisión todavía pendiente de aceptar explorar el ajuste. Consultar detalles o precios no acepta la propuesta; no vuelva a presentar todo el catálogo ni cambie la necesidad original.' : 'Recomiende brevemente la alternativa verificable, no se limite a enumerar que existe. Explique por qué merece revisarla mediante rangos de área interior y características comunes comprobadas de los grupos requirement_alternatives, distinguiendo las categorías disponibles. Si un área no está verificada, omítala. No enumere números de unidad ni añada precios no solicitados antes de aceptar la alternativa. La recomendación invita a valorar otra opción, no afirma que satisfaga el requisito original ni que sea adecuada para toda la familia.'} La explicación y la pregunta reales deben identificar el mismo ajuste de proposed_query, incluida la cantidad propuesta si existe. El revisor debe comprobar tanto la recomendación sustentada (o la respuesta a la consulta informativa) como esa equivalencia antes de aprobar: un sí autoriza explorar esa propuesta, no otra ni seleccionar una unidad. Admita redacción equivalente sin exigir una frase literal.` : ''}${strict ? ' La cantidad de dormitorios fue declarada indispensable: respétela y no insista en alternativas ni añada una pregunta de ajuste.' : ''}${adjustmentDeclined ? ' El cliente rechazó ajustar esta búsqueda: respete su negativa, no repita la propuesta ni pida presupuesto; atienda la consulta y deje abierta la conversación sin una nueva pregunta obligatoria.' : ''}${informationMissing ? ' Falta información para comprobar este requisito y tampoco hay una alternativa verificada: explique ese límite, sin pedir que cambie una condición cuya ausencia no se ha confirmado.' : ''}`,
      question, question ? 'property_requirements' : ''), question_act: alternative ? 'explore_alternatives' : 'other',
      ...(!alternative && question ? { adjustment_requires_specific_choice: true,
        instruction: 'No hay una propuesta concreta que un sí pueda aceptar. Explique los requisitos incompatibles verificados y pregunte cuál desea mantener o flexibilizar; conserve la búsqueda original hasta recibir una preferencia específica. No repita una invitación genérica a aceptar alternativas inexistentes.' } : {}),
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

  const kindQuestion = budgetKindQuestion(budget)
  const budgetDeferred = ids(object(info.memoria_comercial).deferred_fields).includes('presupuesto')
    && budget.source !== 'current_lead_statement'
  if (!accepted && kindQuestion && !budgetDeferred && !passive) return plan('clarify_budget_kind',
    'El monto fue declarado, pero no su significado. Responda la consulta y aclare si es presupuesto total o dinero para la entrada. No vuelva a pedir la cifra, no compare su suficiencia con el precio ni ofrezca financiamiento o reserva antes de esa aclaración.',
    kindQuestion, 'budget_kind')

  const requests = rows(info.solicitudes_interpretadas || object(info.contrato_turno).requests)
  const requestedFinance = requests.some(r => r.domain === 'financing') || object(info.semantica_turno).primary_intent === 'ask_financing'
  const partners = ids(finance.partners)
  const financeDeclined = object(finance.journey).status === 'declined'
  const assessment = object(info.presupuesto_del_turno)
  const insufficient = budget.status === 'insufficient_for_selected_unit' && (!budget.unit_id || budget.unit_id === selected)
    || budget.status === 'maximum_total' && Number(budget.amount) > 0
      && (Number(readiness.price) > Number(budget.amount) || assessment.status === 'below_available_prices')
  const undefinedBudget = budget.status === 'no_defined_budget'
  if (!accepted && partners.length && (requestedFinance || !passive && !financeDeclined && (state.financing_offered !== true || object(object(info.semantica_turno).budget).status !== 'not_discussed' && !!object(object(info.semantica_turno).budget).evidence) && (insufficient || undefinedBudget))) {
    const result = plan('offer_financing', 'Explique brevemente el financiamiento con las entidades autorizadas, indique que primero se elige una unidad y pregunte únicamente si desea continuar. No ofrezca contactos ni otros proyectos. No rechace al lead por el presupuesto.',
      '¿Desea que continuemos con el proceso de financiamiento?', 'financing_invitation')
    return { ...result, financing_offer_allowed: true }
  }
  if (selected && passive) return plan('leave_open', 'Responda la consulta solicitada sobre la unidad conocida. No convierta una consulta informativa en presupuesto, financiamiento, reserva ni visita.')
  if (selected && budget.answered !== true && !budgetDeferred) return {
    ...plan('ask_budget', 'La unidad ya fue identificada por el cliente. Responda su consulta y presente sus características si todavía no se han mostrado; antes de datos financieros o reserva, aclare el presupuesto. Un sí sin monto requiere preguntar cuánto. Una declaración de no tenerlo definido permite continuar.', budgetQuestion(info), 'budget_amount'),
    selection_scope: { categories: category ? [category] : [], unit_ids: [selected], floors: [] },
    presentation: ids(state.presented_unit_ids).includes(selected) ? 'known_units' : 'single_unit_before_budget',
    requires_unit_presentation: !ids(state.presented_unit_ids).includes(selected),
  }
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
  if (!accepted && !passive && !selected && comparing && uncertain.kind === 'uncertain' && uncertain.confidence === 'high'
    && !visitDeclined && state.visit_offered !== true && visitPolicy.allowSuggestions) return {
      ...plan('offer_visit', 'El cliente no decide entre opciones. Ofrezca revisar los planos en la oficina si ayuda a comparar.', visitInvitation(text(info.modo_comercial), visitPolicy), 'visit_invitation'), visit_offer_allowed: true }
  if (selected) return plan('clarify_purchase', 'Responda y aclare únicamente lo necesario para avanzar. Sin cobertura confirmada no ofrezca reserva. Respete la negativa a financiamiento.')
  if (!category && !query.group && !purpose) return plan('discover_use', 'Presente brevemente las categorías disponibles y pregunte vivienda o comercio.', '¿Busca una vivienda o un local para su negocio?', 'property_category')
  if (!purpose && !passive) return plan('discover_purpose', 'Pregunte el uso que aún falta sin repetir el tipo de espacio.', category === 'local' ? '¿Lo busca para su propio negocio o para invertir y arrendarlo?' : '¿Lo busca para vivir o como inversión?', 'property_purpose')
  if (category !== 'local' && category !== 'suite' && !filters.bedrooms && !(Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.length) && !lead.preferred_bedrooms)
    return plan('discover_bedrooms', 'Use la familia conocida, pero no convierta personas en dormitorios. Pregunte cuántos necesita.', '¿Cuántos dormitorios necesita?', 'property_bedrooms')
  const selection = plan('select_property', accepted
    ? 'Ya aceptó financiamiento: retome las opciones con las preferencias conocidas hasta elegir una unidad concreta. No repita que no alcanza, no pida otra aceptación, cédula ni datos laborales. No exija elegir una planta si ya la conoce.'
    : 'Ayude a comparar y elegir una unidad concreta con las preferencias conocidas. No vuelva a pedir datos ya respondidos.')
  {
    if (!candidates.length) return clarifyRequirements()
    if (!category && categories.length > 1) {
      const options = new Intl.ListFormat('es', { type: 'disjunction' }).format(categories.map(category => labels[category]))
      return { ...selection, question: `¿Prefiere que revisemos ${options}?`, question_id: 'property_category', question_act: 'choose_category',
        selection_scope: selectionScope, presentation: 'categories',
        instruction: `${text(selection.instruction)} Presente brevemente todas las categorías compatibles, incluidas las alternativas de penthouse que cumplan los dormitorios. Recomiende valorarlas con sus diferencias de amplitud verificadas; no garantice que se adapten a la familia. Pregunte cuál tipo prefiere antes de planta, presupuesto o unidad. No enumere números de unidad ni pida una unidad específica todavía.` }
    }
    if (floors.length > 1) {
      const options = new Intl.ListFormat('es', { type: 'disjunction' }).format(categories.map(category => labels[category]))
      return { ...selection, question: `¿En qué planta le gustaría revisar ${options || 'las opciones'}?`, question_id: 'property_floor', question_act: 'choose_floor',
        selection_scope: selectionScope, presentation: 'floors',
        instruction: `${text(selection.instruction)} El tipo ya está definido o sólo existe uno compatible. Resuma los rangos verificados de superficie interior y exterior y las plantas reales de ese tipo; no invente plantas intermedias ni que el precio aumenta por altura. Pregunte explícitamente en qué planta desea revisar opciones. No enumere números de unidad, no pregunte presupuesto todavía ni pida elegir una unidad. No repita las fichas completas.` }
    }
    const presentedIds = new Set(ids(state.presented_unit_ids))
    const unitsAlreadyPresented = candidates.every(unit => presentedIds.has(text(unit.id)))
    if (!passive && budget.answered !== true && !budgetDeferred) return {
      ...plan('ask_budget', unitsAlreadyPresented
        ? 'Las unidades de la planta ya se mostraron con sus números y características. Responda la consulta actual sin repetir todas las fichas y pregunte únicamente el presupuesto todavía desconocido.'
        : 'El tipo y la planta están definidos o sólo queda una planta compatible. Presente primero los números y las características verificadas de las unidades compatibles de esta planta. Si hay una única opción, muestre su recorrido 360 autorizado sin darla por elegida. Después pregunte únicamente el presupuesto todavía desconocido; no pida elegir una unidad en este mismo turno.',
      budgetQuestion(info), 'budget_amount'), selection_scope: selectionScope,
      presentation: unitsAlreadyPresented ? 'known_units' : candidates.length === 1 ? 'single_unit_before_budget' : 'units_before_budget',
      requires_unit_presentation: !unitsAlreadyPresented,
    }
    if (candidates.length === 1) return { ...selection, question: passive
      ? `¿Le gustaría conocer algún detalle adicional de ${text(candidates[0].category)} ${text(candidates[0].unit_number)}?`
      : `¿Desea continuar con ${text(candidates[0].category)} ${text(candidates[0].unit_number)}?`,
      question_id: 'unit_choice', question_act: passive ? 'show_unit_details' : 'confirm_unit', selection_scope: selectionScope, presentation: 'single_unit',
      requires_unit_presentation: !unitsAlreadyPresented,
      instruction: `${text(selection.instruction)} ${unitsAlreadyPresented ? 'La opción ya fue presentada: no repita toda su ficha.' : 'Presente la única opción compatible con su número, características y recorrido 360 autorizado.'} Mostrarla no significa que el cliente ya la eligió. ${passive ? 'La continuación ofrece sólo información solicitada, no consentimiento de compra ni trámites.' : 'El presupuesto ya se respondió o fue pospuesto; confirme si desea continuar con esa unidad.'}` }
    return { ...selection, question: '¿Cuál de las unidades de esta planta le gustaría revisar?', question_id: 'unit_choice', question_act: 'choose_unit',
      selection_scope: selectionScope, presentation: 'units', requires_unit_presentation: !unitsAlreadyPresented,
      instruction: `${text(selection.instruction)} La planta está definida y el presupuesto ya se respondió, fue pospuesto o no se solicita en modo informativo. ${unitsAlreadyPresented ? 'Los números y características ya fueron mostrados: no repita todas las fichas.' : 'Presente primero los números y características de las unidades compatibles antes de preguntar cuál desea revisar.'} Si ya indicó que una le interesa sin identificarla, pregunte cuál sin repetir el catálogo. No ofrezca trámites no solicitados.` }
  }
}

export function journeyPendingQuestion(reply: string, plan: Row, approved: boolean, metadata?: unknown): Row {
  return approved ? deliveredPendingQuestion(reply, { plan, metadata }) : {}
}

export function rememberCommercialJourney(previous: Row, plan: Row, pending: Row, approved: boolean, presentedUnitIds: unknown = []): Row {
  if (!approved || !plan.action) return previous
  const next: Row = { ...previous, stage: plan.action, next_step: plan.instruction, selected_unit_id: plan.selected_unit_id || null }
  const authorized = new Set([...ids(object(plan.selection_scope).unit_ids), text(plan.selected_unit_id)].filter(Boolean))
  const presented = ids(presentedUnitIds).filter(id => authorized.has(id))
  if (presented.length) next.presented_unit_ids = [...new Set([...ids(previous.presented_unit_ids), ...presented])]
  if (pending.id === 'reservation_invitation' && plan.selected_unit_id)
    next.reservation_offered_ids = [...new Set([...ids(previous.reservation_offered_ids), text(plan.selected_unit_id)])]
  if (pending.id === 'visit_invitation') next.visit_offered = true
  if (pending.id === 'financing_invitation') next.financing_offered = true
  return next
}
