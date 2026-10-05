import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultFinancingGuidance, validateFinancingGuidance, changeFinancingGuidance, financingGuidanceSettings } from '@/lib/inmobiliaria/financingGuidance'
import { financingQuoteInquiry, financingPolicyContext, financingQuoteContext } from './financing-quote'
import { financingInputs } from './financing'
import { commercialJourneyPlan } from './commercial-journey'
import { verifiedClaimSources } from './turn-evidence'
import { assessMissingFacts } from './coverage-evidence'
import { calculateMonthlyPayment } from '@/lib/financing/calculator'
import { completeTurnReply } from './turn-completeness'
import { object, type Row } from './data'

const today = '2026-10-05', partners = ['Cooperativa JEP', 'Banco Pichincha']
const inquiry = { requested: true, beforeApplication: true, evidence: '¿Cuánto sería la entrada y la cuota?', years: null }
const unit = { id: 'u502', unit_number: '502', category: 'departamento', published_commercial_price: 310000, is_published: true, status: 'disponible' }
const source = { source: 'Condiciones autorizadas del proyecto', checkedOn: today, reviewBy: '2026-11-05' }
function fixture(settings = defaultFinancingGuidance()) {
  return { catalogo: [unit], property_context: { selected_ids: ['u502'] }, modo_comercial: 'lanzamiento',
    politica_comercial: { precios_autorizados: true }, financiamiento: { partners, current: {} },
    politica_financiera: { guidance: financingPolicyContext(settings, partners, today) } }
}

test('JEP applies both 70% and the $150k cap; unverified term does not produce a monthly payment', () => {
  const context = financingQuoteContext(fixture(), inquiry)
  const jep = context.estimates[0]
  assert.equal(jep.maximum_loan_reference, 150000)
  assert.equal(jep.own_funds_from_lender, 160000)
  assert.equal(jep.project_entry, null)
  assert.equal(jep.contribution_reference, 160000)
  assert.equal(jep.basic_monthly_payment, null)
  assert.ok(jep.issues.includes('plazo_sin_confirmar_o_fuera_de_limites'))
})

test('Pichincha uses 80% purchase coverage instead of 83% including expenses; no guessed rate type', () => {
  const pichincha = financingQuoteContext(fixture(), { ...inquiry, years: 20 }).estimates[1]
  assert.equal(pichincha.maximum_loan_reference, 248000)
  assert.equal(pichincha.own_funds_from_lender, 62000)
  assert.equal(pichincha.basic_monthly_payment, null)
  assert.ok(pichincha.issues.includes('tasa_o_tipo_de_tasa_sin_confirmar'))
  assert.ok(pichincha.issues.includes('limite_absoluto_del_prestamo_sin_confirmar'))
})

test('project and lender contributions use the greater requirement, never their sum; reservation is not deducted without payment', () => {
  const settings = defaultFinancingGuidance()
  settings.entry = { ...settings.entry, ...source, requirement: 'required', kind: 'percent', value: 60, due: 'Al firmar' }
  settings.reservation = { ...settings.reservation, ...source, enabled: true, requirement: 'required', amount: 5000, conditions: 'A la firma', creditedToEntry: true }
  const jep = financingQuoteContext(fixture(settings), inquiry).estimates[0]
  assert.equal(jep.project_entry, 186000)
  assert.equal(jep.contribution_reference, 186000)
  assert.equal(jep.loan_reference, 124000)
})

test('no project entry does not mean no borrower contribution; wrong category/unit/stage cannot inherit entry', () => {
  const settings = defaultFinancingGuidance()
  settings.entry = { ...settings.entry, ...source, requirement: 'not_required', value: 50 }
  assert.equal(financingQuoteContext(fixture(settings), inquiry).estimates[0].project_entry, 0)
  assert.equal(financingQuoteContext(fixture(settings), inquiry).estimates[0].contribution_reference, 160000)
  for (const scope of [{ categories: ['local'] }, { unitNumbers: ['601'] }, { mode: 'preventa' as const }]) {
    const scoped = structuredClone(settings)
    Object.assign(scoped.entry, scope)
    const result = financingQuoteContext(fixture(scoped), inquiry)
    assert.equal(result.project_entry_applies, false)
    assert.equal(result.estimates[0].project_entry, null)
  }
})

test('global/lender/source switches filter facts themselves; paused and expired values cannot reach the writer', () => {
  const settings = defaultFinancingGuidance()
  settings.entry = { ...settings.entry, ...source, requirement: 'required', value: 30, due: 'Al firmar' }
  settings.enabled = false
  assert.deepEqual(financingPolicyContext(settings, partners, today).lenders, [])
  assert.equal(financingPolicyContext(settings, partners, today).entry, null)
  settings.enabled = true; settings.lenders[0].enabled = false
  assert.deepEqual(financingPolicyContext(settings, partners, today).lenders.map(l => l.id), ['pichincha'])
  assert.deepEqual(financingPolicyContext(settings, [], today).lenders, [])
  assert.deepEqual(financingPolicyContext(settings, partners, '2026-11-06').lenders, [])
  assert.equal(financingPolicyContext(settings, partners, '2026-11-06').entry, null)
})

test('calculation switch keeps terms readable but suppresses computed amounts; no invented unit or hidden price', () => {
  const settings = defaultFinancingGuidance(); settings.estimatesEnabled = false
  const info = fixture(settings)
  assert.equal(info.politica_financiera.guidance.lenders.length, 2)
  assert.deepEqual(financingQuoteContext(info, inquiry).estimates, [])
  assert.equal(financingQuoteContext(info, inquiry).project_entry_reference, null)
  assert.equal(financingQuoteContext({ ...fixture(), property_context: { selected_ids: [] } }, inquiry).status, 'needs_unit')
  assert.deepEqual(financingQuoteContext({ ...fixture(), politica_comercial: { precios_autorizados: false } }, inquiry).estimates, [])
  assert.deepEqual(financingQuoteContext({ ...fixture(), catalogo: [{ ...unit, status: 'vendido' }] }, inquiry).estimates, [])
  assert.deepEqual(financingQuoteContext({ ...fixture(), catalogo: [{ ...unit, category: 'local' }] }, inquiry).estimates, [])
})

test('quote preserves the proposed down payment and loan, flags shortfall and cap violations, and never converts budget into entry', () => {
  const info = fixture()
  const mismatch = financingQuoteContext({ ...info, financing_amounts: { down_payment: { amount: 200000 }, loan: { amount: 100000 } } }, inquiry)
  assert.equal(mismatch.estimates[0].loan_reference, 100000)
  assert.equal(mismatch.estimates[0].contribution_reference, 200000)
  assert.ok(mismatch.estimates[0].issues.includes('entrada_y_prestamo_no_cubren_el_precio'))
  const beyond = financingQuoteContext({ ...info, financing_amounts: { down_payment: { amount: 50000 } } }, inquiry)
  assert.equal(beyond.estimates[0].loan_reference, 260000)
  assert.ok(beyond.estimates[0].issues.includes('prestamo_fuera_de_limites_publicados'))
  assert.equal(financingQuoteContext({ ...info, financing_amounts: { total_budget: { amount: 50000 } } }, inquiry).estimates[0].contribution_reference, 160000)
})

test('configured and requested terms yield deterministic basic payments, with zero rates distinct from unknown', () => {
  const settings = defaultFinancingGuidance()
  Object.assign(settings.lenders[0], { minYears: 5, maxYears: 20, exampleYears: 10, monthlyCharges: 15 })
  const quote = financingQuoteContext(fixture(settings), inquiry).estimates[0]
  assert.equal(quote.basic_monthly_payment, calculateMonthlyPayment(150000, 9.74, 10, 'nominal_annual'))
  assert.equal(quote.monthly_payment_with_known_charges, Math.round((quote.basic_monthly_payment + 15) * 100) / 100)
  assert.equal(financingQuoteContext(fixture(settings), { ...inquiry, years: 25 }).estimates[0].basic_monthly_payment, null)
  settings.lenders[0].annualRate = 0
  assert.equal(financingQuoteContext(fixture(settings), inquiry).estimates[0].basic_monthly_payment, 1250)
  settings.lenders[0].annualRate = null
  assert.equal(financingQuoteContext(fixture(settings), inquiry).estimates[0].basic_monthly_payment, null)
})

test('the reported informational yes cannot become credit consent or a new lender choice', () => {
  const current = 'Muchas gracias, Sí me interesa conocer un poco más. Antes de avanzar con el financiamiento, quisiera saber aproximadamente cuánto sería la entrada y cuánto quedarían las cuotas mensuales.'
  const extracted = { financing_consent: true, financing_partner: 'Cooperativa JEP',
    turn_semantics: { primary_intent: 'ask_financing', confidence: 'high', answer_to_previous: { question_id: 'financing_invitation', kind: 'affirmative', confidence: 'high' } } }
  assert.equal(financingQuoteInquiry(extracted, current).beforeApplication, true)
  const input = financingInputs(extracted, current, '¿Desea continuar con el proceso de financiamiento?', { partners, current: { selected_partner_name: 'Cooperativa JEP' } })
  assert.equal(input.consent, null)
  assert.equal(input.partner, null)
  assert.equal(financingQuoteInquiry({}, 'Puedo aportar una entrada de 200 mil').requested, false)
  assert.equal(financingQuoteInquiry({}, 'Quiero iniciar la evaluación con JEP y saber cuánto sería la cuota').beforeApplication, false)
  assert.equal(financingInputs({}, 'prefiero jep', '', { partners, current: {} }).partner, 'Cooperativa JEP')
})

test('semantic quote interpretation supports different wording, but stale evidence and inconsistent month conversion are rejected', () => {
  const current = 'Me explicas lo que tendría que poner yo y lo que iría pagando cada mes a 120 meses'
  const raw = { requested: true, before_application: true, evidence: current, years: 10, years_evidence: '120 meses' }
  assert.equal(financingQuoteInquiry({ financing_quote: raw }, current).years, 10)
  assert.equal(financingQuoteInquiry({ financing_quote: { ...raw, years: 20 } }, current).years, null)
  assert.equal(financingQuoteInquiry({ financing_quote: raw }, 'prefiero jep').requested, false)
})

test('orientation supersedes repeated credit invitations and uses server estimates as auditable facts', () => {
  const info = { ...fixture(), financing_quote: financingQuoteContext(fixture(), inquiry), recorrido_comercial: {} }
  assert.equal(commercialJourneyPlan(info).action, 'financing_orientation')
  const sources = verifiedClaimSources(info, {}, { units: [unit], groups: [] })
  assert.ok(sources.some(s => s.path === 'contexto_verificado.financing_quote.estimates'))
  const fragment = inquiry.evidence
  const assessment = assessMissingFacts([fragment, '¿Cuánto cuesta la alícuota?'], { financing_orientation_fragments: [fragment] })
  assert.deepEqual(assessment.unresolved, ['¿Cuánto cuesta la alícuota?'])
})

test('saved settings round trip without overwriting review and business policies; malformed data cannot reactivate defaults', () => {
  const draft = defaultFinancingGuidance()
  const policies = changeFinancingGuidance({ response_review: { enabled: false }, other: { keep: true } }, draft, 'admin', today)
  assert.deepEqual(financingGuidanceSettings(policies), draft)
  assert.deepEqual(policies.response_review, { enabled: false })
  assert.deepEqual(policies.other, { keep: true })
  assert.equal(financingGuidanceSettings({ financing_guidance: { enabled: 'false' } }).enabled, false)
  for (const mutate of [
    (d: typeof draft) => { d.entry.enabled = 'false' as unknown as boolean },
    (d: typeof draft) => { d.entry.requirement = 'required' },
    (d: typeof draft) => { d.lenders[0].purchasePercent = 101 },
    (d: typeof draft) => { d.lenders[0].annualRate = Number.NaN },
    (d: typeof draft) => { d.lenders[0].exampleYears = 10 },
    (d: typeof draft) => { d.lenders[0].reviewBy = '2020-01-01' },
  ]) { const bad = structuredClone(draft); mutate(bad); assert.throws(() => validateFinancingGuidance(bad)) }
})

test('writer and reviewer receive the same current quote and orientation step with optimized context enabled', async () => {
  const info = { ...fixture(), financing_quote: financingQuoteContext(fixture(), inquiry), recorrido_comercial: {}, catalog_search: { embeddingsEnabled: true },
    solicitudes_interpretadas: [{ domain: 'financing', request: 'Conocer entrada y cuota', evidence: inquiry.evidence, confidence: 'high' }] }
  const reply = 'Como referencia para esta unidad de $310.000, JEP publica un límite de crédito de $150.000: la diferencia sería $160.000 de recursos propios. Esto está sujeto a evaluación y falta confirmar la entrada del proyecto. Aún falta verificar el plazo para calcular una cuota básica.'
  const calls: string[] = [], errors: string[] = []
  const result = await completeTurnReply({ current: inquiry.evidence, baseReply: reply, verified: info,
    audit: { source: 'financing_question', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, raw, _schema, _image, _file, _tone, task) => {
    calls.push(String(task))
    try {
      const input = object(raw)
      const quote = object(task === 'writing' ? object(input.contexto_verificado).financing_quote : object(input.fuentes_autorizadas).orientacion_financiera)
      assert.equal(quote.orientation_only, true)
      assert.equal((quote.estimates as Row[])[0].maximum_loan_reference, 150000)
      assert.equal((input.obligaciones_del_turno as Row[]).find(o => o.id === 'commercial_next_step')?.action, 'financing_orientation')
      if (task === 'writing') return { reply, requests: [{ fragment: 'R1', status: 'answered', intent: 'Entrada y cuota', evidence: reply, fact_key: 'policy', request_type: 'general_information' }],
        question: { role: 'none', purpose: 'none', missing_datum: '', next_decision: '' } }
      return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
    } catch (error) { errors.push(String(error)); throw error }
  })
  assert.deepEqual(errors, [])
  assert.equal(result.audit.status, 'checked')
  assert.deepEqual(calls, ['writing', 'review'])
})
