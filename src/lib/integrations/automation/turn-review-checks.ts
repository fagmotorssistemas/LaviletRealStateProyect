import { object, text, type Row } from './data'

export const reviewChecks = ['all_requests_considered', 'answers_supported', 'answered_content_preserved', 'operational_goal_preserved', 'question_has_purpose'] as const
const advisoryChecks = new Set(['all_requests_considered', 'answered_content_preserved', 'question_has_purpose'])
export const FACTUAL_REVIEW_SCOPE_RULES = `ALCANCE DE LA REVISIÓN: Bloquee únicamente hechos o promesas sin respaldo, contradicciones y reglas comerciales obligatorias aplicables al turno. all_requests_considered, answered_content_preserved y question_has_purpose son observaciones de calidad, no vetos: sus detalles usan kind=editorial. No rechace por orden, longitud, falta de una pregunta opcional o por no encontrar opciones en una búsqueda completa. Informar que no hay coincidencias SÍ responde una consulta de disponibilidad. operational_goal_preserved controla obligaciones concretas del contrato de apertura o de la acción actual, nunca preferencias generales de venta. Mantenga las reglas obligatorias de recoger datos y no presentar categorías antes de la etapa permitida. Cada defecto factual debe identificar la afirmación y qué evidencia falta o la contradice. Un error de su ficha no demuestra un error comercial. Revise separadamente las afirmaciones de una oración compuesta: una búsqueda vacía puede respaldar la ausencia solicitada, pero no un máximo, otra categoría o una promesa adicional.`
export const reviewIssuesSchema = { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false,
  properties: { check: { type: 'string', enum: [...reviewChecks] },
    kind: { type: 'string', enum: ['content', 'editorial'] },
    source: { type: 'string', enum: ['current_request', 'draft'] }, fragment: { type: 'string' }, reason: { type: 'string' } },
  required: ['check', 'kind', 'source', 'fragment', 'reason'] } }

export const REVIEW_CHECK_RULES = `Revise la pertinencia y los hechos, no la semejanza con una respuesta base. answered_content_preserved significa coherencia de la respuesta actual; su nombre es histórico y NO exige preservar contenido de una base. Para cada control false incluya en review_issues un defecto concreto con check, kind=content, fragment y reason que explique el problema. En fragment seleccione obligatoriamente un ID S1, S2... de oraciones_borrador o R1 del mensaje actual referenciado; no copie ni reformule el texto y no indique source: el sistema obtiene la fuente del ID. Una petición actual no atendida usa R1; una afirmación incorrecta del borrador usa su ID S. El ID solo identifica el texto y su fuente; explique el defecto real en reason, pues seleccionar una referencia existente no demuestra un error. No invente omisiones de solicitudes antiguas. Diferencias de estilo, orden, longitud sugerida, no enumerar unidades secundarias o no copiar una pregunta son observaciones kind=editorial, no motivos de rechazo. No pedir un dato innecesario es válido. Si no hay defectos reales, marque los controles true y review_issues=[]. Los defectos de su propia ficha deben corregirse en la ficha, no atribuirse al texto del cliente.`

/** False flags must explain an actual defect, rather than silently vetoing prose. */
export function checkReviewDecision(review: Row, current: string, reply: string) {
  const issues: Row[] = [], editorial: Row[] = []
  const checks: Row = {}
  const needed = reviewChecks.filter(check => check !== 'question_has_purpose' || reply.replace(/https?:\/\/\S+/g, '').includes('?'))
  // Historical fixtures/snapshots predate issue details. Runtime schema requires them.
  if (review.review_issues === undefined) {
    for (const check of needed) {
      checks[check] = review[check] === true
      if (!checks[check]) issues.push({ code: `review_check_failed:${check}`, kind: 'commercial_content', check })
    }
    return { issues, editorial, checks }
  }
  if (!Array.isArray(review.review_issues) || review.review_issues.length > 12)
    return { issues: [{ code: 'invalid_review_issue_list', kind: 'review_metadata' }], editorial, checks }
  const details = review.review_issues.map(object)
  for (const detail of details) {
    if (advisoryChecks.has(text(detail.check))) {
      editorial.push({ ...detail, kind: 'editorial' })
      continue
    }
    const source = detail.source === 'current_request' ? current : detail.source === 'draft' ? reply : ''
    if (detail.invalid_sentence_reference === true || !reviewChecks.includes(detail.check as typeof reviewChecks[number]) || !['content', 'editorial'].includes(text(detail.kind))
      || !text(detail.fragment).trim() || !source.includes(text(detail.fragment)) || !text(detail.reason).trim()) {
      issues.push({ code: 'invalid_review_issue_reference', kind: 'review_metadata', check: detail.check, fragment: detail.fragment })
      continue
    }
    if (detail.kind === 'editorial') editorial.push(detail)
    else issues.push({ ...detail, code: `review_check_failed:${detail.check}`, kind: 'commercial_content' })
  }
  for (const check of needed) {
    if (advisoryChecks.has(check)) {
      checks[check] = true
      if (review[check] !== true && !editorial.some(item => item.check === check))
        editorial.push({ check, kind: 'editorial', reason: 'Observación de calidad sin un defecto factual o una obligación incumplida.' })
      continue
    }
    const hasContent = issues.some(issue => issue.check === check && issue.kind === 'commercial_content')
    const hasEditorial = editorial.some(issue => issue.check === check)
    checks[check] = !hasContent && (review[check] === true || hasEditorial)
    if (typeof review[check] !== 'boolean' || !checks[check] && !hasContent
      && !issues.some(issue => issue.check === check))
      issues.push({ code: 'unexplained_review_failure', kind: 'review_metadata', check })
  }
  return { issues, editorial, checks }
}
