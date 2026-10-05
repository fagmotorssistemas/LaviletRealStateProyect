import { object, text, type Row } from './data'
import { selectedFinancingUnit } from './financing-stage'
import { leadBudget, budgetQuestion, reviewedFinancingCovers } from './budget-state'
import { catalogQuery, filterCatalog } from './catalog-dialogue'
import { botVisitPolicy, visitInvitation } from '@/lib/inmobiliaria/botVisits'
import { replyQuestions } from './reply-question'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const ids = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : []

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
    const selectionQuery = catalogQuery({ ...query, category: category || null, filters: { ...filters, bedrooms: filters.bedrooms ?? lead.preferred_bedrooms } })
    const scopedIds = selectionQuery.scope === 'offered' ? ids(context.offered_ids)
      : selectionQuery.scope === 'comparison' ? ids(context.comparison_ids)
        : selectionQuery.scope === 'selected' ? ids(context.selected_ids) : undefined
    const excluded = new Set(ids(context.excluded_categories))
    const candidates = filterCatalog(rows(info.catalogo), selectionQuery, scopedIds).filter(unit => !excluded.has(text(unit.category)))
    const labels: Record<string, string> = { suite: 'las suites', departamento: 'los departamentos', penthouse: 'los penthouses', local: 'los locales comerciales' }
    const categories = Object.keys(labels).filter(category => candidates.some(unit => unit.category === category))
    const floors = [...new Set(candidates.map(unit => unit.floor_number).filter(value => typeof value === 'number'))]
    const selectionScope = { categories, unit_ids: candidates.map(unit => text(unit.id)).filter(Boolean), floors }
    if (!floors.length && categories.length > 1) {
      const options = new Intl.ListFormat('es', { type: 'disjunction' }).format(categories.map(category => labels[category]))
      return { ...selection, question: `¿Prefiere que revisemos ${options}?`, question_id: 'property_category', question_act: 'choose_category',
        selection_scope: selectionScope, instruction: `${text(selection.instruction)} Mantenga abiertas las categorías compatibles; no invente las plantas que faltan en las fichas.` }
    }
    if (candidates.length === 1) return { ...selection, question: `¿Desea continuar con ${text(candidates[0].category)} ${text(candidates[0].unit_number)}?`,
      question_id: 'unit_choice', question_act: 'confirm_unit', selection_scope: selectionScope, presentation: 'single_unit',
      instruction: `${text(selection.instruction)} Presente la única opción compatible con sus características y su recorrido autorizado. Mostrarla no significa que el cliente ya la eligió; confirme si desea continuar con ella.` }
    if (floors.length > 1 || !candidates.length && filters.floor_number == null) {
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
    ...(plan.selection_scope ? { candidate_ids: ids(object(plan.selection_scope).unit_ids) } : {}) }
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
