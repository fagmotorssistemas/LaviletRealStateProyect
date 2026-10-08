import { object, text, type Row } from './data'

/** The model interprets the subject before selecting a source. The system only
 * checks these structured labels; it never searches the draft for vocabulary. */
export function focusedSubjectSchema(schema: Row, catalog: Row[]): Row {
  const properties = { ...object(schema.properties) }, list = object(properties.factual_values)
  if (!Object.keys(list).length) return schema
  const categories = [...new Set(catalog.map(row => text(row.category)).filter(Boolean))]
  const decorate = (item: Row): Row => {
    if (Array.isArray(item.anyOf)) return { ...item, anyOf: item.anyOf.map(raw => decorate(object(raw))) }
    if (!object(item.properties).unit_id) return item
    const derived = Array.isArray(object(object(item.properties).field).enum)
      && (object(object(item.properties).field).enum as unknown[]).includes('derived_value')
    const fields = { subject_category: derived ? { type: 'null' } : { type: ['string', 'null'], enum: [...categories, null],
      description: 'Categoría a la que el BORRADOR atribuye ESTE dato, antes de elegir unit_id. Resuelva pronombres en su contexto. null solo si no afirma una categoría única; no copie la categoría de la fuente para justificarla.' },
      ...object(item.properties) }
    return { ...item, properties: fields, required: Object.keys(fields) }
  }
  return { ...schema, properties: { ...properties, factual_values: { ...list, items: decorate(object(list.items)) } } }
}

export function numericSubjectIssues(facts: unknown, catalog: Row[]): Row[] {
  if (!Array.isArray(facts)) return []
  return facts.flatMap<Row>(raw => {
    const fact = object(raw)
    // Historical records predate this required field. Live schemas require it.
    if (fact.field === 'derived_value' && fact.subject_category != null) return [{
      code: 'derived_value_has_project_subject', kind: 'review_metadata', owner: 'system', repair_owner: 'reviewer',
      fragment: fact.fragment, field: fact.field, unit_id: fact.unit_id, subject_category: fact.subject_category,
      reason: 'Un resultado aritmético no es una característica publicada de una categoría del proyecto.',
    }]
    if (!('subject_category' in fact) || fact.subject_category === null) return []
    const category = text(fact.subject_category), source = catalog.find(row => row.id === fact.unit_id)
    if (!source) return [] // Existing source-ID validation owns this error.
    const members = Array.isArray(source.member_ids)
      ? source.member_ids.map(id => catalog.find(row => row.id === id && !row.aggregation)) : [source]
    const matches = category && members.length && members.every(row => row && row.category === category)
    if (matches) return []
    return [{ code: 'numeric_subject_source_mismatch', kind: 'review_metadata', owner: 'system', repair_owner: 'reviewer',
      fragment: fact.fragment, field: fact.field, unit_id: fact.unit_id, subject_category: fact.subject_category,
      received: fact.value, received_upper: fact.upper_value ?? null,
      reason: 'La categoría interpretada para esta cifra no coincide con los miembros de su fuente. Repare la referencia, no el texto ni los valores del borrador.',
      candidate_source_ids: catalog.filter(row => row.category === category && row.aggregation === source.aggregation
        && (row.bedrooms_filter ?? null) === (source.bedrooms_filter ?? null) && typeof row[text(fact.field)] === 'number').map(row => row.id),
    }]
  })
}

export const FOCUSED_SUBJECT_RULES = 'REFERENTE DE CADA DATO: extraiga subject_category del significado de cada afirmación antes de elegir unit_id. Una oración puede hablar de departamentos y penthouses: sus cifras tienen referentes distintos aunque compartan S_ID. No asigne un rango de penthouses a todo el catálogo. En frases como «todos disponen», determine el conjunto mencionado en contexto, sin ampliarlo automáticamente a locales u otras categorías. Si el referente no es resoluble, use pending_checks; no invente una universalidad. No use una fuente porque sus valores se parecen: primero sujeto y alcance, después contraste exacto. Un cálculo con field=derived_value usa subject_category=null y unit_id=null; las fuentes de sus operandos se comprueban en calculation, sin atribuir el resultado al catálogo.'
