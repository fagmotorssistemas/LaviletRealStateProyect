import 'server-only'
import { activePrompt, aiJson, draftReply } from './ai'
import { db, object, scope, text, type Row } from './data'
import { nextDiscoveryQuestion, reviewReasons, reviewSchema, sdrState, styleIssues } from './sdr-rules'
import type { Guard } from './visits'
import { NATURAL_CONVERSATION_RULES, conversationalFirstName } from './conversation-style'
import { commercialMemory, commercialFallback, COMMERCIAL_EXPERIENCE_RULES, experienceContext, experienceIssues, PROJECT_POSITIONING, turnWritingRules } from './commercial-experience'
import { catalogReferenceReply, resolveCatalogReference } from './catalog-reference'
import { fabricatedActionRequest, mediaClarificationReply } from './clarification'
import { unitModelRequestReply } from './unit-model'

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
    db().from('projects').select('name,address,description').eq('id', scope.project_id).eq('tenant_id', scope.tenant_id).abortSignal(AbortSignal.timeout(10_000)).maybeSingle(),
    db().from('project_automation_config').select('mode,timezone,business_hours,visit_location_url').match(scope).abortSignal(AbortSignal.timeout(10_000)).maybeSingle(),
  ])
  if ([units, amenities, places, project, config].some(r => r.error)) throw new Error('COMMERCIAL_CONTEXT_FAILED')
  const settings = object(config.data), mode = text(settings.mode) || 'lanzamiento'
  const pricesAllowed = mode === 'preventa'
  const catalog = (units.data || []).map(row => ({ ...row, published_commercial_price: pricesAllowed ? row.published_commercial_price : null }))
  return { lead: { name: conversationalFirstName(text(lead.name)), preferred_category: lead.preferred_category, purchase_purpose: lead.purchase_purpose,
    preferred_bedrooms: lead.preferred_bedrooms, stage: lead.stage }, historial: history,
    conversacion: sdrState(lead, history), siguiente_pregunta: nextDiscoveryQuestion(lead),
    proyecto: project.data, modo_comercial: mode,
    posicionamiento_proyecto: PROJECT_POSITIONING,
    politica_comercial: { precios_autorizados: pricesAllowed && catalog.some(u => Number(u.published_commercial_price) > 0),
      confirmar_disponibilidad: false, confirmar_visita_sin_resultado: false, agendar_llamadas: false },
    catalogo: catalog, instalaciones: amenities.data, lugares_cercanos: places.data,
    horario_atencion: settings.business_hours,
    ubicacion: settings.visit_location_url,
    fecha: new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'full', timeStyle: 'short' }).format(new Date()) }
}

export async function commercialReply(info: Row, current: string, summary: Row, guard: Guard) {
  const memory = commercialMemory(info.memoria_comercial || summary._commercial_memory, info.historial, current)
  const mediaExplanation = mediaClarificationReply(current)
  if (mediaExplanation) return {reply:mediaExplanation,audit:{source:'media_clarification',rewritten:false,review_reasons:[],fallback:false}}
  if (fabricatedActionRequest(current)) return {reply:'Para confirmarle una cita o una reserva, primero debe quedar registrada y aprobada en el sistema. Puedo ayudarle a coordinarla.',audit:{source:'action_not_recorded',rewritten:false,review_reasons:[],fallback:false}}
  if (info.posicionamiento_proyecto && !/precio|metros|tama[nñ]o|qu[eé] (?:ofrece|incluye)|[mM]²/i.test(current) && /constructora|qui[eé]n(?:es)?[^?\n]*(?:constru|hizo|hace|hicieron|hacen)/i.test(current)) {
    const ownerToo = /due[nñ]o|propietario/i.test(current)
    return {reply:'Claro, la constructora que realizó el proyecto es Agmen.' + (ownerToo ? ' El nombre del propietario no lo tengo confirmado.' : ''), audit:{source:'project_builder',rewritten:false,review_reasons:[],fallback:false}}
  }
  const reference = object(info.referencia_unidad)
  const matches = Array.isArray(reference.matches) ? reference.matches.map(object)
    : resolveCatalogReference((Array.isArray(info.catalogo) ? info.catalogo : []).map(object), current, summary._unit_reference).matches
  const modelReply = unitModelRequestReply(matches, current, object(info.modelo_3d).se_adjunta_en_esta_respuesta === true)
  if (modelReply) return { reply: modelReply, audit: { source: 'unit_model_request', rewritten: false, review_reasons: [], fallback: false } }
  const unitReply = catalogReferenceReply(matches, current)
  if (unitReply) return {reply:unitReply, audit:{source:'catalog_reference',rewritten:false,review_reasons:[],fallback:false}}
  if (info.posicionamiento_proyecto && /asegur|garanti/i.test(current) && /precio|rentab|subir|plusval|valori/i.test(current)) {
    return { reply: 'La ubicación en Puertas del Sol es parte del atractivo para invertir. Podemos comparar las opciones según sus objetivos, pero no podemos garantizar que el precio suba ni una rentabilidad futura.', audit: { source: 'investment_expectations', rewritten: false, review_reasons: [], fallback: false } }
  }
  const [prompt, reviewer] = await Promise.all([activePrompt('respuesta_comercial'), activePrompt('revisor_respuesta')])
  const input = { ...experienceContext(info, current, memory), resumen: summary, mensaje_actual: current }
  const rules = NATURAL_CONVERSATION_RULES + '\n' + COMMERCIAL_EXPERIENCE_RULES + turnWritingRules(current, memory)
    + '\nEl campo modelo_3d indica si el sistema adjuntará el recorrido de la unidad en ESTA respuesta. Si está presente, responda la consulta brevemente sin ofrecer enviarlo después, pedir permiso ni afirmar que no existe. No escriba ni invente enlaces de modelos: el sistema añade el enlace verificado. Si no hay modelo_3d no prometa enviar un modelo. No confunda este recorrido con una cita presencial.'
  const reasons: string[] = []
  const warm = (answer: string) => /(?:informaci[oó]n|saber|cu[eé]nt|expl[ií]q|explica).*(?:proyecto|edificio)|(?:proyecto|edificio).*(?:informaci[oó]n|detalles)/i.test(current)
    && !/^(?:claro|con gusto|por supuesto|hola|buen[oa]s?)/i.test(answer.trim()) ? 'Claro, con mucho gusto. ' + answer : answer
  let reply = warm(await draftReply(prompt + rules, input))
  // One bounded rewrite; rejected drafts never reach Kommo.
  for (let attempt = 0; attempt < 2; attempt++) {
    await guard()
    const review = await aiJson(reviewer + rules, { ...input, respuesta: reply }, reviewSchema)
    const issues = [...styleIssues(reply, object(info.conversacion).ya_saludamos === true), ...experienceIssues(reply, current, info, memory)]
    if (reply.trim() === text(object(info.conversacion).ultima_respuesta).trim() && !/rep[ií]t|repita|otra vez|no entend[ií]/i.test(current)) issues.push('repeated_question')
    if (review.aprobada === true && !issues.length) return { reply, audit: { rewritten: attempt > 0, review_reasons: reasons, fallback: false } }
    reasons.push(...issues, ...(Array.isArray(review.motivos) ? review.motivos.filter(v => reviewReasons.includes(v as typeof reviewReasons[number])) as string[] : []))
    if (!attempt) {
      await guard()
      reply = warm(await draftReply(prompt + rules, { ...input, borrador_rechazado: reply, correcciones_requeridas: reasons,
        tarea: 'Reescriba en lenguaje sencillo y breve. Resuelva la consulta actual; no repita beneficios ni preguntas sobre datos que el cliente no sabe. Una pregunta útil es opcional, sin inventar hechos.' }))
    }
  }
  return { reply: commercialFallback(info, current, memory), audit: { rewritten: true, review_reasons: [...new Set(reasons)], fallback: true } }
}
