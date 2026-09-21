import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { isUnitVisualRequest } from './unit-visual-request'
import { sanitizeTourSpaces } from '@/lib/tour/tourRooms'

export function resolveCatalogReference(catalog: Row[], current: string, previous: unknown = {}, history: unknown = []) {
  // A vision description that qualifies the number as unreadable is not an identification.
  const readable = current.replace(/\[(?:Imagen|Archivo PDF):[\s\S]*?\]/g, block =>
    /(?:numero|titulo|codigo)[^.]*?(?:ilegible|no (?:se|es)|dudoso)|no (?:se (?:lee|distingue)|puedo leer)|podria ser|parece ser|posiblemente/i.test(normalized(block)) ? '' : block)
  const m = normalized(readable), saved = object(previous)
  const savedIds = Array.isArray(saved.ids) ? saved.ids : []
  const codes = [...m.matchAll(/\b(?:lc|local(?: comercial)?|depart[ae]mento|depto|dpto|apto|apartamento|suite|unidad|piso)\s*(?:numero\s*|n(?:ro|o)?\s*)?(\d{1,4})\b/g)]
  // «Cuánto cuesta el 502» also names a unit, not an amount or a floor.
  if (!codes.length && /\b(?:precio|valor|vale|valen|cuesta|cuestan|cost[oa])\b/.test(m)) {
    codes.push(...m.matchAll(/\b(?:el|del|la|de la)\s+(\d{3,4})\b/g))
  }
  // After the bot lists concrete options, clients commonly choose one with
  // phrases such as “me interesa la 210” without repeating “suite”.
  if (!codes.length && /\b(?:me interesa|prefiero|elijo|escojo|me quedo con|quiero|quisiera)\b/.test(m)) {
    codes.push(...m.matchAll(/\b(?:me interesa|prefiero|elijo|escojo|me quedo con|quiero|quisiera)(?:\s+(?:revisar|conocer|ver))?\s+(?:la|el|unidad)?\s*(\d{3,4})\b/g))
  }
  // A named project subject supersedes a remembered unit for this turn.
  const projectTopic=/\b(?:edificio|proyecto|areas comunes|amenidades)\b/.test(m)
  const largest=/\bdepartamento (?:mas grande|de mayor (?:superficie|area|tamano))\b/.test(m)
  if(!codes.length && largest) {
    const candidates=catalog.filter(u=>u.category==='departamento'&&u.is_published!==false&&(!u.status||u.status==='disponible'))
    // Do not silently ignore another constraint or rank units whose area is unknown.
    if(!/presupuesto|dormitorios?|habitaciones?|cuartos?|terraza|piso|planta|barato|economico|\bno\b/.test(m)&&candidates.length&&candidates.every(u=>Number(u.area_internal_m2)>0)) {
      const max=Math.max(...candidates.map(u=>Number(u.area_internal_m2)))
      const matches=candidates.filter(u=>Number(u.area_internal_m2)===max)
      return {explicit:true,hasUnitMention:true,matches,memory:{ids:matches.map(u=>u.id),numbers:matches.map(u=>u.unit_number)}}
    }
    return {explicit:false,hasUnitMention:false,matches:[],memory:{}}
  }
  if(!codes.length && projectTopic)return {explicit:false,hasUnitMention:false,matches:[],memory:{}}
  let matches = catalog.filter(u => codes.some(c => {
    const code = text(u.unit_number).replace(/\D/g, '')
    // Clients use “departamento” and “suite” interchangeably. Match the residential
    // number, then describe its actual catalog category; never cross into local codes.
    const category = /^(?:lc|local)/.test(c[0]) ? 'local' : /^unidad/.test(c[0]) ? null : 'residencial'
    if (/^piso/.test(c[0]) && c[1].length < 3) return false
    return Number(code) === Number(c[1]) && (!category || (category === 'residencial'
      ? ['suite', 'departamento', 'penthouse'].includes(text(u.category)) : u.category === category))
  }))
  const numbers = [...readable.matchAll(/\b\d{1,4}[.,]\d{1,2}\b/g)].map(n => Number(n[0].replace(',', '.')))
  if (!codes.length && !matches.length && numbers.length && /cual|el de|que ofrece|area|metros|m2|interior|exterior/.test(m)) {
    matches = catalog.filter(u => numbers.some(n => Math.abs(Number(u.area_internal_m2) - n) < .005))
  }
  if (!codes.length && !matches.length && /^(?:el |la )?\d{3,4}$/.test(m)) {
    const code = m.replace(/^(?:el|la) /, '')
    matches = catalog.filter(u => (savedIds.includes(u.id) || m !== code) && text(u.unit_number) === code)
  }
  const explicit = matches.length > 0
  const hasUnitMention = codes.length > 0 || (numbers.length > 0 && /cual|el de|que ofrece|area|metros|m2|interior|exterior/.test(m)) || /^(?:el |la )?\d{3,4}$/.test(m)
  let historyResolved = false
  // Recover the client's latest unit, including conversations whose old summary lost
  // it. Never infer interest from an alternative that only the bot proposed.
  if (!codes.length && !explicit && isUnitVisualRequest(readable)) {
    const clients = (Array.isArray(history) ? history : []).map(object).filter(r => r.role === 'cliente').reverse()
    for (const row of clients) {
      const candidate = resolveCatalogReference(catalog, text(row.content))
      if (candidate.hasUnitMention) {
        matches = candidate.matches; historyResolved = true; break
      }
      // A later change of property family supersedes an earlier concrete unit.
      if (/\b(?:ahora|mejor|prefiero|quiero|interesa)\b.*\b(?:local|suite|departamento)s?\b/.test(normalized(text(row.content)))) {
        historyResolved = true; break
      }
    }
  }
  // Only a real previously matched unit can give meaning to «ese», «qué ofrece» or «su precio».
  if (!codes.length && !explicit && !historyResolved && (/\b(?:ese|esa|este|esta)\b|que (?:ofrece|incluye|tiene)|su precio/.test(m) || isUnitVisualRequest(readable))) {
    matches = catalog.filter(u => savedIds.includes(u.id))
  }
  if (!codes.length && !historyResolved && !matches.length && /\b(?:ese|esa|este|esta)\b|precio|dueno|quien|que (?:ofrece|incluye|tiene)/.test(m)) {
    const recentImage = (Array.isArray(history) ? history : []).map(object).filter(r => r.role === 'cliente').slice(-4).reverse()
      .find(r => /\[Imagen:|\[Archivo PDF:/.test(text(r.content)) && (!r.sent_at || Date.now() - Date.parse(text(r.sent_at)) < 15 * 60_000))
    if (recentImage) matches = resolveCatalogReference(catalog, text(recentImage.content)).matches
  }
  return { explicit, hasUnitMention, matches, memory: matches.length ? { ids: matches.map(u => u.id), numbers: matches.map(u => u.unit_number) } : codes.length || historyResolved ? {} : saved }
}

export function catalogReferenceReply(matches: Row[], current: string) {
  if (!matches.length) return ''
  const m = normalized(current)
  if(/\b(?:edificio|proyecto|areas comunes|amenidades)\b/.test(m)&&!/\b(?:unidad|departamento|suite|local)\s+\d/.test(m))return ''
  if (!/cual|que (?:ofrece|tiene|incluye)|informacion|detalle|\[imagen|\[archivo/.test(m) || /precio|valor|cuanto cuesta|dueno|constructora/.test(m)) return ''
  const first = matches[0], number = (v: unknown) => Number(v).toLocaleString('es-EC', { maximumFractionDigits: 2 })
  const codes = matches.map(u => text(u.unit_number)).sort().join(', ')
  const opening = matches.length === 1 ? `Claro, se trata ${first.category === 'local' ? 'del local' : 'de la unidad'} ${codes}.`
    : `Claro, esa medida corresponde a las unidades ${codes}.`
  const area = Number(first.area_internal_m2) > 0 ? ` Tienen ${number(first.area_internal_m2)} m² interiores${Number(first.area_exterior_m2) > 0 ? ` y ${number(first.area_exterior_m2)} m² exteriores` : ''}.` : ''
  const common = sanitizeTourSpaces(Array.isArray(first.spaces) ? first.spaces : []).filter(s => matches.every(u => Array.isArray(u.spaces) && u.spaces.includes(s)))
  const spaces = common.length ? ` Incluyen ${common.slice(0, 6).map(s => text(s).toLocaleLowerCase('es')).join(', ')}.` : ''
  return opening + (matches.length === 1 ? area.replace(' Tienen', ' Tiene') + spaces.replace(' Incluyen', ' Incluye') : area + spaces + ' ¿Tiene algún piso de preferencia?')
}
