type Row = Record<string, unknown>
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
const text = (v: unknown) => typeof v === 'string' ? v : ''
const list = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : []
const fields: Record<string, string> = { bedrooms: 'dormitorios', bathrooms_full: 'baños completos', area_internal_m2: 'superficie interior', area_exterior_m2: 'superficie exterior', floor_number: 'planta', published_commercial_price: 'precio publicado' }
const checks: Record<string, string> = { all_requests_considered: 'No se confirmó que atendiera todas las solicitudes.', answers_supported: 'No se confirmó el respaldo de las respuestas.', answered_content_preserved: 'No se confirmó que conservara la información necesaria.', operational_goal_preserved: 'No se confirmó que respetara el objetivo del turno.', question_has_purpose: 'No se confirmó la utilidad de la pregunta final.' }
const profileChecks: Record<string, string> = {
  unauthorized_link: 'El borrador incluye un enlace que no está autorizado por la evidencia del turno.',
  required_link_omitted: 'El borrador omitió un enlace que debía entregar por la solicitud actual o una entrega comprometida.',
  reservation_not_confirmed: 'El borrador afirmó una reserva de inventario sin confirmación; registrar la solicitud no separa el inmueble.',
  advisor_assignment_not_verified: 'El borrador afirmó una asignación de asesor que no está comprobada.',
  reservation_handoff_not_verified: 'El borrador afirmó un trámite o derivación de reserva que no está comprobado.',
  lead_profile_confirmation_omitted: 'Se omitió confirmar si el lugar declarado es la residencia actual.',
  lead_profile_question_purpose_changed: 'La pregunta cambió el dato que debía recoger o confirmar.',
  lead_profile_unconfirmed_residence: 'Se presentó como residencia confirmada un lugar que aún necesita confirmación.',
  lead_profile_name_acknowledgement_missing: 'Falta el saludo «Mucho gusto» con el nombre recibido por primera vez.',
  commercial_next_question_missing: 'Se omitió la pregunta que permite avanzar entre las opciones de interés.',
  commercial_next_question_changed: 'La pregunta cambió el propósito del siguiente paso antes de completar la elección.',
}

export function reviewDecision(output: Row, catalog: Row[] = []) {
  const status = text(output.status), review = row(output.semantic_review)
  const recovery = row(output.recovery || row(output.turn_completeness).recovery)
  const recoveryPending = recovery.version === 'turn-recovery-v1' && recovery.pending === true
  const errors = list(review.validation_details), attempts = list(output.repair_attempts)
  const issues = Array.isArray(output.issues) ? output.issues.map(text) : []
  const quantityChecks = list(row(output.final_validation).project_quantity_checks)
  const rejected = output.draft_rejected === true || /^(rejected|invalid)/.test(status)
  const metadata = rejected && (status === 'invalid_coverage' || issues.includes('invalid_review_metadata'))
  const tone = status === 'checked' ? 'accepted' : metadata ? 'metadata' : rejected ? 'rejected' : 'unknown'
  const title = recoveryPending ? 'Propuesta sin aprobar · Recuperación pendiente' : tone === 'accepted' ? 'Propuesta aprobada en este paso' : metadata ? 'Propuesta descartada · Falló la ficha interna'
    : rejected ? 'Propuesta descartada · Falló una validación' : 'Decisión sobre el borrador sin confirmar'
  const explanation = recoveryPending ? 'La propuesta no superó la revisión y la respuesta base no se autorizó como reemplazo. La consulta quedó pendiente de recuperación; el texto preparado y su envío se comprueban en los pasos posteriores.'
    : tone === 'accepted' ? 'Los controles de este paso aprobaron la propuesta. El envío definitivo se verifica en Envío a Kommo.'
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
    if (error.code === 'numeric_relation_not_in_reply') return `${location}: el valor que el revisor intentó comprobar no está expresado en ese fragmento. Falló la ficha de revisión.${quote}`
    if (error.code === 'numeric_field_not_in_reply') return `${location}: la cifra del fragmento describe otro dato; no acredita ${field}. Falló la asociación de la ficha del revisor.${quote}`
    if (text(error.code).startsWith('review_check_failed:')) return `${checks[text(error.check)] || 'Se detectó un problema de contenido'} ${text(error.reason)}${quote}`
    if (error.code === 'unexplained_review_failure') return `El revisor rechazó «${text(error.check)}» sin identificar un defecto concreto. Se requiere corregir la ficha, no demuestra que el texto comercial sea incorrecto.`
    if (error.code === 'claim_source_not_verified') return `${location}: la fuente citada no respalda el tipo de afirmación o no pertenece a la evidencia de esta ejecución.${quote}`
    if (error.code === 'catalog_value_mismatch') return `${location}: para "${ref}", ${field} recibido: ${String(error.received)}; catálogo: ${error.expected == null ? 'sin dato verificado' : String(error.expected)}.${quote}`
    return `${location}: control ${text(error.code) || 'no identificado'}.${quote}`
  })
  if (!details.length) for (const issue of issues) {
    if (profileChecks[issue]) { details.push(profileChecks[issue]); continue }
    if (issue === 'question_count') { details.push('Falló el límite de preguntas. En registros antiguos también podía rechazarse una sola pregunta porque la plantilla base no contenía ninguna. Compare el borrador y la base.'); continue }
    if (issue === 'operational_question_added') { details.push('La IA añadió una pregunta a una plantilla operativa sin revisión de su propósito.'); continue }
    if (issue === 'fallback_unanswered_request') { details.push('El respaldo omite una solicitud actual y no se conserva como respuesta válida.'); continue }
    details.push(issue.startsWith('review_check_failed:') ? checks[issue.slice('review_check_failed:'.length)] || issue
      : issue === 'semantic_claims_unsupported_or_invalid' ? 'Una afirmación carece de respaldo o su ficha no cumple el contrato. Consulte las afirmaciones contrastadas.' : issue)
  }
  for (const check of quantityChecks.filter(check => check.outcome !== 'supported')) {
    details.push(`Afirmación «${text(check.fragment)}»: ${check.outcome === 'contradicted' ? 'el valor contradice la evidencia de ese atributo' : 'no se pudo resolver una referencia única; no significa que el dato sea falso'}. Contexto: ${text(check.context)}. Evidencia: ${list(check.evidence).map(f => `${text(f.subject)}: ${text(f.text)} (${text(f.source)})`).join('; ') || 'sin referencia identificada'}.`)
  }
  const eligibility = row(review.repair_eligibility)
  const descriptions: Record<string, string> = {
    ...profileChecks,
    question_count: 'Falló la restricción de preguntas. En ejecuciones antiguas también se rechazaba una sola pregunta si la plantilla base no tenía ninguna.',
    operational_question_added: 'Se añadió una pregunta operativa sin una revisión de su propósito.',
    fallback_unanswered_request: 'El respaldo omite una solicitud actual; no debe enviarse como si la hubiera contestado.',
    invalid_unit_fact: 'Referencias, campos o valores de la ficha no pudieron asociarse con la evidencia del turno.',
    review_fragment_not_in_reply: 'El revisor entregó citas que no aparecen literalmente en el borrador.',
    claim_fragment_not_in_reply: 'El revisor incluyó una afirmación que no aparece en el borrador.',
    numeric_relation_not_in_reply: 'El revisor atribuyó al fragmento un valor que el texto no expresa.',
    numeric_field_not_in_reply: 'El revisor asoció una cifra con un atributo distinto del expresado.',
    claim_source_not_verified: 'La ficha citó fuentes ausentes o de un tipo incorrecto para la afirmación.',
    unexplained_review_failure: 'El revisor emitió un rechazo sin explicar un defecto concreto del contenido.',
    invalid_review_issue_reference: 'La explicación del rechazo no se vinculó correctamente al mensaje actual o al borrador.',
    guidance_contains_factual_assertion: 'La ficha debe separar la orientación general de los datos que necesitan evidencia.',
    catalog_value_mismatch: 'Los valores declarados no coinciden con los datos verificados.',
    conflicting_evidence: 'El sistema preparó datos contradictorios para una misma unidad.',
    review_repair_omitted_facts: 'La reparación omitió relaciones que debía conservar.',
  }
  const causes = [...new Set(errors.map(error => text(error.code)))].map(code => `${descriptions[code] || code} (${errors.filter(error => error.code === code).length} comprobaciones afectadas).`)
  const corrections = list(review.reference_corrections)
  const resolvedDetails = corrections.length ? [
    `Se resolvieron ${corrections.length} referencias internas sin cambiar el texto comercial ni sus valores. Estas correcciones no son causas de rechazo.`,
    ...corrections.map(correction => `${text(correction.code)}${text(correction.from) ? `: «${text(correction.from)}»` : ''}${text(correction.to) ? ` → «${text(correction.to)}»` : ''}.`),
  ] : []
  if (!causes.length) causes.push(...details)
  const repair = attempts.length ? `Hubo ${attempts.length} intento(s) registrado(s). Consulte su resultado en Intento de reparación.`
    : eligibility.policy === 'review_metadata_v2' && eligibility.reason === 'data_or_evidence_error' ? 'La política distingue errores internos de discrepancias de datos. No se registró un intento; consulte la evidencia y el resultado final.'
    : eligibility.reason === 'error_not_supported_by_repair_policy' ? 'No se intentó reparar: el error no está admitido por la política registrada. Esa política solo repara citas no literales del revisor; no referencias de unidades, campos ni valores.'
      : eligibility.reason === 'claims_not_supported' ? 'No se intentó reparar: no se confirmó el respaldo de las afirmaciones, requisito de la reparación de citas.'
        : status === 'checked' ? 'No hubo intentos registrados; la propuesta quedó aprobada en este paso.'
          : errors.some(error => error.code === 'invalid_unit_fact') ? 'No hay intentos registrados. Este registro histórico no conserva la política que se ejecutó; no se atribuye a la política actual.'
            : 'No hay intentos registrados. Este registro no conserva un motivo específico para no reparar.'
  return { tone, title, explanation, details, causes, repair, resolvedDetails, recoveryPending }
}
