import { object, text, type Row } from './data'

export const TURN_CONTEXT_REFERENCE_RULES = `El contexto usa una sola copia del catálogo en evidencia_turno.units y de sus agregaciones en evidencia_turno.groups. Un objeto con unit_ref remite a esa unidad; sus otros campos conservan datos particulares de esa aparición. Si contradicen la evidencia canónica, no los use para inventar un hecho. ref remite a la ruta indicada del mismo contexto. Son referencias internas, nunca texto para el cliente. Para factual_values.unit_id use el id de la fuente admitido por el esquema; unit_number es su número comercial, no un identificador intercambiable. Use las agregaciones calculadas para rangos y extremos; no convierta un rango en el precio de cada unidad. No interprete una referencia como ausencia de datos. Historial, borrador y base siguen sin ser evidencia de hechos nuevos.`
  + '\nSi contexto_verificado.catalog_context_scope indica complete_category, el catálogo cubre esa categoría. No deduzca que otras categorías no existen ni amplíe una afirmación a todo el proyecto. Use siempre el alcance y los miembros de la fuente citada.'
  + '\nSi catalog_context_scope.kind=project_overview, las unidades se omitieron porque esta presentación no las necesita: NO es una consulta con cero resultados ni prueba de falta de disponibilidad. No afirme precios, dimensiones, máximos ni ausencia de opciones a partir de ese catálogo omitido. Las fuentes de afirmaciones pueden referenciar su valor canónico mediante ref; consulte esa ruta, no la trate como una fuente vacía.'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/** Model-only projection. Validation and the saved audit retain the complete original evidence. */
export function compactTurnPromptContext(context: Row, options: { preserveUnitIds?: boolean } = {}): Row {
  const evidence = object(context.evidencia_turno)
  const units = rows(evidence.units)
  const byId = new Map(units.map(unit => [text(unit.id), unit]))
  const alias = new Map<string, string>()
  // The reviewer normalizer already resolves unique unit numbers to real IDs.
  // Never alias ambiguous numbers or names that could collide with another ID.
  for (const unit of options.preserveUnitIds ? [] : units) {
    const id = text(unit.id), number = text(unit.unit_number)
    if (id && number && units.filter(candidate => text(candidate.unit_number) === number).length === 1
      && !units.some(candidate => text(candidate.id) === number && candidate.id !== id)) alias.set(id, number)
  }
  const canonicalPaths = ['contrato_turno', 'property_context', 'estado_operativo', 'historial_reciente']
    .filter(key => context[key] && JSON.stringify(context[key]).length > 40)
  const memberships = new Map<string, string>()
  const sourceValue = (path: string): unknown => path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, context)
  const visit = (value: unknown, path: string): unknown => {
    if (typeof value === 'string') {
      const key = path.replace(/\.\d+$/, '').split('.').at(-1) || ''
      return /^(?:id|ids|unit_ref)$|_ids?$/.test(key) ? alias.get(value) ?? value : value
    }
    if (Array.isArray(value)) {
      if (path.startsWith('evidencia_turno.groups.') && path.endsWith('.member_ids')) {
        const key = JSON.stringify(value), previous = memberships.get(key)
        if (previous && key.length > previous.length + 12) return { ref: previous }
        if (!previous) memberships.set(key, path)
      }
      return value.map((item, index) => visit(item, `${path}.${index}`))
    }
    if (!value || typeof value !== 'object') return value
    const row = object(value)
    // Preserve every source and its provenance, without repeating the same
    // policy/project/operation payload already available at its canonical path.
    // A stale path or differing value must remain visible to the reviewer.
    if (/^evidencia_afirmaciones\.\d+$/.test(path) && 'value' in row
      && /^(?:contexto_verificado|estado_operativo)\./.test(text(row.path))
      && same(row.value, sourceValue(text(row.path)))) return {
      ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'value')
        .map(([key, entry]) => [key, visit(entry, `${path}.${key}`)])),
      value: { ref: row.path },
    }
    const canonicalPath = !canonicalPaths.includes(path)
      ? canonicalPaths.find(key => !key.startsWith(path + '.') && same(row, context[key])) : undefined
    if (canonicalPath) return { ref: canonicalPath }
    const unit = byId.get(text(row.id))
    // Deduplicate only repeated values. Extra or conflicting fields are retained,
    // never overwritten from the canonical catalog to make an answer appear valid.
    if (unit && !path.startsWith('evidencia_turno.units.')) return {
      unit_ref: alias.get(text(unit.id)) ?? unit.id,
      ...Object.fromEntries(Object.entries(row).filter(([key, entry]) => !same(entry, unit[key]))
        .map(([key, entry]) => [key, visit(entry, `${path}.${key}`)])),
    }
    return Object.fromEntries(Object.entries(row).map(([key, entry]) => [key, visit(entry, path ? `${path}.${key}` : key)]))
  }
  return visit(context, '') as Row
}
