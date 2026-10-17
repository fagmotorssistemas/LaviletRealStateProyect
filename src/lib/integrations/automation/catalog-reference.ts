import { sanitizeTourSpaces } from '@/lib/tour/tourRooms'
import { object,text,type Row } from './data'
import { normalized } from './sdr-rules'
import { acceptedExtractorConfidence } from './extractor-confidence'

/** Resolve validated codes or saved IDs, never parse conversational text. */
export function resolveCatalogReference(catalog: Row[], current: string, previous: unknown = {}, _history: unknown = [], interpreted: unknown = {}) { void _history;
  const saved = object(previous), property = object(object(interpreted).property)
  const evidence = text(property.evidence).trim()
  const grounded = acceptedExtractorConfidence(property.confidence) && !!evidence
    && current.normalize('NFKC').toLowerCase().includes(evidence.normalize('NFKC').toLowerCase())
  const canonical = (value: unknown) => text(value).toUpperCase().replace(/^LC-?0*/, 'LC-').replace(/^0+/, '')
  const codes = grounded && Array.isArray(property.unit_numbers) ? property.unit_numbers.map(text) : []
  const matches = codes.length ? catalog.filter(unit => codes.map(canonical).includes(canonical(unit.unit_number))) : []
  return { explicit: codes.length > 0, hasUnitMention: codes.length > 0, matches, requestedCodes: codes,
    memory: matches.length ? { ids: matches.map(unit => unit.id), numbers: matches.map(unit => unit.unit_number) } : saved }
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
