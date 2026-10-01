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

export const BUSINESS_RISK_REVIEW_RULES = `Revise el borrador sin reescribirlo. Decida PASA o BLOQUEA exclusivamente por estos tres riesgos comerciales:
1. DATOS DUROS: una afirmación concreta de precio, rango, dormitorios, superficie, planta, tipología o disponibilidad contradice el catálogo/CRM verificado para el mismo inmueble y alcance, o afirma un dato comercial que no consta en las fuentes. Respete el sujeto, los filtros de la consulta y los extremos exactos; no redondee. Las cantidades del mensaje del cliente son requisitos, no afirmaciones del negocio. No exija mencionar datos secundarios.
2. RESTRICCIONES: el borrador promete una reserva, precio congelado, descuento, aprobación financiera u otra gestión no confirmada; da asesoría legal/financiera compleja; usa lenguaje inapropiado; ofrece inmuebles ajenos al catálogo, competidores o enlaces no autorizados; o contradice una política comercial aplicable. Reconocer lo que el cliente contó, usar primera persona y ofrecer orientación NO equivale a afirmar una gestión realizada.
3. OBJETIVO DEL TURNO: omite una obligación explícita en obligaciones_del_turno, deja sin atender la solicitud actual o cierra la conversación sin la aclaración, alternativa verificada o material autorizado necesarios. Acepte preguntas y expresiones equivalentes; compruebe lo que hace el borrador, no si el cliente ya respondió. No imponga una pregunta si la obligación no la exige.
No evalúe estilo, tono, elegancia, longitud sugerida, saludo, sintaxis, número de frases ni si usted habría redactado otra respuesta. Una respuesta clara que atiende al cliente PASA aunque sea mejorable. No cree un inventario de oraciones ni una ficha de cifras, operadores o IDs de fuentes. Si bloquea, incluya solo hallazgos materiales: qué afirma u omite el borrador, por qué perjudica el turno y cuál es el hecho o la regla autorizada que lo contradice. Una duda del revisor sobre el formato o una referencia administrativa nunca es motivo de bloqueo. verdict=pass exige findings=[]. verdict=block exige al menos un hallazgo.`

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
