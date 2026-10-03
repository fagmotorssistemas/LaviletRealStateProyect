import { object, text, type Row } from './data'

const fields = ['published_commercial_price', 'area_internal_m2', 'area_exterior_m2', 'bedrooms', 'bathrooms_full',
  'floor_number', 'category', 'availability_status', 'status', 'unit_number', 'amount']
const kinds = ['catalog_value', 'lead_budget', 'budget_difference', 'other_calculation']
const relations = ['eq', 'gt', 'gte', 'lt', 'lte', 'range']
export const businessFactSchema: Row = {
  type: 'object', additionalProperties: false,
  properties: {
    statement: { type: 'string', description: 'Afirmación del borrador que se comprueba. Conserve su significado y sujeto.' },
    kind: { type: 'string', enum: kinds },
    subject_id: { type: ['string', 'null'], description: 'ID real de la unidad o grupo de fuentes_autorizadas. null para presupuesto del cliente.' },
    field: { type: 'string', enum: fields },
    value: { type: ['number', 'string'] },
    upper_value: { type: ['number', 'null'] },
    relation: { type: 'string', enum: relations },
    unit: { type: 'string', enum: ['USD', 'm2', 'count', 'text', 'other'] },
  }, required: ['statement', 'kind', 'subject_id', 'field', 'value', 'upper_value', 'relation', 'unit'],
}

export const BUSINESS_FACT_RULES = `
## Datos para comprobación por código
En facts extraiga las afirmaciones verificables que realmente aparecen en borrador: precios, características de unidades, presupuesto confirmado y diferencias respecto al presupuesto. Interprete también cifras escritas en palabras. No copie valores del catálogo que el borrador no afirma. No confunda personas de la familia con dormitorios.
catalog_value identifica el inmueble o grupo exacto de fuentes_autorizadas, su field y valor afirmado. lead_budget usa field=amount. budget_difference identifica la unidad o grupo cuyo precio se compara con presupuesto_confirmado y field=published_commercial_price; value es la diferencia afirmada, NO el precio. Use other_calculation si la operación tiene otra fórmula o base: revísela semánticamente sin inventar operandos.
Respete el alcance: rangos usan grupos con aggregation=range, relation=range y ambos extremos. «Desde» usa el mínimo del grupo; «superan» es gt, no gte. Una afirmación de mínimo/máximo exacto usa el grupo min/max pertinente y relation=eq. No convierta una comparación general en una reserva.
Si se refiere a opciones dentro del presupuesto, use el grupo budget_matching correspondiente y no el grupo global de la categoría. Una lista de ejemplos se verifica por sus unidades, no como mínimo y máximo universal. Si no puede representar fielmente el subconjunto afirmado, solicite aclaración de la ficha; no invente una referencia global.
unit identifica USD, m2, count o text. No suponga que una entrada o cuota es presupuesto total. Negaciones y condiciones que no se representan fielmente con estos campos se revisan semánticamente; no las transforme en hechos afirmativos.
No cree un inventario de cada oración ni referencias E/S/N. Los datos son una extracción del borrador, no nueva evidencia ni permiso para cambiar el catálogo. Un problema de extracción requiere reparar la ficha, no reescribir un borrador correcto.
question describe la pregunta real del borrador (null si no hay pregunta). offered_action diferencia information, financing_review, internal_advisor, ambiguous y none. Ofrecer dos ayudas distintas produce ambiguous: un sí no autoriza escoger una. No marque none si está ofreciendo una ayuda concreta.
`

export type FactCheck = { index: number; fact: Row; status: 'verified' | 'contradiction' | 'unverified';
  expected?: unknown; source?: Row; reason: string; repairable?: boolean }

const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const comparable = (value: unknown) => typeof value === 'string' ? value.trim().toLocaleLowerCase('es') : value
const equal = (left: unknown, right: unknown) => numeric(left) && numeric(right)
  ? Math.abs(left - right) < 1e-8 : comparable(left) === comparable(right)

/** Only structured facts enter this function. It never receives the draft or
 * scans prose, currency symbols, citations or historical messages. */
export function validateBusinessFacts(raw: unknown, units: Row[], groups: Row[], budget: Row): FactCheck[] {
  if (!Array.isArray(raw)) return [{ index: -1, fact: {}, status: 'unverified', reason: 'Falta la lista de datos del revisor.', repairable: true }]
  return raw.map((entry, index): FactCheck => {
    const fact = object(entry)
    const unknown = (reason: string, repairable = true): FactCheck => ({ index, fact, status: 'unverified', reason, repairable })
    if (!text(fact.statement).trim() || !kinds.includes(text(fact.kind)) || !fields.includes(text(fact.field))
      || !relations.includes(text(fact.relation))) return unknown('La ficha necesita identificar el dato y su significado.')
    if (fact.kind === 'other_calculation') return unknown('Operación revisada por IA; sin comprobación matemática de código.', false)
    const catalog = [...units, ...groups]
    const exact = catalog.find(row => row.id === fact.subject_id)
    const numbered = units.filter(row => text(row.unit_number) === text(fact.subject_id))
    const subject = exact || (numbered.length === 1 ? numbered[0] : undefined)
    const unitForField = fact.field === 'published_commercial_price' || fact.field === 'amount' ? 'USD'
      : /^area_/.test(text(fact.field)) ? 'm2'
        : ['bedrooms', 'bathrooms_full', 'floor_number'].includes(text(fact.field)) ? 'count' : 'text'
    if (fact.unit !== unitForField) return unknown('La unidad de medida o moneda requiere aclaración.')
    let expected: unknown, source: Row
    if (fact.kind === 'lead_budget') {
      if (fact.field !== 'amount') return unknown('El presupuesto debe identificar amount.')
      if (budget.confidence !== 'high' || !numeric(budget.amount)) return unknown('No hay importe confirmado para contrastar.', false)
      expected = budget.amount; source = { budget }
    } else {
      if (!subject) return unknown('La unidad o grupo no está identificado entre las fuentes del turno.')
      if (fact.kind === 'budget_difference') {
        if (fact.field !== 'published_commercial_price') return unknown('La diferencia requiere el precio de la unidad o grupo.')
        if (!['amount', 'maximum_total'].includes(text(budget.status)) || budget.confidence !== 'high'
          || !numeric(budget.amount) || !numeric(subject.published_commercial_price)) return unknown('Faltan precio o presupuesto total confirmado; no asumir entrada o cuota.', false)
        if (subject.aggregation === 'range') return unknown('Identifique el extremo pertinente del rango para esta diferencia.')
        expected = Math.max(0, Math.round((subject.published_commercial_price - budget.amount) * 100) / 100)
        source = { subject_id: subject.id, price: subject.published_commercial_price, budget, operation: 'max(0, price - budget)' }
      } else {
        if (fact.field === 'amount') return unknown('amount corresponde al presupuesto, no a una ficha de catálogo.')
        expected = subject[fact.field as string]
        source = { subject_id: subject.id, field: fact.field, aggregation: subject.aggregation,
          member_ids: subject.member_ids, upper_value: object(subject.upper_values)[fact.field as string] }
      }
    }
    if (expected === undefined || expected === null || expected === '') return unknown('La fuente no contiene ese dato; requiere revisión semántica.', false)
    if (numeric(expected) && !numeric(fact.value)) return unknown('El valor numérico debe entregarse como número, no como texto monetario.')
    let matches: boolean
    if (fact.relation === 'range') {
      if (fact.kind !== 'catalog_value' || subject?.aggregation !== 'range') return unknown('Un rango necesita un grupo con sus dos extremos.')
      const upper = object(subject.upper_values)[fact.field as string]
      if (!numeric(upper) || !numeric(fact.upper_value)) return unknown('Falta un extremo del rango.')
      matches = equal(expected, fact.value) && equal(upper, fact.upper_value)
      expected = [expected, upper]
    } else if (fact.relation === 'eq') {
      if (subject?.aggregation === 'range' && !equal(expected, object(subject.upper_values)[fact.field as string])) return unknown('Un grupo con precios distintos no tiene un único valor exacto.')
      matches = equal(expected, fact.value)
    } else {
      if (!numeric(expected) || !numeric(fact.value)) return unknown('La comparación requiere valores numéricos.')
      // Universal comparisons over a range must hold at the relevant endpoint.
      if (subject?.aggregation === 'range' && ['lt', 'lte'].includes(text(fact.relation))) {
        const upper = object(subject.upper_values)[fact.field as string]
        if (!numeric(upper)) return unknown('Falta el extremo superior para comprobar la comparación.')
        expected = upper
      }
      const value = expected as number
      matches = fact.relation === 'gt' ? value > fact.value : fact.relation === 'gte' ? value >= fact.value
        : fact.relation === 'lt' ? value < fact.value : value <= fact.value
    }
    return { index, fact, expected, source, status: matches ? 'verified' : 'contradiction',
      reason: matches ? 'Coincide con la fuente y relación indicadas.' : 'La afirmación extraída contradice la fuente o el cálculo indicado.' }
  })
}

export function factFindings(checks: FactCheck[]): Row[] {
  return checks.filter(check => check.status === 'contradiction').map(check => ({ category: 'hard_fact',
    statement: check.fact.statement, reason: check.reason,
    authoritative_fact: JSON.stringify({ expected: check.expected, source: check.source }), owner: 'system' }))
}

export function availableAssistance(verified: Row): Row {
  const finance = object(verified.financiamiento)
  return { information: true, internal_advisor: true, financing_review: Array.isArray(finance.partners) && finance.partners.length > 0,
    financing_partners: finance.partners || [], bank_contact: false,
    instruction: 'Las entidades autorizadas no son contactos de ejecutivos bancarios. La derivación disponible es al equipo interno. Una oferta no acredita una gestión realizada ni consentimiento.' }
}

export const ASSISTANCE_RULES = `Ofrezca únicamente las ayudas de capacidades_disponibles. Puede explicar financiamiento autorizado y ofrecer ayuda del equipo interno; no ofrezca un contacto bancario o especialista externo sin una capacidad verificada. Identifique al equipo al ofrecer contacto para evitar prometer otra entidad. Mantenga el sentido con redacción libre. Distinga explicar, iniciar una revisión consentida y solicitar atención humana. question debe describir la pregunta real de reply, aunque sea una invitación opcional. No mezcle dos alternativas en una aceptación que se interpretaría como consentimiento financiero.`
