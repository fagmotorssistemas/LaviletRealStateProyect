type Row = Record<string, unknown>
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
const text = (v: unknown) => typeof v === 'string' ? v : ''
const list = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : []
const fields: Record<string, string> = { bedrooms: 'dormitorios', bathrooms_full: 'baños completos', area_internal_m2: 'superficie interior', area_exterior_m2: 'superficie exterior', floor_number: 'planta', published_commercial_price: 'precio publicado' }
const checks: Record<string, string> = { all_requests_considered: 'No se confirmó que atendiera todas las solicitudes.', answers_supported: 'No se confirmó el respaldo de las respuestas.', answered_content_preserved: 'No se confirmó que conservara la información necesaria.', operational_goal_preserved: 'No se confirmó que respetara el objetivo del turno.', question_has_purpose: 'No se confirmó la utilidad de la pregunta final.' }

export function reviewDecision(output: Row, catalog: Row[] = []) {
  const status = text(output.status), review = row(output.semantic_review)
  const errors = list(review.validation_details), attempts = list(output.repair_attempts)
  const issues = Array.isArray(output.issues) ? output.issues.map(text) : []
  const rejected = output.draft_rejected === true || /^(rejected|invalid)/.test(status)
  const metadata = rejected && (status === 'invalid_coverage' || issues.includes('invalid_review_metadata'))
  const tone = status === 'checked' ? 'accepted' : metadata ? 'metadata' : rejected ? 'rejected' : 'unknown'
  const title = tone === 'accepted' ? 'Propuesta aprobada en este paso' : metadata ? 'Propuesta descartada · Falló la ficha interna'
    : rejected ? 'Propuesta descartada · Falló una validación' : 'Decisión sobre el borrador sin confirmar'
  const explanation = tone === 'accepted' ? 'Los controles de este paso aprobaron la propuesta. El envío definitivo se verifica en Envío a Kommo.'
    : metadata ? 'El sistema no pudo validar la información interna que acompaña al texto. Conservó la respuesta de respaldo; esto no demuestra por sí solo que la redacción comercial fuera incorrecta.'
      : rejected ? 'La propuesta no superó los controles registrados. Se conservó la respuesta de respaldo.' : 'Este registro no permite confirmar la aceptación o el descarte.'
  const details = errors.map(error => {
    const ref = text(error.unit_id), field = fields[text(error.field)] || text(error.field) || 'dato no identificado'
    const location = typeof error.index === 'number' ? `factual_values[${error.index}]` : 'Ficha del revisor'
    const quote = text(error.fragment) ? ` Fragmento: «${text(error.fragment)}».` : ''
    if (error.code === 'invalid_unit_fact') {
      const matches = catalog.filter(unit => unit.unit_number === ref)
      const expected = text(error.expected_unit_id) || (matches.length === 1 && !catalog.some(unit => unit.id === ref) ? text(matches[0].id) : '')
      if (expected) return `${location}: se recibió unit_id="${ref}", que es el número visible de la unidad; se esperaba su identificador interno "${expected}". El dato a comprobar era ${field}: ${String(error.received)}.${quote}`
      if (error.reason === 'unit_id_not_in_catalog') return `${location}: el identificador "${ref}" no está en el catálogo usado para validar. No se pudo asociar ${field}: ${String(error.received)} con una unidad verificada.${quote}`
      if (error.reason === 'unsupported_field') return `${location}: el campo "${text(error.field)}" no está admitido por el contrato del revisor.${quote}`
      if (error.reason === 'invalid_numeric_value') return `${location}: el valor de ${field} no es un número válido.${quote}`
      return `${location}: referencia interna, campo o valor inválido. Referencia recibida: "${ref}"; ${field}: ${String(error.received)}. Este registro antiguo no distingue cuál de esas comprobaciones falló.${quote}`
    }
    if (error.code === 'review_fragment_not_in_reply') return `${location}: el fragmento de respaldo no aparece literalmente en el borrador. Falló la cita del revisor, no necesariamente el dato comercial.${quote}`
    if (error.code === 'catalog_value_mismatch') return `${location}: para "${ref}", ${field} recibido: ${String(error.received)}; catálogo: ${error.expected == null ? 'sin dato verificado' : String(error.expected)}.${quote}`
    return `${location}: control ${text(error.code) || 'no identificado'}.${quote}`
  })
  if (!details.length) for (const issue of issues) {
    details.push(issue.startsWith('review_check_failed:') ? checks[issue.slice('review_check_failed:'.length)] || issue
      : issue === 'semantic_claims_unsupported_or_invalid' ? 'Una afirmación carece de respaldo o su ficha no cumple el contrato. Consulte las afirmaciones contrastadas.' : issue)
  }
  const eligibility = row(review.repair_eligibility)
  const repair = attempts.length ? `Hubo ${attempts.length} intento(s) registrado(s). Consulte su resultado en Intento de reparación.`
    : eligibility.reason === 'error_not_supported_by_repair_policy' ? 'No se intentó reparar: el error no está admitido por la política registrada. Esa política solo repara citas no literales del revisor; no referencias de unidades, campos ni valores.'
      : eligibility.reason === 'claims_not_supported' ? 'No se intentó reparar: no se confirmó el respaldo de las afirmaciones, requisito de la reparación de citas.'
        : status === 'checked' ? 'No hubo intentos registrados; la propuesta quedó aprobada en este paso.'
          : errors.some(error => error.code === 'invalid_unit_fact') ? 'No hay intentos registrados. La reparación actual solo contempla citas no literales; este fallo de referencia, campo o valor queda fuera. El registro histórico no conserva la política que se ejecutó.'
            : 'No hay intentos registrados. Este registro no conserva un motivo específico para no reparar.'
  return { tone, title, explanation, details, repair }
}
