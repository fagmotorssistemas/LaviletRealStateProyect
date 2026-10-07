export const AREA_FACT_CATEGORIES = {
  sector_positioning: 'Descripción del sector', commercial_activity: 'Actividad comercial', nearby_services: 'Servicios cercanos',
  quality_of_life: 'Calidad de vida y seguridad del sector', urban_connectivity: 'Conectividad urbana', investment_positioning: 'Entorno para inversión',
} as const
export const AREA_FACT_AUDIENCES = { residential: 'Vivienda', commercial: 'Local comercial', investment: 'Inversión' } as const
export const AREA_FACT_MODES = { lanzamiento: 'Lanzamiento', preventa: 'Preventa', venta: 'Venta' } as const
export type AreaFactDraft = {
  headline: string; category: keyof typeof AREA_FACT_CATEGORIES; fact_text: string; safe_sales_text: string;
  source_name: string; source_url: string; verified_on: string;
  audiences: (keyof typeof AREA_FACT_AUDIENCES)[]; commercial_modes: (keyof typeof AREA_FACT_MODES)[]
}
export type ProjectAreaFact = {
  id: string; updatedAt: string; draft: AreaFactDraft; published: AreaFactDraft | null;
  status: 'draft' | 'published' | 'paused'
}
export type AreaFactCommand = { action: 'draft' | 'publish' | 'pause'; id: string; value?: unknown; expectedUpdatedAt: string | null; confirmed?: boolean }
export const AREA_FACT_COLUMNS = 'id,tenant_id,project_id,fact_key,headline,category,fact_text,safe_sales_text,source_name,source_url,verified_on,audiences,commercial_modes,review_status,approved_for_bot,updated_at,draft_content'
const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function emptyAreaFact(): AreaFactDraft {
  return { headline: '', category: 'quality_of_life', fact_text: '', safe_sales_text: '', source_name: '', source_url: '', verified_on: '',
    audiences: ['residential', 'commercial', 'investment'], commercial_modes: ['lanzamiento', 'preventa', 'venta'] }
}
export function validateAreaFact(value: unknown, publish = false, today = new Date().toISOString().slice(0, 10)): AreaFactDraft {
  const input = row(value)
  const labels: Record<string, string> = { headline: 'Título', fact_text: 'Hecho y límites confirmados', safe_sales_text: 'Redacción autorizada para el cliente', source_name: 'Fuente o responsable', source_url: 'Enlace de la fuente', verified_on: 'Fecha de verificación' }
  const field = (key: string, minimum: number, maximum: number) => {
    if (typeof input[key] !== 'string') throw Error('Revise los campos de la ficha del entorno.')
    const value = input[key].trim()
    if (value.length < minimum || value.length > maximum) throw Error('Revise «' + labels[key] + '»: debe contener entre ' + minimum + ' y ' + maximum + ' caracteres.')
    return value
  }
  const list = <T extends string>(key: string, allowed: Record<T, string>): T[] => {
    const values = input[key]
    if (!Array.isArray(values) || !values.length || values.length > Object.keys(allowed).length
      || values.some(value => typeof value !== 'string' || !Object.hasOwn(allowed, value)) || new Set(values).size !== values.length)
      throw Error('Seleccione al menos una opción válida de destinatarios y etapas.')
    return [...values] as T[]
  }
  const result: AreaFactDraft = {
    headline: field('headline', 3, 120), category: input.category as AreaFactDraft['category'], fact_text: field('fact_text', 10, 1200),
    safe_sales_text: field('safe_sales_text', 10, 700), source_name: field('source_name', 0, 600), source_url: field('source_url', 0, 1000),
    verified_on: field('verified_on', 0, 10), audiences: list('audiences', AREA_FACT_AUDIENCES), commercial_modes: list('commercial_modes', AREA_FACT_MODES),
  }
  if (!Object.hasOwn(AREA_FACT_CATEGORIES, result.category)) throw Error('Seleccione un tema válido del entorno.')
  if (result.source_url) {
    let url: URL
    try { url = new URL(result.source_url) } catch { throw Error('La fuente debe ser un enlace HTTPS válido.') }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw Error('La fuente debe ser un enlace HTTPS válido.')
  }
  if (result.verified_on && (!/^\d{4}-\d{2}-\d{2}$/.test(result.verified_on) || !Number.isFinite(Date.parse(result.verified_on))
    || new Date(result.verified_on).toISOString().slice(0, 10) !== result.verified_on || result.verified_on > today))
    throw Error('Indique una fecha de verificación válida que no sea futura.')
  if (publish && ((!result.source_name && !result.source_url) || !result.verified_on))
    throw Error('Para publicar, indique la fuente o responsable y la fecha en que se verificó la información.')
  return result
}
function content(value: unknown): AreaFactDraft {
  const input = row(value), fallback = emptyAreaFact()
  return { ...fallback, ...Object.fromEntries((Object.keys(fallback) as (keyof AreaFactDraft)[]).map(key => [key, input[key] ?? fallback[key]])) } as AreaFactDraft
}
export function projectAreaFact(value: unknown): ProjectAreaFact {
  const input = row(value), live = content(input), published = input.review_status === 'verified' && input.approved_for_bot === true
  return { id: String(input.id), updatedAt: String(input.updated_at), draft: input.draft_content ? content(input.draft_content) : live,
    published: published ? live : null, status: published ? 'published' : input.review_status === 'verified' ? 'paused' : 'draft' }
}
/** Draft writes preserve every published field; only an explicit publish approves bot use. */
export function areaFactChange(command: AreaFactCommand, existing: unknown, now: string) {
  if (!['draft', 'publish', 'pause'].includes(command.action) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command.id))
    throw Error('Operación inválida.')
  const current = row(existing)
  if (command.action === 'pause') {
    if (!current.id) throw Error('Ficha no disponible.')
    return { approved_for_bot: false, updated_at: now }
  }
  if (command.action === 'publish' && command.confirmed !== true) throw Error('Confirme que revisó la fuente y autoriza al bot a comunicar esta información.')
  const draft = validateAreaFact(command.value, command.action === 'publish', now.slice(0, 10))
  if (command.action === 'draft' && current.id) return { draft_content: draft, updated_at: now }
  return { ...draft, source_name: draft.source_name || null, source_url: draft.source_url || null, verified_on: draft.verified_on || null,
    draft_content: draft, updated_at: now, review_status: command.action === 'publish' ? 'verified' : 'draft', approved_for_bot: command.action === 'publish' }
}
