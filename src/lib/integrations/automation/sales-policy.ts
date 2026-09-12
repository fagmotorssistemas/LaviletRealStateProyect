import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { isUnitVisualRequest } from './unit-visual-request'

const rows = (v: unknown) => (Array.isArray(v) ? v : []).map(object)
const invitation = (v: string) => /[¿?]/.test(v) && /(?:gustaria|desea|quiere|animaria|coordinamos|agendamos|podemos coordinar).*(?:visita|conocerlo en persona|verlo en persona)/.test(normalized(v))
const positive = (v: string) => /^(?:(?:si|claro|perfecto|bueno) )?(?:se ve interesante|me (?:gusta|interesa|encanta)|esta interesante|muy interesante|me parece (?:bien|interesante))$/.test(normalized(v))
const discovery = (v: string) => /[¿?]/.test(v) && /presupuesto|para vivir|como inversion|para invertir|cuantos dormitorios|que.*prioriz|que.*importante|cuando.*decision/.test(normalized(v))

export function acceptsVisitInvitation(current: string, lastReply: string) {
  if (!invitation(lastReply)) return false
  const m = normalized(current)
  if (/^(?:si(?: claro| por favor| me gustaria| quiero| gracias)?|claro|de acuerdo|esta bien|me parece bien|perfecto|hagamoslo)$/.test(m)) return true
  // A proposed day/hour or a request for scheduling help also answers an invitation.
  // Questions about prices, business hours or other topics do not accept it.
  if (/precio|presupuesto|financ|credito|cuesta|atienden|horario de atencion|pero|\bno puedo\b/.test(m)) return false
  return /^(?:si )?(?:manana|hoy|pasado manana|(?:el )?(?:lunes|martes|miercoles|jueves|viernes|sabado)|(?:el )?\d{1,2} de \w+|a las \d{1,2})(?:\s+(?:a|las|por|en|la|el|de|tarde|manana|horas|am|pm|\d{1,2}))*$/.test(m)
    || /^(?:no (?:se|estoy segur[oa])(?: (?:cuando|que dia|a que hora))?|digame (?:usted|ud)|que (?:dia|hora) (?:pueden|tienen)|sugierame (?:un dia|una hora|un horario))$/.test(m)
}

export function salesMemory(previous: unknown, history: unknown) {
  const saved = object(previous)
  let invited = saved.visit_invited === true, declined = saved.visit_declined === true, last = ''
  for (const row of rows(history)) {
    const content = text(row.content)
    if (['bot', 'asesor'].includes(text(row.role))) {
      last = content
      if (invitation(content)) invited = true
    } else if (row.role === 'cliente' && invitation(last) && /^(?:no|no gracias|ahora no|por ahora no|solo (?:quiero )?informacion)/.test(normalized(content))) declined = true
  }
  return { visit_invited: invited, visit_declined: declined }
}

export function rememberSalesReply(previous: unknown, history: unknown, current: string, reply: string) {
  return salesMemory(previous, [...rows(history), { role: 'cliente', content: current }, { role: 'bot', content: reply }])
}

export function salesTopics(current: string) {
  const m = normalized(current)
  return [ /jardin|(?:areas|espacios|zonas) verdes/.test(m) && 'jardines',
    /sector|barrio|entorno|cerca|alrededor/.test(m) && 'sector',
    /revender|reventa|venderlo|venderla|vender.*futuro|venta futura/.test(m) && 'reventa',
    /como (?:lo |la )?compro|proceso de compra|pasos.*compr|como.*(?:comprar|adquirir)/.test(m) && 'compra',
  ].filter((v): v is string => !!v)
}

export function salesPlan(info: Row, current: string, summary: Row) {
  const history = rows(info.historial), replies = history.filter(r => ['bot', 'asesor'].includes(text(r.role)))
  const memory = salesMemory(summary._sales_memory, history)
  const last = text(replies.at(-1)?.content), m = normalized(current)
  const pendingVisit = rows(info.propuestas).some(p => ['confirmed', 'awaiting_advisor', 'awaiting_client'].includes(text(p.status)))
    || object(info.coordinacion_visita).status === 'collecting'
  const refuses = /no (?:quiero|deseo|necesito|me interesa).*(?:visita|cita)|solo (?:quiero )?(?:informacion|ver|saber)/.test(m)
  const model = object(info.modelo_3d).se_adjunta_en_esta_respuesta === true
  const sawModel = /\/tour\/modelo-3d\/|\b3D\b/.test(last)
  const topics = salesTopics(current)
  const hasUnit = rows(object(info.referencia_unidad).matches).length === 1
  const signal = model || (positive(current) && (sawModel || hasUnit)) || (topics.includes('reventa') && topics.length > 1)
  const invite = signal && !pendingVisit && !refuses && !memory.visit_invited && !memory.visit_declined
  const twoQuestions = replies.length >= 2 && replies.slice(-2).every(r => discovery(text(r.content)))
  const uncertain = /no (?:se|estoy segur|tengo claro|tengo idea)|no he pensado/.test(m)
  const answerOnly = pendingVisit || memory.visit_invited || memory.visit_declined || twoQuestions || topics.length > 0 || isUnitVisualRequest(current) || positive(current) || uncertain
  return { action: invite ? 'invite_visit' : answerOnly ? 'answer_only' : 'discover', topics,
    max_questions: invite || !answerOnly ? 1 : 0,
    closing: invite ? '¿Le gustaría coordinar una visita para conocerlo en persona?' : '',
    memory, positive_after_model: positive(current) && (sawModel || hasUnit),
    rules: `Responda primero todas las dudas del mensaje. No siga una lista obligatoria de calificación.
Use datos ya conocidos de vivir/invertir, dormitorios y presupuesto; pregunte solo UN dato útil que falte, nunca uno aplazado o ya contestado.
Si aún no sabe su presupuesto, ofrezca ayudarle a ordenar entrada y cuota cómoda, sin aprobar un crédito ni exigir ingresos aquí.
Presente de uno a tres beneficios relevantes, solo los que ayudan a esta persona; no repita instalaciones ni rellene hasta llegar a tres.
No suponga que «se ve interesante» acepta una visita. No cree cita ni avise al asesor al ofrecerla.
El plan de este turno es ${invite ? 'responder y ofrecer una visita; el sistema añade la invitación, NO escriba otra pregunta' : answerOnly ? 'responder sin otra pregunta comercial; no pida requisitos para dar información' : 'responder y opcionalmente aclarar un único dato útil' }.
No prometa reventa, arriendo, rentabilidad, disponibilidad, aprobación bancaria ni tiempos sin datos. No invente reservas, anticipos ni pasos legales de compra.
Si hay varias consultas, cubra cada una brevemente. Cerrar sin pregunta también es una respuesta completa.` }
}

export function salesIssues(reply: string, plan: ReturnType<typeof salesPlan>) {
  const r = normalized(reply), issues: string[] = []
  if ((plan.action !== 'discover') && /[¿?]/.test(reply)) issues.push('repeated_question')
  if (plan.topics.includes('jardines') && !/jardin|verde/.test(r)) issues.push('ignored_question')
  if (plan.topics.includes('sector') && !/sector|puertas del sol|barrio|cerca|entorno/.test(r)) issues.push('ignored_question')
  if (plan.topics.includes('reventa') && !/reventa|vender|venta futura/.test(r)) issues.push('ignored_question')
  return issues
}

// Grounded fallback for the reported multi-question turn. Never substitutes an
// unrelated qualification question when generation or review fails.
export function salesTopicReply(info: Row, current: string) {
  const topics = salesTopics(current), m = normalized(current)
  if (!topics.length || /precio|presupuesto|financ|credito|foto|modelo|dormitorio|metro|piscina|gimnasio|constructora|dueno/.test(m)) return ''
  const sentences: string[] = []
  if (topics.includes('jardines')) {
    const known = /jardin|verde/.test(normalized(JSON.stringify(info.instalaciones || [])))
    sentences.push(known ? 'Hay áreas exteriores con jardines para disfrutar al aire libre.' : 'Necesito verificar qué espacios verdes corresponden a esa opción.')
  }
  if (topics.includes('sector') && info.posicionamiento_proyecto) {
    const place = rows(info.lugares_cercanos).find(p => /caffe bianco/i.test(text(p.poi_name)))
    sentences.push('Está en Puertas del Sol, un sector residencial de Cuenca' + (place ? ` con lugares como ${text(place.poi_name)} en el entorno.` : '.'))
  }
  if (topics.includes('reventa')) sentences.push('Para una futura reventa conviene revisar precios de propiedades similares, estado del inmueble y demanda de ese momento; no podemos asegurar una ganancia ni un plazo de venta.')
  if (topics.includes('compra')) sentences.push('Primero revisamos la opción que le interesa; después, el asesor confirma disponibilidad, precio y condiciones para avanzar. Si necesita financiamiento, podemos orientarle con las entidades habilitadas.')
  return sentences.length === topics.length ? 'Claro, con mucho gusto. ' + sentences.join(' ') : ''
}
