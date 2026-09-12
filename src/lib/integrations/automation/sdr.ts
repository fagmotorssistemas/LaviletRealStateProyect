import 'server-only'
import { activePrompt, aiJson, draftReply } from './ai'
import { db, object, scope, text, type Row } from './data'
import { nextDiscoveryQuestion, reviewReasons, reviewSchema, sdrState, styleIssues } from './sdr-rules'
import type { Guard } from './visits'
import { NATURAL_CONVERSATION_RULES, conversationalFirstName } from './conversation-style'
import { commercialMemory, commercialFallback, COMMERCIAL_EXPERIENCE_RULES, experienceContext, experienceIssues, PROJECT_POSITIONING, turnWritingRules } from './commercial-experience'

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
  if (info.posicionamiento_proyecto && /asegur|garanti/i.test(current) && /precio|rentab|subir|plusval|valori/i.test(current)) {
    return { reply: 'La ubicación en Puertas del Sol es parte del atractivo para invertir. Podemos comparar las opciones según sus objetivos, pero no podemos garantizar que el precio suba ni una rentabilidad futura.', audit: { source: 'investment_expectations', rewritten: false, review_reasons: [], fallback: false } }
  }
  const [prompt, reviewer] = await Promise.all([activePrompt('respuesta_comercial'), activePrompt('revisor_respuesta')])
  const input = { ...experienceContext(info, current, memory), resumen: summary, mensaje_actual: current }
  const rules = NATURAL_CONVERSATION_RULES + '\n' + COMMERCIAL_EXPERIENCE_RULES + turnWritingRules(current, memory)
  const reasons: string[] = []
  let reply = await draftReply(prompt + rules, input)
  // One bounded rewrite; rejected drafts never reach Kommo.
  for (let attempt = 0; attempt < 2; attempt++) {
    await guard()
    const review = await aiJson(reviewer + rules, { ...input, respuesta: reply }, reviewSchema)
    const issues = [...styleIssues(reply, object(info.conversacion).ya_saludamos === true), ...experienceIssues(reply, current, info, memory)]
    if (review.aprobada === true && !issues.length) return { reply, audit: { rewritten: attempt > 0, review_reasons: reasons, fallback: false } }
    reasons.push(...issues, ...(Array.isArray(review.motivos) ? review.motivos.filter(v => reviewReasons.includes(v as typeof reviewReasons[number])) as string[] : []))
    if (!attempt) {
      await guard()
      reply = await draftReply(prompt + rules, { ...input, borrador_rechazado: reply, correcciones_requeridas: reasons,
        tarea: 'Reescriba en lenguaje sencillo y breve. Resuelva la consulta actual; no repita beneficios ni preguntas sobre datos que el cliente no sabe. Una pregunta útil es opcional, sin inventar hechos.' })
    }
  }
  return { reply: commercialFallback(info, current, memory), audit: { rewritten: true, review_reasons: [...new Set(reasons)], fallback: true } }
}
