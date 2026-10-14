import { object, text, type Row } from './data'

export const WRITER_OBJECTIVE_RULES = `Usted redacta el mensaje completo que recibirá el cliente. El sistema no añadirá saludos, preguntas, avisos ni enlaces después. Use objetivos_conversacion y el estado disponible para decidir cómo responder y formular una continuación pertinente. Los IDs y actos enlazan el estado y las referencias, no imponen palabras. Pregunte una preferencia pendiente con naturalidad, sin tono de formulario. Si el cliente declara dormitorios indiferentes, omita esa captura y avance al tipo de vivienda y a las opciones de mayor amplitud interior verificada. No deduzca una preferencia de dormitorios de los inmuebles mostrados. Una duda intermedia conserva decisiones aceptadas; retome cuando ayude al cliente, sin insistir inmediatamente con la misma captura después de varias dudas. Incluya material programado y condiciones pertinentes dentro de su propia redacción; mencionar un brochure ya leído no solicita reenviarlo. Mantenga hechos, autorizaciones y resultados operativos reales. Su ficha question debe describir SOLO la pregunta que efectivamente escribió, con su ID, acto y referentes, o none si no hay pregunta.`

export function conversationObjective(raw: unknown): Row {
  const plan = object(raw), id = text(plan.question_id || plan.id)
  const goals: Record<string, string> = {
    property_bedrooms: 'Conocer cuántos dormitorios le gustaría tener, únicamente si no lo ha respondido ni lo declaró indiferente.',
    property_category: 'Ayudar a elegir el tipo de inmueble entre las categorías verificadas pertinentes.',
    property_floor: 'Conocer la planta que le gustaría explorar cuando siga pendiente y sea útil.',
    unit_choice: 'Ayudar a comparar o continuar con una opción concreta, conservando selecciones conocidas.',
    financing_invitation: 'Ofrecer continuar con el financiamiento, si aún no lo ha aceptado o rechazado.',
    financing_down_payment: 'Conocer el aporte que tenía pensado para la entrada, conservando cualquier importe ya confirmado.',
    property_requirements: 'Explorar la alternativa concreta autorizada, sin reabrir restricciones indiferentes ni requisitos aceptados.',
    property_priority: 'Continuar con la prioridad de selección declarada, sin convertirla en una cantidad de dormitorios.',
  }
  return { action: plan.action || plan.act || null, question_id: id || null,
    question_act: plan.question_act || plan.act || null,
    objective: goals[id] || text(plan.instruction) || 'Atender la consulta y continuar únicamente con lo que siga pendiente.',
    instruction: plan.instruction || null, selection_scope: plan.selection_scope || null }
}

/** Preserve facts, consent and reference IDs. Literal route templates and
 * pending questions remain internal recovery/history data, not writer scripts. */
export function writerObjectiveContext(raw: Row): Row {
  const visit = (value: unknown, key = ''): unknown => {
    if (['historial', 'historial_reciente', 'history', 'mensaje_actual', 'solicitud_actual', 'referencias_solicitud'].includes(key)) return value
    if (Array.isArray(value)) return value.map(item => visit(item))
    if (!value || typeof value !== 'object') return value
    const row = object(value), hasQuestion = typeof row.question === 'string' || typeof row.next_question === 'string'
    return { ...Object.fromEntries(Object.entries(row).filter(([name, item]) =>
      !(typeof item === 'string' && ['question', 'next_question', 'suggested_question', 'pregunta_siguiente', 'baseReply', 'base_reply', 'reply'].includes(name)))
      .map(([name, item]) => [name, visit(item, name)])), ...(hasQuestion ? { objetivo_conversacion: conversationObjective(row) } : {}) }
  }
  return visit(raw) as Row
}
