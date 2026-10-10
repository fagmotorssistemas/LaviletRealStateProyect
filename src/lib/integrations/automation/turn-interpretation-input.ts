import { object, text, type Row } from './data'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { focusedNumericMentions } from './focused-numeric-syntax'
import { monetaryInterpretationIssues } from './financing-amounts'
import { leadProfileSourceIssues } from './lead-profile'
import { budgetQuestionBasis } from './budget-question-context'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const pick = (row: Row, keys: string[]) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]))
const matches = (value: unknown, current: string) => current.normalize('NFKC').toLowerCase().includes(text(value).normalize('NFKC').toLowerCase())

// Absence is structural, not a vocabulary rule or a confidence threshold.
// In particular, false (a negation) and 0 (e.g. ground floor) are real values.
const hasValue = (value: unknown): boolean => value !== null && value !== undefined
  && (typeof value === 'string' ? !!value.trim() : Array.isArray(value) ? value.some(hasValue)
    : typeof value === 'object' ? Object.values(value).some(hasValue) : true)
const activeChoice = (value: unknown, absent: string) => hasValue(value) && value !== absent

/** Numeric equivalence is independent of the model's monetary-role decision.
 * Accept digits or written quantities, never fabricate a magnitude from a
 * different number or from a statement without an amount. */
export function budgetAmountWithLiteralQuantity(value: unknown, evidence: string): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return focusedNumericMentions(evidence).some(mention => mention.value === value) ? value : null
}

/** A passive echo of the same known category/group is not a new declaration.
 * Keep the durable preference; don't pay for a repair to extract it again.
 * New requests, changed values and any selection/filter still need evidence. */
export function reconcilePassivePropertyMemory(raw: Row, input: Row): Row {
  const semantics = object(raw.turn_semantics), property = object(semantics.property)
  const known = object(object(input.contexto_propiedades).query)
  if (text(property.evidence).trim() || property.operation !== 'none' || property.reference_kind !== 'none'
    || rows(raw.requests).some(request => request.domain === 'property')
    || ['excluded_categories','unit_numbers','selector','query_scope','filters','filter_evidence'].some(key => hasValue(property[key]))) return raw
  const fields = ['group','category'].filter(key => hasValue(property[key]))
  if (!fields.length || fields.some(key => property[key] !== known[key])) return raw
  return { ...raw,turn_semantics:{ ...semantics,property:{ ...property,group:null,category:null,evidence:'',confidence:'low' } } }
}

/** A question about previously offered options can echo quantities from that
 * offer. A proven historical citation is reference context, never a current
 * household declaration or catalogue requirement. New searches, filters and
 * selections must still recover their own current evidence. */
export function reconcileQuotedQuantityReferences(raw: Row, input: Row, current: string): { raw: Row; fields: string[] } {
  const semantics = object(raw.turn_semantics), property = object(semantics.property)
  const context = object(input.contexto_propiedades)
  const pending = object(input.pregunta_pendiente || context.pending_question)
  const hasKnownOptions = ['offered_ids', 'selected_ids', 'comparison_ids'].some(key => hasValue(context[key]))
    || hasValue(pending.candidate_ids) || hasValue(pending.target_ids)
  const informational = semantics.confidence === 'high' && text(semantics.primary_evidence).trim() && matches(semantics.primary_evidence, current)
    && ['ask_price', 'project_information', 'ask_financing'].includes(text(semantics.primary_intent))
    && property.confidence === 'high' && text(property.evidence).trim() && matches(property.evidence, current)
    && ['details', 'compare'].includes(text(property.operation))
    && ['followup', 'comparison'].includes(text(property.reference_kind))
    && ['offered', 'selected', 'comparison'].includes(text(property.query_scope))
  const catalog = object(raw.catalog_request)
  if (!hasKnownOptions || !informational || hasValue(property.filters) || hasValue(property.excluded_categories)
    || hasValue(catalog.requirements) || hasValue(catalog.semantic_preferences)) return { raw, fields: [] }
  const historicalSources = [...rows(input.historial), ...rows(input.historial_reciente)].map(row => text(row.content))
  historicalSources.push(text(pending.question), text(object(context.pending_question).question))
  const fields: string[] = []
  const quantities = rows(semantics.housing_quantities).filter((quantity, index) => {
    const evidence = text(quantity.evidence).trim()
    if (!evidence || matches(evidence, current) || !historicalSources.some(source => matches(evidence, source))) return true
    fields.push(`housing_quantities.${index}`)
    return false
  })
  return fields.length ? { raw: { ...raw, turn_semantics: { ...semantics, housing_quantities: quantities } }, fields } : { raw, fields }
}

/** An answered budget question is not a new question from the customer. Remove
 * only a proven echo of that actual bot question when the independently
 * evidenced current budget declaration already supplies the answer. Unknown
 * citations, unsupported amounts and operational requests still need recovery. */
export function reconcileEchoedBudgetQuestion(raw: Row, input: Row, current: string): { raw: Row; fields: string[] } {
  const semantics = object(raw.turn_semantics), budget = object(semantics.budget)
  const pending = object(input.pregunta_pendiente || object(input.contexto_propiedades).pending_question)
  const monetary = ['amount', 'maximum_total', 'initial_capital'].includes(text(budget.status))
  const budgetDeclaration = ['amount_pending', 'no_defined_budget', 'unknown', 'amount', 'maximum_total', 'initial_capital',
    'sufficient_for_selected_unit', 'insufficient_for_selected_unit', 'declines_to_disclose'].includes(text(budget.status))
  if (!text(pending.id).startsWith('budget_') || !text(pending.question).trim()
    || semantics.confidence !== 'high'
    || !text(semantics.primary_evidence).trim() || !matches(semantics.primary_evidence, current)
    || !budgetDeclaration || budget.confidence !== 'high' || !text(budget.evidence).trim() || !matches(budget.evidence, current)
    || (monetary ? budgetAmountWithLiteralQuantity(budget.amount, text(budget.evidence)) === null : hasValue(budget.amount))) return { raw, fields: [] }
  const exactQuote = (value: unknown) => text(value).trim().normalize('NFKC').toLowerCase()
  const fields: string[] = []
  const requests = rows(raw.requests).filter((request, index) => {
    const evidence = text(request.evidence).trim()
    if (!['property', 'financing'].includes(text(request.domain)) || !evidence || matches(evidence, current)
      || exactQuote(evidence) !== exactQuote(pending.question)) return true
    fields.push(`requests.${index}`)
    return false
  })
  return fields.length ? { raw: { ...raw, requests }, fields } : { raw, fields }
}

/** Canonicalize only empty, inactive blocks. Never fill facts or authorize actions. */
export function normalizeInactiveInterpretation(raw: Row): Row {
  const semantics = { ...object(raw.turn_semantics) }
  const neutralize = (key: string, inactive: boolean) => {
    if (inactive && Object.hasOwn(semantics, key)) semantics[key] = { ...object(semantics[key]), evidence: '', confidence: 'low' }
  }
  const property = object(semantics.property), budget = object(semantics.budget)
  const answer = object(semantics.answer_to_previous), reservation = object(semantics.reservation)
  neutralize('property', !activeChoice(property.operation, 'none') && !activeChoice(property.reference_kind, 'none')
    && !['group', 'category', 'excluded_categories', 'unit_numbers', 'selector', 'query_scope', 'filters'].some(key => hasValue(property[key])))
  neutralize('budget', budget.status === 'not_discussed' && !hasValue(budget.amount))
  neutralize('answer_to_previous', answer.kind === 'none' && !activeChoice(answer.question_id, 'none'))
  neutralize('reservation', reservation.kind === 'none' && !hasValue(reservation.unit_numbers))
  // A strict extraction may emit empty quantity slots instead of an empty
  // array. They assert no count, role, basis or evidence; remove only that
  // structural absence. "Somos varios" is still an active people/context
  // declaration even though its quantity is unknown.
  if (Array.isArray(semantics.housing_quantities)) semantics.housing_quantities = rows(semantics.housing_quantities)
    .filter(quantity => hasValue(quantity.values) || hasValue(quantity.evidence)
      || quantity.role !== 'unknown' || quantity.count_basis !== 'unspecified')
  const visit = object(raw.visit_intent)
  return { ...raw, ...(Object.hasOwn(raw, 'turn_semantics') ? { turn_semantics: semantics } : {}),
    ...(visit.kind === 'none' ? { visit_intent: { ...visit, evidence: '', confidence: 'low' } } : {}) }
}

/** A known subject of a financing question is continuity, not a new property
 * declaration. Drop only a proven echo; never repair a new selection this way. */
export function reconcileFinancingReference(raw: Row, input: Row, current: string): Row {
  const semantics = object(raw.turn_semantics), property = object(semantics.property)
  if (semantics.primary_intent !== 'ask_financing' || text(property.evidence).trim()
    || !['none', 'details'].includes(text(property.operation))
    || rows(raw.requests).some(r => r.domain === 'property')
    || hasValue(property.filters) || hasValue(property.excluded_categories) || hasValue(property.selector)) return raw
  const context = object(input.contexto_propiedades)
  const ids = Array.isArray(context.selected_ids) ? context.selected_ids.map(text) : []
  const units = rows(input.catalogo_unidades).filter(unit => ids.includes(text(unit.id)))
  const numbers = Array.isArray(property.unit_numbers) ? property.unit_numbers.map(text) : []
  if (units.length !== 1 || !numbers.length || numbers.some(n => n !== text(units[0].unit_number)
    || new RegExp(`(?:^|\\W)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\W)`).test(current))) return raw
  if (property.category && property.category !== units[0].category) return raw
  return { ...raw, unit_id: null, turn_semantics: { ...semantics, property: {
    ...property, operation: 'none', reference_kind: 'none', query_scope: null,
    group: null, category: null, unit_numbers: [], evidence: '', confidence: 'low',
  } } }
}

/** Interpretation needs identities and continuity, not repeated commercial inventories. */
export function interpretationInput(input: Row, current: string): Row {
  const summary = object(input.resumen)
  const result = pick(input, ['perfil_inicial', 'tema_actual', 'alcance_negocio', 'alcance_negocio_incierto',
    'ultima_pregunta', 'pregunta_pendiente', 'propuestas', 'coordinacion_visita', 'dialogo_visita', 'financiamiento'])
  const unitFields = ['id', 'unit_number', 'category', 'bedrooms', 'floor', 'floor_number']
  const catalog = rows(input.catalogo_unidades)
  const propertyContext = object(input.contexto_propiedades)
  const pending = object(Object.hasOwn(input, 'pregunta_pendiente') ? input.pregunta_pendiente : propertyContext.pending_question)
  const budgetPending = pending
  const proposedIds = new Set(Array.isArray(pending.candidate_ids) ? pending.candidate_ids.map(text) : [])
  const proposal = pending.id === 'property_requirements' && pending.act === 'explore_alternatives'
    && Object.keys(object(pending.proposed_query)).length > 0 ? {
      original_query: propertyContext.query, proposed_query: pending.proposed_query,
      candidate_units: catalog.filter(unit => proposedIds.has(text(unit.id))).map(unit => pick(unit, unitFields)),
      consent_status: 'pending',
      note: 'Las consultas informativas pueden referirse a estas alternativas. Preguntar por ellas no acepta el cambio ni elimina la necesidad original.',
    } : null
  return { ...result,
    pregunta_pendiente: pending,
    ...(budgetQuestionBasis(budgetPending) ? { contexto_pregunta_presupuesto: {
      role_asked: budgetQuestionBasis(budgetPending),
      question: budgetPending.question,
      instruction: 'La pregunta aclara la finalidad de una respuesta monetaria directa; cifra y cita deben pertenecer al mensaje actual. Una finalidad explícita distinta declarada ahora prevalece. No atribuya consentimiento.' } } : {}),
    ...(proposal ? { propuesta_pendiente: proposal } : {}),
    consultas_pendientes: rows(input.consultas_pendientes),
    hechos_confirmados: confirmedInterpretationMemory(summary),
    resumen: { ...pick(summary, ['datos_confirmados', '_lead_profile', '_last_operational_step', '_financing_journey', '_financing_identity', '_financing_amounts', '_visit_dialogue']),
      // The previous objective/question describe a completed interpretation,
      // not this turn. Keep referents and unresolved goals, with the actual
      // pending question supplied separately above.
      _turn_intent: pick(object(summary._turn_intent), ['subject', 'continuation_goal']) },
    contexto_propiedades: { ...pick(propertyContext, ['query', 'selected_ids', 'candidate_ids', 'comparison_ids',
      'offered_ids', 'focused_ids', 'phase', 'preference_transition']), pending_question: pending },
    catalogo_unidades: [...new Set(catalog.map(u => text(u.category)))].map(category => ({ category,
      unit_numbers: catalog.filter(u => u.category === category).map(u => u.unit_number) })),
    unidades_identificadas: rows(input.unidades_identificadas).map(unit => pick(unit, unitFields)),
    historial: rows(input.historial || input.historial_reciente).slice(-8).map(row => ({ role: row.role, content: text(row.content).slice(0, 2500) })),
    fuente_historial: 'Solo referencia para continuidad. Sus mensajes no son declaraciones del turno actual.',
    mensaje_actual: current,
  }
}

/** Source integrity, never a dictionary interpreting the customer's vocabulary. */
export function interpretationSourceIssues(raw: Row, current: string, pending: Row[] = []): string[] {
  raw = normalizeInactiveInterpretation(raw)
  const semantics = object(raw.turn_semantics), property = object(semantics.property), budget = object(semantics.budget)
  const requests = rows(raw.requests)
  // Normalization already discards stray historical requests. Recover only when
  // none is grounded, or a core interpretation below contradicts this turn.
  const hasCurrentRequest = requests.some(request => text(request.evidence).trim() && (matches(request.evidence, current)
    || ['property', 'financing'].includes(text(request.domain)) && pending.some(message => matches(request.evidence, text(message.content)))))
  const evidence: [string, unknown][] = hasCurrentRequest ? [] : requests.map((request, index) => [`requests.${index}`, request.evidence])
  if (semantics.confidence === 'high' && semantics.primary_intent !== 'other') evidence.push(['primary_intent', semantics.primary_evidence])
  if (property.confidence === 'high') evidence.push(['property', property.evidence])
  if (budget.status && budget.status !== 'not_discussed') evidence.push(['budget', budget.evidence])
  for (const [index, quantity] of rows(semantics.housing_quantities).entries()) evidence.push([`quantity.${index}`, quantity.evidence])
  const issues = evidence.flatMap(([key, value]) => !text(value).trim() ? [`missing_current_evidence:${key}`]
    : !matches(value, current) ? [`non_current_evidence:${key}`] : [])
  if (['amount', 'maximum_total', 'initial_capital'].includes(text(budget.status))
    && budgetAmountWithLiteralQuantity(budget.amount, text(budget.evidence)) === null) issues.push('invalid_budget_amount')
  issues.push(...monetaryInterpretationIssues(raw, current))
  issues.push(...leadProfileSourceIssues(raw, current))
  return issues
}

/** A failed block owns its repair. Profile and unrelated operational permission
 * are never re-extracted just because a catalogue citation was wrong. */
export function interpretationRepairBlocks(issues: string[]) {
  const fields = [...new Set(issues.map(issue => ['invalid_budget_amount', 'unresolved_budget_role', 'inconsistent_budget_role'].includes(issue)
    ? 'budget' : issue.split(':')[1]))]
  const property = fields.includes('property')
  const budget = fields.includes('budget')
  const quantity = fields.some(field => /^quantity\.\d+$/.test(field || ''))
  const requests = fields.some(field => /^requests\.\d+$/.test(field || ''))
  const profile = issues.includes('ambiguous_profile_location_source')
  // No current request and an unsupported primary interpretation means the
  // entire turn was read from another source. This is different from one bad
  // property citation alongside a valid current budget/profile.
  const fullTurn = fields.includes('primary_intent') && requests
  return { property, budget, quantity, requests, profile, fullTurn,
    semanticFields: [...new Set([
      ...(property || fields.includes('primary_intent') || issues.includes('inconsistent_primary_intent:budget')
        ? ['primary_intent', 'primary_evidence', 'confidence'] : []),
      ...(property ? ['property'] : []), ...(budget ? ['budget'] : []), ...(quantity ? ['housing_quantities'] : []),
    ])],
    rootFields: [...new Set([...(property ? ['preferred_category', 'declaration_evidence', 'unit_id', 'catalog_request', 'requests'] : []),
      ...(budget ? ['financing_amounts', 'qualification'] : []), ...(requests ? ['requests'] : []),
      ...(profile ? ['residence_city', 'residence_country', 'declared_location', 'profile_evidence'] : [])])],
  }
}

export function mergeInterpretationRepair(previous: Row, repaired: Row, issues: string[]): Row {
  const blocks = interpretationRepairBlocks(issues)
  if (blocks.fullTurn) return repaired
  const semantics = { ...object(previous.turn_semantics) }, incoming = object(repaired.turn_semantics)
  for (const field of blocks.semanticFields) if (Object.hasOwn(incoming, field)) semantics[field] = incoming[field]
  const result: Row = { ...previous, turn_semantics: semantics }
  for (const field of blocks.rootFields) {
    if (!Object.hasOwn(repaired, field)) continue
    if (field === 'qualification') {
      if (Object.hasOwn(object(repaired.qualification), 'presupuesto_texto')) result.qualification = {
        ...object(previous.qualification), presupuesto_texto: object(repaired.qualification).presupuesto_texto }
    } else if (field === 'declaration_evidence') result.declaration_evidence = { ...object(previous.declaration_evidence),
      preferred_category: object(repaired.declaration_evidence).preferred_category }
    else if (field === 'profile_evidence') result.profile_evidence = { ...object(previous.profile_evidence),
      residence_city: object(repaired.profile_evidence).residence_city,
      residence_country: object(repaired.profile_evidence).residence_country }
    else if (field === 'requests' && blocks.property && !blocks.requests) result.requests = [
      ...rows(previous.requests).filter(request => request.domain !== 'property'),
      ...rows(repaired.requests).filter(request => request.domain === 'property'),
    ]
    else result[field] = repaired[field]
  }
  return result
}


/** Repair-only source projection: preserve canonical values/referents and the
 * actual pending question, without inviting copies of old evidence excerpts. */
export function interpretationRepairContext(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(interpretationRepairContext)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:^|_)evidence$/.test(key)
    && !['content', 'reply', 'historial', 'historial_reciente'].includes(key))
    .map(([key, item]) => [key, interpretationRepairContext(item)]))
}

/** A failed property citation cannot erase an independently valid answer to a
 * known budget question. Isolation requires an explicit repair certification
 * and no independently evidenced property/action request. It never selects an
 * option or changes saved context; it removes only this turn's invalid delta. */
export function isolateHistoricalPropertyFromBudget(previous: Row, merged: Row, repaired: Row,
  current: string, knownBudgetQuestion: boolean, remaining: string[]): Row | null {
  if (!knownBudgetQuestion || !remaining.length || remaining.some(issue => issue !== 'non_current_evidence:property')) return null
  const certificate = object(repaired.property_turn_use)
  const grounded = (value: unknown) => !!text(value).trim() && matches(value, current)
  if (!['context_only', 'none'].includes(text(certificate.kind)) || certificate.confidence !== 'high'
    || !grounded(certificate.evidence)) return null
  const independentBudget = (raw: Row) => {
    const semantics = object(raw.turn_semantics), budget = object(semantics.budget)
    return semantics.primary_intent === 'discuss_budget' && semantics.confidence === 'high'
      && grounded(semantics.primary_evidence) && budget.confidence === 'high' && grounded(budget.evidence)
      && ['amount', 'maximum_total', 'initial_capital'].includes(text(budget.status))
      && budgetAmountWithLiteralQuantity(budget.amount, text(budget.evidence)) !== null
  }
  const compatibleRequests = (raw: Row, requireFinance: boolean) => {
    const requests = rows(raw.requests).filter(request => grounded(request.evidence))
    return (!requireFinance || requests.some(request => request.domain === 'financing' && request.confidence === 'high'))
      && requests.every(request => ['financing', 'courtesy'].includes(text(request.domain)) && request.confidence === 'high'
        && (!Array.isArray(request.topics) || request.topics.every(topic => topic === 'financing')))
  }
  if (!independentBudget(previous) || !independentBudget(merged)
    || !compatibleRequests(previous, true) || !compatibleRequests(merged, true) || !compatibleRequests(repaired, false)) return null
  const hasOtherCurrentClaim = (raw: Row) => {
    const semantics = object(raw.turn_semantics), property = object(semantics.property), catalog = object(raw.catalog_request)
    const answer = object(semantics.answer_to_previous), reservation = object(semantics.reservation)
    return ['requested_advisor', 'opt_out', 'consent_granted', 'financing_consent', 'visit_needs_help'].some(key => raw[key] === true)
      || !['', 'none'].includes(text(object(raw.visit_intent).kind))
      || !['', 'none'].includes(text(reservation.kind))
      || !['', 'none'].includes(text(object(raw.financing_partner_choice).kind))
      || !['', 'none'].includes(text(object(raw.material_request).kind))
      || object(raw.financing_quote).requested === true
      || (answer.kind && answer.kind !== 'none' && !text(answer.question_id).startsWith('budget_'))
      || rows(semantics.housing_quantities).some(quantity => grounded(quantity.evidence))
      || grounded(property.evidence) || Object.values(object(property.filter_evidence)).some(grounded)
      || grounded(object(raw.declaration_evidence).preferred_category) || grounded(catalog.evidence)
      || rows(catalog.requirements).some(requirement => grounded(requirement.evidence))
      || rows(catalog.semantic_preferences).some(preference => grounded(preference.evidence))
      || Object.entries(object(raw.qualification)).some(([key, value]) => key !== 'presupuesto_texto' && hasValue(value))
  }
  if (hasOtherCurrentClaim(previous) || hasOtherCurrentClaim(merged)) return null
  const semantics = object(merged.turn_semantics), property = object(semantics.property)
  const budget = object(object(previous.turn_semantics).budget)
  // A property-only recovery must retain the exact validated monetary block.
  if (JSON.stringify(budget) !== JSON.stringify(semantics.budget)) return null
  return { ...merged, preferred_category: null, unit_id: null,
    declaration_evidence: { ...object(merged.declaration_evidence), preferred_category: null },
    events: (Array.isArray(merged.events) ? merged.events : []).filter(event =>
      !['declared_unit_type', 'asked_location_features', 'asked_delivery_date', 'asked_price'].includes(text(event))),
    requests: rows(merged.requests).filter(request => grounded(request.evidence)),
    catalog_request: { purpose: 'none', metric: null, requirements: [], semantic_preferences: [], evidence: '', confidence: 'low' },
    turn_semantics: { ...semantics, property: { ...property, group: null, category: null, excluded_categories: [],
      operation: 'none', reference_kind: 'none', unit_numbers: [], selector: null, query_scope: null,
      filters: Object.fromEntries(Object.entries(object(property.filters)).map(([key, value]) => [key, Array.isArray(value) ? [] : null])),
      filter_evidence: Object.fromEntries(Object.keys(object(property.filter_evidence)).map(key => [key, ''])),
      evidence: '', confidence: 'low' } } }
}

export class TurnInterpretationError extends Error {
  constructor(public issues: string[]) { super('TURN_INTERPRETATION_INVALID') }
}

export const CURRENT_TURN_INTERPRETATION_RULE = `
FUENTE PRINCIPAL: interprete mensaje_actual completo, aunque contenga errores ortográficos, varias solicitudes o cantidades muy bajas. Recorra sus necesidades, composición familiar, presupuesto, preferencias y preguntas antes de responder. El historial solo resuelve referencias: nunca extraiga una pregunta histórica como solicitud nueva ni copie su evidencia. No convierta personas en dormitorios ni un importe bajo en miles de dólares. Una cifra no especificada como entrada o cuota no autoriza a asumir esa finalidad.
SITUACIONES PERSONALES: preserve las dudas sobre distribución, camas, otros muebles, circulación, mascotas y accesibilidad como solicitudes informativas con su referente vigente. Las implicaciones razonables orientan la respuesta; no declare una necesidad inferida como filtro, qualification, preferencia o requisito confirmado. Extraiga restricciones nuevas solo si el cliente las expresa. Una edad no prueba movilidad reducida, niños no determinan dormitorios y mencionar una mascota no confirma que el proyecto la admita. No convierta cantidades o medidas de objetos en personas o dormitorios. Responder una consulta intermedia requiere conservar la selección, las consultas pendientes y la pregunta comercial aún no contestada; la duda no es consentimiento para otra acción.
La clasificación de alcance recibida es provisional. Interprete de forma independiente las solicitudes actuales; una etiqueta incierta no vuelve desconocida una petición inmobiliaria explícita. No necesita el catálogo de precios para extraer el presupuesto del cliente. La evidencia conserva el texto original con sus errores; el valor estructurado expresa su significado. No corrija la ortografía de una cita.
USO RESIDENCIAL: una búsqueda de cuartos, habitaciones o dormitorios expresa vivienda: property.group=residential, sin elegir una tipología si no se indicó. Una categoría comercial del historial no debe mantenerse frente a esa necesidad actual. «Mínimo 3 cuartos» exige bedrooms >= 3; no necesita preguntar si habla de ambientes de un local. No confunda número de personas con dormitorios. Las plantas altas o superiores son una preferencia relativa: no invente floor_number=1 ni otra planta exacta; conserve esa preferencia en catalog_request.semantic_preferences. Un número de planta explícito sí permite un filtro numérico.
SEPARACIÓN ENTRE MEMORIA Y NOVEDADES: hechos_confirmados conserva declaraciones ya aceptadas. Su salida contiene únicamente novedades del mensaje actual; no reconstruya el perfil completo. Si un presupuesto conocido no se vuelve a declarar, budget.status=not_discussed, amount=null y evidence=""; esto significa «sin actualización», no que el sistema olvide el presupuesto. Lo mismo aplica a cantidades familiares, preferencias, qualification y perfil: sin declaración nueva, use el valor neutro del esquema. La memoria se conserva por separado. Si el cliente cambia, niega o precisa un dato, extraiga esa novedad con evidencia actual aunque contradiga la memoria. Una consulta de financiamiento puede continuar con datos conocidos sin volver a declararlos. Ninguna memoria autoriza una gestión o consentimiento nuevo.
REFERENTE DE PROPUESTAS: propuesta_pendiente distingue la necesidad original de las alternativas que el bot acaba de recomendar. Una consulta de precios, tamaños, características, cantidad o comparación sin un nuevo ámbito explícito se refiere a esas alternativas: use property.operation=details o compare, reference_kind=followup o comparison y query_scope=offered o comparison. No reconstruya requisitos originales incompatibles en catalog_request. Puede consultar una categoría de esa propuesta sin aceptar sustituir su necesidad ni elegir una unidad. Conserve el propósito informativo; solo una aceptación o negativa real responde al consentimiento pendiente. Una nueva búsqueda explícita o una consulta general de todo el catálogo sí tiene su propio ámbito.
`

export const QUANTITY_RECOVERY_RULES = `Corrija únicamente turn_semantics.housing_quantities con el esquema adjunto. La única fuente de cantidades es mensaje_actual; pregunta_pendiente solo permite interpretar una respuesta a esa pregunta. No recupere cantidades del historial, de las alternativas conocidas ni de una pregunta del bot que el cliente no está contestando.
Si el mensaje actual no declara ni evalúa personas/dormitorios, devuelva housing_quantities=[]. No cree objetos vacíos para completar dimensiones. Cada elemento activo requiere evidencia literal actual que conserve el contexto y la corrección; values=[] es válido si habla de una cantidad desconocida (por ejemplo una familia numerosa sin cifra).
dimension=people cuenta personas, bedrooms dormitorios, unknown conserva ambigüedad. role=requirement solicita una cantidad o restricción; evaluation pregunta si las opciones sirven o cómo funcionan; context describe la familia. Evaluar cuántos ocupantes caben no solicita otra búsqueda ni impone dormitorios. count_basis=total solo si incluye al hablante, excluding_speaker si explícitamente lo excluye, unspecified si no se sabe. Separe varias dimensiones sin convertir personas en dormitorios, sumar cifras que se solapen o inventar valores. Un sí a explorar opciones no declara de nuevo sus cantidades. Devuelva solo los campos solicitados, sin modificar otros datos o permisos.`

export const EXTRACTION_CONSISTENCY_RULES = `Antes de devolver el JSON, compruebe coherencia entre los bloques: housing_quantities=[] si el turno actual no menciona ni evalúa cantidades; un catálogo o una pregunta previa no son una declaración nueva. Una consulta sobre si un espacio sirve a una familia es evaluation y details, con referencia a las opciones actuales; no es precio salvo que también pregunte importes, ni convierte esa cantidad en un requisito de búsqueda. Una cifra deseada y el operador eq no significan rigidez: bedrooms_required=true necesita una declaración actual inequívoca de que no acepta otra cantidad. Ante flexibilidad expresa no use true; conserve la cantidad deseada sin sustituirla automáticamente. Ninguna respuesta a una alternativa inmobiliaria acepta una visita, entidad o trámite diferente. Las acciones negadas, hipotéticas, condicionadas o citadas como palabras de otra persona no son permisos actuales.
La intención principal debe describir la solicitud actual y ser coherente con los bloques activos; que una cita sea literal no demuestra que justifique esa intención. Un presupuesto guardado no convierte una respuesta de dormitorios, planta, tipo o unidad en discuss_budget. La pregunta pendiente vigente prevalece sobre el objetivo de un turno anterior. Si el mensaje también modifica o aclara presupuesto, entrada o crédito, preserve AMBAS solicitudes actuales; no borre una de ellas para imponer una intención única.`

export const BLOCK_RECOVERY_RULES = `Repare únicamente los bloques y campos que permite el esquema adjunto. mensaje_actual es la única fuente de novedades y de citas. El contexto confirmado solo resuelve referentes: una unidad seleccionada del historial NO es una selección actual ni aporta una cita nueva. Si el cliente únicamente aclara una cantidad, property usa operation=none, reference_kind=none, valores neutros y evidence=""; preserve la unidad conocida fuera de esa salida. No cambie permisos, perfil ni solicitudes de otros dominios.
Si el esquema incluye property_turn_use, certifique por separado si mensaje_actual solicita una acción o información inmobiliaria (current_request), si el inmueble es únicamente referente conocido de una respuesta monetaria (context_only), si no tiene uso (none), o si no puede decidirlo (uncertain). Cite literalmente el mensaje actual y no el historial; confidence expresa su certeza. Una solicitud inmobiliaria adicional, incluida una preferencia nueva, requiere current_request aunque también haya presupuesto. Este metadato no autoriza selecciones, cambios ni consentimiento.
Si el esquema incluye budget_turn_use, certifique si el mensaje actual declara, aclara, cambia, niega o retira presupuesto, entrada o crédito (current_update), si esos datos únicamente sirven de referencia conocida (context_only), si no tienen uso (none), o si no puede decidirlo (uncertain). Una aclaración sin cifra nueva sigue siendo current_update. Cite el mensaje actual y no una respuesta del bot. Para context_only o none use budget.status=not_discussed, amount=null, evidence="", financing_amounts=[] y qualification.presupuesto_texto=null; los fondos confirmados se conservan fuera de esa actualización. Si también se permite reparar la intención principal, haga que coincida con los bloques actuales que siguen válidos y la pregunta pendiente, sin inventar preferencias o permisos.
Si se solicita el bloque monetario, interprete el papel de cada importe, incluidos negaciones, dudas, autocorrecciones y aclaraciones de una cifra conocida. Devuelva budget y financing_amounts coherentes. Una entrada explícita es initial_capital y down_payment; el presupuesto total explícito es maximum_total y total_budget; un préstamo es loan y no un presupuesto. amount significa que el rol continúa realmente ambiguo. Una cita del mensaje actual puede conservar faltas de escritura, pero no puede sustituirse por una frase histórica o inventada. No complete importes desde una pregunta del bot ni otorgue consentimiento financiero. Devuelva los valores neutros del bloque que no está activo, en vez de fabricar acciones o evidencia.`
