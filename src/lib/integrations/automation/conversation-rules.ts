import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
const events = new Set(['declared_unit_type', 'declared_purchase_purpose', 'asked_location_features', 'asked_delivery_date',
  'asked_price', 'asked_financing', 'requested_visit', 'asked_reservation', 'nutrition_response'])
export function normalizeEvents(raw: unknown, message: string): Row {
  const data = object(raw)
  const nullableText = (key: string) => text(data[key]).trim() || null
  const positive = (key: string) => typeof data[key] === 'number' && Number.isFinite(data[key]) && Number(data[key]) >= 0 ? data[key] : null
  const chosenEvents = [...new Set(['first_response', ...(Array.isArray(data.events) ? data.events.filter(e => typeof e === 'string' && events.has(e)) : [])])]
  const digitsInMessage = message.replace(/[\s-]/g, '')
  const nationalId = text(data.national_id).replace(/\D/g, '')
  const ruc = text(data.ruc).replace(/\D/g, '')
  const evidence = object(data.declaration_evidence)
  const supported = (key: string) => {
    const quote = normalized(text(evidence[key]))
    return quote.length > 0 && quote.length <= 180 && normalized(message).includes(quote)
  }
  const category = supported('preferred_category') && ['departamento', 'suite', 'local'].includes(text(data.preferred_category)) ? data.preferred_category : null
  const purpose = supported('purchase_purpose') && ['vivir', 'invertir', 'segunda_vivienda', 'negocio'].includes(text(data.purchase_purpose)) ? data.purchase_purpose : null
  return {
    events: chosenEvents.filter(e => (e !== 'declared_unit_type' || category) && (e !== 'declared_purchase_purpose' || purpose)),
    preferred_category: category,
    qualification: object(data.qualification),
    purchase_purpose: purpose,
    unit_id: /^[a-f0-9-]{36}$/i.test(text(data.unit_id)) ? data.unit_id : null,
    preferred_visit_time_text: nullableText('preferred_visit_time_text'),
    visit_needs_help: data.visit_needs_help === true,
    tracking_consent: data.consent_granted === true || data.tracking_consent === true,
    opt_out: data.opt_out === true,
    requested_advisor: data.requested_advisor === true,
    financing_consent: typeof data.financing_consent === 'boolean' ? data.financing_consent : null,
    financing_partner: nullableText('financing_partner'), full_name: nullableText('full_name'),
    applicant_type: ['empleado', 'independiente'].includes(text(data.applicant_type)) ? data.applicant_type : null,
    national_id: nationalId.length === 10 && digitsInMessage.includes(nationalId) ? nationalId : null,
    ruc: ruc.length === 13 && digitsInMessage.includes(ruc) ? ruc : null,
    employment_stability_months: Number.isInteger(positive('employment_stability_months')) ? positive('employment_stability_months') : null,
    job_title: nullableText('job_title'), monthly_income: positive('monthly_income'),
  }
}

export function validateIntent(raw: Row, proposal: Row | null, sourceAt: string, registeredAt: string) {
  let intent = text(raw.intent)
  if (!['accept', 'counterproposal', 'reject', 'cancel', 'question', 'unclear', 'opt_out'].includes(intent)) throw new Error('INVALID_VISIT_INTENT')
  if (!proposal && !['question', 'opt_out'].includes(intent)) intent = 'unclear'
  if (intent === 'accept' && (proposal?.status !== 'awaiting_client' || !proposal.advisor_accepted_at
    || !(Date.parse(sourceAt) > Date.parse(text(proposal.propuesta_enviada_at)))
    || !(Date.parse(registeredAt) > Date.parse(text(proposal.propuesta_enviada_at))))) intent = 'unclear'
  return intent
}
