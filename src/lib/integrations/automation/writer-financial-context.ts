import { informationOnly } from './interaction-mode'
import { object, text, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(text) : []
const financialKeys = new Set(['politica_financiera', 'politica_pago_contado', 'financing_policy', 'financiamiento',
  'financing_quote', 'financing_balance', 'financing_amounts', 'etapa_financiamiento', 'next_financing_step',
  'financing_partners', 'next_financing_question', 'direct_credit'])
const financialTopics = new Set(['financing', 'cash_payment', 'credit_approval', 'financing_process', 'monthly_payment'])
const financialActions = new Set(['offer_financing', 'clarify_financing_down_payment', 'continue_financing',
  'choose_financing_partner', 'collect_financing_required', 'explain_financing', 'financing', 'collect_financing'])

/** Project only model inputs. Canonical state, operational gates and reviewer
 * evidence remain complete. Rental/investment words are never a credit signal. */
export function financialWritingScope(raw: Row): Row {
  const verified = object(raw.contexto_verificado || raw)
  const contract = object(raw.contrato_turno || verified.contrato_turno)
  const semantics = object(verified.semantica_turno || raw.semantica_turno)
  const writerContract = object(raw.contrato_redaccion)
  const currentRequest = object(writerContract.solicitud_actual)
  const requests = [contract.requests, verified.solicitudes_interpretadas, semantics.requests, currentRequest.requests].flatMap(rows)
  const currentFinancialRequest = requests.some(request => request.domain === 'financing'
    || strings(request.topics).some(topic => financialTopics.has(topic)))
    || semantics.primary_intent === 'ask_financing'
    || strings(raw.consultas_del_turno).some(topic => financialTopics.has(topic))
    || object(verified.financing_quote).requested === true
  const unrelatedInquiry = requests.some(request => ['project', 'property'].includes(text(request.domain))
    && strings(request.topics).some(topic => !financialTopics.has(topic)
      && !['purchase_price', 'property_options', 'visualization'].includes(topic)))
  const plans = [verified.siguiente_paso_comercial, raw.plan_comercial, writerContract.objetivo_siguiente,
    writerContract.continuacion_del_turno].map(object)
  const finance = object(verified.financiamiento), journey = object(finance.journey), stage = object(verified.etapa_financiamiento)
  const accepted = stage.accepted === true || journey.status !== 'declined'
    && (journey.accepted === true || object(finance.current).explicit_consent === true)
  const authorizedContinuation = plans.some(plan => financialActions.has(text(plan.action)) || plan.financing_offer_allowed === true)
  const source = text(object(raw.estado_operativo).source || writerContract.ruta)
  const financialRoute = source.startsWith('financing_') || ['credit_orientation', 'financing'].includes(source)
  const currentReply = object(semantics.answer_to_previous)
  const acceptedNow = currentReply.question_id === 'financing_invitation' && currentReply.kind === 'affirmative'
  const allowed = currentFinancialRequest || !informationOnly(verified) && (!unrelatedInquiry && (authorizedContinuation || financialRoute) || acceptedNow
    || accepted && plans.some(plan => plan.action === 'select_property' && !requests.length))
  return { allowed, accepted, reason: currentFinancialRequest ? 'current_financial_request'
    : allowed ? 'authorized_financial_continuation' : 'unrelated_to_current_request' }
}

export function projectFinancialContextForWriter(raw: Row): Row {
  const scope = financialWritingScope(raw)
  if (scope.allowed === true) return { ...raw, alcance_financiero_turno: scope }
  const visit = (value: unknown, key = ''): unknown => {
    // History and the client's words retain their original meaning and evidence.
    if (['historial', 'historial_reciente', 'history', 'mensaje_actual', 'solicitud_actual', 'referencias_solicitud'].includes(key)) return value
    if (Array.isArray(value)) return value.filter(item => {
      const row = object(item), path = text(row.path)
      if (row.topic === 'financiamiento' || object(row.value).topic === 'financiamiento') return false
      return ![...financialKeys].some(name => path === `contexto_verificado.${name}` || path.startsWith(`contexto_verificado.${name}.`))
    }).map(item => visit(item))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(object(value)).filter(([name]) => !financialKeys.has(name)
      && name !== 'informacion_bancaria_verificada' && !(key === 'capacidades_disponibles' && ['financing_review', 'bank_contact'].includes(name)))
      .map(([name, item]) => [name, visit(item, name)]))
  }
  return { ...object(visit(raw)), alcance_financiero_turno: scope }
}

export const FINANCIAL_WRITER_SCOPE_RULE = 'alcance_financiero_turno.allowed=false significa que este turno no requiere orientación ni capturas financieras. Responda la consulta inmobiliaria y conserve las decisiones conocidas; no introduzca bancos, aprobación, respaldo de arriendos, cuotas ni invitaciones de crédito por el solo hecho de hablar de inversión, alquiler o reventa. No interprete campos financieros omitidos del prompt como rechazo o pérdida del estado guardado.'
