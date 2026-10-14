import { object, text, type Row } from './data'
import { REVIEWER_AUTHORITY_RULES, REVIEWER_AUTHORITY_VERSION, factualReviewObligations, reviewerFactData } from './reviewer-authority'
import { BUSINESS_FACT_RULES, businessFactSchema, derivedBusinessFactSchema, OTHER_FINANCIAL_CALCULATION_FIELDS, availableAssistance } from './business-facts'
import { effectiveTurnBudget } from './turn-budget'
import { catalogOverviewSummary } from './task-context'
import { PROJECT_DELIVERY_RULES } from '@/lib/inmobiliaria/projectDelivery'
import { PROJECT_TRUTH_RULES } from './project-truth'

export const BUSINESS_RISK_REVIEW_VERSION = 'business-risk-v2'

// A finding describes a commercial risk, not an inventory of every sentence or
// number in the draft. The authoritative catalogue is supplied in the input.
export const businessRiskReviewSchema: Row = {
  type: 'object', additionalProperties: false,
  properties: {
    review_contract: { type: 'string', enum: [BUSINESS_RISK_REVIEW_VERSION] },
    verdict: { type: 'string', enum: ['pass', 'block'] },
    facts: { type: 'array', items: { anyOf: [businessFactSchema, derivedBusinessFactSchema] } },
    question: { type: 'null', description: 'La pregunta y la continuidad las conserva el redactor; el revisor no las evalúa.' },
    findings: { type: 'array', maxItems: 8, items: {
      type: 'object', additionalProperties: false,
      properties: {
        category: { type: 'string', enum: ['hard_fact', 'business_guardrail'] },
        statement: { type: 'string' },
        reason: { type: 'string' },
        authoritative_fact: { type: 'string' },
      },
      required: ['category', 'statement', 'reason', 'authoritative_fact'],
    } },
  },
  required: ['review_contract', 'verdict', 'findings', 'facts', 'question'],
}

/** Tie metadata to this turn's sources at generation time. In particular a
 * catalog fact needs a source, and a declared budget amount is an equality;
 * neither should cost a second call merely to complete that contract. */
export function businessRiskSchemaForSources(units: Row[], groups: Row[]): Row {
  const sourceIds = [...new Set([...units, ...groups].map(row => text(row.id)).filter(Boolean))]
  const groupIds = [...new Set(groups.map(row => text(row.id)).filter(Boolean))]
  const valueIds = [...new Set([...units, ...groups].filter(row => {
    if (!row.aggregation) return true
    const count = Array.isArray(row.member_ids) ? row.member_ids.length : row.member_count ?? row.unit_count
    return count !== 0
  }).map(row => text(row.id)).filter(Boolean))]
  const properties = object(businessFactSchema.properties)
  const scopedSchema = (object(properties.scope).anyOf as Row[]).find(row => row.type === 'object')!
  const variants = ['catalog_value', 'catalog_absence', 'lead_budget', 'budget_difference', 'budget_coverage', 'other_calculation'].flatMap<Row>(kind => {
    const variant = {
      ...businessFactSchema, properties: { ...properties, kind: { type: 'string', enum: [kind] },
        ...(kind === 'catalog_value' || kind === 'catalog_absence' || kind === 'budget_difference' || kind === 'budget_coverage' ? {
          subject_id: { type: 'string', enum: [...(kind === 'catalog_absence' ? groupIds : kind === 'budget_difference' ? valueIds : sourceIds), 'unresolved'], description: 'ID de la fuente para este sujeto y alcance. unresolved solo si no hay respaldo: señale el hallazgo comercial correspondiente.' },
        } : {}),
        ...(kind === 'catalog_absence' ? { field: { type: 'string', enum: ['unit_count'] }, relation: { type: 'string', enum: ['eq'] },
          scope: scopedSchema, value: { type: 'number', enum: [0] }, upper_value: { type: 'null' }, unit: { type: 'string', enum: ['count'] } } : {}),
        ...(kind === 'budget_coverage' ? { field: { type: 'string', enum: ['published_commercial_price'] },
          relation: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte'] }, value: { type: 'number' },
          upper_value: { type: 'null' }, unit: { type: 'string', enum: ['USD'] } } : {}),
        ...(kind === 'other_calculation' ? { field: { type: 'string', enum: OTHER_FINANCIAL_CALCULATION_FIELDS },
          unit: { type: 'string', enum: ['USD', 'percent'] } } : {}),
        ...(kind === 'lead_budget' ? { field: { type: 'string', enum: ['amount'] }, relation: { type: 'string', enum: ['eq'] },
          subject_id: { type: 'null' }, scope: { type: 'null' }, value: { type: 'number' }, upper_value: { type: 'null' }, unit: { type: 'string', enum: ['USD'] } } : {}),
      },
    }
    if (kind !== 'catalog_value') return [variant]
    return [{ ...variant, properties: { ...variant.properties,
      subject_id: { ...object(variant.properties.subject_id), enum: [...valueIds, 'unresolved'] },
      field: { ...object(properties.field), enum: (object(properties.field).enum as string[]).filter(field => field !== 'unit_count') } } },
    { ...variant, properties: { ...variant.properties,
      subject_id: { ...object(variant.properties.subject_id), enum: [...groupIds, 'unresolved'] },
      field: { type: 'string', enum: ['unit_count'] }, scope: scopedSchema } }]
  })
  return { ...businessRiskReviewSchema, properties: { ...object(businessRiskReviewSchema.properties),
    facts: { type: 'array', items: { anyOf: [...variants, derivedBusinessFactSchema] } } } }
}

export const BUSINESS_RISK_REVIEW_RULES = `REVISIÓN DE HECHOS Y PROMESAS COMERCIALES
${REVIEWER_AUTHORITY_RULES}
Revise el borrador sin reescribirlo. Bloquee únicamente:
1. Una afirmación de precio, rango, unidad, dormitorios, superficies, planta, ubicación, tipología, instalaciones o disponibilidad falsa, contradictoria o sin respaldo autorizado para ese mismo sujeto y conjunto.
2. Una condición o promesa comercial sin respaldo: descuento, precio congelado, reserva confirmada, aprobación financiera, crédito directo, requisito bancario, pago, cita, asignación o gestión realizada.
Respete negaciones y condiciones. Ofrecer orientación, recibir datos o invitar a solicitar una reserva no afirma que se haya realizado una operación. Una posibilidad condicionada de pedir crédito no garantiza aprobación. Una valoración prudente no es un hecho del inmueble.
Extraiga únicamente hechos realmente afirmados. No copie cifras ausentes del texto, no redondee valores y no confunda dormitorios, ocupación, número de plantas o última planta. Una referencia completa al presupuesto limita las afirmaciones siguientes de ese mismo subconjunto. Compare extremos y ausencia de opciones solo con fuentes completas del alcance afirmado; no mezcle opciones excluidas ni grupos de todo el proyecto con la búsqueda del turno.
Consulte todas las fuentes autorizadas antes de declarar falta de respaldo. Un catálogo parcial no demuestra un máximo global ni ausencia de opciones. Informar disponibilidad publicada no reserva inventario ni garantiza disponibilidad futura. Un precio de lanzamiento no demuestra por sí solo descuento ni un precio posterior. Un descuento ya incluido no se resta otra vez.
Los resultados operativos solo prueban la operación, destinatario y estado registrados. Las fuentes del historial no certifican hechos actuales del proyecto.
No evalúe las obligaciones del redactor ni omisiones de preguntas, datos, material, precios o avisos. No decida derivaciones ni solicite datos faltantes del cliente. El sistema conserva el seguimiento independientemente de esta revisión.
Salida: JSON del esquema. question=null. verdict=pass exige findings=[]. verdict=block exige identificar la afirmación material, la contradicción o respaldo faltante y la fuente o condición comercial aplicable; nunca una obligación conversacional.
${PROJECT_TRUTH_RULES}
${BUSINESS_FACT_RULES}
${PROJECT_DELIVERY_RULES}`

export function businessRiskReviewInstructions(optimizedCatalog = false): string {
  // Existing callers select their evidence separately; authority is invariant.
  void optimizedCatalog
  return BUSINESS_RISK_REVIEW_RULES
}

const categories = new Set(['hard_fact', 'business_guardrail'])

export function businessRiskDecision(raw: Row): { valid: boolean; approved: boolean; findings: Row[]; ignoredFindings: Row[] } {
  const reported = Array.isArray(raw.findings) ? raw.findings.map(object) : []
  // A historical/out-of-contract turn_goal cannot regain authority by being
  // returned despite the current schema. Unknown defects still fail closed.
  const ignoredFindings = reported.filter(row => row.category === 'turn_goal')
  const findings = reported.filter(row => categories.has(text(row.category)))
  const valid = raw.review_contract === BUSINESS_RISK_REVIEW_VERSION
    && ['pass', 'block'].includes(text(raw.verdict)) && Array.isArray(raw.findings)
    && reported.every(row => (categories.has(text(row.category)) || row.category === 'turn_goal')
      && text(row.statement).trim() && text(row.reason).trim())
    && (raw.verdict === 'pass' ? reported.length === 0 : reported.length > 0)
  return { valid, approved: valid && findings.length === 0, findings: valid ? findings : [], ignoredFindings }
}

export function businessRiskContext(input: {
  current: string; reply: string; obligations: Row[]; units: Row[]; groups: Row[];
  projectFacts: Row[]; claimSources: Row[]; verified: Row; audit: Row; allowedLinks: string[];
}): Row {
  const overview = object(input.verified.prompt_context_selection).task === 'category_overview'
  const sourceFields = ['id', 'unit_number', 'category', 'bedrooms', 'bathrooms_full', 'area_internal_m2',
    'area_exterior_m2', 'area_total_m2', 'floor_number', 'floor', 'spaces', 'description', 'published_commercial_price', 'availability_status', 'status', 'is_published', 'unit_count', 'query_role',
    'catalog_base_price', 'discount_reference_price', 'discount_amount_reference', 'discounted_price_reference', 'discount_percent', 'discount_condition_met', 'early_purchase_discount']
  const pick = (row: Row) => Object.fromEntries(sourceFields.filter(key => row[key] != null && row[key] !== '')
    .map(key => [key, row[key]]))
  const groups = input.groups.map(group => {
    const row = pick(group)
    return { ...row, aggregation: group.aggregation, bedrooms_filter: group.bedrooms_filter,
      source_scope: group.source_scope, upper_values: group.upper_values, complete_for_query: group.complete_for_query, covers: group.covers,
      query_scope: group.query_scope,
      member_count: Array.isArray(group.member_ids) ? group.member_ids.length : group.member_count ?? 0 }
  })
  const sources = input.claimSources.filter(source => !/(?:siguiente_paso_comercial|alcance_contenido_turno|profile_introduction|profile_collection|contrato_turno|semantica_turno)/.test(text(source.path))
    && !text(source.path).startsWith('evidencia_turno.')
    && !text(source.path).startsWith('contexto_verificado.financing_quote.')
    && source.kind !== 'lead_statement')
    .map(source => ({ kind: source.kind, path: source.path, value: reviewerFactData(source.value) }))
  return object(reviewerFactData({
    capacidades_disponibles: availableAssistance(input.verified),
    borrador: input.reply,
    reviewer_authority: { version: REVIEWER_AUTHORITY_VERSION, scope: 'facts_and_commercial_promises', workflow_owner: 'writer_and_system' },
    obligaciones_del_turno: factualReviewObligations(input.obligations),
    fuentes_autorizadas: {
      unidades: input.units.map(pick), grupos: groups, hechos_con_cantidades: input.projectFacts,
      ...(input.audit.catalog_summary ? { resumen_catalogo: overview ? catalogOverviewSummary(input.audit.catalog_summary) : input.audit.catalog_summary } : {}),
      otros_hechos_y_politicas: sources, enlaces_permitidos: input.allowedLinks,
      presupuesto_del_turno: input.verified.presupuesto_del_turno || null,
      contrato_afirmaciones_presupuesto: object(object(input.verified.siguiente_paso_comercial).budget_guidance).claim_contract
        || object(input.verified.presupuesto_del_turno).claim_contract || null,
      presupuesto_confirmado: effectiveTurnBudget(input.verified),
      razonamiento_contextual: input.verified.razonamiento_contextual || null,
      etapa_financiamiento: input.verified.etapa_financiamiento || null,
      entrega_proyecto: input.verified.entrega_proyecto || null,
      importes_financiamiento: input.verified.financing_amounts || null,
      conciliacion_financiamiento: input.verified.financing_balance || null,
      orientacion_financiera: input.verified.financing_quote || null,
      descuentos_comerciales: input.verified.politica_descuentos || null,
      grupos_por_alcance: 'task_query y budget_matching describen conjuntos filtrados, no todo el catálogo. No use una opción fuera del filtro para rechazar el rango del conjunto filtrado.',
    },
    estado_del_turno: {
      consulta_catalogo: input.audit.catalog_query || null,
      alcance_catalogo: input.verified.catalog_context_scope || null,
      ...(input.verified.prompt_context_selection ? { seleccion_contexto: input.verified.prompt_context_selection } : {}),
      cobertura_catalogo: input.audit.catalog_coverage || null,
      resultado_catalogo: { complete: object(input.audit.catalog_results).complete,
        ...(overview ? { matching_count: object(input.audit.catalog_summary).matching_count }
          : { unit_ids: object(input.audit.catalog_results).unit_ids }) },
      reserva: input.audit.reservation || null,
      visita: input.audit.visit_result || null,
      permiso_ubicacion: input.verified.location_disclosure || null,
      accion: input.audit.action || null,
      etapa_financiamiento: input.verified.etapa_financiamiento || null,
    },
  }))
}
