import { object, text, type Row } from './data'
import { BUSINESS_FACT_RULES, businessFactSchema, availableAssistance, ASSISTANCE_RULES } from './business-facts'
import { effectiveTurnBudget } from './turn-budget'
import { FINANCING_PROCESS_RULES } from './financing-guidance'

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
        purpose: { type: 'string', enum: ['none', 'clarify_request', 'collect_lead_profile', 'choose_property', 'choose_financing_partner', 'collect_financing_required', 'coordinate_visit', 'offer_advisor', 'offer_verified_material', 'permission_to_continue'] },
        role: { type: 'string', enum: ['none', 'necessary_clarification', 'required_collection', 'optional_continuation'] },
        missing_datum: { type: 'string' }, next_decision: { type: 'string' },
        offered_action: { type: 'string', enum: ['none', 'information', 'financing_review', 'internal_advisor', 'ambiguous'] },
      }, required: ['purpose', 'role', 'missing_datum', 'next_decision', 'offered_action'] }] },
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

export const BUSINESS_RISK_REVIEW_RULES = `# Función del revisor

Revise el borrador sin reescribirlo. Decida PASA o BLOQUEA exclusivamente por los tres riesgos siguientes.

## 1. Veracidad de datos del negocio

Bloquee una afirmación concreta de precio, rango, dormitorios, superficie, planta, tipología, instalaciones o disponibilidad que contradiga el catálogo/CRM para el mismo inmueble y alcance, o que carezca de respaldo en las fuentes autorizadas. Respete sujeto, filtros y valores exactos; no redondee. Las cantidades declaradas por el cliente son requisitos, no hechos del inmueble. No exija mencionar datos secundarios. Una orientación general y prudente no constituye una garantía ni requiere una ficha inmobiliaria.

## 2. Restricciones comerciales aplicables

Bloquee promesas sin respaldo de reserva, precio congelado, descuento, aprobación financiera o gestión realizada; asesoría legal/financiera compleja; lenguaje inapropiado; ofertas de inmuebles ajenos, competidores o enlaces no autorizados; y contradicciones con políticas aplicables. Reconocer datos del cliente, usar primera persona u ofrecer orientación no acredita una gestión realizada. Ofrecer revisar financiamiento autorizado y acompañamiento no garantiza aprobación.
No convierta una imprecisión de denominación en un riesgo material si el conjunto de entidades autorizadas permanece explícito y correcto: mencionar bancos y nombrar también una cooperativa no excluye esa cooperativa. Sí bloquee afirmar que una entidad autorizada no está disponible o inventar una nueva vía, garantía o requisito bancario. Mencionar solo una opción pertinente no niega las demás. Los requisitos específicos de una entidad necesitan una fuente bancaria autorizada; una lista de documentos genéricos no queda respaldada por decir «normalmente» ni por la existencia del convenio.

## 3. Obligaciones explícitas de este turno

Compruebe únicamente obligaciones_del_turno. current_request exige atender las solicitudes actuales, incluso con una aclaración pertinente o explicando una limitación real de las fuentes. Para bloquear por turn_goal identifique en reason la obligación concreta omitida y su efecto. No cree obligaciones adicionales de preguntas, brochure, alternativas, perfilamiento o derivación. Una consulta atendida puede terminar sin pregunta si ninguna obligación exige hacerla. Acepte expresiones equivalentes; no espere que el cliente ya haya respondido una captura solicitada en el borrador.
consultas_pendientes conserva mensajes sin respuesta: current_request incluye sus consultas informativas aún vigentes. Compruebe su atención junto con mensaje_actual; no repita acciones ni reabra consultas canceladas o sustituidas por el cliente. Un aviso de recuperación no las atiende.

# Fuentes y alcance

Use unidades, grupos y presupuesto_del_turno para precios y comparaciones; hechos_con_cantidades no es la única fuente. Consulte todas las fuentes pertinentes antes de declarar falta de respaldo. Una política de reserva regula solicitudes o confirmaciones de reserva, no convierte una comparación en reserva ni obliga a derivar consultas de precios. Respete el alcance de cada política y los filtros de la búsqueda. El historial y el propio borrador no demuestran hechos actuales del negocio.
Evalúe las comparaciones dentro del conjunto que afirma el borrador. Un rango de opciones dentro del presupuesto corresponde a los miembros de budget_matching, no al catálogo completo. «Algunas opciones» o ejemplos no afirman un máximo de todo el proyecto. Un rango global sí debe cubrir todo su grupo. Identifique una contradicción en ese mismo alcance antes de bloquear.
Si estado_del_turno.alcance_catalogo.kind=semantic_candidates, las unidades son una selección parcial por similitud. Sus grupos solo describen esa selección; no acreditan totales, extremos ni ausencia de otras opciones en el proyecto. La similitud no certifica características: compruébelas en los campos actuales de cada unidad, incluidos spaces y description.
Describir una unidad como disponible en el catálogo autorizado del turno no confirma una reserva, garantiza que seguirá libre ni acredita asignación al cliente. Una prohibición de garantizar disponibilidad no impide informar el estado publicado. Una unidad ausente de una búsqueda no se vuelve disponible por esta regla; respete las fuentes y cualquier restricción comercial explícita aplicable.

# Criterios excluidos

No evalúe estilo, tono, elegancia, longitud sugerida, saludo, sintaxis ni número de frases. No cree inventarios por oración ni referencias cruzadas complejas. Una respuesta clara que cumple las obligaciones y respeta los datos pasa aunque usted la redactaría distinto. Un error administrativo no demuestra un riesgo comercial.

# Salida

Devuelva únicamente el JSON del esquema. verdict=pass exige findings=[]. verdict=block exige hallazgos materiales que identifiquen la afirmación u obligación afectada, el perjuicio y el hecho o regla autorizada pertinente. No invente evidencia para justificar un bloqueo.
${BUSINESS_FACT_RULES}
${FINANCING_PROCESS_RULES}
${ASSISTANCE_RULES}`

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
  const sourceFields = ['id', 'unit_number', 'category', 'bedrooms', 'bathrooms_full', 'area_internal_m2',
    'area_exterior_m2', 'floor_number', 'floor', 'spaces', 'description', 'published_commercial_price', 'availability_status', 'status', 'is_published']
  const pick = (row: Row) => Object.fromEntries(sourceFields.filter(key => row[key] != null && row[key] !== '')
    .map(key => [key, row[key]]))
  const groups = input.groups.map(group => {
    const row = pick(group)
    return { ...row, aggregation: group.aggregation, bedrooms_filter: group.bedrooms_filter,
      source_scope: group.source_scope, upper_values: group.upper_values,
      member_count: Array.isArray(group.member_ids) ? group.member_ids.length : 0 }
  })
  const sources = input.claimSources.filter(source => !text(source.path).startsWith('evidencia_turno.')
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
      otros_hechos_y_politicas: sources, enlaces_permitidos: input.allowedLinks,
      presupuesto_del_turno: input.verified.presupuesto_del_turno || null,
      presupuesto_confirmado: effectiveTurnBudget(input.verified),
    },
    estado_del_turno: {
      consulta_catalogo: input.audit.catalog_query || null,
      alcance_catalogo: input.verified.catalog_context_scope || null,
      cobertura_catalogo: input.audit.catalog_coverage || null,
      resultado_catalogo: { complete: object(input.audit.catalog_results).complete,
        unit_ids: object(input.audit.catalog_results).unit_ids },
      introduccion: input.audit.profile_introduction || null,
      reserva: input.audit.reservation || null,
      visita: input.audit.visit_result || null,
      accion: input.audit.action || null,
    },
  }
}
