import { object, text, type Row } from './data'
import { botVisitPolicy, visitInvitation } from '@/lib/inmobiliaria/botVisits'
import { normalized } from './sdr-rules'
import { isUnitVisualRequest } from './unit-visual-request'
import { isPropertyScopeRedirect, salesSubject } from './sales-subject'
import { commercialEngagement, passiveSalesRules } from './commercial-engagement'

const rows = (v: unknown) => (Array.isArray(v) ? v : []).map(object)
const invitation = (v: string) => /[¿?]/.test(v) && /(?:gustaria|desea|quiere|prefiere|animaria|coordinamos|agendamos|podemos coordinar).*(?:visita|conocerlo en persona|verlo en persona)/.test(normalized(v))
const positive = (v: string) => /^(?:(?:si|claro|perfecto|bueno) )?(?:se ve interesante|me (?:gusta|interesa|encanta)|esta interesante|muy interesante|me parece (?:bien|interesante))$/.test(normalized(v))
const discovery = (v: string) => /[¿?]/.test(v) && /presupuesto|para vivir|como inversion|para invertir|cuantos dormitorios|que.*prioriz|que.*importante|cuando.*decision/.test(normalized(v))

export function acceptsUnitOptions(current: string, lastReply: string) {
  return /^(?:si(?: por favor| me gustaria| quiero| claro| gracias)?|claro|de acuerdo|muestr[ae]me(?: una)?|a ver)$/.test(normalized(current))
    && /le gustaria (?:revisar la distribucion|que le muestre una opcion)/.test(normalized(lastReply))
}

export function acceptsVisitInvitation(current: string, lastReply: string) {
  const scheduling = /(?:dia|fecha).*horario|dia.*hora|fecha.*hora/.test(normalized(lastReply)) && /visita|cita|recibirle/.test(normalized(lastReply))
  if (!invitation(lastReply) && !scheduling) return false
  const m = normalized(current).replace(/\s+(?:puede ser|le parece|por favor)$/, '')
  if (/^(?:si(?: claro| por favor| me gustaria| quiero| gracias)?|claro|de acuerdo|esta bien|me parece bien|perfecto|hagamoslo)$/.test(m)) return true
  // A proposed day/hour or a request for scheduling help also answers an invitation.
  // Questions about prices, business hours or other topics do not accept it.
  if (/precio|presupuesto|financ|credito|cuesta|atienden|horario de atencion|pero|\bno puedo\b/.test(m)) return false
  if (/\b(?:cuando|a que hora|que dias?)\b.*\b(?:puedo|podria|pueden)\b/.test(m)) return true
  return /^(?:si )?(?:manana|hoy|pasado manana|(?:el )?(?:lunes|martes|miercoles|jueves|viernes|sabado)|(?:el )?\d{1,2} de \w+|a las \d{1,2})(?:\s+(?:a|las|por|en|la|el|de|tarde|manana|horas|am|pm|\d{1,2}))*$/.test(m)
    || /^(?:no (?:se|estoy segur[oa])(?: (?:cuando|que dia|a que hora))?|digame (?:usted|ud)|que (?:dia|hora) (?:pueden|tienen)|sugierame (?:un dia|una hora|un horario))$/.test(m)
}

export function salesMemory(previous: unknown, history: unknown) {
  const saved = object(previous)
  const messages = rows(history)
  let invited = saved.visit_invited === true, declined = saved.visit_declined === true, last = ''
  const unrelatedClientTurn = (row: Row, index: number) => row.role === 'cliente' && (
    salesSubject(text(row.content), messages.slice(0, index)).subject === 'vehicle'
    || isPropertyScopeRedirect(text(messages.slice(index + 1).find(next => ['bot', 'asesor'].includes(text(next.role)))?.content)))
  // Repair older memory that counted credit for another service as mortgage guidance.
  const wrongScope = messages.some((row, index) => row.role === 'cliente' && mentionsFinancing(text(row.content))
    && unrelatedClientTurn(row, index))
  let financingMentioned = saved.financing_mentioned === true && !wrongScope
  let unitsOffered = saved.unit_options_offered === true
  for (const [index, row] of messages.entries()) {
    const content = text(row.content)
    if (['cliente', 'bot', 'asesor'].includes(text(row.role)) && mentionsFinancing(content)
      && !unrelatedClientTurn(row, index) && salesSubject(content, messages.slice(0, index)).subject !== 'vehicle') financingMentioned = true
    if (['bot', 'asesor'].includes(text(row.role))) {
      last = content
      if (invitation(content)) invited = true
      if (/le gustaria (?:revisar la distribucion|que le muestre una opcion)/.test(normalized(content))) unitsOffered = true
    } else if (row.role === 'cliente' && invitation(last) && /^(?:no|no gracias|ahora no|por ahora no|solo (?:quiero )?informacion)/.test(normalized(content))) declined = true
  }
  const engagement = commercialEngagement('', history, saved)
  return { visit_invited: invited, visit_declined: declined, financing_mentioned: financingMentioned, unit_options_offered: unitsOffered, passive_sales: engagement.passive, property_interest: engagement.interested }
}

export function mentionsFinancing(value: string) {
  return /\b(?:financ\w*|credito\w*|hipotec\w*|pichincha|jep|jardin\s*(?:azuayo|zauayo))\b/.test(normalized(value))
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
  const engagement = commercialEngagement(current, history, summary._sales_memory)
  const last = text(replies.at(-1)?.content), m = normalized(current)
  const pendingVisit = rows(info.propuestas).some(p => ['confirmed', 'awaiting_advisor', 'awaiting_client'].includes(text(p.status)))
    || object(info.coordinacion_visita).status === 'collecting'
  const refuses = /no (?:quiero|deseo|necesito|me interesa).*(?:visita|cita)|solo (?:quiero )?(?:informacion|ver|saber)/.test(m)
  const model = object(info.modelo_3d).se_adjunta_en_esta_respuesta === true
  const sawModel = /\/tour\/(?:modelo-3d|unidad)\/|\b3D\b/.test(last)
  const topics = salesTopics(current)
  const hasUnit = rows(object(info.referencia_unidad).matches).length === 1
  const concreteInterest = /(?:me interesa|busco|quiero|quisiera).*(?:departamento|suite|vivienda|local)/.test(m)
    && (hasUnit || /\b[123] (?:dormitorios|habitaciones|personas)|pisos? altos?|terraza/.test(m))
  const signal = info.precio_cotizado === true || model || concreteInterest || (positive(current) && (sawModel || hasUnit || /brochure|folleto/i.test(last))) || (topics.includes('reventa') && topics.length > 1)
  const policy = object(info.politica_visitas)
  const visits = botVisitPolicy({ bot_visits: { allow_suggestions: policy.allowSuggestions, launch_destination: policy.launchDestination } }, text(info.modo_comercial))
  const recentInvitation = replies.slice(-3).some(row => invitation(text(row.content)))
  const invite = !engagement.passive && visits.allowSuggestions && signal && !pendingVisit && !refuses && !recentInvitation
    && (!memory.visit_invited || replies.length >= 3) && !memory.visit_declined
  // An old offer must not block a useful next step after the client starts a new search.
  const recentUnitOffer = replies.slice(-2).some(row => /le gustaria (?:revisar la distribucion|que le muestre una opcion)/.test(normalized(text(row.content))))
  const offerUnits = !engagement.passive && !invite && info.precio_cotizado === true && !pendingVisit && !model && (!memory.unit_options_offered || (replies.length >= 3 && !recentUnitOffer))
    && !/solo (?:quiero )?(?:el )?precio|no (?:quiero|deseo|necesito).*(?:ver|opcion|modelo|distribucion)/.test(m) && !isUnitVisualRequest(current)
  const quoted = rows(info.unidades_cotizadas)
  const unitClosing = quoted.length === 1
    ? `¿Le gustaría revisar la distribución ${quoted[0].category === 'suite' ? 'de la suite' : quoted[0].category === 'local' ? 'del local' : 'del departamento'} ${text(quoted[0].unit_number)}?`
    : '¿Le gustaría que le muestre una opción de ese rango?'
  const twoQuestions = replies.length >= 2 && replies.slice(-2).every(r => discovery(text(r.content)))
  const shareBrochure = !engagement.passive && twoQuestions && !pendingVisit && !invite && !offerUnits
    && !replies.some(r => /brochure-la-vilet|brochure|folleto/i.test(text(r.content)))
    && !/no (?:quiero|deseo|necesito).*(?:material|brochure|folleto|informacion)/.test(m)
  const uncertain = /no (?:se|estoy segur|tengo claro|tengo idea)|no he pensado/.test(m)
  const answerOnly = engagement.passive || pendingVisit || memory.visit_invited || memory.visit_declined || twoQuestions || topics.length > 0 || isUnitVisualRequest(current) || positive(current) || uncertain
  return { action: invite ? 'invite_visit' : offerUnits ? 'offer_units' : shareBrochure ? 'share_brochure' : answerOnly ? 'answer_only' : 'discover', topics,
    question_purpose: invite ? 'Obtener permiso para coordinar la visita, sin confirmarla.' : offerUnits ? 'Elegir una unidad y mostrar su distribución.' : answerOnly ? null : object(info.siguiente_pregunta).purpose || 'Aclarar un dato faltante que cambie la recomendación o el siguiente paso.',
    max_questions: invite || offerUnits || !answerOnly ? 1 : 0,
    closing: invite ? visitInvitation(text(info.modo_comercial), visits) : offerUnits ? unitClosing : '',
    visits_allowed: visits.allowSuggestions,
    launch: info.modo_comercial === 'lanzamiento',
    memory, engagement, positive_after_model: positive(current) && (sawModel || hasUnit),
    rules: `Responda primero todas las dudas del mensaje. No siga una lista obligatoria de calificación.
Use datos ya conocidos de vivir/invertir, dormitorios y presupuesto; pregunte solo UN dato útil que falte, nunca uno aplazado o ya contestado.
Cada pregunta debe tener un propósito concreto y un uso para la respuesta: seleccionar una unidad, mostrar material pertinente, coordinar una visita, iniciar una revisión financiera consentida o facilitar atención del asesor. Si no cambia ninguna decisión, omita la pregunta. No pregunte para mantener interacción ni clasifique a alguien como poco interesado por hacer preguntas; use decisiones expresas del cliente y respete su ritmo.
Preguntar uso propio o inversión sirve para orientar la elección de la unidad. No afirme que alquilar generará ingresos aceptados por el banco ni que respalda o mejora la aprobación: faltan políticas verificadas de la entidad. Si preguntan por qué importa, explique el propósito comercial y que cualquier efecto crediticio debe verificarlo la entidad.
Si el cliente expresa una duda sobre su capacidad de compra, ofrezca orientación de financiamiento sin aprobar un crédito ni exigir ingresos aquí. La ausencia de presupuesto por sí sola no autoriza esa oferta; respete el modo informativo del turno.
Presente de uno a tres beneficios relevantes, solo los que ayudan a esta persona; no repita instalaciones ni rellene hasta llegar a tres.
No suponga que «se ve interesante» acepta una visita. No cree cita ni avise al asesor al ofrecerla.
${invite ? 'El sistema añadirá una invitación a una visita. El mapa se entrega solo al solicitarlo el cliente o al confirmar realmente la cita, nunca por esta invitación.' : 'No añada una invitación a visita en este turno; si el cliente la solicita expresamente el sistema coordina esa petición.'}
El plan de este turno es ${invite ? 'responder y ofrecer una visita; el sistema añade la invitación, NO escriba otra pregunta' : offerUnits ? 'responder el precio; el sistema ofrecerá revisar una unidad, NO escriba otra pregunta ni invite a una visita' : answerOnly ? 'responder sin otra pregunta comercial; no pida requisitos para dar información' : 'responder y opcionalmente aclarar un único dato útil' }.
No prometa reventa, arriendo, rentabilidad, disponibilidad, aprobación bancaria ni tiempos sin datos. No invente reservas, anticipos ni pasos legales de compra.
Si hay varias consultas, cubra cada una brevemente. Cerrar sin pregunta también es una respuesta completa.
${passiveSalesRules(engagement)}` }
}

export function salesIssues(reply: string, plan: ReturnType<typeof salesPlan>) {
  const r = normalized(reply), issues: string[] = []
  if (!plan.visits_allowed && /(?:le gustaria|podemos|puede|le invito|coordin|agend|visitenos).{0,50}(?:visita|visitarnos|conocerlo|conocer el lugar|verlo en persona)/.test(r)) issues.push('unsupported_fact')
  if (plan.launch && /(?:visitar|recorrer|conocer|ver).{0,30}(?:departamento|suite|vivienda).{0,20}(?:persona|presencial|construid)|(?:departamentos|suites) (?:terminados|construidos) disponibles/.test(r)) issues.push('unsupported_fact')
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
  return sentences.length === topics.length ? sentences.join(' ') : ''
}
