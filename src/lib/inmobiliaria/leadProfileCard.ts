type Data = Record<string, unknown>
const row = (v: unknown): Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {}
const str = (v: unknown) => typeof v === 'string' ? v : ''
const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v) : ''
const display = (v: unknown): string => v == null || v === '' ? 'Sin confirmar' : Array.isArray(v) ? v.map(display).join(', ') : String(v)
export type LeadCardGroup = { title: string; fields: { label: string; value: string }[] }
export type LeadProfileCardData = { groups: LeadCardGroup[]; leadUpdatedAt: string; selectedUnitId: string | null; selectedUnitNumber: string | null; financingAccepted: boolean; review: Data }

export function parseLeadSummary(value: unknown): Data {
  if (typeof value !== 'string') return row(value)
  try { return row(JSON.parse(value)) } catch { return {} }
}

/** Read-only presentation: no inference from message text and no mixing old
 * conversations into a newly restarted lead. */
export function leadProfileCard(lead: Data, summary: Data, financing: Data, units: Data[]): LeadProfileCardData {
  const profile = row(summary._lead_profile), memory = row(summary._interpretation_memory)
  const context = row(summary._property_context), query = row(context.query), filters = row(query.filters)
  const budget = row(memory.budget), state = row(summary._commercial_journey), financeJourney = row(summary._financing_journey)
  const signals = row(lead.behavior_signals), qualification = { ...row(signals.sdr), ...row(memory.qualification) }
  const selectedIds = Array.isArray(context.selected_ids) ? context.selected_ids : lead.unit_id ? [lead.unit_id] : []
  const unit = selectedIds.length === 1 ? units.find(u => u.id === selectedIds[0]) : undefined
  const budgetLabels: Record<string, string> = { not_discussed: 'Todavía no preguntado / sin respuesta', amount_pending: 'Tiene presupuesto; falta el monto',
    no_defined_budget: 'No tiene presupuesto definido', unknown: 'Necesita aclaración', amount: 'Monto declarado; uso por aclarar',
    maximum_total: 'Límite total de compra', initial_capital: 'Capital para entrada', sufficient_for_selected_unit: 'Indica que alcanza para la unidad',
    insufficient_for_selected_unit: 'Indica que no alcanza para la unidad', declines_to_disclose: 'Prefiere no compartirlo' }
  const budgetStatus = str(budget.status) || (lead.budget || lead.budget_max ? 'amount' : 'not_discussed')
  const amount = Object.keys(budget).length ? budget.amount : lead.budget_max || lead.budget
  const quantity = (Array.isArray(memory.housing_quantities) ? memory.housing_quantities : []).map(row).find(q => q.dimension === 'people')
  const people = quantity && Array.isArray(quantity.values) ? quantity.values.map(n => Number(n) + (quantity.count_basis === 'excluding_speaker' ? 1 : 0)).join(' o ') : ''
  const fullName = financing.legal_name || row(summary._financing_identity).full_name
  const review = row(signals.financing_review)
  const amounts = row(summary._financing_amounts)
  const bedroomCondition: Record<string, string> = { eq: 'Exactamente', gte: 'Como mínimo', lte: 'Como máximo' }
  const fields = (values: [string, unknown][]) => values.map(([label, value]) => ({ label, value: display(value) }))
  const statuses: Record<string, string> = { offer_reservation: 'Puede iniciar solicitud de reserva', await_reservation: 'Evaluando la reserva',
    offer_visit: 'Invitación a oficina', leave_open: 'Evaluando su decisión', select_property: 'Selección de unidad',
    ask_budget: 'Presupuesto pendiente', introduction: 'Presentación', discover_use: 'Tipo de espacio', discover_purpose: 'Propósito',
    discover_bedrooms: 'Necesidades de vivienda', offer_financing: 'Orientación financiera', continue_financing: 'Recopilación financiera',
    current_operation: 'Gestión en curso', visit_pending: 'Coordinación de visita', clarify_purchase: 'Aclarar cómo desea continuar' }
  const purpose: Record<string, string> = { vivir: 'Vivir', invertir: 'Invertir', negocio: 'Negocio', segunda_vivienda: 'Segunda vivienda' }
  const financeStatus: Record<string, string> = { lista: 'Datos completos, pendiente de revisión', borrador: 'Recopilando datos', en_proceso: 'En proceso' }
  return { leadUpdatedAt: str(lead.updated_at), selectedUnitId: selectedIds.length === 1 ? str(selectedIds[0]) : null,
    selectedUnitNumber: str(unit?.unit_number) || null, financingAccepted: financeJourney.status !== 'declined' && (financeJourney.accepted === true || financing.explicit_consent === true), review,
    groups: [
      { title: 'Identificación y contacto', fields: fields([
        ['Nombre declarado', profile.name_status === 'confirmed' ? profile.full_name : 'Sin confirmar'], ['Nombre en CRM', lead.name],
        ['Nombre legal completo', fullName], ['Nombre legal confirmado', financing.legal_name_confirmed === true || row(summary._financing_identity).complete === true ? 'Sí' : 'Pendiente'],
        ['Residencia actual', [profile.residence_city, profile.residence_country].filter(Boolean).join(', ')],
        ['Teléfono', lead.phone], ['Correo', lead.email], ['Cédula', financing.national_id ? `••••••${str(financing.national_id).slice(-4)}` : null],
        ['Brochure', row(summary._lead_introduction).brochure_sent === true ? 'Enviado' : 'Pendiente'],
      ]) },
      { title: 'Qué busca', fields: fields([
        ['Propósito', purpose[str(lead.purchase_purpose)] || lead.purchase_purpose], ['Tipo de inmueble', query.category || lead.preferred_category || query.group],
        ['Personas', people], ['Dormitorios', qualification.dormitorios_texto || (Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.length ? filters.bedrooms_any : filters.bedrooms || lead.preferred_bedrooms)],
        ['Condición de dormitorios', bedroomCondition[str(filters.bedrooms_operator)] || filters.bedrooms_operator], ['Planta preferida', filters.floor_number],
        ['Superficie mínima (m²)', filters.min_area_m2], ['Superficie máxima (m²)', filters.max_area_m2],
        ['Requisitos', (Array.isArray(query.requirements) ? query.requirements : []).map(r => row(r).evidence || row(r).field).filter(Boolean).join('; ')],
        ['Prioridades', qualification.prioridad], ['Actividad comercial', qualification.actividad_comercial],
        ['Área buscada', qualification.area_buscada], ['Plazo de compra', qualification.plazo_compra],
        ['Unidad elegida', unit ? `${display(unit.category)} ${display(unit.unit_number)}` : selectedIds.length ? 'Unidad elegida sin ficha disponible' : 'Todavía no elegida'],
        ['Alternativas consideradas', units.filter(u => [...(Array.isArray(context.offered_ids) ? context.offered_ids : []), ...(Array.isArray(context.comparison_ids) ? context.comparison_ids : [])].includes(u.id)).map(u => u.unit_number).join(', ')],
      ]) },
      { title: 'Presupuesto y financiamiento', fields: fields([
        ['Situación del presupuesto', budgetLabels[budgetStatus] || budgetStatus], ['Monto', money(amount)], ['Declaración del cliente', budget.evidence],
        ['Entrada propuesta', money(row(amounts.down_payment).amount)], ['Crédito solicitado', money(row(amounts.loan).amount)],
        ['Financiamiento', financeJourney.status === 'declined' ? 'No desea continuar' : financeJourney.accepted === true || financing.explicit_consent === true ? 'Aceptó continuar' : 'Sin aceptación'],
        ['Entidad elegida', financing.selected_partner_name], ['Estado de recopilación', financeStatus[str(financing.status)] || financing.status],
        ['Situación laboral', financing.applicant_type === 'empleado' ? 'Dependiente' : financing.applicant_type === 'independiente' ? 'Independiente' : financing.applicant_type],
        ['Cargo', financing.job_title], ['Antigüedad laboral (meses)', financing.employment_stability_months], ['Ingreso mensual', money(financing.monthly_income)],
        ['Resultado de revisión', review.result === 'favorable' ? 'Favorable registrado por el equipo' : review.result === 'pending' ? 'Pendiente' : review.result === 'unfavorable' ? 'No favorable' : 'Sin revisión registrada'],
        ['Aporte revisado', money(review.own_funds)], ['Financiamiento revisado', money(review.financing_amount)],
      ]) },
      { title: 'Seguimiento', fields: fields([
        ['Etapa actual', statuses[str(state.stage)] || 'Sin siguiente paso registrado'], ['Siguiente paso', state.next_step],
        ['Reserva de la unidad elegida', (Array.isArray(state.reservation_declined_ids) ? state.reservation_declined_ids : []).includes(selectedIds[0]) ? 'No desea avanzar por ahora' : (Array.isArray(state.reservation_offered_ids) ? state.reservation_offered_ids : []).includes(selectedIds[0]) ? 'Ofrecida' : 'No ofrecida'],
        ['Visita', state.visit_declined === true || row(summary._sales_memory).visit_declined === true ? 'Declinada por ahora' : state.visit_offered === true || row(summary._sales_memory).visit_invited === true ? 'Ofrecida; consulte la pestaña Visitas para el estado de la cita' : 'No ofrecida'],
      ]) },
    ] }
}
