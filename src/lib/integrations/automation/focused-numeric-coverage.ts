import { object, text, type Row } from './data'
import { numericMentions } from './semantic-review'
import { focusedNumericMentions } from './focused-numeric-syntax'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const classification = ['business_quantity', 'unit_identifier', 'lead_context', 'contextual_guidance', 'not_quantity']

export type NumericReference = {
  id: string; sentence_id: string; text: string; value: number; sentence_text: string;
  start: number; end: number; quantities: Array<{ value: number; dimension: string; unit: string }>;
}

/** Every numeric occurrence gets a reference, including ambiguous articles and
 * ordinals. The reviewer, not this scanner, decides whether it states a fact. */
export function buildNumericReferences(sentences: Row[]): NumericReference[] {
  const result: NumericReference[] = []
  for (const sentence of sentences) {
    const original = text(sentence.text)
    for (const mention of focusedNumericMentions(original)) {
      result.push({ id: `N${result.length + 1}`, sentence_id: text(sentence.id), text: mention.text,
        value: mention.value, sentence_text: original, start: mention.index, end: mention.end, quantities: mention.quantities })
    }
  }
  return result
}

export function numericReferencesForPrompt(refs: NumericReference[]): Row[] {
  return refs.map(({ id, sentence_id, text, value, quantities }) => ({ id, sentence_id, text, value,
    ...(quantities.length ? { quantities } : {}) }))
}

function identifierValues(ref: NumericReference): number[][] {
  const literal = ref.text.trim().replace(/[.,]$/, '')
  return [[ref.value], ...(/^\d+(?:,\d+)+$/.test(literal) ? [literal.split(',').map(Number)] : [])]
}

function identifierCandidates(ref: NumericReference, catalog: Row[]): string[] {
  const values = identifierValues(ref).flat()
  return catalog.filter(unit => !unit.aggregation && numericMentions(text(unit.unit_number)).length === 1
    && values.includes(numericMentions(text(unit.unit_number))[0].value)).map(unit => text(unit.id))
}

export const FOCUSED_NUMERIC_COVERAGE_RULES = `INVENTARIO NUMÉRICO: referencias_numericas enumera las expresiones numéricas del borrador, incluidas palabras ambiguas como un/una/segundo. Resuelva CADA N_ID exactamente una vez en numeric_checks. Usted interpreta su significado: business_quantity para datos numéricos del negocio; unit_identifier para identificadores comerciales de unidades; lead_context para datos declarados del cliente; contextual_guidance para una posibilidad o consejo sin asegurar un dato del negocio; not_quantity para artículos u otros usos sin cantidad. Dé una explicación breve, especialmente al excluir una expresión del contraste numérico.
business_quantity debe enlazar índices BASE CERO de factual_values o project_values donde extrajo ESE valor y esa oración. Interprete el atributo una sola vez en factual_values: numeric_checks enlaza esa extracción, no la reinterpreta. Un claim narrativo no sustituye el contraste numérico. No omita precio, planta, tamaño ni atributos secundarios. En intervalos, ambos N_ID pueden enlazar la misma fila between si corresponden a sus extremos. Una ENUMERACIÓN exige sus valores individuales, no solo un intervalo: «tercera, cuarta y quinta planta» tiene floor_number=3,4,5, cada uno asociado a las unidades correspondientes. También compruebe esos atributos si se enumeran como opciones dentro de una pregunta. «Tercera planta» nunca significa unit_number=304: el 3 es floor_number de esa unidad; solo «departamento 304» expresa su identificador. unit_identifier se reserva al número comercial exacto de la unidad, no a un atributo que ayude a localizarla. El schema ofrece únicamente identificadores numéricamente compatibles; si no ofrece esa variante, interprete el atributo real o el uso no comercial, sin forzar otro identificador. Una expresión como 202,302 puede significar agrupación numérica o lista: usted decide por el contexto; si identifica dos unidades, cite ambas en unit_ids y el sistema contrastará todos los componentes exactos. Las demás clasificaciones llevan unit_ids=[]; las no comerciales tampoco llevan índices de hechos. No declare not_quantity/contextual_guidance para evitar contrastar un dato de negocio que sí afirma el texto. Una pregunta sobre datos del cliente no constituye un dato de negocio. Estas clasificaciones resuelven la interpretación; el sistema solo verifica referencias y cantidades exactas.`

export function numericCoverageSchema(schema: Row, refs: NumericReference[], catalog: Row[]): Row {
  const unitIds = catalog.filter(row => !row.aggregation).map(row => text(row.id)).filter(Boolean)
  const indexList = { type: 'array', maxItems: 80, items: { type: 'integer', minimum: 0, maximum: 79 } }
  const properties = {
    numeric_id: { type: 'string', enum: refs.length ? refs.map(ref => ref.id) : ['none'] },
    classification: { type: 'string', enum: classification },
    factual_value_indexes: indexList, project_value_indexes: indexList,
    unit_ids: { type: 'array', maxItems: Math.min(80, unitIds.length), items: { type: 'string', enum: unitIds.length ? [...new Set(unitIds)] : ['none'] } },
    reason: { type: 'string' },
  }
  const emptyIndexes = { ...indexList, maxItems: 0 }, emptyUnits = { ...properties.unit_ids, maxItems: 0 }
  const variant = (fields: Row) => ({ type: 'object', additionalProperties: false,
    properties: { ...properties, ...fields }, required: Object.keys(properties) })
  const variants = [
    variant({ classification: { type: 'string', enum: ['business_quantity'] },
      factual_value_indexes: { ...indexList, minItems: 1 }, unit_ids: emptyUnits }),
    variant({ classification: { type: 'string', enum: ['business_quantity'] },
      factual_value_indexes: emptyIndexes, project_value_indexes: { ...indexList, minItems: 1 }, unit_ids: emptyUnits }),
    ...refs.flatMap(ref => {
      const candidates = identifierCandidates(ref, catalog)
      return candidates.length ? [variant({ numeric_id: { type: 'string', enum: [ref.id] },
        classification: { type: 'string', enum: ['unit_identifier'] },
        factual_value_indexes: emptyIndexes, project_value_indexes: emptyIndexes,
        unit_ids: { ...properties.unit_ids, minItems: 1, maxItems: candidates.length, items: { type: 'string', enum: candidates } } })] : []
    }),
    variant({ classification: { type: 'string', enum: ['lead_context', 'contextual_guidance', 'not_quantity'] },
      factual_value_indexes: emptyIndexes, project_value_indexes: emptyIndexes, unit_ids: emptyUnits }),
  ]
  return { ...schema, properties: { ...object(schema.properties),
    numeric_checks: { type: 'array', minItems: refs.length, maxItems: refs.length, items: { anyOf: variants } } },
    required: [...new Set([...(Array.isArray(schema.required) ? schema.required : []), 'numeric_checks'])] }
}

/** A repair's indexes address its own extraction arrays. Rebase them after
 * merging; an unresolved row deliberately remains invalid instead of silently
 * removing the link that made a quantity require verification. */
export function remapNumericChecks(checks: unknown, sourceReview: Row, targetReview: Row, sentences: Row[] = []): Row[] {
  const normalized = (value: unknown) => text(value).normalize('NFC').trim().replace(/\s+/g, ' ')
  const sentenceId = (value: unknown) => {
    const fragment = normalized(value)
    const matches = sentences.filter(sentence => sentence.id === fragment || normalized(sentence.text) === fragment)
    return matches.length === 1 ? matches[0].id : fragment
  }
  const identity = (row: Row) => JSON.stringify({ fragment: sentenceId(row.fragment),
    field: row.field, dimension: row.dimension, unit_id: row.unit_id, source_id: row.source_id,
    value: row.value, upper_value: row.upper_value ?? null, operator: row.operator || 'eq',
    measurement_unit: row.measurement_unit, value_scope: row.value_scope,
    ...(row.field === 'derived_value' ? { calculation: row.calculation } : {}) })
  return rows(checks).map(check => {
    const result = { ...check }
    for (const [field, key] of [['factual_value_indexes', 'factual_values'], ['project_value_indexes', 'project_values']]) {
      if (!Array.isArray(check[field])) continue
      const source = rows(sourceReview[key]), target = rows(targetReview[key])
      result[field] = (check[field] as unknown[]).map(index => {
        if (!Number.isInteger(index) || Number(index) < 0 || !source[Number(index)]) return -1
        const original = identity(source[Number(index)])
        return target.findIndex(row => identity(row) === original)
      })
    }
    return result
  })
}

/** Validate the model's explicit interpretation, never infer meaning from prose. */
export function numericCoverageIssues(review: Row, refs: NumericReference[], catalog: Row[]): Row[] {
  const issues: Row[] = []
  const fail = (code: string, ref?: NumericReference, extra: Row = {}) => issues.push({ code, kind: 'review_metadata',
    owner: 'system', repair_owner: 'reviewer', ...(ref ? { numeric_id: ref.id, sentence_id: ref.sentence_id,
      fragment: ref.sentence_text, numeric_text: ref.text, received: ref.value } : {}), ...extra })
  if (!Array.isArray(review.numeric_checks)) { fail('invalid_numeric_coverage'); return issues }
  const checks = rows(review.numeric_checks)
  for (const check of checks) if (!refs.some(ref => ref.id === check.numeric_id)) fail('unknown_numeric_reference', undefined, { numeric_id: check.numeric_id })
  for (const ref of refs) {
    const matches = checks.filter(check => check.numeric_id === ref.id)
    // Word-number candidates need semantic interpretation, not a compulsory
    // justification per word. Explicit digits still need a business binding
    // or an explicit nonbusiness classification (e.g. the customer's budget).
    if (!matches.length && review.numeric_coverage === 'asserted-facts-v1' && !/\d/u.test(ref.text)) continue
    if (matches.length !== 1) { fail(matches.length ? 'duplicate_numeric_reference' : 'unreviewed_numeric_reference', ref); continue }
    const check = matches[0], kind = text(check.classification)
    if (!classification.includes(kind) || !text(check.reason).trim()) { fail('invalid_numeric_classification', ref); continue }
    const factual = check.factual_value_indexes, project = check.project_value_indexes, unitIds = check.unit_ids
    if (![factual, project].every(indexes => Array.isArray(indexes) && indexes.length <= 80
      && new Set(indexes).size === indexes.length && indexes.every(index => Number.isInteger(index) && index >= 0 && index <= 79))) {
      fail('invalid_numeric_bindings', ref); continue
    }
    if (!Array.isArray(unitIds) || unitIds.length > 80 || unitIds.some(id => typeof id !== 'string')
      || new Set(unitIds).size !== unitIds.length) { fail('invalid_numeric_unit_references', ref); continue }
    const links = [...(factual as number[]).map(index => ({ key: 'factual_values', index })),
      ...(project as number[]).map(index => ({ key: 'project_values', index }))]
    if (kind === 'business_quantity') {
      if (!links.length || unitIds.length) { fail('numeric_business_binding_missing', ref); continue }
      for (const link of links) {
        const fact = rows(review[link.key])[link.index]
        if (!fact || ![ref.sentence_id, ref.sentence_text].includes(text(fact.fragment))) {
          fail('numeric_binding_not_in_sentence', ref, { binding: link }); continue
        }
        const values = fact.operator === 'between' ? [fact.value, fact.upper_value] : [fact.value]
        const observed = link.key === 'project_values' && ref.quantities.length
          ? ref.quantities.filter(quantity => quantity.dimension === fact.dimension && quantity.unit === fact.measurement_unit).map(quantity => quantity.value)
          : [ref.value]
        if (!values.some(value => typeof value === 'number' && observed.includes(value)))
          fail('numeric_binding_value_mismatch', ref, { binding: link, field: fact.field || fact.dimension, bound_values: values })
      }
    } else if (kind === 'unit_identifier') {
      const units = unitIds.map(id => catalog.find(row => row.id === id && !row.aggregation))
      const identifiers = units.map(unit => unit ? numericMentions(text(unit.unit_number)) : [])
      const possibleValues = identifierValues(ref)
      const actual = identifiers.map(values => values[0]?.value).sort((a, b) => a - b)
      const exact = possibleValues.some(values => values.length === actual.length && [...values].sort((a, b) => a - b).every((value, index) => value === actual[index]))
      if (links.length || !unitIds.length || identifiers.some(values => values.length !== 1) || !exact)
        fail('numeric_unit_identifier_unverified', ref, { unit_ids: unitIds,
          compared_field: 'unit_number', expected_identifiers: units.map(unit => ({ unit_id: unit?.id ?? null, unit_number: unit?.unit_number ?? null })),
          candidate_attributes: units.flatMap(unit => unit ? ['floor_number', 'bedrooms', 'bathrooms_full', 'area_internal_m2', 'area_exterior_m2', 'published_commercial_price']
            .filter(field => unit[field] === ref.value).map(field => ({ unit_id: unit.id, field, value: unit[field] })) : []),
          reason: 'La expresión fue declarada identificador, pero no coincide con unit_number de la fuente. Reevalúe su significado: puede ser un atributo comercial, un dato del cliente o una expresión sin cantidad. No fuerce un enlace comercial ni sustituya esta expresión por otra cifra de la oración. No cambie el borrador.',
        })
    } else if (links.length || unitIds.length) fail('nonbusiness_numeric_has_business_binding', ref)
  }
  return issues
}
