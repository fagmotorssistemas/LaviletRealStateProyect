import { createHash } from 'node:crypto'
import { object, text, type Row } from './data'
import { selectedFinancingUnit } from './financing-stage'
import { leadBudget, budgetQuestion, budgetKindQuestion, reviewedFinancingCovers } from './budget-state'
import { catalogQuery, filterCatalog, partitionCatalog, catalogRequirementAlternative, alternativeFloorQuestion,
  canOfferLowerFloorBedrooms, catalogLowerFloorBedroomAlternative } from './catalog-dialogue'
import { botVisitPolicy, visitInvitation } from '@/lib/inmobiliaria/botVisits'
import { deliveredPendingQuestion } from './continuation-question'
import { normalizedPropertyQuery } from './turn-semantics'
import { VISIT_DIALOGUE_PLAN_VERSION } from './visit-dialogue'
import { BUDGET_ORIENTATION_RULES } from './budget-orientation-rules'
import { isPassivePurchaseEvidence } from './purchase-evidence'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const ids = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : []
const assetCategory = (value: unknown) => ['suite', 'departamento', 'penthouse', 'local'].includes(text(value)) ? text(value) : ''
const assetGroup = (category: unknown) => category === 'local' ? 'commercial' : assetCategory(category) ? 'residential' : ''

/** Retrieval scope and CRM labels are not declarations of what the lead seeks.
 * Keep accepted conversational evidence separate from the query used for RAG. */
function declaredCommercialInterest(info: Row) {
  const context = object(info.property_context), query = object(context.query)
  const memory = object(info.hechos_confirmados), current = object(object(info.semantica_turno).property)
  const usable = (value: Row) => value.confidence === 'high' && !!text(value.evidence).trim()
    && !isPassivePurchaseEvidence(value.evidence)
  const currentProperty = usable(current) ? current : {}, saved = object(memory.property)
  const knownProperty = usable(saved) ? saved : {}
  const preference = object(context.category_preference)
  const confirmedCategory = preference.confirmed === true ? assetCategory(preference.category) : ''
  const exploration = object(context.exploration_state)
  const acceptedExploration = exploration.authorized === true && !!text(exploration.evidence).trim()
    && !isPassivePurchaseEvidence(exploration.evidence)
  // Older delivered selection receipts did not carry declaration metadata. A
  // genuine floor/unit decision still retains its established category.
  const advancedCategory = ['choose_floor', 'choose_unit', 'review_unit'].includes(text(context.phase))
    ? assetCategory(query.category || context.preference_category) : ''
  const category = assetCategory(currentProperty.category) || confirmedCategory || assetCategory(knownProperty.category) || advancedCategory
  const declaredGroup = (property: Row) => ['residential', 'commercial'].includes(text(property.group)) ? text(property.group)
    : assetGroup(assetCategory(property.category)) || (typeof object(property.filters).bedrooms === 'number' ? 'residential' : '')
  const qualificationPurpose = text(object(memory.qualification).proposito).trim()
  const rawPurpose = text(object(info.lead).purchase_purpose || qualificationPurpose)
  const purpose = ['vivir', 'invertir', 'segunda_vivienda', 'negocio'].includes(rawPurpose)
    && !(qualificationPurpose && isPassivePurchaseEvidence(qualificationPurpose)) ? rawPurpose : ''
  const group = declaredGroup(currentProperty) || assetGroup(confirmedCategory) || declaredGroup(knownProperty)
    || assetGroup(advancedCategory) || (acceptedExploration && ['residential', 'commercial'].includes(text(query.group)) ? text(query.group) : '')
    || (['vivir', 'segunda_vivienda'].includes(purpose) ? 'residential' : purpose === 'negocio' ? 'commercial' : '')
  return { category, group, purpose, known: !!(category || group || purpose) }
}

/** A code-resolved informational reference does not accept the proposed change. */
export function proposalInformationContext(info: Row): Row {
  const context = object(info.property_context), pending = object(context.pending_question)
  const reference = object(context.proposal_information)
  return reference.version === 'proposal-information-v1' && reference.active === true
    && reference.informational_only === true && pending.id === 'property_requirements'
    && pending.act === 'explore_alternatives' && reference.pending_question_id === pending.id
    && Object.keys(object(reference.query)).length ? reference : {}
}

/** Planning reads the same durable query as retrieval. A typed condition is
 * authoritative even when the optional legacy filter was deliberately omitted. */
export function commercialSelectionQuery(info: Row) {
  const context = object(info.property_context), query = object(context.query), lead = object(info.lead)
  const bedroomConditions = rows(query.requirements).filter(requirement => requirement.field === 'bedrooms')
  const currentBedrooms = object(query.filters).bedrooms
  const sameBedroomCondition = bedroomConditions.length === 1 && bedroomConditions[0].operator === 'eq'
    && typeof currentBedrooms === 'number' && currentBedrooms === bedroomConditions[0].value
  const category = commercialSelectionCategory(info)
  const interest = declaredCommercialInterest(info)
  return catalogQuery({ ...query, category,
    group: interest.group || assetGroup(category) || null,
    filters: { ...object(query.filters), bedrooms: bedroomConditions.length
      ? sameBedroomCondition ? currentBedrooms : null : currentBedrooms ?? lead.preferred_bedrooms } })
}

function commercialSelectionCategory(info: Row) {
  const context = object(info.property_context), preference = object(context.category_preference)
  // An earlier CRM label or an incidental visualization noun is not a choice
  // between the compatible types in the current alternative set.
  if (object(context.exploration_state).authorized === true)
    return preference.confirmed === true ? assetCategory(preference.category) || null : null
  return declaredCommercialInterest(info).category || null
}

export const COMMERCIAL_JOURNEY_RULES = `${BUDGET_ORIENTATION_RULES}
RECORRIDO COMERCIAL: siga siguiente_paso_comercial después de atender la consulta actual. La presentación pide nombre y residencia actual y ofrece el brochure según su etapa; no repita datos confirmados ni material ya enviado. El presupuesto se pregunta después de conocer qué busca y antes de dormitorios, tipo, planta y unidades. Si declara no tenerlo definido o prefiere no compartirlo, continúe por las características sin ofrecer financiamiento automáticamente. Si un requisito físico no está disponible, recomiende alternativas verificadas y pregunte si desea revisarlas antes de tratar el presupuesto como solución: el crédito no crea dormitorios, medidas o plantas inexistentes. Aceptar ese ajuste no elige tipo ni unidad. Presente las categorías pertinentes, luego las plantas reales y pregunte planta solo si hay varias. Con la planta definida, muestre números y características antes de elegir unidad; conserve el presupuesto ya conocido. Cuando existe una sola compatible, preséntela con su recorrido autorizado sin darla por elegida. La falta de medidas específicas restringe garantías de cabida, pero no obliga a añadir advertencias familiares en una selección ordinaria.
FINANCIAMIENTO Y RESERVA: una aceptación de financiamiento conserva el interés y primero resuelve la selección pendiente. Ofrezca analizar financiamiento ante presupuesto total insuficiente comprobado, entrada declarada o solicitud del lead, con entidades autorizadas y respetando negativas. No confunda ausencia de presupuesto o presupuesto sin definir con insuficiencia. No prometa aprobación ni viabilidad o inviabilidad del crédito sin evaluación. Para ofrecer reserva hace falta unidad elegida, ficha comercial y cobertura suficiente; datos financieros completos no son aprobación. La aceptación de reserva inicia una solicitud al equipo, no reserva inventario ni cobra.
VISITAS: la visita espontánea va después de declinar la reserva y puede ayudar ante dificultad explícita para elegir opciones compatibles identificadas o una solicitud del cliente. Una consulta de precio, distribución o capacidad no demuestra indecisión ni permiso para agendar. Invite a recibir orientación en el lugar habilitado y pregunte aceptación. No prometa planos sin documentos oficiales ni acceso a unidades terminadas; una oficina en el sitio no habilita recorrer la obra. Respete invitaciones declinadas, solicitudes actuales y límites del proyecto. No describa estados internos como «hemos registrado/confirmado su interés».`

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
  const filters = object(query.filters)
  const category = text(commercialSelectionCategory(info))
  const interest = declaredCommercialInterest(info), purpose = interest.purpose
  const profileDone = !!text(profile.full_name) && !!text(profile.residence_city || profile.residence_country)
  const stage = object(info.etapa_financiamiento), accepted = readiness.financing_accepted === true
  const selected = text(readiness.selected_unit_id)
  const policy = object(info.politica_visitas), sales = object(info._sales_memory)
  const visitDeclined = state.visit_declined === true || sales.visit_declined === true
  const visitPending = object(info.coordinacion_visita).status === 'collecting'
    || rows(info.propuestas).some(p => ['confirmed', 'awaiting_advisor', 'awaiting_client'].includes(text(p.status)))
  const visitPolicy = botVisitPolicy({ bot_visits: { allow_suggestions: policy.allowSuggestions, launch_destination: policy.launchDestination } }, text(info.modo_comercial))
  if (policy.readiness) visitPolicy.readiness = policy.readiness as NonNullable<typeof visitPolicy.readiness>
  let budgetGuidance: Row = {}
  const plan = (action: string, instruction: string, question = '', questionId = ''): Row => ({
    version: 'commercial-journey-v1', action, instruction, question, question_id: questionId,
    selected_unit_id: selected || null, readiness, profile_complete: profileDone,
    financing_offer_allowed: false, visit_offer_allowed: false,
    ...(Object.keys(budgetGuidance).length ? { budget_guidance: budgetGuidance } : {}),
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

  const selectionQuery = commercialSelectionQuery(info)
  // A budget declaration guides presentation. It cannot erase physical needs or
  // make accepting financing select a cheaper/incompatible unit automatically.
  const physicalQuery = catalogQuery({ ...selectionQuery,
    requirements: rows(selectionQuery.requirements).filter(r => r.field !== 'published_commercial_price') })
  const pendingSelection = object(context.pending_question)
  const progressionIds = object(context.exploration_state).authorized === true && ['choose_category', 'choose_floor'].includes(text(pendingSelection.act))
    ? ids(pendingSelection.candidate_ids) : []
  const scopedIds = selectionQuery.scope === 'offered' ? ids(context.offered_ids).length ? ids(context.offered_ids) : progressionIds
    : selectionQuery.scope === 'comparison' ? ids(context.comparison_ids)
      : selectionQuery.scope === 'selected' ? ids(context.selected_ids) : undefined
  const excluded = new Set(ids(context.excluded_categories))
  // Retrieval may legitimately project an empty result. Planning still uses
  // the complete verification snapshot, never a top-k sample as inventory.
  const planningCatalog = rows(Array.isArray(info.catalogo_verificacion) ? info.catalogo_verificacion : info.catalogo)
  const partition = partitionCatalog(planningCatalog, selectionQuery, scopedIds)
  const physicalPartition = partitionCatalog(planningCatalog, physicalQuery, scopedIds)
  let candidates = partition.units.filter(unit => !excluded.has(text(unit.category)))
  const unknownIds = partition.unknown.filter(unit => !excluded.has(text(unit.category))).map(unit => text(unit.id))
  const labels: Record<string, string> = { suite: 'las suites', departamento: 'los departamentos', penthouse: 'los penthouses', local: 'los locales comerciales' }
  let categories = Object.keys(labels).filter(category => candidates.some(unit => unit.category === category))
  let floors = [...new Set(candidates.map(unit => unit.floor_number).filter(value => typeof value === 'number'))]
  let selectionScope = { categories, unit_ids: candidates.map(unit => text(unit.id)).filter(Boolean), floors }
  const scopeKnown = !!selectionQuery.group || !!category || !!selected
  const amount = typeof budget.amount === 'number' && Number.isFinite(budget.amount) && budget.amount > 0 ? budget.amount : null
  const comparable = budget.status === 'maximum_total' && amount !== null && budget.confidence === 'high' && scopeKnown
  const authorizedPrices = object(info.politica_comercial).precios_autorizados === true
  const physicalCandidates = physicalPartition.units.filter(unit => !excluded.has(text(unit.category)))
  const physicalCategories = Object.keys(labels).filter(type => physicalCandidates.some(unit => unit.category === type))
  const assessmentCandidates = selected ? physicalCandidates.filter(unit => unit.id === selected) : physicalCandidates
  const priced = authorizedPrices ? assessmentCandidates.filter(unit => typeof unit.published_commercial_price === 'number'
    && Number.isFinite(unit.published_commercial_price) && unit.published_commercial_price > 0) : []
  const affordable = comparable ? priced.filter(unit => Number(unit.published_commercial_price) <= amount!) : []
  const complete = object(info.catalog_verification_read || info.catalog_read).complete === true
    && !physicalPartition.unknown.some(unit => !excluded.has(text(unit.category))) && priced.length === assessmentCandidates.length
  // Reading or comparing the same options is not a new budget decision. Track
  // the actual inventory and its verification, not transient query operations.
  const scopeKey = createHash('sha256').update(JSON.stringify({ selected: selected || null,
    amount, status: budget.status, scopeKnown, complete, authorizedPrices,
    candidates: assessmentCandidates.map(unit => [text(unit.id), unit.published_commercial_price])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))) })).digest('hex')
  const currentBudget = object(object(info.semantica_turno).budget)
  const currentBudgetDeclaration = currentBudget.confidence === 'high' && currentBudget.status !== 'not_discussed' && !!text(currentBudget.evidence).trim()
  const scopeChanged = state.budget_scope_key !== scopeKey
  budgetGuidance = {
    status: !comparable ? 'not_comparable' : !authorizedPrices ? 'prices_not_authorized'
      : !complete ? 'incomplete_prices' : !assessmentCandidates.length ? 'no_matching_features'
        : affordable.length ? 'matching_options' : 'below_available_prices',
    coverage: !comparable || !complete || !assessmentCandidates.length ? 'unknown'
      : affordable.length === assessmentCandidates.length ? 'all' : affordable.length ? 'some' : 'none',
    amount, complete, scope_key: scopeKey,
    candidate_unit_ids: assessmentCandidates.map(unit => text(unit.id)), matching_unit_ids: affordable.map(unit => text(unit.id)),
    prices: priced.map(unit => ({ unit_id: unit.id, published_commercial_price: unit.published_commercial_price })),
    comparison_required: comparable && complete && assessmentCandidates.length > 0 && !affordable.length && !accepted
      && (currentBudgetDeclaration || scopeChanged),
    instruction: comparable && currentBudgetDeclaration && affordable.length
      ? 'Puede reconocer brevemente que hay alternativas dentro del importe para el alcance conocido. No afirme que cumplen necesidades aún desconocidas ni que le alcanza para todo. No enumere precios o unidades por declarar presupuesto; continúe con la única pregunta pendiente.'
      : 'Use el presupuesto recordado para orientar. No repita importes ni condiciones de precios sin una consulta actual o una diferencia indispensable. Conserve preferencias y requisitos; una cifra aproximada no es un máximo rígido.',
  }
  const clarifyRequirements = (): Row => {
    const complete = object(info.catalog_read).complete === true && !unknownIds.length
      && (audit.verified_catalog !== true || object(audit.catalog_results).complete === true && !ids(object(audit.catalog_results).unknown_unit_ids).length)
    const pendingProposal = object(context.pending_question)
    const pendingQuery = catalogQuery(pendingProposal.proposed_query)
    const hasPendingProposal = pendingProposal.act === 'explore_alternatives'
      && Object.keys(object(pendingProposal.proposed_query)).length > 0 && ids(pendingProposal.candidate_ids).length > 0
    const pendingUnits = hasPendingProposal
      ? filterCatalog(planningCatalog, pendingQuery, ids(pendingProposal.candidate_ids))
        .filter(unit => !excluded.has(text(unit.category))) : []
    const initialAlternative = hasPendingProposal
      ? pendingUnits.length ? { field: text(object(pendingProposal.requirement_change).field)
        || (pendingQuery.filters.floor_number !== selectionQuery.filters.floor_number && pendingQuery.filters.bedrooms !== selectionQuery.filters.bedrooms ? 'bedrooms_and_floor'
          : pendingQuery.filters.floor_number !== selectionQuery.filters.floor_number ? 'floor_number'
          : pendingQuery.filters.bedrooms !== selectionQuery.filters.bedrooms ? 'bedrooms' : 'other'), query: pendingQuery, units: pendingUnits } : null
      : catalogRequirementAlternative(planningCatalog, selectionQuery, excluded, scopedIds,
        comparable && authorizedPrices ? { maximum: amount! } : undefined)
    const declined = object(context.requirements_declined)
    const adjustmentDeclined = Object.keys(declined).length > 0
      && JSON.stringify(normalizedPropertyQuery({ ...object(declined.original_query), operation: 'search', selector: null }))
        === JSON.stringify(normalizedPropertyQuery({ ...selectionQuery, operation: 'search', selector: null }))
      && (!hasPendingProposal || JSON.stringify(normalizedPropertyQuery(pendingProposal.proposed_query))
        === JSON.stringify(normalizedPropertyQuery(declined.proposed_query)))
    const lowerAlternative = adjustmentDeclined && canOfferLowerFloorBedrooms(info, selectionQuery, declined)
      ? catalogLowerFloorBedroomAlternative(planningCatalog, selectionQuery, declined, excluded, scopedIds,
        comparable && authorizedPrices ? { maximum: amount! } : undefined) : null
    const alternative = lowerAlternative || initialAlternative
    const bedroomCount = ['bedrooms', 'bedrooms_and_floor'].includes(text(alternative?.field)) ? alternative!.query.filters.bedrooms : null
    const strict = selectionQuery.filters.bedrooms_required === true
    const blockedByBedrooms = strict && (!alternative || ['bedrooms', 'bedrooms_and_floor'].includes(alternative.field))
    const lowerFloorProposal = alternative?.field === 'bedrooms_and_floor'
    const floorQuestion = ['floor_number', 'bedrooms_and_floor'].includes(text(alternative?.field))
      ? alternativeFloorQuestion(alternative!.query, alternative!.units, lowerFloorProposal) : ''
    const declinedProposalBlocks = adjustmentDeclined && !lowerAlternative
    const informationMissing = !complete && !alternative
    const question = blockedByBedrooms || declinedProposalBlocks || informationMissing ? '' : floorQuestion || (bedroomCount !== null
      ? `¿Le gustaría revisar las opciones de ${bedroomCount} dormitorios que tenemos disponibles?`
      : alternative ? '¿Estaría dispuesto a ajustar ese requisito para revisar las alternativas disponibles?'
        : '¿Cuál de sus requisitos considera indispensable y cuál podría flexibilizar para buscar alternativas?')
    const recommendation = Object.keys(proposalInformation).length
      ? 'Responda primero la consulta informativa sobre la propuesta pendiente con su referente verificado, incluidos precios autorizados si se preguntan. Después conecte esa respuesta con la decisión todavía pendiente de aceptar explorar el ajuste. Consultar detalles o precios no acepta la propuesta; no vuelva a presentar todo el catálogo ni cambie la necesidad original.'
      : 'Recomiende brevemente la alternativa verificable, no se limite a enumerar que existe. Explique por qué merece revisarla mediante rangos de área interior y características comunes comprobadas de los grupos requirement_alternatives, distinguiendo las categorías disponibles. Si un área no está verificada, omítala. No enumere números de unidad ni añada precios no solicitados antes de aceptar la alternativa. La recomendación invita a valorar otra opción, no afirma que satisfaga el requisito original ni que sea adecuada para toda la familia.'
    const floorInstruction = lowerFloorProposal
      ? 'El cliente rechazó la planta anterior, no aceptó reducir dormitorios. Proponga una única alternativa verificada en una planta inferior con menos dormitorios, indicando ambos cambios de proposed_query en la explicación y en la pregunta. Conserve la búsqueda original, categoría y presupuesto hasta recibir un sí a esta nueva propuesta; no insista en la planta rechazada ni seleccione una unidad. Rechazar también esta segunda propuesta deja abierta la conversación, sin una tercera oferta.'
      : floorQuestion ? 'Preserve los dormitorios y el presupuesto al proponer la planta compatible más cercana verificada. Explique la diferencia con la planta solicitada y pregunte por la planta concreta de proposed_query, sin enumerar todas las plantas ni reducir dormitorios. Use su denominación oficial: una segunda planta alta no es una segunda planta baja. No dé esa propuesta por elegida antes de la aceptación. Si falta cobertura completa o alguna planta está sin verificar, no afirme que es la más baja de todo el proyecto.' : ''
    const consentInstruction = 'La explicación y la pregunta reales deben identificar el mismo ajuste de proposed_query, incluida la cantidad propuesta si existe. El revisor debe comprobar tanto la recomendación sustentada (o la respuesta a la consulta informativa) como esa equivalencia antes de aprobar: un sí autoriza explorar esa propuesta, no otra ni seleccionar una unidad. Admita redacción equivalente sin exigir una frase literal.'
    return { ...plan('clarify_requirements',
      `${complete ? 'La consulta completa no tiene coincidencias con todos los requisitos actuales.'
        : 'No hay coincidencias confirmadas en el alcance consultado; faltan fichas o datos para afirmar ausencia en todo el proyecto.'} Reconozca el presupuesto solo si fue declarado, sin afirmar que alcanza para alternativas incompatibles. Explique el requisito que cambia y pregunte si aceptaría revisar ese cambio antes de pedir presupuesto, planta, unidad o financiamiento. No garantice que otra cantidad de dormitorios acomode a la familia.${alternative && !blockedByBedrooms && !declinedProposalBlocks ? ` ${recommendation} ${floorInstruction} ${consentInstruction}` : ''}${strict ? blockedByBedrooms ? ' La cantidad de dormitorios fue declarada indispensable: respétela y no insista en alternativas ni añada una pregunta de ajuste.' : ' La cantidad de dormitorios es indispensable: consérvela al proponer únicamente el cambio de planta u otro requisito.' : ''}${declinedProposalBlocks ? ' El cliente rechazó ajustar esta búsqueda: respete su negativa, no repita la propuesta ni pida presupuesto; atienda la consulta y deje abierta la conversación sin una nueva pregunta obligatoria. Rechazar otra planta no autoriza reducir dormitorios: cualquier propuesta con menos habitaciones necesita una aceptación específica.' : ''}${informationMissing ? ' Falta información para comprobar este requisito y tampoco hay una alternativa verificada: explique ese límite, sin pedir que cambie una condición cuya ausencia no se ha confirmado.' : ''}`,
      question, question ? 'property_requirements' : ''), question_act: alternative ? 'explore_alternatives' : 'other',
      ...(!alternative && question ? { adjustment_requires_specific_choice: true,
        instruction: 'No hay una propuesta concreta que un sí pueda aceptar. Explique los requisitos incompatibles verificados y pregunte cuál desea mantener o flexibilizar; conserve la búsqueda original hasta recibir una preferencia específica. No repita una invitación genérica a aceptar alternativas inexistentes.' } : {}),
      selection_scope: selectionScope, presentation: 'requirements', requested_query: selectionQuery,
      match_complete: complete, unknown_unit_ids: unknownIds,
      ...(alternative && !blockedByBedrooms && !declinedProposalBlocks ? { proposed_query: alternative.query, alternative_unit_ids: alternative.units.map(unit => text(unit.id)),
        requirement_change: { field: alternative.field }, recommendation_mode: Object.keys(proposalInformation).length ? 'answer_then_confirm_alternative' : 'brief_verified_summary' } : {}) }
  }
  // A tour, price question, courtesy or answer about use can interrupt this
  // decision, but cannot accept it or replace it with a fresh discovery step.
  const pendingProposal = object(context.pending_question)
  if (!selected && pendingProposal.act === 'explore_alternatives'
    && Object.keys(object(pendingProposal.proposed_query)).length && ids(pendingProposal.candidate_ids).length)
    return clarifyRequirements()
  // Compatibility precedes budget discovery. Money and financing cannot make
  // an unavailable physical feature compatible with the current requirement.
  const physicalRequirements = rows(selectionQuery.requirements).some(r => r.strength === 'required' && r.field !== 'published_commercial_price')
    || selectionQuery.filters.bedrooms !== null || !!selectionQuery.filters.bedrooms_any?.length
    || selectionQuery.filters.floor_number !== null || selectionQuery.filters.min_area_m2 !== null || selectionQuery.filters.max_area_m2 !== null
  if (!selected && physicalRequirements && (['search', 'rank', 'none'].includes(selectionQuery.operation) || Object.keys(proposalInformation).length > 0)
    && !filterCatalog(planningCatalog, physicalQuery, scopedIds).some(unit => !excluded.has(text(unit.category)))) return clarifyRequirements()

  const kindQuestion = budgetKindQuestion(budget)
  const budgetDeferred = ids(object(info.memoria_comercial).deferred_fields).includes('presupuesto')
    && budget.source !== 'current_lead_statement'
  if (!selected && !interest.known)
    return plan('discover_use', 'Presente brevemente las categorías disponibles y pregunte vivienda o comercio.', '¿Busca una vivienda o un local para su negocio?', 'property_category')
  if (!passive && budget.answered !== true && !budgetDeferred) return {
    ...plan('ask_budget', selected
      ? 'Conserve la unidad de interés y responda la consulta actual. Recupere únicamente el presupuesto total aproximado que falta, sin reabrir tipo o planta ni repetir la ficha ya presentada.'
      : 'Ya conocemos qué busca. Responda cualquier consulta actual y pregunte únicamente el presupuesto total aproximado antes de dormitorios, tipo, planta o unidades. No enumere opciones ni precios por esta pregunta. Un sí sin monto requiere preguntar cuánto; sin presupuesto definido o ante negativa continúe con las características.',
    budgetQuestion(info), 'budget_amount'),
    ...(selected ? { selection_scope: { categories: category ? [category] : [], unit_ids: [selected], floors: [] } } : {}),
    presentation: 'budget_intake',
  }
  if (!accepted && kindQuestion && !budgetDeferred && !passive) return plan('clarify_budget_kind',
    'El monto fue declarado, pero no su significado. Responda la consulta y aclare si es presupuesto total o dinero para la entrada. No vuelva a pedir la cifra, no compare su suficiencia con el precio ni ofrezca financiamiento o reserva antes de esa aclaración.',
    kindQuestion, 'budget_kind')
  if (!selected && purpose && !category && !selectionQuery.group)
    return plan('discover_use', 'El propósito de inversión y la situación del presupuesto están conocidos, pero inversión no identifica vivienda o local. Aclare ese alcance antes de comparar importes; no deduzca una categoría.', '¿Le interesa una vivienda o un local comercial para invertir?', 'property_category')

  const currentSemantics = object(info.semantica_turno), currentAnswer = object(currentSemantics.answer_to_previous)
  const currentPreference = object(currentSemantics.property), currentFilters = object(currentPreference.filters)
  const specificPreference = currentPreference.confidence === 'high' && !!text(currentPreference.evidence).trim()
    && (text(currentPreference.category) || ids(currentPreference.unit_numbers).length || text(currentPreference.selector)
      || Object.values(currentFilters).some(value => typeof value === 'number' || Array.isArray(value) && value.length > 0)
      || rows(object(currentSemantics.catalog_request).requirements).length > 0
      || ids(object(currentSemantics.catalog_request).semantic_preferences).length > 0)
  if (currentAnswer.kind === 'negative' && currentAnswer.confidence === 'high' && !!text(currentAnswer.evidence).trim()
    && ['property_category', 'property_floor', 'unit_choice'].includes(text(currentAnswer.question_id)) && !specificPreference)
    return { ...plan('clarify_preferences', 'Las opciones presentadas no le convencen y todavía no explicó qué cambiaría. Reconozca su respuesta y aclare qué le gustaría que tuviera la vivienda o el local. No repita la ficha, no suponga que el motivo es precio, no reinicie presupuesto y no sustituya sus necesidades por lo más barato.',
      '¿Qué le gustaría que tuviera la propiedad y que estas opciones no ofrecen?', 'property_requirements'), question_act: 'other' }

  const requests = rows(info.solicitudes_interpretadas || object(info.contrato_turno).requests)
  const requestedFinance = requests.some(r => r.domain === 'financing') || object(info.semantica_turno).primary_intent === 'ask_financing'
  const partners = ids(finance.partners)
  const financeDeclined = object(finance.journey).status === 'declined'
  const insufficient = budget.status === 'insufficient_for_selected_unit' && (!budget.unit_id || budget.unit_id === selected)
    || budget.status === 'maximum_total' && Number(budget.amount) > 0
       && (Number(readiness.price) > Number(budget.amount) || budgetGuidance.status === 'below_available_prices')
  const entryNeedsFinancing = budget.status === 'initial_capital' && Number(budget.amount) > 0
    && (!selected || Number(readiness.price) > Number(budget.amount))
  if (!accepted && partners.length && (requestedFinance || !passive && !financeDeclined
    && (state.financing_offered !== true || currentBudgetDeclaration || scopeChanged) && (insufficient || entryNeedsFinancing))) {
    const result = plan('offer_financing', `${insufficient ? 'Explique con calma que los precios de las opciones compatibles comprobadas están por encima del presupuesto total indicado, sin rechazar al lead ni enumerar todo el catálogo. ' : ''}Explique brevemente que podemos ayudarle a analizar financiamiento con las entidades autorizadas y pregunte únicamente si desea continuar por este chat. ${selected ? 'Conserve la unidad elegida; no pida confirmarla otra vez ni reabra otras opciones.' : 'Si acepta, primero se identificará una unidad de interés con sus necesidades conocidas; no pida entidad, cédula, empleo ni ingresos antes de elegirla.'}${entryNeedsFinancing ? ' La cantidad conocida es entrada prevista, no presupuesto total ni fondos verificados; el saldo y sus condiciones requieren evaluación. No vuelva a preguntar el papel de ese importe.' : ''} No ofrezca contactos ni otros proyectos. No rechace al lead por el presupuesto. No prometa aprobación ni que el crédito cubrirá la diferencia. Una orientación o consulta de requisitos no autoriza recopilar datos financieros.`,
      '¿Desea que continuemos con el proceso de financiamiento?', 'financing_invitation')
    return { ...result, financing_offer_allowed: true }
  }
  if (!accepted && insufficient && (financeDeclined || !partners.length))
    return plan('leave_open', 'Responda la consulta y explique únicamente la diferencia comprobada para las opciones que le interesan. Conserve sus necesidades, preferencias y presupuesto; no insista con financiamiento rechazado, no sustituya por opciones incompatibles ni prometa una solución inexistente. No añada una pregunta obligatoria de elección de inmuebles fuera del importe.')
  if (selected && passive) return plan('leave_open', 'Responda la consulta solicitada sobre la unidad conocida. No convierta una consulta informativa en presupuesto, financiamiento, reserva ni visita.')
  if (accepted && selected && readiness.can_offer_reservation !== true) return plan('continue_financing', stage.instruction ? text(stage.instruction) : 'Continúe con el siguiente dato financiero pendiente; no repita la aceptación ni ofrezca reserva mientras no exista revisión favorable.')
  if (selected && readiness.can_offer_reservation === true && profileDone) {
    if (ids(state.reservation_declined_ids).includes(selected)) {
      if (!visitDeclined && state.visit_offered !== true && visitPolicy.allowSuggestions) return {
        ...plan('offer_visit', 'La reserva fue declinada. Atienda primero el motivo si lo hay; puede ofrecer atención en el lugar habilitado para recibir orientación sobre el proyecto. No prometa planos disponibles ni acceso a unidades terminadas sin evidencia. La invitación pide aceptación; no registra una cita. No vuelva a ofrecer reserva.', visitInvitation(text(info.modo_comercial), visitPolicy), 'visit_invitation'), visit_offer_allowed: true }
      return plan('leave_open', 'Atienda cualquier duda y deje abierta la conversación. No añada preguntas ni vuelva a ofrecer reserva o visita rechazadas.')
    }
    if (!ids(state.reservation_offered_ids).includes(selected)) return plan('offer_reservation',
      'Después de responder, ofrezca iniciar la solicitud de reserva de la unidad elegida. La aceptación pasará al equipo para gestionar condiciones, no reserva inventario. Ofrezca reserva antes que visita.',
      `¿Le gustaría que le ayudemos a iniciar la reserva de la unidad ${text(readiness.selected_unit_number)}?`, 'reservation_invitation')
    return plan('await_reservation', 'Responda las dudas pendientes sin repetir la oferta de reserva ni sustituirla por una visita mientras no la haya declinado.')
  }
  const uncertain = object(object(info.semantica_turno).answer_to_previous)
  const currentIntent = text(object(info.semantica_turno).primary_intent)
  const comparisonIds = ids(context.comparison_ids)
  const comparedUnits = candidates.filter(unit => comparisonIds.includes(text(unit.id)))
  const comparing = comparedUnits.length > 1
  const informationalOnly = ['ask_price', 'project_information', 'ask_financing', 'ask_reservation', 'request_visit', 'request_reservation'].includes(currentIntent)
  if (!accepted && !passive && !selected && comparing && uncertain.kind === 'uncertain' && uncertain.confidence === 'high'
    && !informationalOnly && !visitDeclined && state.visit_offered !== true && visitPolicy.allowSuggestions) return {
      ...plan('offer_visit', 'El cliente expresa dificultad para elegir entre opciones compatibles identificadas. Atienda primero su duda y ofrezca atención en el lugar habilitado para orientarle y comparar. No prometa planos disponibles, medidas de dormitorios ni capacidad de camas sin evidencia específica. La oficina en el sitio del proyecto no habilita acceso a la obra ni a unidades terminadas. Pregunte si desea coordinar esa atención; no confirme una cita ni solicite otra elección simultánea.', visitInvitation(text(info.modo_comercial), visitPolicy), 'visit_invitation'), visit_offer_allowed: true,
      comparison_unit_ids: comparedUnits.map(unit => text(unit.id)) }
  if (selected) return plan('clarify_purchase', 'Responda y aclare únicamente lo necesario para avanzar. Sin cobertura confirmada no ofrezca reserva. Respete la negativa a financiamiento.')
  const exploringAlternatives = object(context.exploration_state).authorized === true
  if (!purpose && !passive && !exploringAlternatives) return plan('discover_purpose', 'Pregunte el uso que aún falta sin repetir el tipo de espacio.', category === 'local' ? '¿Lo busca para su propio negocio o para invertir y arrendarlo?' : '¿Lo busca para vivir o como inversión?', 'property_purpose')
  const bedroomCondition = rows(selectionQuery.requirements).some(requirement => requirement.field === 'bedrooms')
  if (category !== 'local' && category !== 'suite' && !bedroomCondition && !filters.bedrooms && !(Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.length) && !lead.preferred_bedrooms)
    return plan('discover_bedrooms', 'Use la familia conocida, pero no convierta personas en dormitorios. Pregunte cuántos necesita.', '¿Cuántos dormitorios necesita?', 'property_bedrooms')
  const selection = plan('select_property', accepted
    ? 'Ya aceptó financiamiento: retome las opciones con las preferencias conocidas hasta elegir una unidad concreta. No repita que no alcanza, no pida otra aceptación, cédula ni datos laborales. No exija elegir una planta si ya la conoce.'
    : 'Ayude a comparar y elegir una unidad concreta con las preferencias conocidas. No vuelva a pedir datos ya respondidos.')
  {
    if (!candidates.length) return clarifyRequirements()
    // Prefer affordable matches for presentation without changing the durable
    // query. A later explicit preference outside this set still gets evaluated.
    const affordableIds = new Set(affordable.map(unit => text(unit.id)))
    const affordableCandidates = candidates.filter(unit => affordableIds.has(text(unit.id)))
    if (!accepted && !passive && ['search', 'none'].includes(selectionQuery.operation)
      && budgetGuidance.status === 'matching_options' && affordableCandidates.length > 0 && affordableCandidates.length < candidates.length) {
      candidates = affordableCandidates
      categories = Object.keys(labels).filter(category => candidates.some(unit => unit.category === category))
      floors = [...new Set(candidates.map(unit => unit.floor_number).filter(value => typeof value === 'number'))]
      selectionScope = { categories, unit_ids: candidates.map(unit => text(unit.id)).filter(Boolean), floors }
      selection.instruction = `${text(selection.instruction)} Oriente la presentación hacia las alternativas compatibles dentro del importe declarado, sin dar ninguna por elegida ni modificar la búsqueda guardada. Conserve las preferencias explícitas aunque superen el importe y atienda cualquier petición de revisar otras opciones. No transforme una cifra aproximada en una condición rígida.`
    }
    if (!category && categories.length === 1 && physicalCategories.length > 1) {
      const recommendedCategory = categories[0]
      return { ...selection, question: `¿Le gustaría que exploremos ${labels[recommendedCategory]}?`,
        question_id: 'property_category', question_act: 'choose_category',
        selection_scope: selectionScope, presentation: 'categories',
        proposed_query: normalizedPropertyQuery({ ...selectionQuery, category: recommendedCategory, operation: 'search', selector: null }),
        instruction: `${text(selection.instruction)} El presupuesto orienta hacia un tipo, pero el cliente todavía no lo ha elegido. Presente brevemente esa recomendación y pregunte si desea explorarla antes de planta o unidad. No dé por aceptado el tipo ni descarte las demás alternativas físicamente compatibles; si solicita otro tipo, conserve sus necesidades y evalúe ese interés con el presupuesto conocido. No enumere números de unidad todavía.` }
    }
    if (!category && categories.length > 1) {
      const options = new Intl.ListFormat('es', { type: 'disjunction' }).format(categories.map(category => labels[category]))
      return { ...selection, question: `¿Prefiere que revisemos ${options}?`, question_id: 'property_category', question_act: 'choose_category',
        selection_scope: selectionScope, presentation: 'categories',
        instruction: `${text(selection.instruction)} Presente brevemente las categorías pertinentes, incluidas las alternativas de penthouse cuando correspondan al alcance. Explique diferencias verificadas de amplitud y distribución sin añadir advertencias generales sobre expectativas familiares. Pregunte cuál tipo prefiere antes de planta o unidad; el presupuesto ya se preguntó o fue pospuesto. No enumere números de unidad ni pida una unidad específica todavía.` }
    }
    if (floors.length > 1) {
      const options = new Intl.ListFormat('es', { type: 'disjunction' }).format(categories.map(category => labels[category]))
      return { ...selection, question: `¿En qué planta le gustaría revisar ${options || 'las opciones'}?`, question_id: 'property_floor', question_act: 'choose_floor',
        selection_scope: selectionScope, presentation: 'floors',
        instruction: `${text(selection.instruction)} El tipo ya está definido o sólo existe uno compatible. Resuma los rangos verificados de superficie interior y exterior y las plantas reales de ese tipo; no invente plantas intermedias ni que el precio aumenta por altura. Pregunte explícitamente en qué planta desea revisar opciones. No enumere números de unidad ni repita un presupuesto conocido, pospuesto o declinado. No pida elegir una unidad ni repita las fichas completas.` }
    }
    const presentedIds = new Set(ids(state.presented_unit_ids))
    const unitsAlreadyPresented = candidates.every(unit => presentedIds.has(text(unit.id)))
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
  if (object(plan.budget_guidance).scope_key) next.budget_scope_key = object(plan.budget_guidance).scope_key
  const authorized = new Set([...ids(object(plan.selection_scope).unit_ids), text(plan.selected_unit_id)].filter(Boolean))
  const presented = ids(presentedUnitIds).filter(id => authorized.has(id))
  if (presented.length) next.presented_unit_ids = [...new Set([...ids(previous.presented_unit_ids), ...presented])]
  if (pending.id === 'reservation_invitation' && plan.selected_unit_id)
    next.reservation_offered_ids = [...new Set([...ids(previous.reservation_offered_ids), text(plan.selected_unit_id)])]
  if (pending.id === 'visit_invitation') next.visit_offered = true
  if (pending.id === 'financing_invitation') next.financing_offered = true
  return next
}
