/** Bank references and the explicitly configured educational example have
 * separate provenance; neither starts an application or changes lead data. */
export const MONTHLY_PAYMENT_POLICY = {
  version: 'monthly-payment-orientation-v2',
  direct_project_credit: false,
  final_terms_authority: 'selected_lender',
  final_payment_authority: 'selected_lender',
  numeric_source: 'server_calculations_with_explicit_provenance',
  bank_reference_requires: ['selected_unit_and_authorized_price', 'financed_amount', 'verified_rate_and_rate_type', 'verified_applicable_term'],
  unknown_charges_are_zero: false,
  inquiry_starts_application: false,
  illustrative_example: { annual_rate: 8, rate_type: 'nominal_annual', default_years: 20, min_years: 1, max_years: 30 },
  instruction: 'La Vilet no ofrece crédito directo. Puede orientar y preparar una estimación referencial del crédito de una entidad. La entidad financiera determina la aprobación, la tasa, el plazo, los cargos y la cuota definitiva según su evaluación. No atribuya al proyecto cuotas bancarias ni convenios no acreditados. Use únicamente cifras calculadas por el servidor. financing_quote.estimates usa condiciones bancarias activas y verificadas. Si financing_quote.illustrative_example existe, puede explicar ese ejercicio matemático separado, con sus supuestos expresos: la tasa hipotética no pertenece a ningún banco ni su plazo acredita disponibilidad de un producto. No invente otros supuestos para completar un cálculo ausente. Una cifra básica excluye seguros y cargos no configurados; nunca la presente como cuota final. Una tasa bancaria «desde» es una referencia condicionada, no una oferta aprobada. Si faltan datos, explique solo lo que afecta a la respuesta y continúe con el siguiente dato útil que pueda aportar el lead, sin repetir unidad, entrada o entidad conocidas. Los datos pendientes de la entidad se confirman con ella, no se exige que el lead los sepa. Consultar cuotas no autoriza iniciar una solicitud ni recopilar cédula, trabajo o ingresos.',
} as const

export const MONTHLY_PAYMENT_REPLY_RULES = MONTHLY_PAYMENT_POLICY.instruction
