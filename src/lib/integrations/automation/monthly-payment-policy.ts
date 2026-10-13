/** Owner-approved orientation; no hypothetical rate or term is configured. */
export const MONTHLY_PAYMENT_POLICY = {
  version: 'monthly-payment-orientation-v1',
  direct_project_credit: false,
  final_terms_authority: 'selected_lender',
  final_payment_authority: 'selected_lender',
  numeric_source: 'server_calculation_with_active_verified_terms',
  requires: ['selected_unit_and_authorized_price', 'financed_amount', 'verified_rate_and_rate_type', 'verified_applicable_term'],
  unknown_charges_are_zero: false,
  inquiry_starts_application: false,
  instruction: 'La Vilet no ofrece crédito directo. Puede orientar y preparar una estimación referencial del crédito de una entidad. La entidad financiera determina la aprobación, la tasa, el plazo, los cargos y la cuota definitiva según su evaluación. No atribuya al proyecto cuotas bancarias ni convenios no acreditados. No invente una tasa o plazo para completar una simulación. Use únicamente cálculos del servidor con condiciones activas y verificadas. Una cifra básica excluye seguros y cargos no configurados; nunca la presente como cuota final. Una tasa «desde» es una referencia condicionada, no una oferta aprobada. Si faltan datos, explique qué falta y continúe con el siguiente dato que pueda aportar el lead, sin repetir unidad, entrada o entidad conocidas. Los datos pendientes de la entidad se confirman con ella, no se exige que el lead los sepa. Consultar cuotas no autoriza iniciar una solicitud ni recopilar cédula, trabajo o ingresos.',
} as const

export const MONTHLY_PAYMENT_REPLY_RULES = MONTHLY_PAYMENT_POLICY.instruction
