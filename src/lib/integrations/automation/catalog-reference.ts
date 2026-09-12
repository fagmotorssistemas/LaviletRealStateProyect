import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'

export function resolveCatalogReference(catalog: Row[], current: string, previous: unknown = {}, history: unknown = []) {
  const m = normalized(current), saved = object(previous)
  const savedIds = Array.isArray(saved.ids) ? saved.ids : []
  const codes = [...m.matchAll(/\b(?:lc|local(?: comercial)?|departamento|depto|suite|unidad)\s*(?:numero\s*|n\s*)?(\d{1,4})\b/g)]
  let matches = catalog.filter(u => codes.some(c => {
    const code = text(u.unit_number).replace(/\D/g, '')
    const category = /^(?:lc|local)/.test(c[0]) ? 'local' : /^suite/.test(c[0]) ? 'suite' : /^(?:departamento|depto)/.test(c[0]) ? 'departamento' : null
    return Number(code) === Number(c[1]) && (!category || u.category === category)
  }))
  const numbers = [...current.matchAll(/\b\d{1,4}[.,]\d{1,2}\b/g)].map(n => Number(n[0].replace(',', '.')))
  if (!matches.length && numbers.length && /cual|el de|que ofrece|area|metros|m2|interior|exterior/.test(m)) {
    matches = catalog.filter(u => numbers.some(n => Math.abs(Number(u.area_internal_m2) - n) < .005))
  }
  if (!matches.length && /^\d{3,4}$/.test(m)) matches = catalog.filter(u => savedIds.includes(u.id) && text(u.unit_number) === m)
  const explicit = matches.length > 0
  // Only a real previously matched unit can give meaning to «ese», «qué ofrece» or «su precio».
  if (!explicit && /\b(?:ese|esa|este|esta)\b|que (?:ofrece|incluye|tiene)|su precio/.test(m)) {
    matches = catalog.filter(u => savedIds.includes(u.id))
  }
  if (!matches.length && /\b(?:ese|esa|este|esta)\b|precio|dueno|quien|que (?:ofrece|incluye|tiene)/.test(m)) {
    const recentImage = (Array.isArray(history) ? history : []).map(object).filter(r => r.role === 'cliente').slice(-4).reverse()
      .find(r => /\[Imagen:|\[Archivo PDF:/.test(text(r.content)) && (!r.sent_at || Date.now() - Date.parse(text(r.sent_at)) < 15 * 60_000))
    if (recentImage) matches = resolveCatalogReference(catalog, text(recentImage.content)).matches
  }
  return { explicit, matches, memory: matches.length ? { ids: matches.map(u => u.id), numbers: matches.map(u => u.unit_number) } : saved }
}

export function catalogReferenceReply(matches: Row[], current: string) {
  if (!matches.length) return ''
  const m = normalized(current)
  if (!/cual|que (?:ofrece|tiene|incluye)|informacion|detalle|\[imagen|\[archivo/.test(m) || /precio|cuanto cuesta|dueno|constructora/.test(m)) return ''
  const first = matches[0], number = (v: unknown) => Number(v).toLocaleString('es-EC', { maximumFractionDigits: 2 })
  const codes = matches.map(u => text(u.unit_number)).sort().join(', ')
  const opening = matches.length === 1 ? `Claro, se trata ${first.category === 'local' ? 'del local' : 'de la unidad'} ${codes}.`
    : `Claro, esa medida corresponde a las unidades ${codes}.`
  const area = Number(first.area_internal_m2) > 0 ? ` Tienen ${number(first.area_internal_m2)} m² interiores${Number(first.area_exterior_m2) > 0 ? ` y ${number(first.area_exterior_m2)} m² exteriores` : ''}.` : ''
  const common = (Array.isArray(first.spaces) ? first.spaces : []).filter(s => matches.every(u => Array.isArray(u.spaces) && u.spaces.includes(s)))
  const spaces = common.length ? ` Incluyen ${common.slice(0, 6).map(s => text(s).toLocaleLowerCase('es')).join(', ')}.` : ''
  return opening + (matches.length === 1 ? area.replace(' Tienen', ' Tiene') + spaces.replace(' Incluyen', ' Incluye') : area + spaces + ' ¿Tiene algún piso de preferencia?')
}
