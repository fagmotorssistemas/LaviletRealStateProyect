import { object, text, type Row } from './data'
import { leadBudget, reviewedFinancingCovers } from './budget-state'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

/** Selection is a client decision, not the first search result or a single match. */
export function selectedFinancingUnit(info: Row): Row | null {
  const reference = object(info.referencia_unidad)
  const context = object(info.property_context || reference.context)
  if (reference.needsClarification === true) return null
  const ids = Array.isArray(context.selected_ids) ? context.selected_ids.map(text) : []
  const id = ids.length === 1 ? ids[0] : !Object.hasOwn(context, 'selected_ids') ? text(object(info.lead).unit_id) : ''
  if (!id) return null
  return [...rows(info.catalogo), ...rows(reference.matches)].find(unit => text(unit.id) === id
    && unit.is_published !== false && (!unit.status || unit.status === 'disponible')) || null
}

/** Kept in the conversation summary while selection continues. No bank write,
 * assigned contact, down-payment interpretation or financial approval is implied. */
export function financingJourney(previous: Row, input: { consent: boolean | null; declined?: boolean }, messageId: string): Row {
  if (input.declined || input.consent === false) return { status: 'declined', accepted: false, source_message_id: messageId }
  if (input.consent === true) return { ...previous, status: 'accepted', accepted: true, source_message_id: messageId }
  return previous
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
  const reviewed = reviewedFinancingCovers(info, unit)
  return { accepted, selected_unit_id: unit?.id || null, selected_unit_number: unit?.unit_number || null,
    stage: !accepted ? 'explain_and_offer' : !unit ? 'select_property' : budget.answered !== true ? 'clarify_budget' : reviewed ? 'reviewed_ready' : 'continue_financing',
    budget_status: budget.status, collection_allowed: accepted && !!unit && budget.answered === true && !reviewed,
    instruction: !accepted ? 'Explique el proceso y las entidades autorizadas. Pregunte si desea continuar, sin ofrecer un contacto por rutina ni solicitar datos financieros.'
      : !unit ? 'El lead ya aceptó continuar con financiamiento. Retome sus preferencias conocidas y ayúdele a elegir una unidad concreta. No pida cédula ni datos laborales, no vuelva a pedir la aceptación y no derive a un asesor.'
        : budget.answered !== true ? 'La unidad y la aceptación están confirmadas. Pregunte si tiene presupuesto estimado; si dijo que sí sin monto, pregunte cuánto. Si declara no tenerlo definido, continúe sin exigir una cifra. No pida aún datos financieros.'
          : reviewed ? 'El equipo registró una revisión favorable que cubre esta unidad. Siga el paso comercial de reserva antes de visita, sin reabrir la recopilación ni afirmar que ya existe reserva.'
            : 'La unidad, el interés y la situación del presupuesto están confirmados. Continúe con la entidad y el siguiente dato pendiente del procedimiento; no vuelva a preguntar si quiere financiamiento.',
  }
}

export const FINANCING_STAGE_RULES = `etapa_financiamiento separa aceptación, elección de inmueble, situación del presupuesto y recopilación. Aceptar orientación o revisión no selecciona una unidad, no confirma que el presupuesto sea entrada y no pide un asesor. Antes de recopilar datos financieros debe existir selected_unit_id y collection_allowed=true. Con select_property conserve el interés financiero y retome la elección de unidad usando las preferencias conocidas: no vuelva a descartar la compra comparando el efectivo con el precio total ni concluya que el financiamiento no resuelve la diferencia. Con clarify_budget pregunte el presupuesto pendiente; declarar no tenerlo definido permite continuar. Es nuestro procedimiento de atención, no un requisito bancario. Continúe el trámite sin repetir la aceptación ni ofrecer explicar lo ya explicado. Puede explicar requisitos si el cliente pregunta, aunque aún no deba solicitarlos. Una solicitud explícita de atención humana se atiende por su ruta propia.`
