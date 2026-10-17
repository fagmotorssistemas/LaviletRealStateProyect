import { object, text, type Row } from './data'
import { informationOnly } from './interaction-mode'

export const WRITER_OBJECTIVE_RULES = `Usted redacta el mensaje completo que recibirá el cliente. El sistema no añadirá saludos, preguntas, avisos ni enlaces después. Use objetivos_conversacion y el estado disponible para decidir cómo responder y formular una continuación pertinente. Los IDs y actos enlazan el estado y las referencias, no imponen palabras. Pregunte una preferencia pendiente con naturalidad, sin tono de formulario. Si el cliente declara dormitorios indiferentes, omita esa captura y avance al tipo de vivienda y a las opciones de mayor amplitud interior verificada. No deduzca una preferencia de dormitorios de los inmuebles mostrados. Una duda intermedia conserva decisiones aceptadas; retome cuando ayude al cliente, sin insistir inmediatamente con la misma captura después de varias dudas. Incluya material programado y condiciones pertinentes dentro de su propia redacción; mencionar un brochure ya leído no solicita reenviarlo. Mantenga hechos, autorizaciones y resultados operativos reales. Su ficha question debe describir SOLO la pregunta que efectivamente escribió, con su ID, acto y referentes, o none si no hay pregunta.`

export function conversationObjective(raw: unknown): Row {
  const plan = object(raw)
  const profileIds: Record<string, string> = { collect_profile: 'lead_profile', collect_name: 'lead_profile_name',
    collect_residence: 'lead_profile_residence', confirm_residence: 'lead_residence_confirmation' }
  const id = text(plan.question_id || plan.id || profileIds[text(plan.question_purpose)])
  if(plan.capture_context==='showroom_later')return {action:'defer_showroom',question_id:null,
    objective:'Reconocer amablemente que prefiere recibir información más adelante. No pedir nombre, residencia, presupuesto ni otros datos ahora; no fijar una fecha ni programar seguimiento sin acuerdo.'}
  if(plan.capture_context==='showroom') return {action:'showroom_continuation',question_id:id||null,
    objective:'Atender la información aceptada en el showroom y preguntar únicamente los datos de presentación pendientes, sin volver a pedir el nombre registrado ni vincular residencia con enviar el brochure.',
    instruction:'Conserve el espacio observado como referente, no como unidad elegida. No reinicie la bienvenida. Una residencia inferida por geolocalización no está declarada por el cliente.'}
  const goals: Record<string, string> = {
    lead_profile: 'Responder primero la consulta y, si la captura está autorizada, conocer únicamente los datos de presentación pendientes con una pregunta natural. Ofrezca el brochure solo cuando estado_comercial.objetivo_presentacion.offer_project_brochure=true; un recordatorio o aclaración no repite el ofrecimiento anterior. Conserve las excepciones de entrega autorizadas y los datos ya aportados.',
    lead_profile_name: 'Conocer únicamente el nombre de presentación pendiente con naturalidad. Siga la decisión de ofrecimiento de estado_comercial; un recordatorio no repite el ofrecimiento anterior ni la residencia conocida.',
    lead_profile_residence: 'Conocer únicamente la ciudad o el país de residencia actual pendiente. Reconozca el lugar ya declarado según su significado temporal confirmado o incierto y aclare solo lo que falta. Siga la decisión de ofrecimiento de estado_comercial; un recordatorio no repite el ofrecimiento anterior ni el nombre confirmado.',
    budget_amount: 'Orientar las opciones con el presupuesto que tenía previsto para la compra, si todavía falta y desea compartirlo. Atienda sus dudas antes de retomarlo; no lo repita en cada respuesta ni lo convierta en condición para informar.',
    budget_kind: 'Aclarar únicamente el significado de un importe ambiguo, conservando la cifra y sin volver a pedir datos resueltos.',
    property_bedrooms: 'Conocer cuántos dormitorios le gustaría tener, únicamente si no lo ha respondido ni lo declaró indiferente.',
    property_category: 'Ayudar a elegir el tipo de inmueble entre las categorías verificadas pertinentes.',
    property_comparison: 'Comparar directamente los tipos ya aceptados, incluyendo ambas partes, sus diferencias útiles y el presupuesto conocido. No volver a pedir permiso para la misma comparación.',
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
  const paused = informationOnly(object(raw.contexto_verificado || raw))
  const visit = (value: unknown, key = ''): unknown => {
    if (['historial', 'historial_reciente', 'history', 'mensaje_actual', 'solicitud_actual', 'referencias_solicitud'].includes(key)) return value
    if (Array.isArray(value)) return value.map(item => visit(item))
    if (!value || typeof value !== 'object') return value
    if (paused && ['pregunta_pendiente', 'pending_question'].includes(key)) {
      const row = object(value)
      return { id: row.id || null, act: row.act || null, target_ids: row.target_ids || [],
        paused_for_information: true, instruction: 'Referencia histórica; no retome esta captura mientras solo desea información.' }
    }
    const row = object(value), hasQuestion = typeof row.question === 'string' || typeof row.next_question === 'string'
    return { ...Object.fromEntries(Object.entries(row).filter(([name, item]) =>
      !(typeof item === 'string' && ['question', 'next_question', 'suggested_question', 'pregunta_siguiente', 'baseReply', 'base_reply', 'reply'].includes(name)))
      .map(([name, item]) => [name, visit(item, name)])), ...(hasQuestion ? { objetivo_conversacion: conversationObjective(row) } : {}) }
  }
  return visit(raw) as Row
}
