import { object, text, type Row } from './data'

const valueScopes = ['individual', 'each_member', 'group_summary']

/** Only the focused reviewer receives this semantic dimension. The model
 * interprets distribution; the server never looks for "cada" or other prose. */
export function focusedValueScopeSchema(schema: Row, catalog?: Row[]): Row {
  const properties = { ...object(schema.properties) }, list = object(properties.factual_values)
  if (!Object.keys(list).length) return schema
  const decorate = (item: Row): Row => {
    if (Array.isArray(item.anyOf)) return { ...item, anyOf: item.anyOf.map(raw => decorate(object(raw))) }
    const fields = { ...object(item.properties) }
    delete fields.value_scope
    const scoped = { value_scope: { type: 'string', enum: valueScopes,
      description: 'individual: una unidad; each_member: la relación se afirma para cada miembro del grupo; group_summary: mínimo, máximo o rango del conjunto, sin afirmar igualdad entre miembros.' }, ...fields }
    const extractionOrder = ['value_scope', 'fragment', 'field', 'value', 'upper_value', 'measurement_unit', 'operator']
    const order = [...extractionOrder.filter(key => key in scoped),
      ...Object.keys(scoped).filter(key => key !== 'unit_id' && !extractionOrder.includes(key)),
      ...('unit_id' in scoped ? ['unit_id'] : [])]
    const ordered = Object.fromEntries(order.map(key => [key, (scoped as Row)[key]]))
    return { ...item, properties: ordered, required: Object.keys(ordered) }
  }
  if (catalog) {
    const restrict = (item: Row): Row[] => {
      if (Array.isArray(item.anyOf)) return item.anyOf.flatMap(raw => restrict(object(raw)))
      const fields = object(item.properties), declaredIds = object(fields.unit_id).enum
      const allowedIds = Array.isArray(declaredIds) ? declaredIds.filter((id): id is string => typeof id === 'string')
        : catalog.map(source => text(source.id))
      const available = catalog.filter(source => allowedIds.includes(text(source.id)))
      return [
        { scopes: ['individual'], ids: available.filter(source => !source.aggregation).map(source => text(source.id)) },
        { scopes: ['each_member', 'group_summary'], ids: available.filter(source => ['min', 'max', 'range'].includes(text(source.aggregation))).map(source => text(source.id)) },
      ].flatMap(({ scopes, ids }) => {
        if (!ids.length) return []
        const decorated = decorate(item), properties = object(decorated.properties)
        return [{ ...decorated, properties: { ...properties,
          value_scope: { ...object(properties.value_scope), enum: scopes },
          unit_id: { ...object(properties.unit_id), type: 'string', enum: [...new Set(ids)] },
        } }]
      })
    }
    const variants = restrict(object(list.items))
    return { ...schema, properties: { ...properties, factual_values: { ...list,
      ...(!variants.length ? { maxItems: 0 } : {}),
      items: variants.length ? { anyOf: variants } : { type: 'object', properties: {}, required: [], additionalProperties: false },
    } } }
  }
  return { ...schema, properties: { ...properties, factual_values: { ...list, items: decorate(object(list.items)) } } }
}

export const FOCUSED_VALUE_SCOPE_RULES = `ALCANCE DEL VALOR: indique value_scope en cada factual_values ANTES de elegir la fuente. individual corresponde a un inmueble identificado. each_member significa que cada unidad del grupo cumple la relación afirmada; seleccione el grupo completo de esas unidades. group_summary describe un mínimo, máximo o rango del conjunto, no el valor de cada unidad. Que el mínimo sea $225.000 no permite afirmar que todos cuestan $225.000; un rango de $225.000 a $275.000 tampoco afirma que todas las unidades tengan ambos precios. Si todos comparten realmente el mismo valor, each_member es válido y el sistema contrastará todos los miembros. Preserve el alcance que expresa el borrador al reparar la ficha; no transforme each_member en group_summary para hacer pasar una generalización falsa. Las cantidades escritas con palabras o cifras tienen el mismo alcance.`

function relation(actual: number, value: number, operator: string, upper: unknown) {
  switch (operator) {
    case 'eq': return actual === value
    case 'gt': return actual > value
    case 'gte': return actual >= value
    case 'lt': return actual < value
    case 'lte': return actual <= value
    case 'between': return typeof upper === 'number' && Number.isFinite(upper) && upper >= value && actual >= value && actual <= upper
    default: return false
  }
}

/** Check the quantified statement against every member of its exact source set.
 * Existing field/operator/source validators continue to run independently. */
export function focusedValueScopeIssues(input: unknown, catalog: Row[], requireScope = false): Row[] {
  if (!Array.isArray(input)) return []
  return input.flatMap(raw => {
    const fact = object(raw), scope = text(fact.value_scope)
    const base = { fragment: fact.fragment, unit_id: fact.unit_id, field: fact.field, value_scope: fact.value_scope,
      received: fact.value, owner: 'system', repair_owner: 'reviewer' }
    const metadata = (code: string, reason: string): Row[] => [{ ...base, code, kind: 'review_metadata', reason }]
    if (!scope && !requireScope) return []
    if (!valueScopes.includes(scope)) return metadata('invalid_numeric_value_scope', 'La ficha debe indicar si el valor describe una unidad, cada miembro o un resumen del grupo.')
    const source = catalog.find(row => row.id === fact.unit_id)
    if (!source) return [] // The independent source validator identifies the unknown ID.
    const grouped = ['min', 'max', 'range'].includes(text(source.aggregation))
    if (scope === 'individual') return grouped
      ? metadata('individual_value_uses_group', 'Un resumen del conjunto no identifica el valor de una unidad individual.') : []
    if (!grouped) return metadata('group_value_uses_individual', 'La afirmación sobre un conjunto necesita la fuente de ese conjunto completo, no una unidad aislada.')
    if (scope === 'group_summary') return []
    if (!Array.isArray(source.member_ids) || !source.member_ids.length
      || source.member_ids.some(id => typeof id !== 'string')
      || new Set(source.member_ids).size !== source.member_ids.length)
      return metadata('invalid_numeric_group_members', 'El grupo no tiene una lista completa e inequívoca de miembros para contrastar la afirmación universal.')
    const members = source.member_ids.map(id => catalog.find(row => row.id === id && !row.aggregation))
    const field = text(fact.field)
    if (members.some(member => !member || typeof member[field] !== 'number' || !Number.isFinite(member[field])))
      return metadata('numeric_group_members_unverified', 'Faltan unidades o valores exactos de los miembros del grupo; no puede aprobarse una afirmación sobre cada uno.')
    if (typeof fact.value !== 'number' || !Number.isFinite(fact.value)) return []
    const failing = members.filter(member => !relation(member![field] as number, fact.value as number, text(fact.operator) || 'eq', fact.upper_value))
    return failing.length ? [{ ...base, code: 'each_member_value_mismatch', kind: 'catalog_data',
      expected_members: members.map(member => ({ unit_id: member!.id, value: member![field] })),
      failing_member_ids: failing.map(member => member!.id),
      reason: 'La relación numérica afirmada para cada unidad no se cumple en todos los miembros del grupo. Un mínimo o máximo del conjunto no demuestra igualdad entre sus unidades.',
    }] : []
  })
}
