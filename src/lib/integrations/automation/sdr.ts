import 'server-only'
import { activePrompt, aiJson, draftReply } from './ai'
import { db, object, scope, text, type Row } from './data'
import { nextDiscoveryQuestion, reviewReasons, reviewSchema, sdrState, styleIssues } from './sdr-rules'
import type { Guard } from './visits'
import { NATURAL_CONVERSATION_RULES, conversationalFirstName } from './conversation-style'
import { commercialMemory, commercialFallback, COMMERCIAL_EXPERIENCE_RULES, experienceContext, experienceIssues, PROJECT_POSITIONING, turnWritingRules, unresolvedCommercialReply, projectOverviewReply, RESIDENTIAL_CONTINUITY_RULES } from './commercial-experience'
import { catalogReferenceReply, resolveCatalogReference } from './catalog-reference'
import { fabricatedActionRequest, mediaClarificationReply } from './clarification'
import { unitModelRequestReply } from './unit-model'
import { salesPlan, salesIssues, salesTopicReply, mentionsFinancing } from './sales-policy'
import { passiveSalesCopy } from './commercial-engagement'
import { openingWritingRules, variedReplyOpening } from './response-openings'
import { botPricingPolicy, launchPricesVisible } from '@/lib/inmobiliaria/unitPrices'
import { acceptedPriceOption, budgetOptionsReply, PRICE_REPLY_RULES, priceReplyIssues, statedBudget, unitPriceQuote } from './price-reply'
import { priceFinancingReply } from './financing'
import { botVisitPolicy } from '@/lib/inmobiliaria/botVisits'
import { brochureReply, BROCHURE_URL, LAUNCH_PROJECT_RULES, vehicleScopeReply, wantsBrochure } from './project-material'
import { botReadiness, projectReadiness, readinessRules, readinessMaterialReply, type ProjectReadiness } from '@/lib/inmobiliaria/projectReadiness'
import { salesSubject } from './sales-subject'
import { unitRecommendation } from './unit-recommendation'
import { recommendationClarification } from './commercial-accuracy'
import { locationRequestKind, withVisitLocation } from './visit-location'
import { completeTurnAnswer, turnAnswerFacts } from './turn-answer'
import { commercialCoverageIssues } from './multi-topic-turn'
import { houseProductReply, PRODUCT_FIT_RULES } from './product-fit'
import { unitAlternative } from './unit-alternatives'

export async function publishedUnitCatalog() {
  const result = await db().from('units').select('id,category,unit_number,floor,floor_number,bedrooms,bathrooms_full,area_internal_m2,area_exterior_m2,area_total_m2,description,spaces')
    .match(scope).eq('is_published', true).eq('status', 'disponible').limit(100).abortSignal(AbortSignal.timeout(10_000))
  if (result.error) throw Error('UNIT_CONTEXT_FAILED')
  return (result.data || []) as Row[]
}

export async function commercialContext(lead: Row, history: unknown) {
  const [units, amenities, places, project, config] = await Promise.all([
    db().from('units').select('id,category,unit_number,floor,floor_number,bedrooms,bathrooms_full,area_internal_m2,area_exterior_m2,area_total_m2,published_commercial_price,description,spaces')
      .match(scope).eq('is_published', true).eq('status', 'disponible').limit(100).abortSignal(AbortSignal.timeout(10_000)),
    db().from('project_amenities').select('category,amenity_name,description').eq('project_id', scope.project_id).limit(100).abortSignal(AbortSignal.timeout(10_000)),
    db().from('location_pois').select('poi_name,poi_category').eq('project_id', scope.project_id).limit(100).abortSignal(AbortSignal.timeout(10_000)),
    db().from('projects').select('name,address,description,policies_json').eq('id', scope.project_id).eq('tenant_id', scope.tenant_id).abortSignal(AbortSignal.timeout(10_000)).maybeSingle(),
    db().from('project_automation_config').select('mode,timezone,business_hours,visit_location_url').match(scope).abortSignal(AbortSignal.timeout(10_000)).maybeSingle(),
  ])
  if ([units, amenities, places, project, config].some(r => r.error)) throw new Error('COMMERCIAL_CONTEXT_FAILED')
  const settings = object(config.data), mode = text(settings.mode) || 'lanzamiento'
  const projectData = object(project.data)
  const pricing = botPricingPolicy(mode, launchPricesVisible(projectData.policies_json))
  const pricesAllowed = pricing.visible
  const catalog = (units.data || []).map(row => ({ ...row, published_commercial_price: pricesAllowed ? row.published_commercial_price : null }))
  return { lead: { name: conversationalFirstName(text(lead.name)), preferred_category: lead.preferred_category, purchase_purpose: lead.purchase_purpose,
    preferred_bedrooms: lead.preferred_bedrooms, stage: lead.stage }, historial: history,
    conversacion: sdrState(lead, history), siguiente_pregunta: nextDiscoveryQuestion(lead),
    proyecto: { name: projectData.name, address: projectData.address, description: projectData.description }, modo_comercial: mode,
    politica_visitas: botVisitPolicy(projectData.policies_json, mode),
    estado_proyecto: projectReadiness(projectData.policies_json,mode).configured ? botReadiness(projectReadiness(projectData.policies_json,mode).value) : null,
    posicionamiento_proyecto: PROJECT_POSITIONING,
    politica_comercial: { precios_autorizados: pricesAllowed && catalog.some(u => Number(u.published_commercial_price) > 0),
      precios_aproximados: pricing.approximate,
      confirmar_disponibilidad: false, confirmar_visita_sin_resultado: false, agendar_llamadas: false },
    alcance_producto: 'La Vilet ofrece suites, departamentos y locales comerciales en Cuenca; no casas independientes.',
    politica_financiera: { credito_directo: false,
      informacion_bancaria_verificada: 'No hay información verificada sobre aceptación o rechazo de arriendos futuros como respaldo. Esto NO es una prohibición del proyecto. Mencione esa incertidumbre solo si el cliente pregunta específicamente por ese respaldo.' },
    catalogo: catalog, instalaciones: amenities.data, lugares_cercanos: places.data,
    condiciones_instalaciones: 'El catálogo describe instalaciones, pero no contiene condiciones verificadas sobre cuotas de condominio, membresías o pagos por usarlas. No deducir gratuidad ni pagos adicionales de su existencia. Si preguntan esos costos o condiciones, debe verificarlos el equipo.',
    horario_atencion: settings.business_hours,
    ubicacion: settings.visit_location_url,
    fecha: new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'full', timeStyle: 'short' }).format(new Date()) }
}

export async function commercialReply(info: Row, current: string, summary: Row, guard: Guard) {
  const clarification=recommendationClarification(info,current)
  if(clarification)return {reply:clarification,audit:{source:'recommendation_clarification',fallback:false}}
  if(info.estado_proyecto) {
    const material=readinessMaterialReply(info.estado_proyecto as ProjectReadiness,current)
    if(material)return {reply:material,audit:{source:'project_material',fallback:false}}
  }
  const house = houseProductReply(current, text(object(info.conversacion).ultima_respuesta))
  if (house) {
    const finance = object(info.financiamiento), partners = Array.isArray(finance.partners) ? finance.partners.map(text) : []
    return { reply: house + (mentionsFinancing(current) ? ' ' + priceFinancingReply(current, { partners, current: object(finance.current) }) : ''), audit: { source: 'product_clarification', fallback: false } }
  }
  const offTopic = ['property', 'mixed'].includes(text(info.alcance_negocio)) ? '' : vehicleScopeReply(current, info.historial)
  if (offTopic) return { reply: offTopic, audit: { source: 'vehicle_out_of_scope', fallback: false } }
  const material = brochureReply(current, info.historial, text(info.modo_comercial),!!info.estado_proyecto)
  if (material) return { reply: material, audit: { source: 'brochure', brochure_sent: true, fallback: false } }
  const acceptedOption = acceptedPriceOption(info, current, summary)
  if (acceptedOption) return acceptedOption
  const memory = commercialMemory(info.memoria_comercial || summary._commercial_memory, info.historial, current)
  const attachBrochure = wantsBrochure(current, info.historial)
  const quote = unitPriceQuote(info, current, summary)
  const alternative = !quote ? unitAlternative(info,current,statedBudget(current)) : null
  if(alternative)return {reply:alternative.reply,audit:{source:'unit_alternative',fallback:false,alternative_unit_id:alternative.unit?.id||null}}
  const budgetOptions=budgetOptionsReply(info,current)
  if(budgetOptions && !quote)return {reply:budgetOptions,audit:{source:'budget_options',fallback:false}}
  const turnAnswers = turnAnswerFacts(info, current, summary)
  const budget = statedBudget(current)
  const finance = object(info.financiamiento)
  const partners = Array.isArray(finance.partners) ? finance.partners.map(text).filter(Boolean) : []
  if (!quote && turnAnswers.topics.every(topic => ['affordability', 'financing'].includes(topic)) && budget !== null && budget < 1000 && partners.length && !/no (?:quiero|necesito|deseo).*financ|sin credito/i.test(current)) {
    return { reply: `Podemos acompañarle a revisar opciones de financiamiento con ${partners.join(' o ')}. ¿Le gustaría que iniciemos la revisión de su caso?`, audit: { source: 'budget_financing_guidance', fallback: false } }
  }
  const plan = salesPlan({ ...info, precio_cotizado: quote?.quoted === true, unidades_cotizadas: quote?.units }, current, summary)
  const finish = (reply: string, audit: Row) => {
    if (quote?.needsAdvisor) return { reply, audit: { ...audit, requires_advisor: true, handoff_reason: 'precio por verificar' } }
    // Safe fallbacks must obey the same stopping rule as generated drafts.
    const completed = completeTurnAnswer(reply, turnAnswers)
    if (unresolvedCommercialReply(completed.reply)) return { reply: completed.reply, audit: { ...audit, requires_advisor: true, handoff_reason: 'consulta sin respuesta verificada' } }
    if (completed.missing.length) return { reply: completed.reply, audit: { ...audit, requires_advisor: true,
      handoff_reason: 'resolver las consultas pendientes: ' + completed.missing.join(', '), unanswered_topics: completed.missing } }
    let answer = plan.action !== 'discover' ? completed.reply.replace(/\s*¿[^?]+\?\s*$/, '').trim() || completed.reply : completed.reply
    if (quote?.financingOffer && !mentionsFinancing(answer)) answer += ' ' + quote.financingOffer
    const shareMaterial = attachBrochure || plan.action === 'share_brochure'
    if (shareMaterial && !answer.includes(BROCHURE_URL)) answer += `\n\nLe comparto el brochure para que pueda explorar la propuesta${info.modo_comercial === 'lanzamiento' ? '; las imágenes ilustran cómo está previsto el proyecto' : ''}: ${BROCHURE_URL}`
    answer += plan.closing && !/[¿?]/.test(answer) ? ' ' + plan.closing : ''
    return { reply: withVisitLocation(answer, info, !!locationRequestKind(current)), audit: { ...audit, ...(shareMaterial ? { brochure_sent: true } : {}), sales_action: plan.action, sales_topics: plan.topics, answered_topics: turnAnswers.topics } }
  }
  const overview = projectOverviewReply(info, current)
  if (overview && !/precio|valor|financ|credito|cuanto|dormitorio|\b\d{3}\b|visita|cita|constructora|entrega|ubicacion|sector|alrededor|cerca/i.test(current)) return finish(overview + `\n\nAquí puede conocer la propuesta con más detalle: ${BROCHURE_URL}`, { source: 'project_overview', brochure_sent: true, fallback: false })
  const mediaExplanation = mediaClarificationReply(current)
  if (mediaExplanation) return {reply:mediaExplanation,audit:{source:'media_clarification',rewritten:false,review_reasons:[],fallback:false}}
  if (fabricatedActionRequest(current)) return {reply:'Para confirmarle una cita o una reserva, primero debe quedar registrada y aprobada en el sistema. Puedo ayudarle a coordinarla.',audit:{source:'action_not_recorded',rewritten:false,review_reasons:[],fallback:false}}
  if (quote && turnAnswers.topics.every(topic => ['price', 'options', 'affordability', 'financing'].includes(topic)) && !/qu[eé] (?:incluye|ofrece|tiene)|cu[aá]ntos dormitorios|c[oó]mo|por qu[eé]|ubicaci[oó]n|d[oó]nde|sector|jard[ií]n|distribuci[oó]n|constructora|due[nñ]o|foto|imagen|modelo|plano|descuento|negocia|cuota|entrada/i.test(current.replace(/jard[ií]n\s*(?:azuayo|zauayo)/gi, ''))) {
    const finance = object(info.financiamiento), partners = Array.isArray(finance.partners) ? finance.partners.map(text) : []
    const financing = mentionsFinancing(current) ? priceFinancingReply(current, { partners, current: object(finance.current) }) : ''
    return finish(quote.reply + (financing ? ' ' + financing : ''), { source: 'unit_price', approximate: object(info.politica_comercial).precios_aproximados === true, fallback: false })
  }
  if (!quote && info.posicionamiento_proyecto && !/precio|metros|tama[nñ]o|qu[eé] (?:ofrece|incluye)|[mM]²/i.test(current) && /constructora|qui[eé]n(?:es)?[^?\n]*(?:constru|hizo|hace|hicieron|hacen)/i.test(current)) {
    const ownerToo = /due[nñ]o|propietario/i.test(current)
    return {reply:'La constructora del proyecto es Agmen.' + (ownerToo ? ' El nombre del propietario no lo tengo confirmado.' : ''), audit:{source:'project_builder',rewritten:false,review_reasons:[],fallback:false, ...(ownerToo ? { requires_advisor: true, handoff_reason: 'confirmar propietario' } : {})}}
  }
  const reference = object(info.referencia_unidad)
  const matches = Array.isArray(reference.matches) ? reference.matches.map(object)
    : resolveCatalogReference((Array.isArray(info.catalogo) ? info.catalogo : []).map(object), current, summary._unit_reference).matches
  const modelReply = unitModelRequestReply(matches, current, object(info.modelo_3d).se_adjunta_en_esta_respuesta === true)
  if (modelReply && !quote) return finish(modelReply, { source: 'unit_model_request', rewritten: false, review_reasons: [], fallback: false })
  if (plan.positive_after_model) return finish(plan.memory.visit_declined ? 'Me alegra que le haya gustado. Puede explorar los espacios a su ritmo en el recorrido.' : 'Me alegra que le haya gustado. El recorrido le permite explorar la distribución y ver cómo encaja con lo que busca.', { source: 'interest_after_model', fallback: false })
  if (!quote && memory.deferred_fields.includes('presupuesto') && /no (?:sé|se|estoy segur|tengo claro|tengo idea)/i.test(current) && !/sector|jard[ií]n|precio|dormitorio|foto/i.test(current)) {
    const alreadyHelped = /entrada y una cuota|cuota mensual.*c[oó]modo/.test(text(object(info.conversacion).ultima_respuesta))
    return finish(alreadyHelped ? 'Está bien, puede definirlo con calma. Por ahora podemos revisar qué opción se adapta a sus necesidades, sin fijar todavía un presupuesto.' : 'Podemos orientarle partiendo de una entrada y una cuota mensual con las que se sienta cómodo, sin comprometerse todavía. ¿Le ayudaría revisar las opciones de financiamiento?', { source: 'budget_guidance', fallback: false })
  }
  const unitReply = catalogReferenceReply(matches, current)
  if (unitReply && !quote) return finish(unitReply, {source:'catalog_reference',rewritten:false,review_reasons:[],fallback:false})
  const recommendation = !quote ? unitRecommendation(info, current, summary) : null
  if (recommendation) return finish(recommendation.reply, recommendation.audit)
  if (info.posicionamiento_proyecto && /asegur|garanti/i.test(current) && /precio|rentab|subir|plusval|valori/i.test(current)) {
    return { reply: 'La ubicación en Puertas del Sol es parte del atractivo para invertir. Podemos comparar las opciones según sus objetivos, pero no podemos garantizar que el precio suba ni una rentabilidad futura.', audit: { source: 'investment_expectations', rewritten: false, review_reasons: [], fallback: false } }
  }
  const [prompt, reviewer] = await Promise.all([activePrompt('respuesta_comercial'), activePrompt('revisor_respuesta')])
  const input = { ...experienceContext(info, current, memory), consultas_del_turno: turnAnswers.topics, respuestas_verificadas: turnAnswers.facts, tema_actual: salesSubject(current, info.historial), respuesta_precio_verificada: quote?.reply || null, siguiente_pregunta: plan.action === 'discover' ? info.siguiente_pregunta : null, plan_comercial: plan, resumen: summary, mensaje_actual: current }
  const rules = NATURAL_CONVERSATION_RULES + '\n' + COMMERCIAL_EXPERIENCE_RULES + RESIDENTIAL_CONTINUITY_RULES + turnWritingRules(current, memory) + openingWritingRules(info.historial) + '\n' + PRICE_REPLY_RULES + '\n' + PRODUCT_FIT_RULES
    + '\nResponda cada tema de consultas_del_turno y cualquier otra solicitud del turno, incluso si llegó en otro mensaje consecutivo o no tiene signo de pregunta. La lista de temas es orientativa, no exhaustiva. Integre respuestas_verificadas con naturalidad; una duda de si le alcanza merece orientación financiera, no otra pregunta de presupuesto. La cantidad de vehículos propios es una necesidad de estacionamiento, no una compra de vehículos. No omita dudas por brevedad ni por una respuesta de financiamiento. El mapa se añade solo si el cliente lo pidió o al confirmar realmente la cita; no lo incluya en invitaciones, propuestas, precios ni modelos. Ante opciones ambiguas, dé alternativas breves según los referentes plausibles sin repetir una negativa anterior.'
    + (attachBrochure ? '\nEl sistema adjuntará el brochure solicitado. Responda las demás consultas sin prometer enviarlo después, preguntar si desea recibirlo o afirmar que no está disponible.' : '')
    + (info.estado_proyecto ? '\n' + readinessRules(info.estado_proyecto as ProjectReadiness) : info.modo_comercial === 'lanzamiento' ? '\n' + LAUNCH_PROJECT_RULES : '')
    + '\nEl tema_actual separa el producto del tipo de pregunta. Si subject es property, responda sobre inmuebles; no vuelva a corregir consultas anteriores sobre vehículos que el cliente ya dejó atrás. Una pregunta de crédito sobre una moto no cuenta como orientación financiera para una vivienda.'
    + '\nEstas decisiones del turno prevalecen sobre preguntas o cierres genéricos del guion: ' + plan.rules
    + '\nEl campo modelo_3d indica que se adjunta material en ESTA respuesta. Si modelo_especifico_disponible=false, es una ficha de la unidad con referencia general del proyecto: no describa la geometría como si fuera la unidad solicitada. Si está presente, responda en menos de 850 caracteres sin ofrecer enviarlo después, pedir permiso ni afirmar que no existe. No escriba ni invente enlaces: el sistema añade texto_de_entrega. Si no hay modelo_3d no prometa enviar un modelo. No confunda este material con una cita presencial.'
  const reasons: string[] = []
  let reply = variedReplyOpening(await draftReply(prompt + rules, input), info.historial)
  // One bounded rewrite; rejected drafts never reach Kommo.
  for (let attempt = 0; attempt < 2; attempt++) {
    await guard()
    const review = await aiJson(reviewer + rules + '\nDevuelva además requiere_asesor=true SOLO si una pregunta inmobiliaria concreta no puede resolverse con los hechos del contexto y debe verificarla el equipo. No lo active por estilo, una preferencia aún sin elegir, preguntas sobre otros negocios, ni enlaces o agenda que el sistema adjunta/procesa. Tampoco por falta de una fecha de entrega: puede explicar que aún no se ha definido. Si hay datos suficientes, corrija el borrador en vez de derivar.', { ...input, respuesta: reply }, reviewSchema, undefined, undefined, undefined, 'review')
    if (review.requiere_asesor === true) return { reply: '', audit: { source: 'verified_information_gap', requires_advisor: true, handoff_reason: 'consulta inmobiliaria que requiere información del equipo', fallback: false } }
    const issues = [...styleIssues(reply, object(info.conversacion).ya_saludamos === true), ...experienceIssues(reply, current, info, memory), ...salesIssues(reply, plan), ...priceReplyIssues(reply, info, current, quote?.prices), ...commercialCoverageIssues(reply, turnAnswers.topics)]
    if (quote?.quoted && !/\$\s*\d|\d[\d.,]*\s*(?:USD|d[oó]lares)/i.test(reply)) issues.push('ignored_question')
    if (quote?.quoted && !quote.financingOffer && !mentionsFinancing(current) && mentionsFinancing(reply)) issues.push('repeated_question')
    if (reply.trim() === text(object(info.conversacion).ultima_respuesta).trim() && !/rep[ií]t|repita|otra vez|no entend[ií]/i.test(current)) issues.push('repeated_question')
    const reviewIssues = Array.isArray(review.motivos) ? review.motivos.map(text) : []
    const onlyStyle = attempt > 0 && reply.length <= 900 && reviewIssues.length > 0 && reviewIssues.every(reason => ['style', 'missing_next_step'].includes(reason)) && issues.every(reason => reason === 'style')
    const unsolicitedOffer = passiveSalesCopy(reply, current, plan.engagement) !== reply
    if (unsolicitedOffer) issues.push('unsolicited_sales_offer')
    if ((review.aprobada === true && !issues.length) || (onlyStyle && !unsolicitedOffer)) return finish(reply, { rewritten: attempt > 0, review_reasons: reasons, fallback: false, ...(onlyStyle ? { style_review_only: true } : {}) })
    reasons.push(...issues, ...(Array.isArray(review.motivos) ? review.motivos.filter(v => reviewReasons.includes(v as typeof reviewReasons[number])) as string[] : []))
    if (!attempt) {
      await guard()
      reply = variedReplyOpening(await draftReply(prompt + rules, { ...input, borrador_rechazado: reply, correcciones_requeridas: reasons,
        tarea: 'Reescriba en lenguaje sencillo y breve. Resuelva la consulta actual; no repita beneficios ni preguntas sobre datos que el cliente no sabe. Una pregunta útil es opcional, sin inventar hechos.' }), info.historial)
    }
  }
  return finish(quote?.reply || salesTopicReply(info, current) || commercialFallback(info, current, memory), { rewritten: true, review_reasons: [...new Set(reasons)], fallback: true })
}
