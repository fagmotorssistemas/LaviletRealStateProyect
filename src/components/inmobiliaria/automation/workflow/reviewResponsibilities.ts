type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}

/** Read each recorded authority independently, also for historical traces. */
export function reviewResponsibilities(output: Row) {
  const review = row(output.semantic_review), acceptance = row(review.acceptance), final = row(output.final_validation)
  const iaApproved = review.status === 'checked' && acceptance.content_approved !== false
  const iaRejected = review.status === 'rejected' || acceptance.content_approved === false
  const issues = Array.isArray(final.issues) ? final.issues.filter(issue => typeof issue === 'string') : []
  return { reviewer: iaApproved ? 'IA revisora: aprobó el contenido factual y las promesas comerciales.'
    : iaRejected ? 'IA revisora: registró hallazgos sobre el contenido; consulte sus motivos.'
      : review.status === 'disabled' ? 'IA revisora: desactivada en esta ejecución.'
        : 'IA revisora: el registro no confirma un resultado de contenido.',
    system: issues.length ? `Validación final del sistema: registró incidencias (${issues.join(', ')}); su origen se indica en cada detalle.`
      : final.passed === true ? 'Sistema: sus controles finales no registraron incidencias.'
        : 'Sistema: el registro no confirma el resultado de sus controles finales.',
    separateRejection: iaApproved && issues.length > 0,
    systemFlowObservation: iaApproved && issues.some(code => /^commercial_next_question_/.test(String(code))) }
}
