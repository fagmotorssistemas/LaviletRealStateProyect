import { object, text, type Row } from './data'
import { decimalNumber, endpointBefore, numericOperators, relationBefore, satisfiesNumeric } from './numeric-relations'
import { DISCOUNT_NUMBER_FIELDS, DISCOUNT_REFERENCE_RULES, discountReferenceEvidence } from './discount-evidence'

const factFields = ['bedrooms', 'bathrooms_full', 'area_internal_m2', 'area_exterior_m2', 'published_commercial_price', 'floor_number',
  'discount_reference_price', 'discount_amount_reference', 'discounted_price_reference', 'discount_percent']

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const numberWords: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50,
  sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, doscientas: 200,
  trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500,
  seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
}
const ordinals: Record<string, number> = { primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercer: 3, tercero: 3, tercera: 3,
  cuarto: 4, cuarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6, septimo: 7, septima: 7, octavo: 8, octava: 8,
  noveno: 9, novena: 9, decimo: 10, decima: 10 }

/** Values actually written, with stable offsets into the original prose. The
 * reviewer may use digits for a value expressed in words, without dictating copy. */
export function numericMentions(value: string): Array<{ value: number; index: number; end: number; text: string }> {
  const tokens = [...value.matchAll(/\d[\d.,]*|[a-záéíóúüñ]+/gi)]
  const result: Array<{ value: number; index: number; end: number; text: string }> = []
  for (let i = 0; i < tokens.length; i++) {
    const word = normalized(tokens[i][0]), digit = /^\d/.test(word)
    if (!digit && numberWords[word] == null && ordinals[word] == null && word !== 'mil') continue
    const start = tokens[i].index!, ordinal = !digit && ordinals[word] != null && numberWords[word] == null
    if (ordinal && !/^(?:planta|piso|nivel)$/.test(normalized(tokens[i + 1]?.[0] || ''))
      && !/^(?:planta|piso|nivel)$/.test(normalized(tokens[i - 1]?.[0] || ''))) continue
    let end = start + tokens[i][0].length, sum = 0, section = digit ? decimalNumber(word) : (numberWords[word] ?? ordinals[word] ?? 1000)
    if (!ordinal) for (let j = i + 1; j < tokens.length; j++) {
      if (/[.,]$/.test(tokens[j - 1][0]) || !/^\s+$/.test(value.slice(end, tokens[j].index))) break
      const next = normalized(tokens[j][0])
      if (next === 'coma' || next === 'punto') {
        let decimals = '', decimalEnd = end, last = j
        for (let k = j + 1; k < tokens.length; k++) {
          if (!/^\s+$/.test(value.slice(tokens[k - 1].index! + tokens[k - 1][0].length, tokens[k].index))) break
          const fractional = normalized(tokens[k][0])
          if (/^\d+$/.test(fractional)) decimals += fractional
          else if (numberWords[fractional] != null && numberWords[fractional] < 100) {
            let part = numberWords[fractional]
            if (part >= 20 && normalized(tokens[k + 1]?.[0] || '') === 'y'
              && numberWords[normalized(tokens[k + 2]?.[0] || '')] < 10) {
              part += numberWords[normalized(tokens[k + 2][0])]; k += 2
            }
            decimals += String(part)
          } else break
          decimalEnd = tokens[k].index! + tokens[k][0].length; last = k
        }
        if (decimals) { section += Number('0.' + decimals); end = decimalEnd; i = last }
        break
      }
      if (next === 'y' && numberWords[normalized(tokens[j + 1]?.[0] || '')] != null && section % 100 >= 20
        && numberWords[normalized(tokens[j + 1][0])] < 10) {
        end = tokens[j].index! + tokens[j][0].length; i = j; continue
      }
      if (next === 'mil') section = (section || 1) * 1000
      else if (next === 'millon' || next === 'millones') { sum += (section || 1) * 1_000_000; section = 0 }
      else if (numberWords[next] != null && !/^\d/.test(tokens[j - 1][0])
        && (section >= 100 || normalized(tokens[j - 1][0]) === 'y')) section += numberWords[next]
      else break
      end = tokens[j].index! + tokens[j][0].length; i = j
    }
    result.push({ value: sum + section, index: start, end, text: value.slice(start, end) })
  }
  return result
}

function numericExpressionPresent(fact: Row, fragment: string) {
  const literals = numericMentions(fragment), matching = literals.filter(match => satisfiesNumeric(match.value, Number(fact.value)))
  if (!matching.length) return false
  const operator = fact.operator || 'eq'
  if (operator === 'eq') return true
  if (operator === 'between') return matching.some(lower => literals.some(upper => satisfiesNumeric(upper.value, Number(fact.upper_value))
    && upper.index > lower.index
    && /^(?:\s*(?:usd|dolares|m2|m²|metros cuadrados|\$|us\$|€|eur))?\s*(?:hasta|a|y|–|-)\s*(?:(?:usd|us\$|\$|€|eur)\s*)?$/.test(normalized(fragment.slice(lower.end, upper.index)))
    && (/\b(?:entre|desde|de)\s*(?:(?:usd|us\$|\$|€|eur)\s*)?$/.test(normalized(fragment.slice(0, lower.index)))
      || !/\by\b/.test(normalized(fragment.slice(lower.end, upper.index))))))
  return matching.some(match => relationBefore(fragment.slice(0, match.index)) === operator)
}

/** Reject an explicit wrong dimension, not an unfamiliar way of writing a
 * valid fact. An absent label stays with semantic review; people are not rooms. */
function numericFieldContradictsText(fact: Row, fragment: string): boolean {
  const value = normalized(fragment)
  const mentions = numericMentions(fragment).filter(mention => mention.value === fact.value)
  const dimensions = mentions.map(mention => {
    const before = value.slice(0, mention.index), after = value.slice(mention.end)
    if (/^\s*(?:personas|integrantes|miembros|hijos|hijas|habitantes|familiares|ocupantes|adultos|ninos|ninas)\b/.test(after)) return 'household'
    if (/^\s*(?:dormitorios?|habitaciones?|cuartos?)\b/.test(after)) return 'bedrooms'
    if (/^\s*banos?\b/.test(after)) return 'bathrooms_full'
    if (/^\s*(?:planta|piso|nivel)\b/.test(after) || /\b(?:planta|piso|nivel)\s*$/.test(before)) return 'floor_number'
    if (/^\s*(?:%|por ciento)(?![a-z])/.test(after)) return 'percentage'
    if (/(?:\$|\busd|\bdolares?)\s*$/.test(before) || /^\s*(?:usd|dolares?)\b/.test(after)) return 'currency'
    if (/^\s*(?:m²|m2|metros? cuadrados?)(?![a-z0-9])/.test(after)) return 'area'
    return null
  })
  return dimensions.length > 0 && dimensions.every(dimension => dimension !== null
    && dimension !== fact.field && !(dimension === 'area' && /^area_/.test(text(fact.field)))
    && !(dimension === 'currency' && ['published_commercial_price', ...DISCOUNT_NUMBER_FIELDS.filter(field => field !== 'discount_percent')].includes(text(fact.field)))
    && !(dimension === 'percentage' && fact.field === 'discount_percent'))
}

function wrongReviewUnitBinding(fact: Row, fragment: string, unit: Row, catalog: Row[]): boolean {
  const sentence = normalized(fragment)
  const categoryNames: Record<string, string> = {
    suite: 'suite', suites: 'suite', departamento: 'departamento', departamentos: 'departamento',
    penthouse: 'penthouse', penthouses: 'penthouse', local: 'local', locales: 'local',
  }
  const categories = [...sentence.matchAll(/\b(suites?|departamentos?|penthouses?|locales?)\b/g)]
    .map(match => categoryNames[match[1]])
  const named = [...sentence.matchAll(/\b(?:suites?|departamentos?|penthouses?|locales?|unidades?)\s+((?:\d{2,5}\b(?![.,]\d{1,2}\b))(?:\s*(?:,|y|e)\s*\d{2,5}\b(?![.,]\d{1,2}\b))*)/g)]
    .flatMap(match => match[1].match(/\d+/g) || [])
  if (named.length && unit.unit_number && !named.includes(text(unit.unit_number))) return true
  if (categories.length && unit.category && !categories.includes(text(unit.category))) return true
  if (named.length || unit.aggregation || satisfiesNumeric(Number(unit[fact.field as string]), Number(fact.value), fact.operator, fact.upper_value)) return false
  if (!/\b(?:hasta|desde|maxim[oa]|minim[oa]|alcanzan|llegan|parten)\b/.test(sentence)) return false
  // A category-level assertion should not be rejected because the reviewer
  // selected a different member when another verified member has that value.
  return catalog.some(candidate => candidate.id !== unit.id && candidate[fact.field as string] != null
    && (!categories.length || categories.includes(text(candidate.category)))
    && satisfiesNumeric(Number(candidate[fact.field as string]), Number(fact.value), fact.operator, fact.upper_value))
}

/** Historical evidence from this event only, never today's catalogue. */
export function reviewReferenceSnapshot(result: unknown): Row[] {
  const coverage = object(object(result).turn_completeness)
  const details = object(coverage.semantic_review).validation_details
  const refs = new Set((Array.isArray(details) ? details : []).map(item => text(object(item).unit_id)).filter(Boolean))
  const facts = object(coverage.writer_contract).hechos_protegidos
  return (Array.isArray(facts) ? facts : []).map(object)
    .filter(unit => refs.has(text(unit.id)) || refs.has(text(unit.unit_number)))
    .slice(0, 80).map(unit => ({ id: text(unit.id), unit_number: text(unit.unit_number), category: text(unit.category) }))
}
export const factualValuesSchema = { type: 'array', maxItems: 80, items: { type: 'object', additionalProperties: false,
  properties: { fragment: { type: 'string' }, unit_id: { type: 'string' }, field: { type: 'string', enum: factFields }, value: { type: 'number' },
    operator: { type: 'string', enum: [...numericOperators] }, upper_value: { type: ['number', 'null'] } },
  required: ['fragment', 'unit_id', 'field', 'value', 'operator', 'upper_value'] } }

export const FLEXIBLE_FACT_RULES = `La respuesta_base es una propuesta, no evidencia independiente ni un texto obligatorio. Puede omitir cifras y opciones secundarias si responde plenamente al mensaje actual. answered_content_preserved evalúa la información necesaria para esa consulta, no que se repitan todas las cifras de la base. No equipare mayor precio con mayor superficie o exclusividad. Para afirmar un máximo de precio use el ranking calculado sobre el conjunto pertinente; si no existe evidencia, rechace esa afirmación.
En factual_values extraiga TODAS las relaciones explícitas entre una unidad y sus valores numéricos (dormitorios, baños, áreas, precio publicado, planta). Use el ID del catálogo, field y value numérico. En fragment seleccione obligatoriamente un identificador S1, S2... existente en oraciones_borrador: el sistema lo convierte en la oración exacta. No copie, resuma ni reformule la oración; el esquema solo acepta esos identificadores. Varias relaciones pueden usar el mismo identificador. Para resúmenes de categoría («hasta», «desde»), use el ID group:...:max o group:...:min de evidencia_turno.groups y el valor calculado allí. No atribuya un máximo a todas las unidades ni enumere los valores de cada unidad cuando el texto solo expresa un máximo. No calcule grupos nuevos ni mezcle conjuntos. Desagregue solo afirmaciones explícitas compartidas por unidades concretas. No use números del historial como evidencia. Use [] si no hay relaciones numéricas verificables. Si hay más de 80 relaciones no apruebe la respuesta.`

export const NUMERIC_RELATION_RULES = 'En factual_values indique operator: eq para valores exactos, gt/gte/lt/lte para comparaciones y between para intervalos (upper_value es el extremo superior; null en los otros casos). Un rango desde X hasta Y se representa con between, value X y upper_value Y. Para rangos generales use un ID group:...:range del conjunto pertinente; sus campos contienen el minimo y upper_values contiene el maximo. Si hay grupos price_quote, son las unidades disponibles con precio publicado incluidas en la cotizacion verificada actual: use esos grupos para sus precios; no los extienda al inventario completo ni a otra categoria. Para un extremo aislado use group:...:min o :max. Use solamente IDs presentes en evidencia_turno; price y price_reference no son IDs. Represente el limite escrito, no lo sustituya por el valor del catalogo. Cada unidad nombrada en una comparacion colectiva necesita su propia relacion. El codigo comprobara el operador contra el fragmento y calculara la relacion con los datos verificados. No use una aprobacion narrativa para omitir relaciones numericas.'
  + '\nEl sistema obtiene cifras_del_borrador exclusivamente del texto actual y restringe el esquema a esos valores y sus oraciones. Si la lista está vacía, factual_values debe ser []. Los candidatos son menciones, no afirmaciones aprobadas: un número de unidad, una cantidad de familiares o una cifra ajena al inmueble no debe convertirse en área, precio o dormitorios. Incluya solo relaciones realmente expresadas y compárelas con el catálogo; nunca rellene la ficha con medidas del catálogo ausentes del texto. Un valor redondeado no coincide con el valor exacto del catálogo aunque el borrador diga «aproximadamente». Si una cifra correcta se atribuyó en su ficha a otra unidad, corrija la referencia interna; no cambie el texto ni invente respaldo.'
  + '\n' + DISCOUNT_REFERENCE_RULES

export function validateFactualValues(value: unknown, reply: string, catalog: unknown): boolean {
  return factualValueIssues(value, reply, catalog).length === 0
}

export function factualValueIssues(value: unknown, reply: string, catalog: unknown): Row[] {
  if (!Array.isArray(value) || value.length > 80) return [{ code: 'invalid_fact_list', kind: 'review_metadata' }]
  const units = Array.isArray(catalog) ? catalog.map(object) : []
  return value.flatMap((raw, index) => {
    const fact = object(raw), unit = units.find(unit => unit.id === fact.unit_id), field = text(fact.field)
    const detail = { index, fragment: text(fact.fragment), unit_id: fact.unit_id, field, received: fact.value }
    const fragment = text(fact.fragment)
    if (fact.invalid_sentence_reference === true || !fragment.trim() || !reply.includes(fragment))
      return [{ ...detail, code: 'review_fragment_not_in_reply', kind: 'review_metadata' }]
    if (fact.operator !== 'between' && fact.upper_value != null)
      return [{ ...detail, code: 'unexpected_numeric_upper_bound', kind: 'review_metadata' }]
    if (typeof fact.value === 'number' && Number.isFinite(fact.value) && !numericExpressionPresent(fact, fragment))
      return [{ ...detail, code: 'numeric_relation_not_in_reply', kind: 'review_metadata' }]
    if (!unit || !factFields.includes(field) || typeof fact.value !== 'number' || !Number.isFinite(fact.value)) {
      const numbered = !unit ? units.filter(candidate => text(candidate.unit_number) === text(fact.unit_id)) : []
      return [{ ...detail, code: 'invalid_unit_fact', kind: 'review_metadata',
        reason: !unit ? 'unit_id_not_in_catalog' : !factFields.includes(field) ? 'unsupported_field' : 'invalid_numeric_value',
        ...(numbered.length === 1 ? { expected_unit_id: numbered[0].id, unit_number: numbered[0].unit_number } : {}) }]
    }
    if (numericFieldContradictsText(fact, fragment))
      return [{ ...detail, code: 'numeric_field_not_in_reply', kind: 'review_metadata' }]
    const discountField = DISCOUNT_NUMBER_FIELDS.find(key => key === field)
    if (discountField) {
      const discount = discountReferenceEvidence(unit), expected = discount.values[discountField]
      if (!discount.available || expected === undefined) return [{ ...detail, code: 'discount_reference_unavailable', kind: 'catalog_data' }]
      const matches = (fact.operator || 'eq') === 'eq' ? expected === fact.value
        : satisfiesNumeric(expected, fact.value as number, fact.operator, fact.upper_value)
      if (!matches) return [{ ...detail, code: 'catalog_value_mismatch', kind: 'catalog_data', expected }]
    }
    if (wrongReviewUnitBinding(fact, fragment, unit, units))
      return [{ ...detail, code: 'review_unit_binding_mismatch', kind: 'review_metadata' }]
    if (discountField) return []
    if (unit.aggregation === 'range') {
      const upper = object(unit.upper_values)[field]
      if (fact.operator !== 'between') return [{ ...detail, code: 'range_reference_requires_interval', kind: 'review_metadata' }]
      if (unit[field] == null || upper == null || !satisfiesNumeric(Number(unit[field]), fact.value as number)
        || typeof fact.upper_value !== 'number' || !satisfiesNumeric(Number(upper), fact.upper_value))
        return [{ ...detail, code: 'catalog_range_mismatch', kind: 'catalog_data', expected: unit[field] ?? null, expected_upper: upper ?? null }]
    } else if (unit.aggregation && fact.operator === 'between') {
      return [{ ...detail, code: 'interval_requires_range_reference', kind: 'review_metadata' }]
    } else if (unit[field] == null || unit[field] === '' || !satisfiesNumeric(Number(unit[field]), fact.value as number, fact.operator, fact.upper_value))
      return [{ ...detail, code: 'catalog_value_mismatch', kind: 'catalog_data', expected: unit[field] ?? null }]
    const endpoint = numericMentions(fragment).filter(match => match.value === fact.value)
      .map(match => endpointBefore(fragment.slice(0, match.index))).find(Boolean)
    if (endpoint && unit.aggregation && unit.aggregation !== 'range' && (unit.aggregation !== endpoint || !satisfiesNumeric(Number(unit[field]), fact.value as number)))
      return [{ ...detail, code: 'catalog_endpoint_mismatch', kind: 'catalog_data', expected: unit[field], aggregation: endpoint }]
    return []
  })
}


export const claimSchema = { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false, properties: {
  fragment: { type: 'string' }, subject: { type: 'string' }, polarity: { type: 'string', enum: ['affirmation', 'negation', 'uncertainty'] },
  claim_kind: { type: 'string', enum: ['project_fact', 'operational_fact', 'lead_statement', 'contextual_guidance'] },
  verdict: { type: 'string', enum: ['supported', 'unsupported', 'contradicted'] },
  evidence: { type: 'string' }, evidence_source: { type: 'string', enum: ['verified_context', 'catalog_no_results', 'lead_declaration', 'contextual_reasoning', 'none'] },
  evidence_ids: { type: 'array', maxItems: 16, items: { type: 'string' } },
}, required: ['fragment', 'subject', 'polarity', 'claim_kind', 'verdict', 'evidence', 'evidence_source', 'evidence_ids'] } }

/** Constrain citations before generation; this does not decide what prose means. */
export function groundedClaimReviewSchema(schema: Row, sources: Row[]): Row {
  const properties = { ...object(schema.properties) }, list = object(properties.claims), item = object(list.items)
  const original = object(item.properties), variants: Row[] = []
  const add = (kind: string[], verdict: string[], source: string[], ids: string[]) => variants.push({
    ...item, properties: { ...original, claim_kind: { type: 'string', enum: kind },
      verdict: { type: 'string', enum: verdict }, evidence_source: { type: 'string', enum: source },
      evidence_ids: ids.length ? { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', enum: ids } }
        : { type: 'array', maxItems: 0, items: { type: 'string' } } },
  })
  for (const kind of ['project_fact', 'operational_fact', 'lead_statement']) {
    const matching = sources.filter(row => row.kind === kind)
    for (const scope of kind === 'project_fact' ? ['verified_context', 'catalog_no_results']
      : [kind === 'lead_statement' ? 'lead_declaration' : 'verified_context']) {
      const ids = matching.filter(row => scope === 'catalog_no_results' ? row.scope === scope : row.scope !== 'catalog_no_results')
        .map(row => text(row.id))
      if (ids.length) add([kind], ['supported', 'contradicted'], [scope], ids)
    }
  }
  add(['project_fact', 'operational_fact', 'lead_statement'], ['unsupported'], ['none'], [])
  add(['contextual_guidance'], ['supported'], ['contextual_reasoning'], [])
  return { ...schema, properties: { ...properties, claims: { ...list, items: { anyOf: variants } } } }
}

export const CLAIM_RULES = `Revise únicamente lo que afirma respuesta_propuesta. El catálogo, el historial, el mensaje actual y la base NO son un inventario de afirmaciones a insertar en claims o factual_values. Una cifra existente en el catálogo que NO se expresa en el borrador NO se revisa. Antes de contrastar un dato compruebe que el fragmento lo dice realmente: una cortesía no afirma un precio.
Enumere en claims las afirmaciones pertinentes usando obligatoriamente en fragment un ID S1, S2... existente en oraciones_borrador, sujeto, polaridad y claim_kind. Seleccione el ID; no copie ni reformule el texto. Use hasta 16 entradas agrupando datos del mismo sujeto; evidence explica brevemente el respaldo, no copia fichas completas. La cortesía y las preguntas no requieren claims. Varias afirmaciones de una oración pueden reutilizar su ID con distintos sujetos. Si una oración mezcla hechos y orientación, revise sus hechos con el tipo factual correspondiente y explique la orientación condicionada en evidence; no etiquete toda la oración contextual_guidance para omitir sus hechos.
claim_kind=project_fact: hechos atribuidos al inmueble/proyecto, cifras, disponibilidad, condiciones, prestaciones y políticas. Requieren evidence_ids de evidencia_afirmaciones con kind=project_fact. operational_fact: acciones, estados o resultados del proceso, requiere fuentes kind=operational_fact; intención no equivale a acción confirmada. lead_statement: una declaración del cliente, requiere fuentes kind=lead_statement; puede reconocer su familia o presupuesto sin convertirlos en dormitorios solicitados ni precio comercial. Para estos tres tipos supported necesita fuentes existentes y aplicables: las IDs no bastan si el contenido no respalda el significado. No invente IDs ni cite S1, respuesta_propuesta, historial o preguntas del cliente como fuente de hechos del proyecto o acciones.
contextual_guidance: orientación razonable, posibilidades cotidianas y valoraciones condicionadas; por ejemplo, que la comodidad depende de cómo prefieran distribuirse o compartir habitaciones. Puede aprobarse SIN una fuente del catálogo, con evidence_source=contextual_reasoning y evidence_ids=[]; explique brevemente por qué es orientación y no una garantía. No exija estudios para una posibilidad cotidiana ni fuerce una pregunta de dormitorios si la inquietud se puede responder evaluando las opciones conocidas. Esto no autoriza inventar capacidad máxima, habitabilidad garantizada, redistribuciones constructivas, requisitos, rentabilidad, precios ni acciones. Si incluye un dato verificable del inmueble, revíselo por separado como project_fact; no lo esconda bajo contextual_guidance.
Para hechos respaldados use evidence_source=verified_context; para declaraciones use lead_declaration. supported significa respaldo real o razonamiento contextual prudente, no solo ausencia de contradicción. Si un HECHO del borrador no tiene respaldo, use unsupported con evidence_source=none; no invente una fuente. contradicted necesita la fuente existente que lo contradice. Una referencia vacía o mal elegida es un defecto de ficha: busque primero el respaldo en las fuentes, sin cambiar automáticamente el veredicto a unsupported para cumplir el esquema. Si una ficha previa inventó una afirmación ausente del texto, elimine esa fila al reparar la ficha sin modificar el borrador ni borrar sus afirmaciones reales.
catalog_no_results requiere una fuente de evidencia_afirmaciones que represente la consulta completa vacía y solo autoriza negar coincidencias para EXACTAMENTE esa consulta, nunca todo el inventario ni otra categoría. Seleccione el ID de la oración negativa y contraste la negación por separado de las alternativas afirmativas. Distinga «no hay», «no solo hay» e incertidumbre. Compruebe que la respuesta atienda la inquietud actual, sin exigir semejanza con la base.`

function guidanceNeedsFactualEvidence(fragment: string): boolean {
  // Numeric integrity only. The reviewer classifies nonnumeric facts and
  // promises; action/guarantee keywords cannot override that classification.
  const value = normalized(fragment)
  const explicitPrice = /(?:\$|\busd\b|\bdolares?\b|\bprecio\b|\bvalor\b|\bcuota\b)/.test(value) && numericMentions(fragment).length > 0
  const namedUnit = /\b(?:departamentos?|suites?|penthouses?|locales?|unidades?)\s+(?:numeros?\s*)?\d/.test(value)
  const propertyMeasures = numericMentions(fragment).filter(mention => /^\s*(?:dormitorios?|habitaciones?|cuartos?|banos?|plantas?|pisos?|m2|m²|metros? cuadrados?)(?![a-z0-9])/.test(value.slice(mention.end))
    || /\b(?:planta|piso)\s*$/.test(value.slice(0, mention.index)))
  const propertyMeasure = propertyMeasures.length > 0
  const attributedMeasure = propertyMeasures.some(mention =>
    /\b(?:tiene[n]?|cuenta[n]? con|incluye[n]?|son|es|hay)\s*(?:de\s*)?$/.test(value.slice(0, mention.index)))
  // A count in advice is not itself an inventory assertion. Support natural
  // evaluations and hypothetical preferences in any position, not only "Si…".
  const contextualEvaluation = /\b(?:podri\w*|pued[ae]n?|conviene|depende|evalu\w*|consider\w*|revis\w*|distribui\w*|compart\w*|organiz\w*)\b/.test(value)
  const hypotheticalPreference = /\b(?:si|en caso de)\b[^.!?;]{0,80}\b(?:necesita\w*|prefier\w*|busca\w*|quisier\w*|desear\w*|desea\w*)\b/.test(value)
  const concreteAvailability = /\b(?:disponible|disponibles|ofrecemos|tenemos|contamos|dispone|disponen)\b/.test(value)
  const occupancyClaim = /\b(?:caben|alberga[n]?|admite[n]?|capacidad para|apto[s]? para|apta[s]? para)\b/.test(value)
  const guidance = (contextualEvaluation || hypotheticalPreference) && !concreteAvailability && !occupancyClaim
  return explicitPrice || namedUnit || attributedMeasure || propertyMeasure && !guidance
}

/** Only independently accepted, source-free guidance may be omitted from
 * catalogue assertion parsing. The actual reply is never edited for delivery. */
export function reviewedContextualGuidance(reply: string, audit: Row): string[] {
  const review = object(audit.semantic_review)
  if (review.status !== 'checked') return []
  return (Array.isArray(review.claims) ? review.claims.map(object) : []).filter(claim => {
    const fragment = text(claim.fragment)
    return claim.claim_kind === 'contextual_guidance' && claim.verdict === 'supported'
      && claim.evidence_source === 'contextual_reasoning' && Array.isArray(claim.evidence_ids) && !claim.evidence_ids.length
      && fragment.trim() && reply.includes(fragment) && !/https?:\/\//.test(fragment)
      && !guidanceNeedsFactualEvidence(fragment)
  }).map(claim => text(claim.fragment))
}

export function reviewClaims(value: unknown, reply: string, sources?: Row[], structuredOnly = false): { valid: boolean; claims: Row[]; issues: Row[] } {
  if (!Array.isArray(value) || value.length > 16)
    return { valid: false, claims: [], issues: [{ code: 'invalid_claim_list', kind: 'review_metadata' }] }
  const claims = value.map(object)
  const issues: Row[] = claims.flatMap((claim, index) => {
    const detail = { index, subject: text(claim.subject), fragment: text(claim.fragment) }
    const result: Row[] = []
    if (sources) {
      const fragment = text(claim.fragment), kind = text(claim.claim_kind), ids = claim.evidence_ids
      // An invented/miscited assertion is a reviewer defect, not proof that the
      // actual draft contains a false claim. Establish text provenance first.
      if (claim.invalid_sentence_reference === true || !fragment.trim() || !reply.includes(fragment))
        return [{ ...detail, code: 'claim_fragment_not_in_reply', kind: 'review_metadata' }]
      if (!['project_fact', 'operational_fact', 'lead_statement', 'contextual_guidance'].includes(kind)
        || !Array.isArray(ids) || ids.length > 16 || ids.some(id => typeof id !== 'string')
        || !text(claim.subject).trim() || !text(claim.evidence).trim()
        || !['affirmation', 'negation', 'uncertainty'].includes(text(claim.polarity)))
        return [{ ...detail, code: 'invalid_claim_evidence_metadata', kind: 'review_metadata' }]
      const referenced = ids.map(id => sources.find(source => source.id === id))
      if (kind === 'contextual_guidance') {
        if (claim.evidence_source !== 'contextual_reasoning' || ids.length)
          result.push({ ...detail, code: 'invalid_guidance_evidence', kind: 'review_metadata' })
        if (!structuredOnly && guidanceNeedsFactualEvidence(fragment))
          result.push({ ...detail, code: 'guidance_contains_factual_assertion', kind: 'review_metadata' })
      } else if (claim.verdict === 'supported' || claim.verdict === 'contradicted') {
        const expectedSource = kind === 'lead_statement' ? 'lead_declaration'
          : claim.evidence_source === 'catalog_no_results' && kind === 'project_fact' ? 'catalog_no_results' : 'verified_context'
        if (!ids.length || referenced.some(source => !source || source.kind !== kind)
          || claim.evidence_source !== expectedSource
          || claim.evidence_source === 'catalog_no_results' && referenced.some(source => source?.scope !== 'catalog_no_results'))
          result.push({ ...detail, code: 'claim_source_not_verified', kind: 'review_metadata', evidence_ids: ids })
      }
      if (claim.verdict === 'needs_evidence')
        result.push({ ...detail, code: 'claim_evidence_missing', kind: 'review_metadata', owner: 'reviewer', repair_owner: 'reviewer',
          reason: text(claim.evidence) })
      else if (['unsupported', 'contradicted'].includes(text(claim.verdict)))
        result.push({ ...detail, code: `claim_${claim.verdict}`, kind: 'commercial_content' })
      else if (claim.verdict !== 'supported') result.push({ ...detail, code: 'invalid_claim_verdict', kind: 'review_metadata' })
      return result
    }
    // A malformed citation does not mean that the commercial statement is false.
    // Conversely, a negative verdict stays a content defect even with bad metadata.
    if (['unsupported', 'contradicted'].includes(text(claim.verdict)))
      result.push({ ...detail, code: `claim_${claim.verdict}`, kind: 'commercial_content' })
    else if (claim.verdict !== 'supported')
      result.push({ ...detail, code: 'invalid_claim_verdict', kind: 'review_metadata' })
    if (!text(claim.fragment).trim() || !reply.includes(text(claim.fragment)))
      result.push({ ...detail, code: 'claim_fragment_not_in_reply', kind: 'review_metadata' })
    if (!text(claim.subject).trim() || !text(claim.evidence).trim()
      || !['affirmation', 'negation', 'uncertainty'].includes(text(claim.polarity))
      || !['verified_context', 'catalog_no_results'].includes(text(claim.evidence_source)))
      result.push({ ...detail, code: 'invalid_claim_evidence_metadata', kind: 'review_metadata' })
    return result
  })
  return { claims, valid: issues.length === 0, issues }
}

/** Repairs may consolidate duplicate extraction rows, but cannot erase the
 * numerical endpoints or verified subjects already extracted from this draft. */
export function reviewRepairCoverageIssues(previous: Row, repaired: Row, reply: string, catalog: Row[]): Row[] {
  const before = (Array.isArray(previous.factual_values) ? previous.factual_values : []).map(object)
  const after = (Array.isArray(repaired.factual_values) ? repaired.factual_values : []).map(object)
  const omitted = before.some(fact => {
    const reference = catalog.find(unit => unit.id === fact.unit_id)
    const values = assertedRepairValues(fact, reply, reference, catalog)
    const previousBindingWrong = factualValueIssues([fact], reply, catalog).some(issue => issue.code === 'review_unit_binding_mismatch')
    return values.some(value => !after.some(next => {
      const nextReference = catalog.find(unit => unit.id === next.unit_id)
      const sameSubject = !reference || next.unit_id === fact.unit_id
        || Array.isArray(nextReference?.member_ids) && nextReference.member_ids.includes(fact.unit_id)
        || previousBindingWrong && next.fragment === fact.fragment && factualValueIssues([next], reply, catalog).length === 0
      return sameSubject && next.field === fact.field && (next.value === value || next.operator === 'between' && next.upper_value === value)
    }))
  })
  const claimsBefore = (Array.isArray(previous.claims) ? previous.claims : []).map(object)
  const claimsAfter = (Array.isArray(repaired.claims) ? repaired.claims : []).map(object)
  // Preserve actual assertions, not the size of a hallucinated review inventory.
  // An entry absent from the draft may be removed in a fresh metadata review.
  const omittedClaims = claimsBefore.some(claim => {
    const fragment = text(claim.fragment)
    return claim.claim_kind !== 'contextual_guidance' && fragment.trim() && !/[¿?]/.test(fragment)
      && reply.includes(fragment) && !claimsAfter.some(next =>
      text(next.fragment).includes(fragment) || fragment.includes(text(next.fragment)) && text(next.fragment).trim())
  })
  return [...(omitted ? [{ code: 'review_repair_omitted_facts', kind: 'review_metadata' }] : []),
    ...(omittedClaims ? [{ code: 'review_repair_omitted_claims', kind: 'review_metadata' }] : [])]
}

/** An invalid reviewer row cannot make a number elsewhere in the message a
 * permanent catalogue assertion. Preserve only its actual text/field/subject. */
function assertedRepairValues(fact: Row, reply: string, reference: Row | undefined, catalog: Row[]): number[] {
  const fragment = text(fact.fragment), field = text(fact.field)
  const writtenRange = typeof fact.upper_value === 'number' && numericExpressionPresent({ ...fact, operator: 'between' }, fragment)
  if (!fragment.trim() || !reply.includes(fragment) || !numericExpressionPresent(fact, fragment) && !writtenRange) return []
  const value = normalized(fragment)
  const named = [...value.matchAll(/\b(?:departamentos?|suites?|penthouses?|locales?|unidades?)\s+((?:\d{2,5})(?:\s*(?:,|y|e)\s*\d{2,5})*)/g)]
    .flatMap(match => match[1].match(/\d+/g) || [])
  if (reference && named.length) {
    const subjects = Array.isArray(reference.member_ids) ? catalog.filter(unit => reference.member_ids && (reference.member_ids as unknown[]).includes(unit.id)) : [reference]
    if (!subjects.some(unit => named.includes(text(unit.unit_number)))) return []
  }
  const mentions = numericMentions(fragment)
  const candidates = mentions.filter(mention => mention.value === fact.value || writtenRange && mention.value === fact.upper_value)
  const associated = candidates.some(mention => {
    const before = value.slice(0, mention.index), after = value.slice(mention.end)
    if (/^\s*(?:personas|integrantes|miembros|anos)\b/.test(after)) return false
    if (field === 'published_commercial_price' || DISCOUNT_NUMBER_FIELDS.includes(field as typeof DISCOUNT_NUMBER_FIELDS[number]) && field !== 'discount_percent') return /(?:\$|usd|dolares?)\s*$/.test(before)
      || /^\s*(?:usd|dolares?)\b/.test(after) || /\b(?:precio|valor|cuesta|cuestan|costo)\b[^.!?;\d]{0,35}$/.test(before)
    if (field === 'discount_percent') return /^\s*(?:%|por ciento)(?![a-z])/.test(after)
    const labels: Record<string, string> = { bedrooms: 'dormitorios?|habitaciones?|cuartos?', bathrooms_full: 'banos?',
      floor_number: 'planta|piso|nivel', area_internal_m2: 'm²|m2|metros? cuadrados?', area_exterior_m2: 'm²|m2|metros? cuadrados?' }
    const label = labels[field]
    return !!label && (new RegExp(`^\\s*(?:(?:amplios?|completos?|de|area|superficie|interior|exterior)\\s+)*(?:${label})(?![a-z0-9])`).test(after)
      || new RegExp(`(?:${label})\\s*(?:(?:es|son|de|tiene|tienen|hay|:)\\s*)?$`).test(before))
  })
  return associated ? [...new Set(candidates.map(mention => mention.value))] : []
}

/** Only a reviewed denial of this complete, empty query may bypass lexical checks.
 * Evidence and scope must come from the code's query, never the writer's metadata. */
export function reviewedCatalogDenials(reply: string, audit: Row): string[] {
  const result = object(audit.catalog_results), query = object(audit.catalog_query)
  const filters = object(query.filters), review = object(audit.semantic_review)
  if (review.status !== 'checked' || result.complete !== true || !Array.isArray(result.units) || result.units.length
    || !Array.isArray(result.unknown_unit_ids) || result.unknown_unit_ids.length || query.scope !== 'catalog') return []
  return (Array.isArray(review.claims) ? review.claims.map(object) : []).filter(claim => {
    const fragment = text(claim.fragment)
    const counts: Record<string, number> = { uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }
    const numericFragment = fragment.replace(/\b(uno|una|un|dos|tres|cuatro|cinco|seis)\s+(?=dormitorios?|habitaciones?|cuartos?)/gi, word => String(counts[word.trim().toLowerCase()]) + ' ')
    // Recheck the recorded claim against this reply and the exact query it reviewed.
    const explicitDenial = /\bno cuenta(?:n)? con\b/i.test(fragment)
    return claim.evidence_source === 'catalog_no_results' && (claim.polarity === 'negation' || claim.polarity === 'affirmation' && explicitDenial) && claim.verdict === 'supported'
      && fragment.length > 0 && reply.includes(fragment) && text(claim.evidence).length > 0
      && reply.split(/(?<!\d)\.\s+|[;\n]+/).some(sentence => sentence.trim().replace(/\.$/, '') === fragment.trim().replace(/\.$/, ''))
      && !/https?:\/\//.test(fragment)
      && [...numericFragment.matchAll(/\d+(?:[.,]\d+)?/g)].every(match => Object.values(filters).flatMap(value => Array.isArray(value) ? value : [value]).some(value => typeof value === 'number' && value === Number(match[0].replace(',', '.'))))
      && JSON.stringify(review.query) === JSON.stringify(query)
      && (filters.bedrooms == null || new RegExp(`\\b${Number(filters.bedrooms)}\\b`).test(numericFragment))
  }).map(claim => text(claim.fragment))
}
