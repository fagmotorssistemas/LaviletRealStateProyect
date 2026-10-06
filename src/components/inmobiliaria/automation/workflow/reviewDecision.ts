type Row = Record<string, unknown>
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
const text = (v: unknown) => typeof v === 'string' ? v : ''
const list = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : []
const ids = (v: unknown): string[] => Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string' && !!item) : []
export function reviewOwnerLabel(value: unknown) {
  return ({ reviewer: 'Revisor IA', writer: 'Redactor IA', system: 'Sistema' } as Record<string, string>)[text(value)] || 'No conservado en el registro'
}
export const reviewIssueLabels: Record<string, string> = {
  invalid_claim_repair_resolution: 'La ficha de reparación no explicó válidamente cómo sustituir o descartar una afirmación anterior. Se conservó esa afirmación para comprobarla.',
  invalid_pending_repair_resolution: 'La reparación no explicó cómo resolver o descartar una comprobación pendiente. Se conserva pendiente; otra afirmación correcta no la sustituye.',
  invalid_numeric_coverage: 'La ficha no contiene una revisión numérica utilizable; falta completar la comprobación de las cantidades.',
  unreviewed_numeric_reference: 'Una expresión numérica quedó sin revisar. Esto no demuestra que el dato del borrador sea incorrecto.',
  duplicate_numeric_reference: 'La ficha revisó la misma expresión numérica más de una vez; debe resolver esa duplicación.',
  unknown_numeric_reference: 'La ficha citó una expresión numérica ajena al inventario de este borrador.',
  invalid_numeric_classification: 'Falta una clasificación válida y explicada para una expresión numérica.',
  invalid_numeric_bindings: 'La ficha no vinculó correctamente la cantidad con los datos extraídos que deben comprobarla.',
  numeric_business_binding_missing: 'Una cantidad del negocio quedó sin enlace a un dato numérico comprobable.',
  numeric_binding_not_in_sentence: 'La ficha vinculó la cantidad con un dato extraído de otra oración o con un dato inexistente.',
  numeric_binding_value_mismatch: 'La cantidad citada y el valor de su ficha no coinciden; debe corregirse esa asociación antes de decidir sobre el mensaje.',
  numeric_unit_identifier_unverified: 'No se pudo comprobar que la cifra corresponda al identificador de una unidad del catálogo.',
  nonbusiness_numeric_has_business_binding: 'La ficha clasificó la expresión como ajena a un dato del negocio, pero también la vinculó con un dato comercial.',
  numeric_repair_outside_scope: 'La ficha reparada incluyó una cifra fuera del alcance solicitado; se conserva la comprobación anterior de esa parte.',
  review_number_not_in_draft: 'La ficha del revisor atribuyó al borrador un valor que este no expresa. Debe corregirse la extracción, sin cambiar el mensaje para hacerlo coincidir con el catálogo.',
  each_member_value_mismatch: 'El valor afirmado para cada unidad no se cumple en todos los miembros del grupo. El mínimo o máximo del conjunto no demuestra que todos compartan ese valor.',
  invalid_numeric_value_scope: 'La ficha del revisor no indica correctamente si el valor corresponde a una unidad, a cada miembro o a un resumen del grupo.',
  individual_value_uses_group: 'La ficha usó una fuente de grupo para comprobar un valor atribuido a una unidad individual.',
  group_value_uses_individual: 'La ficha usó una sola unidad para comprobar una afirmación sobre un grupo completo.',
  writer_repair_unchanged: 'El redactor repitió el borrador rechazado. El sistema mantuvo el rechazo y evitó otra revisión del mismo texto.',
}
export function reviewObligationLabel(value: unknown) {
  return ({ profile_full_name: 'Solicitar el nombre pendiente', profile_current_residence: 'Solicitar o confirmar la residencia actual',
    profile_collection: 'Recoger los datos pendientes con el propósito de brochure y guía personalizada',
    brochure_sequence: 'Ofrecer o entregar el brochure según la etapa', business_scope: 'Respetar el alcance de La Vilet',
    opening_scope: 'Respetar la presentación inicial sin tipos de inmuebles', price_conditions: 'Conservar las condiciones del precio',
    current_operation: 'Respetar el objetivo y la operación del turno',
    location_scope: 'Enviar solo la ubicación permitida en este turno',
    visit_dialogue: 'Continuar la visita con el destino y consentimiento correctos',
    project_context_truth: 'Respetar el avance físico y los hechos verificados del entorno',
    early_purchase_discount: 'Respetar el alcance, la vigencia y las condiciones del descuento',
  } as Record<string, string>)[text(value)] || text(value).replaceAll('_', ' ') || 'Obligación no identificada'
}
function reviewOwnership(item: Row) {
  return `${text(item.owner) ? ` Responsable registrado: ${reviewOwnerLabel(item.owner)}.` : ''}${text(item.repair_owner) ? ` Encargado de corregir: ${reviewOwnerLabel(item.repair_owner)}.` : ''}`
}
const pendingReviewCodes: Record<string, string> = {
  review_sentence_pending: 'El revisor dejó pendiente la comprobación de este segmento; no informó que sus datos fueran incorrectos.',
  unreviewed_sentence: 'No quedó registrada una comprobación para este segmento; debe completarse la revisión.',
  review_obligation_pending: 'No se completó la comprobación de una obligación comercial; esto no acredita un incumplimiento del borrador.',
  unreviewed_obligation: 'La ficha no conserva una comprobación para esta obligación comercial.',
}
const fields: Record<string, string> = { bedrooms: 'dormitorios', bathrooms_full: 'baños completos', area_internal_m2: 'superficie interior', area_exterior_m2: 'superficie exterior', floor_number: 'planta', published_commercial_price: 'precio publicado' }
const checks: Record<string, string> = { all_requests_considered: 'No se confirmó que atendiera todas las solicitudes.', answers_supported: 'No se confirmó el respaldo de las respuestas.', answered_content_preserved: 'No se confirmó que conservara la información necesaria.', operational_goal_preserved: 'No se confirmó que respetara el objetivo del turno.', question_has_purpose: 'No se confirmó la utilidad de la pregunta final.' }
const profileChecks: Record<string, string> = {
  unauthorized_link: 'El borrador incluye un enlace que no está autorizado por la evidencia del turno.',
  required_link_omitted: 'El borrador omitió un enlace que debía entregar por la solicitud actual o una entrega comprometida.',
  required_continuation_missing: 'El borrador omitió la pregunta del siguiente paso comercial vigente. Debe completarla conservando la respuesta a la consulta.',
  reservation_not_confirmed: 'El borrador afirmó una reserva de inventario sin confirmación; registrar la solicitud no separa el inmueble.',
  advisor_assignment_not_verified: 'El borrador afirmó una asignación de asesor que no está comprobada.',
  reservation_handoff_not_verified: 'El borrador afirmó un trámite o derivación de reserva que no está comprobado.',
  lead_profile_confirmation_omitted: 'Se omitió confirmar si el lugar declarado es la residencia actual.',
  lead_profile_question_purpose_changed: 'La pregunta cambió el dato que debía recoger o confirmar.',
  lead_profile_question_missing: 'El sistema detectó que falta la pregunta de datos exigida en esta etapa comercial.',
  invalid_review_question_metadata: 'La ficha de la pregunta del revisor necesita reparación; esto no demuestra un error en el mensaje.',
  invalid_opening_stage_review: 'La ficha del revisor no permite comprobar que la presentación respete la etapa inicial; corresponde reparar la ficha.',
  lead_profile_categories_premature: 'La presentación inicial introdujo tipos de inmuebles antes de la etapa permitida, aunque los describa con otras palabras.',
  lead_profile_unconfirmed_residence: 'Se presentó como residencia confirmada un lugar que aún necesita confirmación.',
  lead_profile_name_acknowledgement_missing: 'Falta el saludo «Mucho gusto» con el nombre recibido por primera vez.',
  commercial_next_question_missing: 'Se omitió la pregunta que permite avanzar entre las opciones de interés.',
  commercial_next_question_changed: 'La pregunta cambió el propósito del siguiente paso antes de completar la elección.',
}

export function repairTargetLabel(target: unknown) {
  return target === 'commercial_draft' ? 'Corrección del mensaje comercial por el redactor'
    : target === 'writer_metadata' ? 'Reparación de la ficha del redactor, conservando el mensaje'
      : target === 'review_metadata' ? 'Reparación de la ficha del revisor, conservando el mensaje'
        : 'Destino de la reparación no conservado en el registro'
}

export function repairBudgetFacts(output: Row) {
  const budget = row(output.repair_budget)
  return [['writer', 'Intentos disponibles para el redactor'], ['review_metadata', 'Intentos disponibles para la ficha del revisor']].flatMap(([key, label]) => {
    const entry = row(budget[key])
    return typeof entry.limit === 'number' && Number.isInteger(entry.limit) && entry.limit >= 0
      && typeof entry.used === 'number' && Number.isInteger(entry.used) && entry.used >= 0
      ? [{ label, value: `${entry.used} utilizado(s) de ${entry.limit} permitido(s).` }] : []
  })
}

export function reviewDecision(output: Row, catalog: Row[] = []) {
  if (output.status === 'review_disabled' || row(output.semantic_review).status === 'disabled'
    || row(output.final_validation).policy === 'transport_only') return {
    tone: 'unknown', title: 'Sin revisión · Control general desactivado',
    explanation: 'Se conservó el borrador del redactor sin aprobación de su contenido. Los controles de transporte no comprueban hechos ni continuidad. El envío se comprueba en Envío a Kommo.',
    details: [], causes: [], repair: 'No se solicitaron revisiones ni reparaciones.', resolvedDetails: [], recoveryPending: false,
  }
  const status = text(output.status), review = row(output.semantic_review)
  const recovery = row(output.recovery || row(output.turn_completeness).recovery)
  const recoveredCatalog = status === 'recovered_catalog_result' && recovery.strategy === 'verified_empty_search'
  const recoveryPending = recovery.version === 'turn-recovery-v1' && recovery.pending === true
  const errors = list(review.validation_details), attempts = list(output.repair_attempts)
  const issues = Array.isArray(output.issues) ? output.issues.map(text) : []
  const quantityChecks = list(row(output.final_validation).project_quantity_checks)
  const rejected = recoveredCatalog || output.draft_rejected === true || /^(rejected|invalid)/.test(status)
  const focused = review.review_contract === 'focused-review-v1'
  const focusedPending = focused && rejected && (errors.length > 0 || ids(row(review.coverage).pending_sentence_ids).length > 0
    || list(review.obligation_checks).some(check => check.verdict === 'pending'))
    && errors.every(error => error.kind === 'review_metadata' || !!pendingReviewCodes[text(error.code)])
    && !list(review.obligation_checks).some(check => check.verdict === 'violated')
    && !quantityChecks.some(check => check.outcome === 'contradicted')
    && !list(row(output.final_validation).details).some(detail => detail.kind && detail.kind !== 'review_metadata')
  const metadata = rejected && (focused ? focusedPending : status === 'invalid_coverage'
    || issues.includes('invalid_review_metadata') || issues.includes('invalid_business_risk_review'))
  const tone = status === 'checked' ? 'accepted' : metadata ? 'metadata' : rejected ? 'rejected' : 'unknown'
  const title = recoveredCatalog ? 'Borrador descartado · Resultado de catálogo verificado' : recoveryPending ? 'Propuesta sin aprobar · Recuperación pendiente' : tone === 'accepted' ? 'Propuesta aprobada en este paso' : focusedPending ? 'Propuesta sin aprobar · Comprobación pendiente' : metadata ? 'Propuesta descartada · Falló la ficha interna'
    : rejected ? 'Propuesta descartada · Falló una validación' : 'Decisión sobre el borrador sin confirmar'
  const explanation = recoveredCatalog ? 'El sistema preparó una respuesta con el resultado de la búsqueda completa sin coincidencias, conservando sus filtros. No aprobó el borrador rechazado. El envío se comprueba en Envío a Kommo.' : recoveryPending ? 'La propuesta no superó la revisión y la respuesta base no se autorizó como reemplazo. La consulta quedó pendiente de recuperación; el texto preparado y su envío se comprueban en los pasos posteriores.'
    : tone === 'accepted' ? 'Los controles de este paso aprobaron la propuesta. El envío definitivo se verifica en Envío a Kommo.'
    : focusedPending ? 'El sistema no aprobó la propuesta porque quedó una comprobación pendiente en la ficha del revisor. Esto no demuestra que el texto contenga datos incorrectos. La respuesta preparada y su envío se verifican en los pasos posteriores.'
    : metadata ? 'El sistema no pudo validar la información interna que acompaña al texto. Conservó la respuesta de respaldo; esto no demuestra por sí solo que la redacción comercial fuera incorrecta.'
      : rejected ? 'La propuesta no superó los controles registrados. Se conservó la respuesta de respaldo.' : 'Este registro no permite confirmar la aceptación o el descarte.'
  const details = errors.map(error => {
    const ref = text(error.unit_id), field = fields[text(error.field)] || text(error.field) || 'dato no identificado'
    const location = typeof error.index === 'number' ? `factual_values[${error.index}]` : 'Ficha del revisor'
    const quote = text(error.fragment) ? ` Fragmento: «${text(error.fragment)}».` : ''
    if (['business-risk-v1', 'business-risk-v2'].includes(text(review.review_contract)) && ['hard_fact', 'business_guardrail', 'turn_goal'].includes(text(error.code))) {
      const labels: Record<string, string> = { hard_fact: 'Dato comercial', business_guardrail: 'Restricción comercial', turn_goal: 'Objetivo del turno' }
      return `${labels[text(error.code)]}: ${text(error.statement)}. ${text(error.reason)}`.trim()
    }
    if (focused && (error.kind === 'review_metadata' || pendingReviewCodes[text(error.code)])) {
      const sentenceIds = [...new Set([text(error.sentence_id), ...ids(error.sentence_ids)].filter(Boolean))]
      const segments = sentenceIds.map(id => {
        const sentence = list(review.sentence_references).find(sentence => sentence.id === id)
        return sentence && text(sentence.text) ? `${id}: «${text(sentence.text)}»` : id
      })
      return `${reviewIssueLabels[text(error.code)] || pendingReviewCodes[text(error.code)] || 'La ficha del revisor requiere una corrección técnica; no acredita por sí sola un dato comercial incorrecto.'}${segments.length ? ` Segmento: ${segments.join('; ')}.` : quote}${text(error.reason) ? ` Motivo registrado: ${text(error.reason)}.` : ''}${reviewOwnership(error)}`
    }
    if (reviewIssueLabels[text(error.code)]) return `${reviewIssueLabels[text(error.code)]}${quote}${reviewOwnership(error)}`
    if (focused && error.code === 'commercial_obligation_violated') return `El revisor registró un incumplimiento de la obligación comercial «${reviewObligationLabel(error.obligation_id)}».${text(error.reason) ? ` ${text(error.reason)}` : ''}${quote}${reviewOwnership(error)}`
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
    if (error.code === 'review_unit_binding_mismatch') return `${location}: el revisor atribuyó ${field}: ${String(error.received)} a la unidad «${ref}», aunque el borrador no hace esa atribución. Debe corregirse la referencia de la ficha sin cambiar el valor del mensaje.${quote}`
    if (text(error.code).startsWith('review_check_failed:')) return `${checks[text(error.check)] || 'Se detectó un problema de contenido'} ${text(error.reason)}${quote}`
    if (error.code === 'unexplained_review_failure') return `El revisor rechazó «${text(error.check)}» sin identificar un defecto concreto. Se requiere corregir la ficha, no demuestra que el texto comercial sea incorrecto.`
    if (error.code === 'claim_source_not_verified') return `${location}: la fuente citada no respalda el tipo de afirmación o no pertenece a la evidencia de esta ejecución.${quote}`
    if (error.code === 'catalog_value_mismatch') return `${location}: para "${ref}", ${field} recibido: ${String(error.received)}; catálogo: ${error.expected == null ? 'sin dato verificado' : String(error.expected)}.${quote}`
    if (profileChecks[text(error.code)]) return `${profileChecks[text(error.code)]}${quote}`
    return `${location}: control ${text(error.code) || 'no identificado'}.${quote}`
  })
  if (!details.length) for (const issue of issues) {
    if (reviewIssueLabels[issue]) { details.push(reviewIssueLabels[issue]); continue }
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
    ...pendingReviewCodes,
    ...reviewIssueLabels,
    commercial_obligation_violated: 'El revisor registró un incumplimiento de una obligación comercial aplicable al turno.',
    question_count: 'Falló la restricción de preguntas. En ejecuciones antiguas también se rechazaba una sola pregunta si la plantilla base no tenía ninguna.',
    operational_question_added: 'Se añadió una pregunta operativa sin una revisión de su propósito.',
    fallback_unanswered_request: 'El respaldo omite una solicitud actual; no debe enviarse como si la hubiera contestado.',
    invalid_unit_fact: 'Referencias, campos o valores de la ficha no pudieron asociarse con la evidencia del turno.',
    review_fragment_not_in_reply: 'El revisor entregó citas que no aparecen literalmente en el borrador.',
    claim_fragment_not_in_reply: 'El revisor incluyó una afirmación que no aparece en el borrador.',
    numeric_relation_not_in_reply: 'El revisor atribuyó al fragmento un valor que el texto no expresa.',
    numeric_field_not_in_reply: 'El revisor asoció una cifra con un atributo distinto del expresado.',
    review_unit_binding_mismatch: 'El revisor atribuyó una cifra a la unidad equivocada; corresponde reparar su ficha sin modificar el borrador.',
    claim_source_not_verified: 'La ficha citó fuentes ausentes o de un tipo incorrecto para la afirmación.',
    claim_evidence_missing: 'Falta la fuente necesaria para comprobar esta afirmación. No se ha demostrado que el mensaje sea incorrecto; se conserva el borrador durante la comprobación.',
    unexplained_review_failure: 'El revisor emitió un rechazo sin explicar un defecto concreto del contenido.',
    invalid_review_issue_reference: 'La explicación del rechazo no se vinculó correctamente al mensaje actual o al borrador.',
    guidance_contains_factual_assertion: 'La ficha debe separar la orientación general de los datos que necesitan evidencia.',
    catalog_value_mismatch: 'Los valores declarados no coinciden con los datos verificados.',
    conflicting_evidence: 'El sistema preparó datos contradictorios para una misma unidad.',
    review_repair_omitted_facts: 'La reparación omitió relaciones que debía conservar.',
  }
  const causes = [...new Set(errors.map(error => text(error.code)))].map(code => `${descriptions[code] || code} (${errors.filter(error => error.code === code).length} comprobaciones afectadas).${focused ? reviewOwnership(errors.find(error => error.code === code) || {}) : ''}`)
  const corrections = list(review.reference_corrections)
  const resolvedDetails = corrections.length ? [
    `Se resolvieron ${corrections.length} referencias internas sin cambiar el texto comercial ni sus valores. Estas correcciones no son causas de rechazo.`,
    ...corrections.map(correction => `${text(correction.code)}${text(correction.from) ? `: «${text(correction.from)}»` : ''}${text(correction.to) ? ` → «${text(correction.to)}»` : ''}.`),
  ] : []
  if (!causes.length) causes.push(...details)
  if (issues.includes('writer_repair_unchanged')) {
    const explanation = reviewIssueLabels.writer_repair_unchanged
    if (!details.includes(explanation)) details.push(explanation)
    if (!causes.includes(explanation)) causes.push(explanation)
  }
  const repairCounts = [
    ['commercial_draft', 'para el mensaje comercial'], ['writer_metadata', 'para la ficha del redactor'], ['review_metadata', 'para la ficha del revisor'],
  ].flatMap(([target, label]) => {
    const count = attempts.filter(attempt => attempt.target === target).length
    return count ? [`${count} ${label}`] : []
  })
  const unknownTargets = attempts.filter(attempt => !['commercial_draft', 'writer_metadata', 'review_metadata'].includes(text(attempt.target))).length
  if (unknownTargets) repairCounts.push(`${unknownTargets} con destino no conservado en el registro`)
  const reviewerNotAttempted = eligibility.budget_available === false && !attempts.some(attempt => attempt.target === 'review_metadata')
    ? unknownTargets ? ' El registro indica que no quedaba un intento disponible para la ficha del revisor; no permite identificar el destino de todos los intentos anteriores.'
      : ' No se intentó reparar la ficha del revisor: el sistema registró que no quedaba un intento disponible para esa reparación.' : ''
  const repair = (attempts.length ? `Se registraron ${attempts.length} intento(s): ${repairCounts.join('; ')}. Consulte su resultado en Intento de reparación.`
    : eligibility.budget_available === false ? 'No hay intentos de reparación registrados.'
    : eligibility.policy === 'review_metadata_v2' && eligibility.reason === 'data_or_evidence_error' ? 'La política distingue errores internos de discrepancias de datos. No se registró un intento; consulte la evidencia y el resultado final.'
    : eligibility.reason === 'error_not_supported_by_repair_policy' ? 'No se intentó reparar: el error no está admitido por la política registrada. Esa política solo repara citas no literales del revisor; no referencias de unidades, campos ni valores.'
      : eligibility.reason === 'claims_not_supported' ? 'No se intentó reparar: no se confirmó el respaldo de las afirmaciones, requisito de la reparación de citas.'
        : status === 'checked' ? 'No hubo intentos registrados; la propuesta quedó aprobada en este paso.'
          : errors.some(error => error.code === 'invalid_unit_fact') ? 'No hay intentos registrados. Este registro histórico no conserva la política que se ejecutó; no se atribuye a la política actual.'
            : 'No hay intentos registrados. Este registro no conserva un motivo específico para no reparar.') + reviewerNotAttempted
  return { tone, title, explanation, details, causes, repair, resolvedDetails, recoveryPending }
}
