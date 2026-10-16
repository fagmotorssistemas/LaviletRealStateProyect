import assert from 'node:assert/strict'
import test from 'node:test'
import { nutritionAnchorTime, nutritionContactPolicy, nutritionIntent } from './nutrition-intent'
import { nutritionMessage } from './nutrition-context'
import { weekOneChoice } from './nutrition-week-one-rules'
import { laterChoice } from './nutrition-later-rules'
import { nutritionWeekOneConfig, WEEK_ONE_FOLLOWUP_BODY } from '@/lib/inmobiliaria/nutritionWeekOne'
import { rememberLeadNurture } from './lead-nurture-state'

const config = { ...nutritionWeekOneConfig(null), enabled: true }
const options = { financing: true, visits: true }
const catalog = [{ id: 'u605', unit_number: '605', category: 'penthouse' }, { id: 'u602', unit_number: '602', category: 'penthouse' }]
const informational = { _interaction_mode: { mode: 'information_only' }, _turn_intent: { objective: 'project_information' } }
const noFinance = { _financing_journey: { status: 'declined', accepted: false } }
const message = (content: string) => [{ role: 'cliente', content }]

test('information-only mode survives financing/budget words and uses an informational template variable', () => {
  for (const input of ['El presupuesto lo veré después; por ahora solo quiero conocer el proyecto',
    'No quiero financiamiento, solo información', 'No quiero crédito, solo conocer el proyecto']) {
    const rendered = nutritionMessage({}, message(input), informational, catalog)
    assert.equal(rendered.context, 'project')
    const choice = weekOneChoice(config, {}, message(input), [], catalog, true, options, informational)!
    assert.equal(choice.action, 'project_questions')
    assert.equal(choice.body, WEEK_ONE_FOLLOWUP_BODY.replace('{{1}}', 'resolver sus dudas sobre el proyecto'))
    assert.equal(laterChoice(2, {}, message(input), [], ['JEP'], informational), null)
    assert.equal(laterChoice(3, {}, message(input), [], ['JEP'], informational), null)
  }
})

test('a financing refusal persists even if the last stored request was financing', () => {
  const summary = { ...noFinance, _turn_intent: { objective: 'ask_financing', requests: [{ domain: 'financing', topics: ['financing'] }] } }
  assert.equal(nutritionIntent({}, summary).financing, false)
  assert.notEqual(nutritionMessage({}, message('No quiero crédito'), summary, []).context, 'financing')
  assert.equal(weekOneChoice(config, {}, message('No quiero crédito'), [], [], true, options, summary), null)
  assert.notEqual(laterChoice(3, {}, message('No quiero crédito'), [], ['JEP'], summary)?.action, 'financing_options')
})

test('typed positive requests work without requiring any specific client wording', () => {
  const summary = { _turn_intent: { requests: [{ domain: 'financing', topics: ['monthly_payment'] }] } }
  for (const input of ['Sí, necesito orientación con eso', 'Me gustaría conocer las alternativas bancarias']) {
    assert.equal(nutritionMessage({}, message(input), summary, []).context, 'financing')
    assert.equal(weekOneChoice(config, {}, message(input), [], [], true, options, summary)?.action, 'financing_options')
  }
  assert.equal(weekOneChoice(config, {}, message('Financiamiento'), [], [], true, options), null,
    'Missing interpretation is not replaced by a new keyword classifier')
})

test('declined visits remain declined while other information remains available', () => {
  const summary = { _visit_dialogue: { status: 'declined' }, _turn_intent: { objective: 'request_visit' },
    _property_context: { selected_ids: ['u605'] } }
  assert.equal(nutritionIntent({}, summary).visits, false)
  const result = weekOneChoice(config, {}, message('No puedo ir'), [], catalog, true, options, summary)!
  assert.equal(result.action, 'unit_details:u605')
  assert.equal(result.topic, 'conocer la distribución del penthouse 605')
})

test('penthouse remains penthouse in unit details, comparison and 24h topic', () => {
  const lead = { preferred_category: 'penthouse' }
  const summary = { _property_context: { selected_ids: ['u605'] } }
  assert.match(nutritionMessage(lead, message('Gracias'), summary, catalog).topic, /penthouse 605/)
  assert.equal(weekOneChoice(config, lead, [], [], catalog, true, options, summary)?.topic, 'conocer la distribución del penthouse 605')
  assert.equal(weekOneChoice(config, lead, [], [], catalog, true, options)?.topic, 'comparar las opciones de penthouses disponibles')
})

test('informational price questions retain the informational mode without choosing financing', () => {
  const summary = { ...informational, _turn_intent: { objective: 'ask_price', requests: [{ domain: 'property', topics: ['purchase_price'] }] } }
  assert.equal(nutritionMessage({}, message('¿Cuánto cuesta?'), summary, catalog).context, 'price')
  assert.equal(nutritionIntent({}, summary).informational, true)
})

test('tracking consent never supplies future-contact permission or an invented date', () => {
  assert.equal(nutritionContactPolicy({ future_interest: true, tracking_consent: true, purchase_horizon: 'el próximo año' }).reason, 'future_contact_permission_required')
  assert.equal(nutritionContactPolicy({ future_interest: true, contact_consent: true, purchase_horizon: 'el próximo año' }).reason, 'future_contact_date_required')
  assert.equal(nutritionContactPolicy({ active: true, contact_consent: true, resume_at: 'el próximo año' }).reason, 'future_contact_date_required')
  assert.equal(nutritionContactPolicy({ contact_consent: false, contact_evidence: 'No me contacten' }).reason, 'contact_permission_declined')
  assert.deepEqual(nutritionContactPolicy({}), { reason: '', resumeAt: null })
})

test('a saved date governs the first follow-up and separates later contacts by seven days', () => {
  const anchor = Date.parse('2026-10-16T14:00:00Z'), resume = Date.parse('2027-01-04T15:00:00Z')
  const policy = nutritionContactPolicy({ active: true, contact_consent: true, resume_at: '2027-01-04T15:00:00Z' })
  assert.equal(policy.reason, '')
  for (const week of [1, 2, 3] as const) assert.equal(nutritionAnchorTime(anchor, policy.resumeAt, week), resume + (week - 1) * 7 * 86_400_000)
  assert.equal(nutritionAnchorTime(anchor, null, 1), anchor + 7 * 86_400_000)
})

test('a new horizon invalidates a formerly saved date and explicit resumption clears the pause date', () => {
  const previous = { active: true, future_interest: true, contact_consent: true, contact_evidence: 'Podemos seguir en contacto',
    evidence: 'Compraría el próximo año', purchase_horizon: 'el próximo año', resume_at: '2027-01-04T15:00:00Z' }
  const current = 'Prefiero comprar después de terminar mi contrato'
  const changed = rememberLeadNurture(previous, { decision: 'future_interest', evidence: current, purchase_horizon: 'después de terminar mi contrato',
    contact_permission: 'unchanged', contact_evidence: '', confidence: 'high' }, current, '2026-10-16T14:00:00Z')
  assert.equal(changed.resume_at, null)
  assert.equal(nutritionContactPolicy(changed).reason, 'future_contact_date_required')
  const resume = 'Quiero avanzar ahora en mi compra'
  const resumed = rememberLeadNurture(previous, { decision: 'resume_now', evidence: resume, purchase_horizon: '',
    contact_permission: 'unchanged', contact_evidence: '', confidence: 'high' }, resume, '2026-10-16T15:00:00Z')
  assert.equal(resumed.resume_at, null)
  assert.deepEqual(nutritionContactPolicy(resumed), { reason: '', resumeAt: null })
})
