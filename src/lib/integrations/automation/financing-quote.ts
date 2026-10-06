import { calculateMonthlyPayment, round2 } from '@/lib/financing/calculator'
import { currentGuidanceSource, type FinancingGuidance } from '@/lib/inmobiliaria/financingGuidance'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { selectedFinancingUnit } from './financing-stage'

export const FINANCING_QUOTE_SCHEMA = { type: 'object', additionalProperties: false,
  properties: { requested: { type: 'boolean' }, before_application: { type: 'boolean' }, evidence: { type: 'string' },
    years: { type: ['number', 'null'] }, years_evidence: { type: 'string' } },
  required: ['requested', 'before_application', 'evidence', 'years', 'years_evidence'] }
export const FINANCING_QUOTE_EXTRACTION_RULES = `financing_quote identifica consultas informativas sobre entrada, cuota, tasa, porcentaje financiable o plazo, incluso sin signos de pregunta y con faltas de escritura. requested=true exige evidence literal actual. before_application=true cuando quiere conocer cifras antes de decidir o solo pide orientación; un «sí me interesa saber más» no inicia revisión. En ese caso financing_consent=null. Si autoriza explícitamente iniciar la evaluación y además pide cifras, before_application=false. years es el plazo pedido, solo con years_evidence literal actual; no infiera un plazo desde edad, antigüedad laboral ni valores monetarios. Preguntar por JEP no elige JEP; «prefiero JEP» sí conserva la elección.`

export type FinancingInquiry = { requested: boolean; beforeApplication: boolean; evidence: string; years: number | null }
export function financingQuoteInquiry(extracted: Row, current: string): FinancingInquiry {
  const raw = object(extracted.financing_quote), message = normalized(current)
  const literal = (value: unknown) => !!text(value).trim() && current.normalize('NFKC').toLowerCase().includes(text(value).trim().normalize('NFKC').toLowerCase())
  const grounded = raw.requested === true && literal(raw.evidence)
  // Compatibility with existing extractors: a question/request, never a declared contribution.
  const fallback = /\b(?:entrada|cuotas?|tasa|porcentaje|plazo|mensualidad)\b/.test(message)
    && /\b(?:cuanto|cual|como|aproximad\w*|estimad\w*|quisiera saber|quiero saber|puede indicar|podria indicar|me informa|necesito saber)\b/.test(message)
  const requested = grounded || fallback
  const explicitStart = /\b(?:autorizo|iniciemos|inicien|empecemos)\b[^.!?]{0,55}\b(?:evaluacion|revision|solicitud|tramite)\b/.test(message)
    || /\bquiero (?:iniciar|empezar) (?:la |mi |una )?(?:evaluacion|revision|solicitud|tramite)\b/.test(message)
  const asksFirst = /\b(?:antes de|primero (?:quiero|quisiera|necesito|deseo)|solo (?:quiero|quisiera|necesito|deseo))\b/.test(message)
  const beforeApplication = requested && (asksFirst || !explicitStart)
  const duration = normalized(text(raw.years_evidence)).match(/\b(\d+(?:[.,]\d+)?)\s*(anos?|meses?)\b/)
  const durationYears = duration ? Number(duration[1].replace(',', '.')) / (duration[2].startsWith('mes') ? 12 : 1) : null
  const years = grounded && typeof raw.years === 'number' && Number.isFinite(raw.years) && raw.years > 0 && raw.years <= 50
    && literal(raw.years_evidence) && durationYears !== null && Math.abs(raw.years - durationYears) < 0.001 ? raw.years : null
  return { requested, beforeApplication, evidence: grounded ? text(raw.evidence) : requested ? current : '', years }
}

/** Paused, expired and non-project lender terms never enter model context. */
export function financingPolicyContext(settings: FinancingGuidance, partners: string[], today?: string) {
  const alias = (value: string) => normalized(value).replace(/^(?:banco|cooperativa)\s+/, '')
  const current = (source: Parameters<typeof currentGuidanceSource>[0]) => currentGuidanceSource(source, today)
  return { enabled: settings.enabled, estimatesEnabled: settings.enabled && settings.estimatesEnabled,
    entry: settings.enabled && settings.entry.enabled && settings.entry.requirement !== 'unconfirmed' && current(settings.entry)
      ? { ...settings.entry, value: settings.entry.requirement === 'not_required' ? null : settings.entry.value } : null,
    reservation: settings.enabled && settings.reservation.enabled && settings.reservation.requirement !== 'unconfirmed' && current(settings.reservation)
      ? { ...settings.reservation, amount: settings.reservation.requirement === 'not_required' ? null : settings.reservation.amount } : null,
    lenders: settings.enabled ? settings.lenders.filter(l => l.enabled && current(l) && partners.some(p => alias(p) === l.id)) : [],
    instruction: 'Solo estas condiciones activas son fuente de cifras financieras. null significa pendiente de confirmar, nunca cero ni ausencia de requisito. Respete categorías, unidades, etapa y elegibilidad de cada producto; si aún falta la unidad no afirme que una regla limitada ya aplica. La entrada del proyecto y la aportación propia del banco son condiciones distintas; pueden coexistir. Referencias públicas sujetas a evaluación, no convenios ni aprobación. Las condiciones actuales reemplazan cifras históricas de este tema.' }
}
export type ActiveFinancingPolicy = ReturnType<typeof financingPolicyContext>

/** Server arithmetic only, based on a published price and the actual selected unit. */
export function financingQuoteContext(info: Row, inquiry: FinancingInquiry): Row {
  const policy = object(object(info.politica_financiera).guidance) as Partial<ActiveFinancingPolicy>
  const unit = selectedFinancingUnit(info)
  const price = unit?.published_commercial_price
  const discount = object(unit?.early_purchase_discount)
  const discountPending = discount.status === 'conditional' && discount.condition_met !== true
  const priced = object(info.politica_comercial).precios_autorizados === true && typeof price === 'number' && Number.isFinite(price) && price > 0
  const entry = policy.entry
  const category = text(unit?.category)
  const entryApplies = !!unit && !!entry && entry.categories.includes(category)
    && (!entry.unitNumbers.length || entry.unitNumbers.includes(text(unit.unit_number)))
    && (entry.mode === 'todos' || entry.mode === info.modo_comercial)
  const projectMinimum = !entryApplies || !priced ? null : entry!.requirement === 'not_required' ? 0
    : entry!.value === null ? null : entry!.kind === 'percent' ? round2(price * entry!.value / 100) : entry!.value
  const proposed = object(info.financing_amounts)
  const down = object(proposed.down_payment).amount, loan = object(proposed.loan).amount
  const hasProposal = typeof down === 'number' || typeof loan === 'number'
  const estimates = !inquiry.requested || !policy.estimatesEnabled || !unit || !priced ? [] : (policy.lenders || []).filter(l => l.categories.includes(category)).map(lender => {
    const cap = lender.purchasePercent === null ? null : round2(Math.min(price * lender.purchasePercent / 100, lender.maxAmount ?? Infinity))
    const bankOwn = cap === null ? null : round2(price - cap)
    const minimumOwn = bankOwn === null ? null : Math.max(bankOwn, projectMinimum ?? 0)
    const proposedDown = typeof down === 'number' ? down : typeof loan === 'number' ? round2(price - loan) : null
    const proposedLoan = typeof loan === 'number' ? loan : typeof down === 'number' ? round2(price - down) : null
    const contribution = hasProposal ? proposedDown : minimumOwn
    const principal = hasProposal ? proposedLoan : minimumOwn === null ? null : round2(price - minimumOwn)
    const mismatch = hasProposal && proposedDown !== null && proposedLoan !== null && Math.abs(round2(price - proposedDown - proposedLoan)) > 0.01
    const issues: string[] = []
    if (cap === null) issues.push('porcentaje_financiable_sin_confirmar')
    if (projectMinimum === null) issues.push('entrada_del_proyecto_sin_confirmar_para_esta_unidad')
    if (lender.maxAmount === null) issues.push('limite_absoluto_del_prestamo_sin_confirmar')
    if (mismatch) issues.push('entrada_y_prestamo_no_cubren_el_precio')
    if (principal !== null && (principal < 0 || principal > price || cap !== null && principal > cap)) issues.push('prestamo_fuera_de_limites_publicados')
    if (contribution !== null && (contribution < 0 || contribution > price || projectMinimum !== null && contribution < projectMinimum)) issues.push('aportacion_fuera_de_condiciones')
    const years = inquiry.years ?? lender.exampleYears
    const termOK = years !== null && lender.minYears !== null && lender.maxYears !== null && years >= lender.minYears && years <= lender.maxYears
    if (!termOK) issues.push('plazo_sin_confirmar_o_fuera_de_limites')
    if (lender.annualRate === null || lender.rateType === 'unconfirmed') issues.push('tasa_o_tipo_de_tasa_sin_confirmar')
    const validProposal = !mismatch && !issues.includes('prestamo_fuera_de_limites_publicados') && !issues.includes('aportacion_fuera_de_condiciones')
    const monthly = termOK && validProposal && principal !== null && principal > 0 && cap !== null && lender.annualRate !== null && lender.rateType !== 'unconfirmed'
      ? calculateMonthlyPayment(principal, lender.annualRate, years!, lender.rateType) : null
    return { entity: lender.name, product: lender.product, unit_id: unit.id, unit_number: unit.unit_number,
      price, maximum_loan_reference: cap, own_funds_from_lender: bankOwn, project_entry: projectMinimum,
      pricing_basis: discountPending ? 'catalog_price_pending_discount' : 'current_authorized_price',
      contribution_reference: contribution, loan_reference: principal, uses_customer_proposal: hasProposal,
      years: termOK ? years : null, annual_rate: lender.annualRate, rate_type: lender.rateType, rate_qualification: lender.rateQualification,
      basic_monthly_payment: monthly, monthly_payment_with_known_charges: monthly !== null && lender.monthlyCharges !== null ? round2(monthly + lender.monthlyCharges) : null,
      issues, source: lender.source, checkedOn: lender.checkedOn,
      assumptions: 'Orientativo y sujeto a evaluación; porcentaje sobre precio publicado, no avalúo bancario. Cuota básica sin gracia, gastos financiados ni cargos desconocidos. No acredita capacidad de pago ni habilita reserva. Un presupuesto total no se convierte en entrada. La reserva no se descuenta sin un pago verificado.' }
  })
  return { requested: inquiry.requested, orientation_only: inquiry.beforeApplication, selected_unit_id: unit?.id || null,
    selected_unit_number: unit?.unit_number || null, project_entry_applies: entryApplies,
    project_entry_reference: policy.estimatesEnabled && priced ? projectMinimum : null,
    estimates, status: !policy.enabled ? 'conditions_disabled' : !policy.estimatesEnabled ? 'estimates_disabled'
      : !unit ? 'needs_unit' : !priced ? 'price_not_authorized' : 'reference',
    ...(discountPending ? { pending_discount: discount,
      discount_instruction: 'Las cifras financieras usan el precio publicado, no el descuento condicionado. Su cumplimiento comercial no está verificado. No reste el descuento ni el monto de reserva de la entrada o del préstamo por iniciativa propia, ni convierta esa referencia en aprobación bancaria.' } : {}),
    instruction: inquiry.beforeApplication
      ? 'Responda las cifras disponibles y sus límites; no inicie recopilación ni repita la invitación al trámite. Use la entidad elegida si existe; preguntar por otra no cambia esa elección.'
      : 'Estas cifras orientan, no aprueban crédito. Respete la acción que el cliente autorizó y las condiciones pendientes.' }
}

export const FINANCING_QUOTE_REPLY_RULES = `Atienda primero la duda concreta sobre entrada o cuotas con politica_financiera.guidance y financing_quote; no repita únicamente los pasos del trámite. Cifre solo los cálculos del servidor. No use el porcentaje que incluye gastos como porcentaje del precio. Nunca diga que no se exige entrada porque la regla esté apagada, sin confirmar, vencida o fuera de su alcance. Tampoco atribuya toda entrada al banco cuando exista una exigencia propia del proyecto. Si no hay fuente activa, diga que falta confirmar ese dato, sin inventarlo ni rescatar cifras del historial. Explique las limitaciones que afectan la cifra; no prometa una cuota final. Una referencia «desde» no es tasa aprobada. La cuota básica no incluye gracia ni gastos no configurados. Con orientation_only=true, responda lo que ya se conoce antes de ofrecer iniciar evaluación: no pida cédula ni empleo, no repita la invitación al trámite y no derive automáticamente por faltar una tasa o plazo. Si falta unidad, ayude a elegirla para calcular una referencia con las preferencias conocidas. Si falta plazo o tipo de tasa, explique exactamente qué impide calcular la cuota; puede terminar sin otra pregunta. Respete una solicitud explícita de asesor por su ruta propia.`
