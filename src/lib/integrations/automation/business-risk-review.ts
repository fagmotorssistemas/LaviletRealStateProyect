import { object, text, type Row } from './data'
import { numericMentions } from './semantic-review'

export const BUSINESS_RISK_REVIEW_VERSION = 'business-risk-v1'

// A finding describes a commercial risk, not an inventory of every sentence or
// number in the draft. The authoritative catalogue is supplied in the input.
export const businessRiskReviewSchema: Row = {
  type: 'object', additionalProperties: false,
  properties: {
    review_contract: { type: 'string', enum: [BUSINESS_RISK_REVIEW_VERSION] },
    verdict: { type: 'string', enum: ['pass', 'block'] },
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
  required: ['review_contract', 'verdict', 'findings'],
}

export const BUSINESS_RISK_REVIEW_RULES = `# Función del revisor

Revise el borrador sin reescribirlo. Decida PASA o BLOQUEA exclusivamente por los tres riesgos siguientes.

## 1. Veracidad de datos del negocio

Bloquee una afirmación concreta de precio, rango, dormitorios, superficie, planta, tipología, instalaciones o disponibilidad que contradiga el catálogo/CRM para el mismo inmueble y alcance, o que carezca de respaldo en las fuentes autorizadas. Respete sujeto, filtros y valores exactos; no redondee. Las cantidades declaradas por el cliente son requisitos, no hechos del inmueble. No exija mencionar datos secundarios. Una orientación general y prudente no constituye una garantía ni requiere una ficha inmobiliaria.

## 2. Restricciones comerciales aplicables

Bloquee promesas sin respaldo de reserva, precio congelado, descuento, aprobación financiera o gestión realizada; asesoría legal/financiera compleja; lenguaje inapropiado; ofertas de inmuebles ajenos, competidores o enlaces no autorizados; y contradicciones con políticas aplicables. Reconocer datos del cliente, usar primera persona u ofrecer orientación no acredita una gestión realizada. Ofrecer revisar financiamiento autorizado y acompañamiento no garantiza aprobación.

## 3. Obligaciones explícitas de este turno

Compruebe únicamente obligaciones_del_turno. current_request exige atender las solicitudes actuales, incluso con una aclaración pertinente o explicando una limitación real de las fuentes. Para bloquear por turn_goal identifique en reason la obligación concreta omitida y su efecto. No cree obligaciones adicionales de preguntas, brochure, alternativas, perfilamiento o derivación. Una consulta atendida puede terminar sin pregunta si ninguna obligación exige hacerla. Acepte expresiones equivalentes; no espere que el cliente ya haya respondido una captura solicitada en el borrador.

# Fuentes y alcance

Use unidades, grupos y presupuesto_del_turno para precios y comparaciones; hechos_con_cantidades no es la única fuente. Consulte todas las fuentes pertinentes antes de declarar falta de respaldo. Una política de reserva regula solicitudes o confirmaciones de reserva, no convierte una comparación en reserva ni obliga a derivar consultas de precios. Respete el alcance de cada política y los filtros de la búsqueda. El historial y el propio borrador no demuestran hechos actuales del negocio.

# Criterios excluidos

No evalúe estilo, tono, elegancia, longitud sugerida, saludo, sintaxis ni número de frases. No cree fichas de cifras, operadores, oraciones o referencias cruzadas. Una respuesta clara que cumple las obligaciones y respeta los datos pasa aunque usted la redactaría distinto. Un error administrativo no demuestra un riesgo comercial.

# Salida

Devuelva únicamente el JSON del esquema. verdict=pass exige findings=[]. verdict=block exige hallazgos materiales que identifiquen la afirmación u obligación afectada, el perjuicio y el hecho o regla autorizada pertinente. No invente evidencia para justificar un bloqueo.`

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

/** Catch a price or surface that is absent from every authorized source without
 * parsing prose into unit/field/ID bindings. The reviewer still checks scope. */
export function unverifiedHardNumbers(reply: string, current: string, units: Row[], claimSources: Row[]): Row[] {
  const leadValues = numericMentions(current).map(item => item.value)
  const sourceValues = claimSources.filter(source => source.kind !== 'lead_statement')
    .flatMap(source => numericMentions(JSON.stringify(source.value ?? '')).map(item => item.value))
  const prices = [...leadValues, ...sourceValues, ...units.map(unit => Number(unit.published_commercial_price))]
  const areas = [...leadValues, ...sourceValues, ...units.flatMap(unit => [Number(unit.area_internal_m2), Number(unit.area_exterior_m2)])]
  const urls = [...reply.matchAll(/https?:\/\/\S+/g)].map(match => ({ start: match.index, end: match.index + match[0].length }))
  return numericMentions(reply).flatMap(mention => {
    if (urls.some(url => mention.index >= url.start && mention.index < url.end)) return []
    const before = reply.slice(Math.max(0, mention.index - 7), mention.index)
    const after = reply.slice(mention.end, mention.end + 22)
    const price = /(?:\$|USD\s*)$/i.test(before) || /^\s*(?:USD|d[oó]lares?\b)/i.test(after)
    const area = /^\s*(?:m²|m2\b|metros?\s+cuadrad[oa]s?\b)/i.test(after)
    if (!price && !area) return []
    const authorized = price ? prices : areas
    if (authorized.some(value => Number.isFinite(value) && Math.abs(value - mention.value) < 1e-9)) return []
    return [{ category: 'hard_fact', statement: `Cifra no verificada: ${mention.text}${area ? ' m²' : ''}`,
      reason: `El valor ${mention.value} no aparece entre los ${price ? 'precios' : 'superficies'} autorizados ni en el mensaje del cliente.`,
      authoritative_fact: `Consulte los ${price ? 'precios publicados' : 'metros cuadrados'} exactos de las unidades y políticas suministradas para este turno.` }]
  })
}

export function businessRiskContext(input: {
  current: string; reply: string; obligations: Row[]; units: Row[]; groups: Row[];
  projectFacts: Row[]; claimSources: Row[]; verified: Row; audit: Row; allowedLinks: string[];
}): Row {
  const sourceFields = ['id', 'unit_number', 'category', 'bedrooms', 'bathrooms_full', 'area_internal_m2',
    'area_exterior_m2', 'floor_number', 'published_commercial_price', 'availability_status', 'status', 'is_published']
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
    mensaje_actual: input.current,
    borrador: input.reply,
    obligaciones_del_turno: input.obligations,
    fuentes_autorizadas: {
      unidades: input.units.map(pick), grupos: groups, hechos_con_cantidades: input.projectFacts,
      otros_hechos_y_politicas: sources, enlaces_permitidos: input.allowedLinks,
      presupuesto_del_turno: input.verified.presupuesto_del_turno || null,
    },
    estado_del_turno: {
      consulta_catalogo: input.audit.catalog_query || null,
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
