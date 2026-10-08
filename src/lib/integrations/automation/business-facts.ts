import { object, text, type Row } from './data'
import { CATALOG_NUMBER_FIELDS, requirementMatch } from './catalog-request'
import { DISCOUNT_NUMBER_FIELDS, DISCOUNT_FACT_UNITS, DISCOUNT_REFERENCE_RULES, discountReferenceEvidence } from './discount-evidence'
import { claimWithinCatalogScope } from './catalog-fact-scope'
import { CONTEXTUAL_CALCULATION_SCHEMA, CONTEXTUAL_REASONING_RULES, contextualCalculationCheck, groundedResultQuantityPresent, type ResultUnit, type ContextualReasoningEvidence } from './contextual-reasoning'

const fields = ['published_commercial_price', 'area_internal_m2', 'area_exterior_m2', 'bedrooms', 'bathrooms_full',
  'area_total_m2', 'floor_number', 'category', 'availability_status', 'status', 'unit_number', 'unit_count', 'amount', ...DISCOUNT_NUMBER_FIELDS]
export const OTHER_FINANCIAL_CALCULATION_FIELDS = ['amount', 'published_commercial_price', ...DISCOUNT_NUMBER_FIELDS]
const kinds = ['catalog_value', 'catalog_absence', 'lead_budget', 'budget_difference', 'other_calculation']
const relations = ['eq', 'gt', 'gte', 'lt', 'lte', 'range']
export const businessFactSchema: Row = {
  type: 'object', additionalProperties: false,
  properties: {
    statement: { type: 'string', description: 'Afirmación del borrador que se comprueba. Conserve su significado y sujeto.' },
    kind: { type: 'string', enum: kinds },
    subject_id: { type: ['string', 'null'], description: 'ID real de la unidad o grupo de fuentes_autorizadas. null para presupuesto del cliente.' },
    scope: { description: 'Condiciones del subconjunto que AFIRMA el borrador (no las del cliente). null si coincide con todo el sujeto. Nunca elija un grupo por coincidir sus cifras.', anyOf: [{ type: 'null' }, {
      type: 'object', additionalProperties: false, required: ['basis', 'group', 'category', 'filters'], properties: {
        basis: { type: 'string', enum: ['subject', 'inventory', 'query', 'alternatives', 'budget_matching'], description: 'Conjunto AFIRMADO: inventario general, búsqueda actual, alternativas propuestas o coincidencias de presupuesto. subject solo para otro grupo identificado.' },
        group: { type: ['string', 'null'], enum: ['residential', 'commercial', null] },
        category: { type: ['string', 'null'], enum: ['local', 'suite', 'departamento', 'penthouse', null] },
        filters: { type: 'array', items: { type: 'object', additionalProperties: false,
          required: ['field', 'operator', 'value', 'upper_value'], properties: {
            field: { type: 'string', enum: [...CATALOG_NUMBER_FIELDS, 'spaces'] },
            operator: { type: 'string', enum: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'contains', 'not_contains'] },
            value: { type: ['number', 'string'] }, upper_value: { type: ['number', 'null'] },
          } } },
      },
    }] },
    field: { type: 'string', enum: fields },
    value: { type: ['number', 'string'] },
    upper_value: { type: ['number', 'null'] },
    relation: { type: 'string', enum: relations },
    unit: { type: 'string', enum: ['USD', 'm2', 'count', 'percent', 'text', 'other'] },
  }, required: ['statement', 'kind', 'subject_id', 'scope', 'field', 'value', 'upper_value', 'relation', 'unit'],
}

export const BUSINESS_FACT_RULES = `
## Datos para comprobación por código
En facts extraiga las afirmaciones verificables que realmente aparecen en borrador: precios, características de unidades, presupuesto confirmado y diferencias respecto al presupuesto. Interprete también cifras escritas en palabras. No copie valores del catálogo que el borrador no afirma. No confunda personas de la familia con dormitorios.
catalog_value identifica el inmueble o grupo exacto de fuentes_autorizadas, su field y valor afirmado. lead_budget usa field=amount. budget_difference identifica la unidad o grupo cuyo precio se compara con presupuesto_confirmado y field=published_commercial_price; value es la diferencia afirmada, NO el precio. Use other_calculation si la operación tiene otra fórmula o base: revísela semánticamente sin inventar operandos.
lead_budget representa exclusivamente el importe declarado, con relation=eq y subject_id=null: «tengo 200 mil» es amount=200000, eq. Para comprobar «los precios superan su presupuesto» use catalog_value del grupo de precios, relation=gt y value=el presupuesto; nunca compare el presupuesto consigo mismo. No copie como statement una frase del cliente que no aparece en el borrador. Un catalog_value requiere el ID de su unidad/grupo, incluso para dormitorios, baños o superficies; null no identifica el sujeto.
Respete el alcance: rangos usan grupos con aggregation=range, relation=range y ambos extremos. «Desde» usa el mínimo del grupo; «superan» es gt, no gte. Una afirmación de mínimo/máximo exacto usa el grupo min/max pertinente y relation=eq. No convierta una comparación general en una reserva.
Si se refiere a opciones dentro del presupuesto, use el grupo budget_matching correspondiente y no el grupo global de la categoría. Una lista de ejemplos se verifica por sus unidades, no como mínimo y máximo universal. Si no puede representar fielmente el subconjunto afirmado, solicite aclaración de la ficha; no invente una referencia global.
scope identifica las condiciones del conjunto que realmente describe la afirmación. Para «locales de la primera planta alta» use category=local y filters=[{field:floor_number,operator:eq,value:1,upper_value:null}], aunque subject_id sea el grupo general de locales. El código recalcula el rango sobre esos miembros. Para un rango sin restricción adicional use scope=null. No añada filtros para hacer coincidir una cifra, ni use el precio afirmado como filtro salvo que el TEXTO delimite expresamente un presupuesto. Una afirmación sobre una planta no se contrasta contra los extremos de todas las plantas.
unit identifica USD, m2, count o text. Dormitorios, baños, plantas y cantidades de unidades usan count. «Cuatro departamentos de tres dormitorios» contiene dos datos distintos: unit_count=4 y bedrooms=3; extraiga ambos si están afirmados. unit_count necesita scope explícito y se refiere al conjunto AFIRMADO, nunca a una ficha individual ni al número de ejemplos enviados. scope.basis distingue inventory (grupos catalog_inventory), query (complete_query/task_query), alternatives (alternativas propuestas), budget_matching y subject (otro conjunto identificado). scope.group distingue viviendas/residential de locales/commercial. No atribuya los totales del proyecto a una búsqueda filtrada. query_scope son las condiciones del grupo calculadas por el sistema: un conjunto vacío de cinco dormitorios no prueba que el inventario general ni las alternativas estén vacíos. Si un total solo está en una descripción narrativa, revíselo semánticamente; no lo convierta en la cantidad de una búsqueda ni contradiga las fichas actuales.
Para «no disponemos de viviendas de cinco dormitorios» use catalog_absence, field=unit_count, value=0, relation=eq, unit=count y scope con el grupo y las condiciones de esa ausencia; NO bedrooms=5 como atributo positivo ni dormitorios=0. La ausencia requiere un conjunto completo y sin datos desconocidos para esos filtros. Una ausencia con más condiciones no demuestra ausencia fuera de ellas. Respete complete_for_query: una lectura parcial o fichas sin el dato no prueban cero. No suponga que una entrada o cuota es presupuesto total. Otras negaciones y condiciones que no se representan fielmente con estos campos se revisan semánticamente; no las transforme en hechos afirmativos.
No cree un inventario de cada oración ni referencias E/S/N. Los datos son una extracción del borrador, no nueva evidencia ni permiso para cambiar el catálogo. Un problema de extracción requiere reparar la ficha, no reescribir un borrador correcto.
question describe la pregunta real del borrador (null si no hay pregunta). offered_action diferencia information, financing_review, internal_advisor, ambiguous y none. Ofrecer dos ayudas distintas produce ambiguous: un sí no autoriza escoger una. No marque none si está ofreciendo una ayuda concreta.
` + '\n' + DISCOUNT_REFERENCE_RULES + '\n' + CONTEXTUAL_REASONING_RULES
  + '\nPara aritmética espacial use other_calculation con field=derived_value, subject_id=null, scope=null, relation=eq y calculation con operación, operandos, fuentes y resultado. No la represente como area_total_m2, capacidad ni atributo publicado. El resultado se verifica por código; una aprobación matemática no prueba cabida ni elimina otros hallazgos. Si falta prueba, retire el cálculo o explique qué medidas faltan. Las cantidades de un supuesto deben declararse como ejemplo en el mensaje real y no se guardan como datos.'

/** A calculation has its own provenance; it never becomes a catalogue field. */
export const derivedBusinessFactSchema: Row = {
  ...businessFactSchema, properties: { ...object(businessFactSchema.properties),
    kind: { type: 'string', enum: ['other_calculation'] }, field: { type: 'string', enum: ['derived_value'] },
    subject_id: { type: 'null' }, scope: { type: 'null' }, value: { type: 'number' },
    relation: { type: 'string', enum: ['eq'] }, upper_value: { type: 'null' },
    unit: { type: 'string', enum: ['m', 'm2', 'count', 'ratio'] }, calculation: CONTEXTUAL_CALCULATION_SCHEMA,
  }, required: [...businessFactSchema.required as string[], 'calculation'],
}

export type FactCheck = { index: number; fact: Row; status: 'verified' | 'contradiction' | 'unverified';
  expected?: unknown; source?: Row; reason: string; repairable?: boolean }

const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const comparable = (value: unknown) => typeof value === 'string' ? value.trim().toLocaleLowerCase('es') : value
const equal = (left: unknown, right: unknown) => numeric(left) && numeric(right)
  ? Math.abs(left - right) < 1e-8 : comparable(left) === comparable(right)

/** Catalogue checks use structured facts. Arithmetic also checks literal
 * provenance against this turn and the actual draft, never reviewer prose. */
export function validateBusinessFacts(raw: unknown, units: Row[], groups: Row[], budget: Row,
  reasoningEvidence?: ContextualReasoningEvidence, draft = ''): FactCheck[] {
  if (!Array.isArray(raw)) return [{ index: -1, fact: {}, status: 'unverified', reason: 'Falta la lista de datos del revisor.', repairable: true }]
  return raw.map((entry, index): FactCheck => {
    const fact = object(entry)
    const unknown = (reason: string, repairable = true): FactCheck => ({ index, fact, status: 'unverified', reason, repairable })
    if (fact.field === 'derived_value') {
      if (fact.kind !== 'other_calculation' || fact.subject_id != null || fact.scope != null || fact.relation !== 'eq'
        || fact.upper_value != null || !numeric(fact.value) || !text(fact.statement).trim() || !draft.includes(text(fact.statement)))
        return unknown('El cálculo debe describir un resultado del borrador, sin atribuirlo al catálogo.', false)
      if (!groundedResultQuantityPresent(fact.value, fact.unit as ResultUnit, text(fact.statement)))
        return unknown('El resultado y su unidad deben estar expresados en la afirmación real del borrador.')
      const checked = contextualCalculationCheck(fact.calculation, reasoningEvidence!, draft)
      if (!checked.valid) return unknown('Cálculo sin prueba válida: ' + checked.reason)
      if (fact.unit !== checked.unit || !equal(fact.value, checked.value)) return { index, fact, status: 'contradiction',
        expected: { value: checked.value, unit: checked.unit }, reason: 'El resultado o la unidad afirmados no coinciden con la operación verificada.' }
      return { index, fact, status: 'verified', expected: checked.value, source: { calculation: fact.calculation,
        scope: checked.scope, not_fit_guarantee: true }, reason: 'Aritmética verificada; no demuestra cabida ni un atributo publicado.' }
    }
    if (!text(fact.statement).trim() || !kinds.includes(text(fact.kind)) || !fields.includes(text(fact.field))
      || !relations.includes(text(fact.relation))) return unknown('La ficha necesita identificar el dato y su significado.')
    if (fact.kind === 'other_calculation') {
      if (!OTHER_FINANCIAL_CALCULATION_FIELDS.includes(text(fact.field)) || !['USD', 'percent'].includes(text(fact.unit)))
        return unknown('La aritmética no financiera requiere derived_value y una prueba verificable, sin atribuirla al catálogo.')
      return unknown('Operación revisada por IA; sin comprobación matemática de código.', false)
    }
    const catalog = [...units, ...groups]
    const exact = catalog.find(row => row.id === fact.subject_id)
    const numbered = units.filter(row => text(row.unit_number) === text(fact.subject_id))
    let subject = exact || (numbered.length === 1 ? numbered[0] : undefined)
    const discountField = DISCOUNT_NUMBER_FIELDS.find(field => field === fact.field)
    if (discountField && (fact.kind !== 'catalog_value' || fact.scope != null || !subject
      || !discountReferenceEvidence(subject).available)) return unknown('El descuento necesita una cotización vigente de la unidad concreta y su condición; no un grupo.', false)
    const scope = object(fact.scope)
    let referenceRepair: Row | undefined
    if (fact.kind === 'catalog_absence' && (fact.field !== 'unit_count' || fact.value !== 0 || fact.relation !== 'eq' || fact.scope == null))
      return unknown('La ausencia necesita cantidad cero y los filtros explícitos, no un atributo afirmativo del inmueble.')
    if (fact.scope != null) {
      if (!Array.isArray(scope.filters) || scope.category != null && !['local', 'suite', 'departamento', 'penthouse'].includes(text(scope.category)))
        return unknown('El ámbito de la afirmación necesita una categoría y filtros válidos.')
      if (scope.group != null && !['residential', 'commercial'].includes(text(scope.group)))
        return unknown('El ámbito necesita identificar viviendas o locales sin mezclar sus inventarios.')
      const basisOf = (row: Row | undefined) => row?.source_scope === 'catalog_inventory' ? 'inventory'
        : ['complete_query', 'task_query', 'query'].includes(text(row?.source_scope)) ? 'query'
          : ['requirement_alternatives', 'alternatives', 'budget_alternatives'].includes(text(row?.source_scope)) ? 'alternatives'
            : row?.source_scope === 'budget_matching' ? 'budget_matching' : 'subject'
      // Repair a cross-scope group reference only when the declared domain
      // uniquely identifies a code-owned inventory source. Never select a
      // source by the asserted quantity, price or another matching value.
      if (scope.basis === 'inventory' && basisOf(subject) !== 'inventory' && Array.isArray(subject?.member_ids)) {
        const group = scope.group || (scope.category ? scope.category === 'local' ? 'commercial' : 'residential' : null)
        const predicates = (value: unknown) => (Array.isArray(value) ? value.map(object) : []).map(row =>
          JSON.stringify([row.field, row.operator, row.value, row.upper_value ?? null])).sort().join('|')
        const candidates = groups.filter(row => row.source_scope === 'catalog_inventory' && row.aggregation === subject!.aggregation
          && object(row.query_scope).group === group && object(row.query_scope).category === (scope.category ?? null)
          && claimWithinCatalogScope(scope, object(row.query_scope)))
        const exactScope = candidates.filter(row => predicates(object(row.query_scope).filters) === predicates(scope.filters))
        const generalScope = candidates.filter(row => Array.isArray(object(row.query_scope).filters) && !(object(row.query_scope).filters as unknown[]).length)
        const matches = exactScope.length ? exactScope : generalScope
        if (matches.length === 1) {
          referenceRepair = { from: subject!.id, to: matches[0].id, reason: 'unique_declared_inventory_scope', asserted_value_used: false }
          subject = matches[0]
        }
      }
      const sourceBasis = basisOf(subject)
      if (scope.basis && scope.basis !== 'subject' && scope.basis !== sourceBasis)
        return unknown('La referencia pertenece a otro conjunto; repare subject_id sin modificar las cifras del borrador.')
      if (subject?.query_scope && !claimWithinCatalogScope(scope, object(subject.query_scope)))
        return unknown('El conjunto afirmado es más amplio o distinto que los filtros de la fuente; repare la referencia, no el borrador.')
      if (object(subject?.query_scope).restricted_to_ids === true && scope.basis !== 'query')
        return unknown('Una selección de unidades no acredita una cantidad del inventario general.')
      const filters = scope.filters.map(object)
      if (filters.some(f => f.field === 'spaces'
        ? typeof f.value !== 'string' || !f.value.trim() || !['contains', 'not_contains'].includes(text(f.operator))
        : !CATALOG_NUMBER_FIELDS.includes(f.field as typeof CATALOG_NUMBER_FIELDS[number])
          || !['eq', 'gt', 'gte', 'lt', 'lte', 'between'].includes(text(f.operator)) || !numeric(f.value)
          || f.operator === 'between' && (!numeric(f.upper_value) || f.upper_value < f.value)))
        return unknown('Los filtros del ámbito no se pueden comprobar; repare la ficha.')
      if (!subject || !Array.isArray(subject.member_ids)) return unknown('Un ámbito filtrado necesita un grupo con miembros identificados.')
      const members = units.filter(u => (subject!.member_ids as unknown[]).includes(u.id))
      if (members.length !== subject.member_ids.length) return unknown('Faltan fichas para recalcular el ámbito completo.', false)
      const checks = members.map(u => ({ unit: u, matches: [
        ...(!scope.category ? [] : [!text(u.category) ? null : u.category === scope.category]),
        ...(!scope.group ? [] : [!text(u.category) ? null : scope.group === 'commercial' ? u.category === 'local' : ['suite', 'departamento', 'penthouse'].includes(text(u.category))]),
        ...filters.map(f => requirementMatch(u, f)),
      ] }))
        .filter(row => !row.matches.includes(false))
      const selected = checks.filter(row => !row.matches.includes(null)).map(row => row.unit)
      const disprovedAbsence = fact.kind === 'catalog_absence' && selected.length > 0
      if (disprovedAbsence) return { index, fact, status: 'contradiction', expected: { at_least: selected.length },
        source: { subject_id: subject.id, field: 'unit_count', member_ids: selected.map(unit => unit.id), scope },
        reason: 'Existen unidades verificadas que cumplen las condiciones de la ausencia afirmada.' }
      if (checks.some(row => row.matches.includes(null))) return unknown('Hay datos desconocidos en el ámbito afirmado.', false)
      if (fact.field === 'unit_count' && (subject.complete_for_query === false
        || !selected.length && subject.complete_for_query !== true))
        return unknown('El conjunto no está completo: no se puede confirmar una cantidad exacta ni ausencia.', false)
      if (fact.kind === 'catalog_absence' && subject.complete_for_query !== true)
        return unknown('La ausencia necesita una lectura completa del conjunto y sin condiciones desconocidas.', false)
      if (!selected.length && fact.field !== 'unit_count') return unknown('El ámbito vacío no tiene atributos positivos de una unidad; repare la ficha de ausencia.')
      const values = fact.field === 'unit_count' ? [selected.length] : selected.map(u => u[text(fact.field)])
      const complete = values.every(v => v != null && v !== '')
      const min = complete && values.every(numeric) ? Math.min(...values as number[]) : complete && values.every(v => equal(v, values[0])) ? values[0] : null
      const max = complete && values.every(numeric) ? Math.max(...values as number[]) : min
      subject = { ...subject, scope, member_ids: selected.map(u => u.id), unit_count: selected.length,
        [text(fact.field)]: subject.aggregation === 'max' ? max : min,
        upper_values: { [text(fact.field)]: max, unit_count: selected.length } }
    }
    const unitForField = discountField ? DISCOUNT_FACT_UNITS[discountField]
      : fact.field === 'published_commercial_price' || fact.field === 'amount' ? 'USD'
      : /^area_/.test(text(fact.field)) ? 'm2'
        : ['bedrooms', 'bathrooms_full', 'floor_number', 'unit_count'].includes(text(fact.field)) ? 'count' : 'text'
    // The typed field already determines these dimensionless counts. An unspecified label cannot change a value or require another model call.
    if (fact.unit !== unitForField && !(unitForField === 'count' && fact.unit === 'other')) return unknown('La unidad de medida o moneda requiere aclaración.')
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
        if (fact.field === 'unit_count' && !Array.isArray(subject.member_ids)) return unknown('La cantidad necesita un grupo con miembros identificados.')
        if (fact.field === 'unit_count' && subject.complete_for_query === false)
          return unknown('Las coincidencias conocidas no acreditan la cantidad exacta de un conjunto incompleto.', false)
        expected = discountField ? discountReferenceEvidence(subject).values[discountField]
          : fact.field === 'unit_count' ? subject.unit_count ?? (subject.member_ids as unknown[]).length : subject[fact.field as string]
        source = { subject_id: subject.id, field: fact.field, aggregation: subject.aggregation,
          member_ids: subject.member_ids, scope: subject.scope, upper_value: object(subject.upper_values)[fact.field as string],
          ...(referenceRepair ? { reference_repair: referenceRepair } : {}),
          ...(discountField ? { early_purchase_discount: discountReferenceEvidence(subject).quote,
            verification_scope: 'conditional_arithmetic_reference_only' } : {}) }
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
      // Only numeric ranges have endpoints. Category/status metadata describes
      // the group itself and is not duplicated in upper_values.
      if (numeric(expected) && fact.field !== 'unit_count' && subject?.aggregation === 'range'
        && !equal(expected, object(subject.upper_values)[fact.field as string])) return unknown('El rango de este atributo no acredita un único valor exacto.')
      matches = discountField ? expected === fact.value : equal(expected, fact.value)
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

const isDerivedCalculation = (fact: Row) => fact.field === 'derived_value' || fact.kind === 'other_calculation'
  && (!OTHER_FINANCIAL_CALCULATION_FIELDS.includes(text(fact.field)) || !['USD', 'percent'].includes(text(fact.unit)))

export function factFindings(checks: FactCheck[]): Row[] {
  return checks.filter(check => check.status === 'contradiction' || check.status === 'unverified'
    && (isDerivedCalculation(check.fact) || check.fact.kind === 'catalog_absence' || check.fact.kind === 'catalog_value' && check.fact.field === 'unit_count')).map(check => ({ category: 'hard_fact',
    statement: check.fact.statement, reason: check.reason,
    authoritative_fact: JSON.stringify({ expected: check.expected, source: check.source,
      ...(check.status === 'unverified' ? isDerivedCalculation(check.fact)
        ? { calculation_status: 'unconfirmed', instruction: 'Corrija o retire el cálculo; explique las medidas que faltan. No convierta el resultado en un atributo del inmueble ni una garantía física.' }
        : { count_status: 'unconfirmed', instruction: 'No afirme una cantidad exacta ni ausencia; explique el límite de verificación. No sustituya datos desconocidos por cero.' } : {}) }), owner: 'system' }))
}

export function availableAssistance(verified: Row): Row {
  const finance = object(verified.financiamiento)
  return { information: true, internal_advisor: true, financing_review: Array.isArray(finance.partners) && finance.partners.length > 0,
    financing_partners: finance.partners || [], bank_contact: false,
    next_financing_step: verified.etapa_financiamiento || null,
    instruction: 'Las entidades autorizadas no son contactos de ejecutivos bancarios. La derivación disponible es al equipo interno. Una oferta no acredita una gestión realizada ni consentimiento.' }
}

export const ASSISTANCE_RULES = `Ofrezca únicamente las ayudas de capacidades_disponibles. Una capacidad disponible no es el siguiente paso obligatorio: para financiamiento siga next_financing_step, explique las entidades y continúe por este chat sin ofrecer contactos ni simular cuotas sin condiciones verificadas. El equipo interno recibe el expediente cuando está listo, o atiende una petición explícita del lead. No ofrezca un contacto bancario o especialista externo sin una capacidad verificada. Identifique al equipo si una derivación realmente corresponde. Distinga explicar, iniciar una revisión consentida y solicitar atención humana. question debe describir la pregunta real de reply, aunque sea una invitación opcional. No mezcle dos alternativas en una aceptación que se interpretaría como consentimiento financiero.`
