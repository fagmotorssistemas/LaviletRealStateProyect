import { WEEK_ONE_BROCHURE_BODY, WEEK_ONE_FOLLOWUP_BODY, type NutritionWeekOneConfig } from '@/lib/inmobiliaria/nutritionWeekOne'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { resolveCatalogReference } from './catalog-reference'

export type WeekOneChoice = { kind: 'brochure' | 'followup'; action: string; topic: string; body: string; unitId?: string; reason: string }
/** Only actual outgoing material counts. A promise or a client's pasted link does not. */
export function sharedBrochure(messages: Row[], leads: Row[] = []) {
  if (leads.some(l => object(object(l.behavior_signals)._nutrition_resources).brochure === true)) return true
  return messages.some(m => {
    if (!['bot', 'asesor'].includes(text(m.role))) return false
    const audit = object(m.tool_calls)
    if (['rejected', 'failed', 'not_sent'].includes(text(audit.provider_status))) return false
    return audit.brochure_sent === true || object(audit.nutrition_week_one).kind === 'brochure'
      || /https:\/\/(?:www\.)?lavilett\.com\/(?:brochure(?:[\s/?#]|$)|materiales\/brochure-la-vilet[^\s]*)/i.test(text(m.content) + ' ' + text(m.media_url))
  })
}
export function weekOneChoice(c: NutritionWeekOneConfig, lead: Row, history: Row[], outbound: Row[], catalog: Row[], brochureShared: boolean, options: { financing: boolean; visits: boolean }) : WeekOneChoice | null {
  if (!brochureShared && c.brochureEnabled) return { kind: 'brochure', action: 'project_brochure', topic: '', body: WEEK_ONE_BROCHURE_BODY, reason: 'brochure_not_shared' }
  if (c.alreadyShared === 'skip') return null
  const clients = history.filter(m => m.role === 'cliente').slice(-4)
  // A new property choice supersedes old preferences, even before the summary updates.
  const recentChoice = clients.findLastIndex(m => /\b(?:local|suite|departamento|vivienda|dormitorio)s?\b/.test(normalized(text(m.content))))
  const relevantClients = recentChoice >= 0 ? clients.slice(recentChoice) : clients
  const recent = normalized(relevantClients.map(m => text(m.content)).join(' '))
  const latest = text(clients.at(-1)?.content)
  const actionsUsed = new Set(outbound.map(m => text(object(object(m.tool_calls).nutrition_week_one).action)))
  const candidates: Omit<WeekOneChoice, 'kind' | 'body' | 'reason'>[] = []
  if (c.financing && options.financing && /presupuesto|financ|credito|no se si.*alcanz|no me alcanza|pichincha|\bjep\b/.test(recent)
    && !/no (?:quiero|necesito|deseo).*financ|pago (?:de )?contado/.test(normalized(latest))) candidates.push({ action: 'financing_options', topic: 'revisar las opciones de financiamiento disponibles' })
  const reference = resolveCatalogReference(catalog, relevantClients.map(m => text(m.content)).join('\n'))
  const latestCategory = /\blocal/.test(recent) ? 'local' : /suite/.test(recent) ? 'suite' : /departamento|vivienda|dormitorio/.test(recent) ? 'departamento' : ''
  const unit = reference.hasUnitMention ? reference.matches.length === 1 ? reference.matches[0] : null
    : catalog.find(u => u.id === lead.unit_id && (!latestCategory || u.category === latestCategory))
  if (c.unitDetails && unit && /^[A-Za-z0-9-]{1,12}$/.test(text(unit.unit_number))) {
    const category = unit.category === 'suite' ? 'la suite' : unit.category === 'local' ? 'el local' : 'el departamento'
    candidates.push({ action: `unit_details:${unit.id}`, unitId: text(unit.id), topic: `conocer la distribución de ${category} ${unit.unit_number}`.replace('de el ', 'del ') })
  }
  if (c.visits && options.visits && /visita|visitar|conocer en persona|oficina/.test(recent) && !/no (?:quiero|puedo|deseo).*visita/.test(recent)) candidates.push({ action: 'office_visit', topic: 'coordinar una visita a nuestra oficina' })
  const category = latestCategory || text(lead.preferred_category)
  if (c.comparison && category && catalog.filter(u => u.category === category).length >= 2) {
    const label = category === 'local' ? 'locales comerciales' : category === 'suite' ? 'suites' : 'departamentos'
    candidates.push({ action: `compare:${category}`, topic: `comparar las opciones de ${label} disponibles` })
  }
  const selected = candidates.find(a => !actionsUsed.has(a.action))
  return selected ? { ...selected, kind: 'followup', body: WEEK_ONE_FOLLOWUP_BODY.replace('{{1}}', selected.topic), reason: brochureShared ? 'brochure_already_shared_relevant_followup' : 'brochure_disabled_relevant_followup' } : null
}

/** Resolve a bare acceptance against the exact last offer; never turn it into credit consent. */
export function nutritionContinuation(current: string, history: unknown) {
  const rows = (Array.isArray(history) ? history : []).map(object)
  const last = rows.findLast(m => ['bot', 'asesor'].includes(text(m.role)))
  if (!last || last.role !== 'bot') return null
  const content = text(last.content).trim()
  const [before, after] = WEEK_ONE_FOLLOWUP_BODY.split('{{1}}')
  if (!content.startsWith(before) || !content.endsWith(after)) return null
  const topic = content.slice(before.length, -after.length)
  const answer = normalized(current).replace(/^(?:hola|buenas|saludos)\s+/, '')
  if (!/^(?:si(?: claro| por favor| gracias| me interesa| quiero| me gustaria)?|claro(?: que si)?|por supuesto|de acuerdo|ok|esta bien|perfecto|adelante|me interesa|hagamoslo|si continuemos|continuemos|me gustaria|si con gusto)$/.test(answer)) return null
  const known = /^(?:conocer la distribuci[oó]n (?:del departamento|de la suite|del local) [a-z0-9-]{1,12}|comparar las opciones de (?:departamentos|suites|locales comerciales) disponibles|comparar las opciones de dos y tres dormitorios|revisar las opciones de financiamiento disponibles|coordinar una visita a nuestra oficina)$/i.test(topic)
  if (!known) return null
  return { original: current, topic, message: topic === 'revisar las opciones de financiamiento disponibles'
    ? 'Quiero información sobre las opciones de financiamiento disponibles.' : `Quiero ${topic}.`, sourceMessageId: text(last.id) }
}
