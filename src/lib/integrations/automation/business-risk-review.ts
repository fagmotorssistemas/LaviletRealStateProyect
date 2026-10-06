import { object, text, type Row } from './data'
import { BUSINESS_FACT_RULES, businessFactSchema, availableAssistance, ASSISTANCE_RULES } from './business-facts'
import { effectiveTurnBudget } from './turn-budget'
import { FINANCING_PROCESS_RULES } from './financing-guidance'
import { catalogOverviewSummary } from './task-context'
import { PROJECT_DELIVERY_RULES } from '@/lib/inmobiliaria/projectDelivery'
import { CONVERSATION_BRIDGE_RULES } from './turn-continuation'
import { PROJECT_TRUTH_RULES } from './project-truth'
import { continuationQuestionProperties, CONTINUATION_QUESTION_RULE } from './continuation-question'

export const BUSINESS_RISK_REVIEW_VERSION = 'business-risk-v2'

// A finding describes a commercial risk, not an inventory of every sentence or
// number in the draft. The authoritative catalogue is supplied in the input.
export const businessRiskReviewSchema: Row = {
  type: 'object', additionalProperties: false,
  properties: {
    review_contract: { type: 'string', enum: [BUSINESS_RISK_REVIEW_VERSION] },
    verdict: { type: 'string', enum: ['pass', 'block'] },
    facts: { type: 'array', items: businessFactSchema },
    question: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
      properties: {
        ...continuationQuestionProperties,
        purpose: { type: 'string', enum: ['none', 'clarify_request', 'collect_lead_profile', 'choose_property', 'choose_financing_partner', 'collect_financing_required', 'coordinate_visit', 'offer_advisor', 'offer_verified_material', 'permission_to_continue'] },
        role: { type: 'string', enum: ['none', 'necessary_clarification', 'required_collection', 'optional_continuation'] },
        missing_datum: { type: 'string' }, next_decision: { type: 'string' },
        offered_action: { type: 'string', enum: ['none', 'information', 'financing_review', 'internal_advisor', 'ambiguous'] },
      }, required: ['purpose', 'role', 'missing_datum', 'next_decision', 'offered_action', 'continuation_id', 'continuation_act'] }] },
    findings: { type: 'array', maxItems: 8, items: {
      type: 'object', additionalProperties: false,
      properties: {
        category: { type: 'string', enum: ['hard_fact', 'business_guardrail', 'turn_goal'] },
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
  const variants = ['catalog_value', 'catalog_absence', 'lead_budget', 'budget_difference', 'other_calculation'].flatMap<Row>(kind => {
    const variant = {
      ...businessFactSchema, properties: { ...properties, kind: { type: 'string', enum: [kind] },
        ...(kind === 'catalog_value' || kind === 'catalog_absence' || kind === 'budget_difference' ? {
          subject_id: { type: 'string', enum: [...(kind === 'catalog_absence' ? groupIds : kind === 'budget_difference' ? valueIds : sourceIds), 'unresolved'], description: 'ID de la fuente para este sujeto y alcance. unresolved solo si no hay respaldo: señale el hallazgo comercial correspondiente.' },
        } : {}),
        ...(kind === 'catalog_absence' ? { field: { type: 'string', enum: ['unit_count'] }, relation: { type: 'string', enum: ['eq'] },
          scope: scopedSchema, value: { type: 'number', enum: [0] }, upper_value: { type: 'null' }, unit: { type: 'string', enum: ['count'] } } : {}),
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
    facts: { type: 'array', items: { anyOf: variants } } } }
}

export const BUSINESS_RISK_REVIEW_RULES = `# Función del revisor

${CONTINUATION_QUESTION_RULE}

Revise el borrador sin reescribirlo. Decida PASA o BLOQUEA exclusivamente por los tres riesgos siguientes.

## 1. Veracidad de datos del negocio

Bloquee una afirmación concreta de precio, rango, dormitorios, superficie, planta, tipología, instalaciones o disponibilidad que contradiga el catálogo/CRM para el mismo inmueble y alcance, o que carezca de respaldo en las fuentes autorizadas. Respete sujeto, filtros y valores exactos; no redondee. Las cantidades declaradas por el cliente son requisitos, no hechos del inmueble. No exija mencionar datos secundarios. Una orientación general y prudente no constituye una garantía ni requiere una ficha inmobiliaria.
Resuelva primero el alcance de la afirmación en el párrafo completo. «Dentro de su presupuesto» limita también las frases siguientes sobre esas opciones, salvo cambio explícito de conjunto. Una unidad fuera del presupuesto o de los filtros NO contradice el rango del subconjunto compatible. query_role=related_option y los grupos de catálogo general son contexto, no miembros de current_query. No exija agregar pisos o precios de unidades excluidas ni mezclar extremos de dos conjuntos. Si el texto afirma expresamente un total global, entonces contraste el conjunto completo.
Distinga cantidades de ordinales: el número de niveles residenciales no es el número de la última planta. Contraste la ubicación con floor_number y floor de las unidades o sus grupos; no deduzca una contradicción por el solo número de pisos destinados a vivienda.

## 2. Restricciones comerciales aplicables

Bloquee promesas sin respaldo de reserva, precio congelado, descuento, aprobación financiera o gestión realizada; asesoría legal/financiera compleja; lenguaje inapropiado; ofertas de inmuebles ajenos, competidores o enlaces no autorizados; y contradicciones con políticas aplicables. Reconocer datos del cliente, usar primera persona u ofrecer orientación no acredita una gestión realizada. Ofrecer revisar financiamiento autorizado y acompañamiento no garantiza aprobación.
Conserve el significado condicional de la afirmación: explicar que se podría aportar una entrada y solicitar el saldo al banco no promete que éste apruebe ni gestione un crédito. No sustituya «si», «podría» o «solicitar» por «debe» o «será aprobado» en el hallazgo. Sí bloquee una garantía real de aprobación o condiciones no autorizadas. No exija repetir una comparación de presupuesto ya atendida si no figura entre las obligaciones de este turno.
No convierta una imprecisión de denominación en un riesgo material si el conjunto de entidades autorizadas permanece explícito y correcto: mencionar bancos y nombrar también una cooperativa no excluye esa cooperativa. Sí bloquee afirmar que una entidad autorizada no está disponible o inventar una nueva vía, garantía o requisito bancario. Mencionar solo una opción pertinente no niega las demás. Los requisitos específicos de una entidad necesitan una fuente bancaria autorizada; una lista de documentos genéricos no queda respaldada por decir «normalmente» ni por la existencia del convenio.

## 3. Obligaciones explícitas de este turno

Compruebe únicamente obligaciones_del_turno. current_request exige atender las solicitudes actuales, incluso con una aclaración pertinente o explicando una limitación real de las fuentes. Para bloquear por turn_goal identifique en reason la obligación concreta omitida y su efecto. No cree obligaciones adicionales de preguntas, brochure, alternativas, perfilamiento o derivación. Una consulta atendida puede terminar sin pregunta si ninguna obligación exige hacerla. Acepte expresiones equivalentes; no espere que el cliente ya haya respondido una captura solicitada en el borrador.
Cuando commercial_next_step incluya selection_scope, compruebe la pregunta realmente escrita: debe permitir elegir entre las categorías pendientes de ese alcance. Mencionarlas en el cuerpo no justifica una pregunta que solo permite continuar con una de ellas o con sus plantas. Una pregunta abierta que abarque todas las opciones presentadas también cumple; no exija enumerarlas otra vez. No reconstruya en question.next_decision alternativas que la pregunta del borrador excluye.
Si commercial_next_step.continuation_required=true, omitir la pregunta o sustituir su finalidad es un incumplimiento turn_goal, aunque la explicación factual y el brochure sean correctos. Compruebe su presencia en el texto, no solo en los metadatos. Acepte paráfrasis que pidan la misma decisión; una invitación genérica a más información no sustituye una elección concreta pendiente. La corrección debe preservar la respuesta válida y completar su continuación; no es un missing_fact ni requiere asesor. Si no hay continuación obligatoria, no invente una ni reabra pasos resueltos o rechazados.
${CONVERSATION_BRIDGE_RULES}
Si presentation=floors, la siguiente elección es una planta entre las categorías compatibles; todavía no enumere códigos. Con presentation=units se elige entre unidades de la planta definida; single_unit presenta características y recorrido disponible, sin inventar aceptación. En financing_collection deben pedirse requested_fields y conservarse la entidad guardada. Una identidad incompleta requiere aclaración del cliente, no traspaso por missing_fact del proyecto.
consultas_pendientes conserva mensajes sin respuesta: current_request incluye sus consultas informativas aún vigentes. Compruebe su atención junto con mensaje_actual; no repita acciones ni reabra consultas canceladas o sustituidas por el cliente. Un aviso de recuperación no las atiende.

# Fuentes y alcance

Use unidades, grupos y presupuesto_del_turno para precios y comparaciones; hechos_con_cantidades no es la única fuente. Consulte todas las fuentes pertinentes antes de declarar falta de respaldo. Una política de reserva regula solicitudes o confirmaciones de reserva, no convierte una comparación en reserva ni obliga a derivar consultas de precios. Respete el alcance de cada política y los filtros de la búsqueda. El historial y el propio borrador no demuestran hechos actuales del negocio.
Evalúe las comparaciones dentro del conjunto que afirma el borrador. Un rango de opciones dentro del presupuesto corresponde a los miembros de budget_matching, no al catálogo completo. «Algunas opciones» o ejemplos no afirman un máximo de todo el proyecto. Un rango global sí debe cubrir todo su grupo. Identifique una contradicción en ese mismo alcance antes de bloquear.
Si estado_del_turno.alcance_catalogo.kind=semantic_candidates, las unidades son una selección parcial por similitud. Sus grupos solo describen esa selección; no acreditan totales, extremos ni ausencia de otras opciones en el proyecto. La similitud no certifica características: compruébelas en los campos actuales de cada unidad, incluidos spaces y description.
Describir una unidad como disponible en el catálogo autorizado del turno no confirma una reserva, garantiza que seguirá libre ni acredita asignación al cliente. Una prohibición de garantizar disponibilidad no impide informar el estado publicado. Una unidad ausente de una búsqueda no se vuelve disponible por esta regla; respete las fuentes y cualquier restricción comercial explícita aplicable.

# Criterios excluidos

No evalúe estilo, tono, elegancia, longitud sugerida, saludo, sintaxis ni número de frases. La conexión semántica exigida por commercial_next_step.response_connection pertenece a las obligaciones del turno: compruebe que enlaza la consulta atendida con la decisión pendiente sin reiniciar la presentación, aceptando cualquier formulación que lo cumpla. No bloquee por preferir otro conector o una transición más elegante. No cree inventarios por oración ni referencias cruzadas complejas. Una respuesta clara que cumple las obligaciones y respeta los datos pasa aunque usted la redactaría distinto. Un error administrativo no demuestra un riesgo comercial.

# Salida

Devuelva únicamente el JSON del esquema. verdict=pass exige findings=[]. verdict=block exige hallazgos materiales que identifiquen la afirmación u obligación afectada, el perjuicio y el hecho o regla autorizada pertinente. No invente evidencia para justificar un bloqueo.
${PROJECT_TRUTH_RULES}
${BUSINESS_FACT_RULES}
${PROJECT_DELIVERY_RULES}
${FINANCING_PROCESS_RULES}
${ASSISTANCE_RULES}`

export function businessRiskReviewInstructions(optimizedCatalog = false): string {
  return optimizedCatalog ? BUSINESS_RISK_REVIEW_RULES.replace(FINANCING_PROCESS_RULES, '') : BUSINESS_RISK_REVIEW_RULES
}

const categories = new Set(['hard_fact', 'business_guardrail', 'turn_goal'])

export function businessRiskDecision(raw: Row): { valid: boolean; approved: boolean; findings: Row[] } {
  const findings = Array.isArray(raw.findings) ? raw.findings.map(object) : []
  const valid = raw.review_contract === BUSINESS_RISK_REVIEW_VERSION
    && ['pass', 'block'].includes(text(raw.verdict))
    && Array.isArray(raw.findings)
    && findings.every(row => categories.has(text(row.category)) && text(row.statement).trim() && text(row.reason).trim())
    && (raw.verdict === 'pass' ? findings.length === 0 : findings.length > 0)
  return { valid, approved: valid && raw.verdict === 'pass', findings: valid ? findings : [] }
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
  const sources = input.claimSources.filter(source => !text(source.path).startsWith('evidencia_turno.')
    && !text(source.path).startsWith('contexto_verificado.financing_quote.')
    && source.kind !== 'lead_statement')
    .map(source => ({ kind: source.kind, path: source.path, value: source.value }))
  return {
    capacidades_disponibles: availableAssistance(input.verified),
    consultas_pendientes: input.verified.consultas_pendientes || [],
    mensaje_actual: input.current,
    borrador: input.reply,
    obligaciones_del_turno: input.obligations,
    fuentes_autorizadas: {
      unidades: input.units.map(pick), grupos: groups, hechos_con_cantidades: input.projectFacts,
      ...(input.audit.catalog_summary ? { resumen_catalogo: overview ? catalogOverviewSummary(input.audit.catalog_summary) : input.audit.catalog_summary } : {}),
      otros_hechos_y_politicas: sources, enlaces_permitidos: input.allowedLinks,
      presupuesto_del_turno: input.verified.presupuesto_del_turno || null,
      presupuesto_confirmado: effectiveTurnBudget(input.verified),
      etapa_financiamiento: input.verified.etapa_financiamiento || null,
      entrega_proyecto: input.verified.entrega_proyecto || null,
      siguiente_paso_comercial: input.verified.siguiente_paso_comercial || null,
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
      introduccion: input.audit.profile_introduction || null,
      reserva: input.audit.reservation || null,
      visita: input.audit.visit_result || null,
      dialogo_visita: input.verified.visit_dialogue_plan || input.audit.visit_dialogue_plan || null,
      permiso_ubicacion: input.verified.location_disclosure || null,
      accion: input.audit.action || null,
      etapa_financiamiento: input.verified.etapa_financiamiento || null,
      siguiente_paso_comercial: input.verified.siguiente_paso_comercial || null,
    },
  }
}
