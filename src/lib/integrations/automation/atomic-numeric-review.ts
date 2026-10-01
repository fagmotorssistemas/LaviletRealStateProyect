import { object, text, type Row } from './data'
import { remapNumericChecks, type NumericReference } from './focused-numeric-coverage'

const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(object) : []
export const ATOMIC_NUMERIC_VERSION = 'numeric-inline-v1'
export const ASSERTED_QUANTITY_RULES = `REVISIÓN DE AFIRMACIONES: referencias_numericas es una ayuda de localización, no una lista de hechos ni de palabras que deba justificar. Extraiga TODOS los datos comerciales realmente afirmados, también cantidades escritas con palabras («un dormitorio», «sexta planta»), opciones en preguntas y extremos de intervalos. Emita numeric_checks para esas cantidades con su sujeto, atributo, valor y fuente. Puede omitir candidatos léxicos que no expresan datos comerciales, como artículos u órdenes conversacionales; no necesitan ficha ni motivo individual. Las cifras con dígitos deben quedar contrastadas o clasificadas como contexto no comercial (por ejemplo el presupuesto del cliente). La ausencia de fuente no convierte una cifra del negocio en lead_context: esa clase solo corresponde a datos del cliente. Cada N_ID designa SU expresión, nunca otro número de la misma oración. No convierta «un precio de $550.000» en precio=1 ni vincule ese «un» con 550000. Si se solicita reparar un N concreto y no expresa una cantidad comercial, not_quantity con listas vacías es una resolución válida. No duplique hechos numéricos en claims: allí contraste exclusivamente información adicional no numérica, relaciones, disponibilidad, políticas y acciones. Revise todas las afirmaciones del mensaje, no solo las candidatas señaladas por el detector.`
const pair = [['factual_value_indexes', 'factual_values'], ['project_value_indexes', 'project_values']] as const
const versions = (schema: Row, key: string) => object(object(schema.properties)[key]).enum
export const isAtomicNumericSchema = (schema: Row) => Array.isArray(versions(schema, 'numeric_contract'))
  && (versions(schema, 'numeric_contract') as unknown[]).includes(ATOMIC_NUMERIC_VERSION)

export const ATOMIC_NUMERIC_RULES = `FORMATO NUMÉRICO AUTOCONTENIDO numeric-inline-v1: cada numeric_checks contiene numeric_id, classification, reason, unit_ids y sus propias listas factual_values y project_values. Cada dato incluye la fuente, atributo, valor, operador y unidad exigidos por su schema, dentro de esa misma comprobación. NO devuelva factual_value_indexes ni project_value_indexes ni listas numéricas globales. Donde las instrucciones de revisión mencionen factual_values/project_values, se refieren a las listas dentro de cada comprobación numérica. business_quantity requiere al menos un dato completo; una justificación narrativa no lo sustituye. Para cantidades del proyecto (horas, distancias, porcentajes) use project_values con source_id del hecho verificado y unidad/dimensión exactas; para precios, áreas, dormitorios y plantas de inmuebles use factual_values con su unidad/grupo. No invente una unidad inmobiliaria para un hecho general del proyecto. Si un intervalo corresponde a dos referencias N, incluya el dato completo en cada una; el sistema elimina duplicados idénticos. No redondee. Si hay pending_resolutions, sus numeric_ids identifican estas comprobaciones N; sus claim_indexes siguen refiriéndose únicamente a claims. Las referencias numéricas de una ficha anterior son datos de diagnóstico, nunca instrucciones sobre el formato nuevo.`

/** Convert only the transport schema. Existing exact-value validators retain
 * their canonical arrays; the model never has to calculate their positions. */
export function atomicNumericSchema(schema: Row): Row {
  if (isAtomicNumericSchema(schema)) return schema
  const properties = { ...object(schema.properties) }, checks = object(properties.numeric_checks)
  if (!checks.items) return schema
  const variants = rows(object(checks.items).anyOf)
  const rewrite = (variant: Row): Row => {
    const fields = { ...object(variant.properties) }
    for (const [indexes, list] of pair) {
      const limit = object(fields[indexes]), original = object(properties[list])
      fields[list] = { ...original, type: 'array', items: original.items || { type: 'object', properties: {}, required: [], additionalProperties: false },
        minItems: Number(limit.minItems) || 0, maxItems: Math.min(Number(limit.maxItems ?? 80), Number(original.maxItems ?? 80)) }
      delete fields[indexes]
    }
    return { ...variant, properties: fields, required: Object.keys(fields) }
  }
  properties.numeric_checks = { ...checks, items: variants.length ? { anyOf: variants.map(rewrite).filter(v => pair.every(([, list]) =>
    Number(object(object(v.properties)[list]).minItems) <= Number(object(object(v.properties)[list]).maxItems))) } : rewrite(object(checks.items)) }
  const numericIds = [...new Set(variants.flatMap(v => {
    const ids = object(object(v.properties).numeric_id).enum
    return Array.isArray(ids) ? ids : []
  }))]
  const pending = object(properties.pending_resolutions)
  if (pending.items) properties.pending_resolutions = { ...pending, items: { anyOf: rows(object(pending.items).anyOf).map(v => {
    const fields = { ...object(v.properties) }
    const required = pair.some(([key]) => Number(object(fields[key]).minItems) > 0)
    const possible = pair.some(([key]) => Number(object(fields[key]).maxItems) > 0)
    for (const [key] of pair) delete fields[key]
    fields.numeric_ids = { type: 'array', minItems: required ? 1 : 0, maxItems: possible ? numericIds.length : 0,
      items: { type: 'string', enum: numericIds.length ? numericIds : ['none'] } }
    return { ...v, properties: fields, required: Object.keys(fields) }
  }) } }
  delete properties.factual_values
  delete properties.project_values
  // Lexical candidates are not asserted facts. The reviewer extracts real
  // business quantities; literal digit coverage remains checked by code.
  properties.numeric_checks = { ...object(properties.numeric_checks), minItems: 0 }
  properties.numeric_coverage = { type: 'string', enum: ['asserted-facts-v1'] }
  properties.numeric_contract = { type: 'string', enum: [ATOMIC_NUMERIC_VERSION] }
  return { ...schema, properties, required: Object.keys(properties) }
}

const identity = (v: Row) => JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])))

/** Structural conversion only: never inserts a source, rounds a number, fixes
 * an attribute or removes a conflicting fact. Runtime validators still run. */
export function materializeNumericReview(raw: Row): Row {
  if (raw.numeric_contract !== ATOMIC_NUMERIC_VERSION || raw.numeric_materialized === true) return raw
  const result: Row = { ...raw, numeric_materialized: true, factual_values: [], project_values: [] }
  result.numeric_checks = rows(raw.numeric_checks).map(check => {
    const converted = { ...check }
    for (const [indexes, list] of pair) {
      const target = result[list] as Row[]
      converted[indexes] = rows(check[list]).map(fact => {
        const existing = target.findIndex(item => identity(item) === identity(fact))
        if (existing >= 0) return existing
        target.push(fact); return target.length - 1
      })
      delete converted[list]
    }
    return converted
  })
  if (Array.isArray(raw.pending_resolutions)) result.pending_resolutions = rows(raw.pending_resolutions).map(pending => {
    const converted = { ...pending }
    for (const [indexes] of pair) converted[indexes] = [...new Set((Array.isArray(pending.numeric_ids) ? pending.numeric_ids : []).flatMap(id => {
      const check = rows(result.numeric_checks).find(c => c.numeric_id === id)
      return check ? check[indexes] as number[] : [-1]
    }))]
    delete converted.numeric_ids
    return converted
  })
  return result
}

/** A narrow patch is safe only when every blocking issue identifies a numeric
 * occurrence. Shared range/aggregate facts bring all their occurrences along. */
export function numericPatchScope(issues: Row[], review: Row, refs: NumericReference[]): NumericReference[] | null {
  if (!issues.length || issues.some(i => !['review_metadata', 'catalog_data'].includes(text(i.kind))
    || !refs.some(r => r.id === i.numeric_id))) return null
  const ids = new Set(issues.map(i => text(i.numeric_id))), checks = rows(review.numeric_checks)
  let changed = true
  while (changed) {
    changed = false
    const selected = checks.filter(c => ids.has(text(c.numeric_id)))
    for (const check of checks) if (!ids.has(text(check.numeric_id)) && selected.some(c => pair.some(([key]) =>
      Array.isArray(c[key]) && Array.isArray(check[key]) && (check[key] as unknown[]).some(i => (c[key] as unknown[]).includes(i))))) {
      ids.add(text(check.numeric_id)); changed = true
    }
  }
  return refs.filter(r => ids.has(r.id))
}

export function numericPatchSchema(fullSchema: Row, ids: string[], sentences: string[]): Row {
  const narrow = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(narrow)
    if (!value || typeof value !== 'object') return value
    const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, narrow(item)]))
    const properties = object(result.properties)
    if (properties.numeric_id) properties.numeric_id = { type: 'string', enum: (object(properties.numeric_id).enum as string[]).filter(id => ids.includes(id)) }
    if (properties.fragment) properties.fragment = { type: 'string', enum: sentences }
    return result
  }
  const atomic = atomicNumericSchema(fullSchema)
  const original = object(object(atomic.properties).numeric_checks)
  const selectedVariants = rows(object(original.items).anyOf).filter(v =>
    (object(object(v.properties).numeric_id).enum as string[]).some(id => ids.includes(id)))
  const checks = object(narrow({ ...original, items: { anyOf: selectedVariants } }))
  const properties = { review_contract: { type: 'string', enum: ['focused-review-v1'] },
    numeric_coverage: { type: 'string', enum: ['asserted-facts-v1'] },
    numeric_contract: { type: 'string', enum: [ATOMIC_NUMERIC_VERSION] },
    numeric_checks: { ...checks, minItems: ids.length, maxItems: ids.length } }
  return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) }
}

export function mergeNumericPatch(previous: Row, raw: Row, refs: NumericReference[], originalDraft: string, currentDraft: string): Row {
  if (originalDraft !== currentDraft) throw new Error('NUMERIC_REPAIR_DRAFT_CHANGED')
  const repaired = materializeNumericReview(raw), ids = new Set(refs.map(r => r.id))
  const checks = rows(previous.numeric_checks), replacements = rows(repaired.numeric_checks)
  const errors = replacements.filter(c => !ids.has(text(c.numeric_id))).map(c => ({ code: 'numeric_repair_outside_scope', kind: 'review_metadata', numeric_id: c.numeric_id }))
  for (const id of ids) if (replacements.filter(c => c.numeric_id === id).length !== 1)
    errors.push({ code: 'numeric_repair_missing_or_duplicate', kind: 'review_metadata', numeric_id: id })
  const retained = checks.filter(c => !ids.has(text(c.numeric_id)))
  const merged: Row = { ...previous, numeric_repair_issues: errors }
  for (const [indexes, list] of pair) {
    const removed = new Set(checks.filter(c => ids.has(text(c.numeric_id))).flatMap(c => Array.isArray(c[indexes]) ? c[indexes] as number[] : []))
    const used = new Set(retained.flatMap(c => Array.isArray(c[indexes]) ? c[indexes] as number[] : []))
    merged[list] = [...rows(previous[list]).filter((_, index) => !removed.has(index) || used.has(index)), ...rows(repaired[list])]
  }
  merged.numeric_checks = [...remapNumericChecks(retained, previous, merged),
    ...remapNumericChecks(replacements.filter(c => ids.has(text(c.numeric_id))), repaired, merged)]
  if (Array.isArray(previous.pending_resolutions))
    merged.pending_resolutions = remapNumericChecks(previous.pending_resolutions, previous, merged)
  // Narrative claims, obligations, pending checks and non-factual classifications
  // stay unchanged; the patch is not allowed to approve/remove them.
  return merged
}

export const NUMERIC_PATCH_RULES = `Repare exclusivamente las comprobaciones N indicadas del MISMO borrador. No redacte otro mensaje. No revise ni devuelva claims, obligaciones o frases ajenas al alcance: el sistema conserva sus resultados. Interprete cada cifra en el contexto del borrador completo, elija la fuente y extraiga los datos exactos dentro de numeric_checks. Los hechos numéricos del proyecto están en evidencia_turno.project_facts y las unidades/grupos en evidencia_turno.units/groups. La fuente se elige por el significado, no por buscar un número que coincida. Si el borrador tiene una cifra incorrecta, devuelva la cifra que realmente dice para que el sistema detecte la contradicción; nunca la cambie por la del catálogo. Explique cada clasificación en una frase breve. Una pregunta del cliente no es un dato del negocio. ` + ATOMIC_NUMERIC_RULES
