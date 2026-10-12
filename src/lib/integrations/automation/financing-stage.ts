import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { budgetKindQuestion, leadBudget, reviewedFinancingCovers } from './budget-state'
import { financingEntryState } from './financing-entry'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

/** Selection is a client decision, not the first search result or a single match. */
export function selectedFinancingUnit(info: Row): Row | null {
  const reference = object(info.referencia_unidad)
  const context = object(info.property_context || reference.context)
  if (reference.needsClarification === true) return null
  const ids = Array.isArray(context.selected_ids) ? context.selected_ids.map(text) : []
  const id = ids.length === 1 ? ids[0] : !Object.hasOwn(context, 'selected_ids') ? text(object(info.lead).unit_id) : ''
  if (!id) return null
  // The response catalogue may be reduced to this turn's information. When a
  // full verification catalogue is supplied it is authoritative, including an
  // empty list or a withdrawn unit; do not fall back to stale displayed offers.
  const catalog = Array.isArray(info.catalogo_verificacion) ? rows(info.catalogo_verificacion)
    : [...rows(info.catalogo), ...rows(reference.matches)]
  return catalog.find(unit => text(unit.id) === id
    && unit.is_published !== false && (!unit.status || unit.status === 'disponible')) || null
}

/** Kept in the conversation summary while selection continues. No bank write,
 * assigned contact, down-payment interpretation or financial approval is implied. */
export function financingJourney(previous: Row, input: { consent: boolean | null; declined?: boolean; partner?: string | null; partner_evidence?: string; cleared_partner?: string | null }, messageId: string): Row {
  if (input.declined || input.consent === false) return { status: 'declined', accepted: false, source_message_id: messageId }
  let next = input.consent === true ? { ...previous, status: 'accepted', accepted: true, source_message_id: messageId } : previous
  if (input.cleared_partner && normalized(text(object(next.partner_preference).name)) === normalized(input.cleared_partner))
    next = { ...next, partner_preference: null }
  if (input.partner && input.partner_evidence?.trim()) next = { ...next,
    partner_preference: { name: input.partner, evidence: input.partner_evidence.trim(), source_message_id: messageId } }
  return next
}

/** Revalidate against the current project configuration before reusing a preference. */
export function rememberedFinancingPartner(journey: unknown, partners: string[]): string | null {
  const preference = object(object(journey).partner_preference)
  if (!text(preference.evidence).trim() || !text(preference.source_message_id).trim()) return null
  return partners.find(name => normalized(name) === normalized(text(preference.name))) || null
}

export function canResumeFinancing(info: Row, journey: Row, extracted: Row): boolean {
  return journey.accepted === true && !!selectedFinancingUnit(info)
    && object(object(info.referencia_unidad).query).operation === 'select'
    && extracted.requested_advisor !== true && extracted.opt_out !== true
    && object(extracted.visit_intent).kind !== 'request_visit'
}

export function financingStage(info: Row): Row {
  const finance = object(info.financiamiento), journey = object(finance.journey), current = object(finance.current)
  const unit = selectedFinancingUnit(info)
  const accepted = journey.status !== 'declined' && (journey.accepted === true || current.explicit_consent === true)
  const budget = leadBudget(info)
  const budgetRoleQuestion = budgetKindQuestion(budget)
  const budgetPending = budget.answered !== true || !!budgetRoleQuestion
  const reviewed = reviewedFinancingCovers(info, unit)
  const entry = financingEntryState(info)
  const partners = Array.isArray(finance.partners) ? finance.partners.map(text) : []
  const partnerUnavailable = !!text(current.selected_partner_name)
    && !partners.some(name => normalized(name) === normalized(text(current.selected_partner_name)))
  return { accepted, selected_unit_id: unit?.id || null, selected_unit_number: unit?.unit_number || null,
    selected_partner_preference: rememberedFinancingPartner(journey, Array.isArray(finance.partners) ? finance.partners.map(text) : []),
    stage: !accepted ? 'explain_and_offer' : !unit ? 'select_property' : budgetPending ? 'clarify_budget' : reviewed ? 'reviewed_ready' : entry.answered !== true ? 'clarify_entry' : 'continue_financing',
    budget_status: budget.status, entry_status: entry.status, entry, partner_unavailable: partnerUnavailable,
    ...(accepted && unit && !budgetPending && !reviewed && entry.answered !== true
      ? { question: entry.question, question_id: 'financing_down_payment', question_act: 'financing' } : {}),
    collection_allowed: accepted && !!unit && !budgetPending && entry.answered === true && !reviewed && !partnerUnavailable,
    instruction: !accepted ? 'Explique el proceso y las entidades autorizadas. Pregunte si desea continuar, sin ofrecer un contacto por rutina ni solicitar datos financieros.'
      : !unit ? 'El lead ya aceptó continuar con financiamiento. Retome sus preferencias conocidas y ayúdele a elegir una unidad concreta. No pida cédula ni datos laborales, no vuelva a pedir la aceptación y no derive a un asesor.'
        : budgetPending ? budgetRoleQuestion || 'La unidad y la aceptación están confirmadas. Pregunte si tiene presupuesto estimado; si dijo que sí sin monto, pregunte cuánto. Si declara no tenerlo definido, continúe sin exigir una cifra. No pida aún datos financieros.'
          : reviewed ? 'El equipo registró una revisión favorable que cubre esta unidad. Siga el paso comercial de reserva antes de visita, sin reabrir la recopilación ni afirmar que ya existe reserva.'
            : entry.answered !== true ? 'La unidad y la aceptación de financiamiento están confirmadas. Pregunte únicamente qué monto propio tendría disponible para la entrada. Es distinto del presupuesto total: no convierta ese presupuesto en entrada ni vuelva a confirmar su finalidad. Conserve la entidad elegida y no pida datos personales todavía. Si no tiene la entrada definida o prefiere no compartirla, continúe sin exigir una cifra ni inventar cero.'
            : partnerUnavailable ? 'La entidad del expediente ya no está habilitada. Conserve el progreso, explique el cambio y solicite una nueva elección entre las entidades vigentes, sin sustituirla automáticamente ni pedir datos personales todavía.'
            : 'La unidad, el interés y la situación del presupuesto están confirmados. Continúe con la entidad y el siguiente dato pendiente del procedimiento; no vuelva a preguntar si quiere financiamiento.',
  }
}

export const FINANCING_STAGE_RULES = `etapa_financiamiento separa aceptación, elección de inmueble, situación del presupuesto, entrada disponible y recopilación. selected_partner_preference conserva una entidad elegida y aún habilitada aunque falten requisitos; no vuelva a pedirla sin cambio o ambigüedad actual. Esa preferencia no autoriza una evaluación ni envío al banco. Aceptar orientación o revisión no selecciona una unidad, no confirma que el presupuesto sea entrada y no pide un asesor. Antes de recopilar datos personales financieros debe existir selected_unit_id y collection_allowed=true. Con select_property conserve el interés financiero y retome la elección de unidad usando las preferencias conocidas: no vuelva a descartar la compra comparando el efectivo con el precio total ni concluya que el financiamiento no resuelve la diferencia. Con clarify_budget pregunte el presupuesto pendiente; declarar no tenerlo definido permite continuar. Con clarify_entry solicite únicamente question: el monto disponible para la entrada, después de elegir la unidad. No repita la pregunta si entry.answered=true: una entrada declarada, no definida o no compartida permite continuar la orientación; no invente cero ni condiciones bancarias. Conserve el presupuesto total y la entrada como roles separados. Es nuestro procedimiento de atención, no un requisito bancario. Continúe el trámite sin repetir la aceptación ni ofrecer explicar lo ya explicado. Puede explicar requisitos si el cliente pregunta, aunque aún no deba solicitarlos. Una solicitud explícita de atención humana se atiende por su ruta propia.`
