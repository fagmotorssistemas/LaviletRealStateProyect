import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import {
  FOCUSED_REVIEW_VERSION, FOCUSED_REVIEW_RULES, adaptFocusedReview, focusedRepairScope,
  focusedReviewContext, focusedReviewIssues, focusedReviewSchema, mergeFocusedRepair,
  observedNumericIssues, repairDismissalsValid, reviewObligations, rowsForRepair,
} from './focused-review'
import type { Row } from './data'
import { structuredFactIssues } from './structured-facts'
import { claimSchema, groundedClaimReviewSchema, reviewClaims } from './semantic-review'

const sentences = [
  { id: 'S1', text: 'Gracias por su interés.' },
  { id: 'S2', text: 'La Vilet está en Puertas del Sol, Cuenca.' },
  { id: 'S3', text: '¿Podría indicarnos su nombre y dónde reside actualmente para enviarle el brochure y una guía personalizada?' },
]
const obligations = [{ id: 'business_scope', instruction: 'Respetar el proyecto.' }, { id: 'profile_collection', instruction: 'Solicitar datos pendientes.' }]
function review(extra: Row = {}): Row {
  return { review_contract: FOCUSED_REVIEW_VERSION, claims: [], factual_values: [], project_values: [],
    non_factual_sentence_ids: ['S1', 'S3'], pending_checks: [],
    obligation_checks: obligations.map(({ id }) => ({ id, verdict: 'met', sentence_ids: ['S3'], reason: '' })), ...extra }
}
const location = { fragment: 'S2', kind: 'project_fact', verdict: 'supported', source_ids: ['E1'], reasoning: 'La ubicación está registrada.' }

test('empty reviewer output cannot approve a greeting and factual project presentation', () => {
  const result = focusedReviewIssues({}, sentences, obligations)
  assert.ok(result.issues.some(issue => issue.code === 'invalid_focused_review_list'))
  assert.deepEqual(result.coverage.pending_sentence_ids, ['S1', 'S2', 'S3'])
  assert.equal(result.issues.filter(issue => issue.code === 'invalid_obligation_review').length, 2)
  assert.ok(result.issues.every(issue => issue.kind === 'review_metadata' && issue.owner === 'system' && issue.repair_owner === 'reviewer'))
})

test('an omitted location sentence is pending even if old global approval flags claim success', () => {
  const result = focusedReviewIssues(review({ answers_supported: true, factual_inventory_complete: true }), sentences, obligations)
  assert.deepEqual(result.coverage.pending_sentence_ids, ['S2'])
  assert.deepEqual(result.issues.map(issue => issue.code), ['unreviewed_sentence'])
  assert.equal(result.issues[0].fragment, sentences[1].text)
  assert.equal(result.issues[0].repair_owner, 'reviewer')
})

test('grounded facts with free wording do not depend on a global inventory boolean', () => {
  for (const fragment of ['S2', sentences[1].text]) {
    const data = review({ claims: [{ ...location, fragment }], factual_inventory_complete: false })
    const result = focusedReviewIssues(data, sentences, obligations)
    assert.deepEqual(result.issues, [])
    assert.deepEqual(result.coverage.reviewed_sentence_ids, ['S2'])
    assert.deepEqual(result.coverage.non_factual_sentence_ids, ['S1', 'S3'])
    assert.deepEqual(result.coverage.pending_sentence_ids, [])
  }
})

test('courtesy and a profile question require no invented factual claims', () => {
  const nonFactual = [sentences[0], sentences[2]]
  const result = focusedReviewIssues(review(), nonFactual, obligations)
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.coverage.reviewed_sentence_ids, [])
  assert.deepEqual(result.coverage.pending_sentence_ids, [])
})

test('focused schema removes redundant vetoes but keeps exact fact field constraints', () => {
  const exactFact = { type: 'array', items: { type: 'object', properties: {
    fragment: { type: 'string', enum: ['S1', 'S2', 'S3'] },
    operator: { type: 'string', enum: ['eq'] }, value: { type: 'number', enum: [120.83] },
  } } }
  const removed = ['all_requests_considered', 'answers_supported', 'answered_content_preserved', 'operational_goal_preserved',
    'question_has_purpose', 'question', 'review_issues', 'factual_inventory_complete', 'sentence_inventory', 'opening_property_type_sentence_ids', 'missing_fact_fragments']
  const schema = focusedReviewSchema({ type: 'object', additionalProperties: false,
    properties: { ...Object.fromEntries(removed.map(key => [key, { type: 'boolean' }])), factual_values: exactFact, claims: { type: 'array' } },
  }, sentences, obligations)
  const properties = schema.properties as Row
  for (const key of removed) assert.equal(key in properties, false, key)
  const factFields = ((properties.factual_values as Row).items as Row).properties as Row
  for (const [field, definition] of Object.entries(exactFact.items.properties)) assert.deepEqual(factFields[field], definition)
  assert.deepEqual((factFields.value_scope as Row).enum, ['individual', 'each_member', 'group_summary'])
  assert.ok((((properties.factual_values as Row).items as Row).required as string[]).includes('value_scope'))
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, Object.keys(properties))
  assert.deepEqual((properties.review_contract as Row).enum, [FOCUSED_REVIEW_VERSION])
  assert.match(FOCUSED_REVIEW_RULES, /No redondee/)
  assert.match(FOCUSED_REVIEW_RULES, /ubicación y las características del entorno SON hechos/)
})

test('focused claim schema permits only compatible business sources and source-free contextual guidance', () => {
  const sources = [{ id: 'E1', kind: 'project_fact' }, { id: 'E2', kind: 'operational_fact' }, { id: 'E3', kind: 'lead_statement' }]
  const base = groundedClaimReviewSchema({ properties: { claims: claimSchema } }, sources)
  const schema = focusedReviewSchema(base, sentences, obligations)
  const properties = schema.properties as Row, claims = (properties.claims as Row).items as Row
  const variants = claims.anyOf as Row[]
  assert.ok(variants.length)
  const kinds = new Set<string>()
  for (const variant of variants) {
    const fields = variant.properties as Row
    assert.equal(variant.additionalProperties, false)
    assert.equal('evidence_source' in fields, false)
    assert.deepEqual(variant.required, Object.keys(fields))
    for (const kind of (fields.claim_kind as Row).enum as string[]) kinds.add(kind)
  }
  assert.deepEqual([...kinds].sort(), ['contextual_guidance', 'operational_fact', 'project_fact'])
  const validate = new Ajv({ allErrors: true }).compile(claims)
  const baseClaim = { fragment: 'S2', subject: 'Hecho bajo revisión', polarity: 'affirmation', evidence: 'Respaldo de la fuente pertinente.' }
  for (const [kind, verdict, evidenceIds, expected] of [
    ['project_fact', 'supported', ['E1'], true], ['operational_fact', 'supported', ['E2'], true],
    ['operational_fact', 'supported', ['E3'], false], ['operational_fact', 'supported', ['E1'], false],
    ['project_fact', 'supported', ['E2'], false], ['project_fact', 'unsupported', [], true],
    ['project_fact', 'unsupported', ['E1'], false], ['contextual_guidance', 'supported', [], true],
    ['contextual_guidance', 'supported', ['E1'], false], ['contextual_guidance', 'unsupported', [], false],
    ['lead_statement', 'supported', ['E3'], false],
  ] as const) {
    assert.equal(validate({ ...baseClaim, claim_kind: kind, verdict, evidence_ids: evidenceIds }), expected,
      `${kind}/${verdict}/${evidenceIds.join(',')}`)
  }
  assert.equal(validate({ ...baseClaim, claim_kind: 'project_fact', verdict: 'supported', evidence_ids: ['E1'], evidence_source: 'verified_context' }), false)
  const checks = ((properties.obligation_checks as Row).items as Row).properties as Row
  assert.deepEqual((checks.verdict as Row).enum, ['met', 'violated'])
  assert.equal('missing_fact_fragments' in properties, false)
})

test('reviewer context keeps evidence and commercial state while excluding fallback text and writer advice', () => {
  const context = focusedReviewContext({ mensaje_actual: 'Estoy interesado', respuesta_propuesta: 'La Vilet está en Cuenca.',
    respuesta_base: 'Plantilla que no prueba el negocio', instrucciones_redactor: 'Consejos de estilo',
    oraciones_borrador: sentences, referencias_solicitud: [{ id: 'R1', text: 'Estoy interesado' }],
    contrato_redaccion: { estado_comercial: { requiere_captura: true }, ruta: 'project_information', estilo: 'Una recomendación' },
    contexto_verificado: { proyecto: { ubicacion: 'Cuenca' }, perfil_lead: { name: '' }, catalog_context_scope: { kind: 'project' },
      catalogo_completo: [{ id: 'irrelevant' }], politica_comercial: { precios_aproximados: true } },
    estado_operativo: { source: 'project_information', registration_verified: false, unrelated_writer_hint: 'No necesaria' },
    evidencia_afirmaciones: [{ id: 'E1', path: 'contexto_verificado.proyecto.ubicacion', text: 'Cuenca' }],
    reparacion_revision: { focused_sentence_ids: ['S2'] },
  }, obligations)
  assert.equal('respuesta_base' in context, false)
  assert.equal('instrucciones_redactor' in context, false)
  assert.equal('estilo' in (context.contrato_redaccion as Row), false)
  assert.equal('catalogo_completo' in (context.contexto_verificado as Row), false)
  assert.equal('unrelated_writer_hint' in (context.estado_operativo as Row), false)
  assert.deepEqual((context.contexto_verificado as Row).proyecto, { ubicacion: 'Cuenca' })
  assert.deepEqual(context.obligaciones_aplicables, obligations)
  assert.deepEqual(context.reparacion_revision, { focused_sentence_ids: ['S2'] })
})

test('obligations are derived from actual stage, never a generic list applied to every reply', () => {
  assert.deepEqual(reviewObligations({}, {}, {}).map(item => item.id), ['business_scope'])
  const applicable = reviewObligations({ profile_introduction: { generic_introduction: true } }, { politica_comercial: { precios_aproximados: true } },
    { estado_comercial: { requiere_captura: true, datos_a_pedir: ['current_residence'], residencia_por_confirmar: 'Guayaquil' } })
  assert.deepEqual(applicable.map(item => item.id), ['business_scope', 'profile_collection', 'profile_current_residence', 'opening_scope', 'price_conditions'])
  assert.deepEqual(applicable.find(item => item.id === 'profile_collection')?.required_data, ['current_residence'])
  assert.equal(applicable.find(item => item.id === 'profile_collection')?.candidate, 'Guayaquil')
  const both = reviewObligations({}, {}, { estado_comercial: { requiere_captura: true, datos_a_pedir: ['full_name', 'current_residence'] } })
  assert.ok(both.some(item => item.id === 'profile_full_name'))
  assert.ok(both.some(item => item.id === 'profile_current_residence'))
  assert.ok(reviewObligations({ reservation: { requested: true } }, {}, {}).some(item => item.id === 'current_operation'))
})

test('targeted repair preserves already checked facts and the unchanged commercial text', () => {
  const withPrice = [...sentences, { id: 'S4', text: 'La unidad 202 cuesta 245.123 dólares.' }]
  const price = { fragment: 'S4', unit_id: 'u202', field: 'published_commercial_price', operator: 'eq', value: 245123 }
  const previous = review({ factual_values: [price], pending_checks: [{ fragment: 'S2', reason: 'Falta verificar ubicación.' }] })
  const issues = focusedReviewIssues(previous, withPrice, obligations).issues
  const scope = focusedRepairScope(issues, withPrice, obligations)
  assert.deepEqual(scope.focused_sentence_ids, ['S2'])
  assert.deepEqual(scope.preserved_sentence_ids, ['S1', 'S3', 'S4'])
  const repaired = review({ claims: [location], non_factual_sentence_ids: [], obligation_checks: [],
    pending_resolutions: [{ pending_id: 'P1', resolution: 'resolved', claim_indexes: [0], factual_value_indexes: [],
      project_value_indexes: [], reason: 'La nueva afirmación contrasta la ubicación pendiente.' }] })
  const merged = mergeFocusedRepair(previous, repaired, scope, withPrice)
  assert.deepEqual(merged.factual_values, [price])
  assert.deepEqual(merged.claims, [location])
  assert.deepEqual(merged.pending_checks, [])
  assert.deepEqual(merged.obligation_checks, previous.obligation_checks)
  assert.deepEqual(focusedReviewIssues(merged, withPrice, obligations).issues, [])
  assert.deepEqual(rowsForRepair([location, { ...location, fragment: 'S4' }], scope, withPrice), [location])
})

test('repairing one obligation cannot erase another violation or approve an omitted targeted obligation', () => {
  const previous = review({ claims: [location], obligation_checks: [
    { id: 'business_scope', verdict: 'violated', sentence_ids: ['S2'], reason: 'Ofrece inmuebles fuera del proyecto.' },
    { id: 'profile_collection', verdict: 'pending', sentence_ids: [], reason: 'Falta revisar los datos solicitados.' },
  ] })
  const scope = focusedRepairScope([{ code: 'review_obligation_pending', obligation_id: 'profile_collection' }], sentences, obligations)
  assert.deepEqual(scope.focused_sentence_ids, [])
  assert.deepEqual(scope.obligations.map(item => item.id), ['profile_collection'])
  const fixed = mergeFocusedRepair(previous, review({ non_factual_sentence_ids: [], obligation_checks: [
    { id: 'profile_collection', verdict: 'met', sentence_ids: ['R1'], reason: '' },
  ] }), scope, sentences)
  const remaining = focusedReviewIssues(fixed, sentences, obligations).issues
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].code, 'commercial_obligation_violated')
  assert.equal(remaining[0].repair_owner, 'writer')
  const erased = mergeFocusedRepair(previous, review({ non_factual_sentence_ids: [], obligation_checks: [] }), scope, sentences)
  assert.ok(focusedReviewIssues(erased, sentences, obligations).issues.some(issue => issue.code === 'invalid_obligation_review' && issue.obligation_id === 'profile_collection'))
})

test('unknown and unexplained review references remain technical errors', () => {
  const cases: [Row, string][] = [
    [{ claims: [{ ...location, fragment: 'S999' }] }, 'unknown_review_sentence'],
    [{ claims: [location], non_factual_sentence_ids: ['S1', 'S3', 'S999'] }, 'unknown_review_sentence'],
    [{ pending_checks: [{ fragment: 'S2', reason: '' }] }, 'invalid_pending_check'],
    [{ claims: [location], obligation_checks: [{ id: 'business_scope', verdict: 'met', sentence_ids: ['S999'], reason: '' }] }, 'invalid_obligation_review'],
    [{ claims: [location], obligation_checks: [{ id: 'business_scope', verdict: 'violated', sentence_ids: ['S2'], reason: '' }] }, 'invalid_obligation_review'],
    [{ claims: [location], obligation_checks: [{ id: 'unknown', verdict: 'met', sentence_ids: [], reason: '' }] }, 'unknown_review_obligation'],
  ]
  for (const [extra, code] of cases) {
    const result = focusedReviewIssues(review(extra), sentences, obligations)
    const issue = result.issues.find(issue => issue.code === code)
    assert.ok(issue, code)
    assert.equal(issue.kind, 'review_metadata')
    assert.equal(issue.repair_owner, 'reviewer')
  }
  const duplicate = review({ claims: [location] })
  duplicate.obligation_checks = [...duplicate.obligation_checks as Row[], (duplicate.obligation_checks as Row[])[0]]
  assert.ok(focusedReviewIssues(duplicate, sentences, obligations).issues.some(issue => issue.code === 'invalid_obligation_review'))
})

test('a redundant courtesy label cannot waive or invalidate an actual factual review', () => {
  const result = focusedReviewIssues(review({ claims: [location], non_factual_sentence_ids: ['S1', 'S2', 'S3'] }), sentences, obligations)
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.coverage.reviewed_sentence_ids, ['S2'])
  assert.deepEqual(result.coverage.non_factual_sentence_ids, ['S1', 'S3'])
  assert.deepEqual(result.coverage.pending_sentence_ids, [])
})

test('a duplicate courtesy label cannot hide an incorrect value or an unsupported assertion', () => {
  const draft = [{ id: 'S1', text: 'La superficie interior es 121 m².' }]
  const extracted = { fragment: draft[0].text, unit_id: 'u202', field: 'area_internal_m2', operator: 'eq', value: 121 }
  const data = review({ factual_values: [extracted], non_factual_sentence_ids: ['S1'], obligation_checks: [] })
  assert.deepEqual(focusedReviewIssues(data, draft, []).coverage.non_factual_sentence_ids, [])
  assert.deepEqual(observedNumericIssues(data, draft), [])
  assert.deepEqual(structuredFactIssues(data.factual_values, [{ id: 'u202', area_internal_m2: 120.83 }]).map(issue => issue.code), ['catalog_value_mismatch'])
  const unsupported = { fragment: 'El proyecto tiene helipuerto.', subject: 'helipuerto', polarity: 'affirmation',
    verdict: 'unsupported', evidence: 'No consta en las fuentes.', claim_kind: 'project_fact', evidence_source: 'none', evidence_ids: [] }
  const claimData = review({ claims: [unsupported], non_factual_sentence_ids: ['S1'], obligation_checks: [] })
  const claimSentences = [{ id: 'S1', text: unsupported.fragment }]
  assert.deepEqual(focusedReviewIssues(claimData, claimSentences, []).coverage.non_factual_sentence_ids, [])
  assert.ok(reviewClaims(claimData.claims, unsupported.fragment, [], true).issues.some(issue => issue.code === 'claim_unsupported'))
})

test('historical output is not adapted while modern compatibility preserves claims and missing sources', () => {
  const historical = { question: { purpose: 'none' }, answers_supported: false }
  assert.equal(adaptFocusedReview(historical, {}, []), historical)
  const raw = review({ claims: [{ ...location, verdict: 'unsupported', source_ids: [] }] })
  const modern = adaptFocusedReview(raw, { purpose: 'clarify_request' }, [{ status: 'clarification', reference_id: 'R1' }])
  assert.equal(modern.answers_supported, false)
  assert.deepEqual(modern.claims, (raw.claims as Row[]).map(claim => ({ ...claim, evidence_source: 'none' })))
  assert.deepEqual((modern.question as Row).clarifies_request_ids, ['R1'])
})

test('compatibility maps a not-reviewed obligation to pending without confusing it with missing client data', () => {
  const raw = review({ claims: [location], obligation_checks: [
    { id: 'business_scope', verdict: 'met', sentence_ids: [], reason: '' },
    { id: 'profile_collection', verdict: 'not_reviewed', sentence_ids: ['R1'], reason: 'El revisor no completó la comprobación.' },
  ], missing_fact_fragments: ['R2'] })
  const adapted = adaptFocusedReview(raw, { purpose: 'clarify_request' }, [{ status: 'clarification', reference_id: 'R2' }])
  assert.equal((adapted.obligation_checks as Row[])[1].verdict, 'pending')
  assert.deepEqual(adapted.missing_fact_fragments, [])
  assert.deepEqual((adapted.question as Row).clarifies_request_ids, ['R2'])
  assert.deepEqual(focusedReviewIssues(adapted, sentences, obligations).issues.map(issue => issue.code), ['review_obligation_pending'])
})

test('source routing is derived from canonical evidence and retains historical explicit classifications', () => {
  const sources = [{ id: 'E1', kind: 'project_fact' }, { id: 'E2', kind: 'project_fact', scope: 'catalog_no_results' },
    { id: 'E3', kind: 'operational_fact' }]
  const raw = review({ claims: [
    { fragment: 'S2', claim_kind: 'project_fact', verdict: 'supported', evidence_ids: ['E1'] },
    { fragment: 'S2', claim_kind: 'project_fact', verdict: 'supported', evidence_ids: ['E2'] },
    { fragment: 'S2', claim_kind: 'operational_fact', verdict: 'supported', evidence_ids: ['E3'] },
    { fragment: 'S2', claim_kind: 'project_fact', verdict: 'unsupported', evidence_ids: [] },
    { fragment: 'S2', claim_kind: 'project_fact', verdict: 'unsupported', evidence_ids: [], evidence_source: 'none' },
  ] })
  const adapted = adaptFocusedReview(raw, {}, [], sources)
  assert.deepEqual((adapted.claims as Row[]).map(claim => claim.evidence_source),
    ['verified_context', 'catalog_no_results', 'verified_context', 'none', 'none'])
})

test('family guidance with an unnecessary historical citation is cleaned without rejecting prudent advice', () => {
  const fragment = 'Tres dormitorios pueden resultar ajustados para su familia; conviene evaluar cómo los distribuirían.'
  const guidance = { fragment, subject: 'Orientación sobre distribución familiar', polarity: 'uncertainty', claim_kind: 'contextual_guidance',
    verdict: 'supported', evidence: 'Es una valoración condicionada a sus necesidades, sin prometer capacidad.',
    evidence_ids: ['E1'], evidence_source: 'verified_context' }
  const adapted = adaptFocusedReview(review({ claims: [guidance] }), {}, [], [{ id: 'E1', kind: 'project_fact' }])
  const adaptedGuidance = (adapted.claims as Row[])[0]
  assert.deepEqual(adaptedGuidance.evidence_ids, [])
  assert.equal(adaptedGuidance.evidence_source, 'contextual_reasoning')
  assert.equal(adaptedGuidance.fragment, fragment)
  const checked = reviewClaims(adapted.claims, fragment, [{ id: 'E1', kind: 'project_fact' }], true)
  assert.equal(checked.valid, true, JSON.stringify(checked.issues))
  assert.deepEqual(checked.issues, [])
})

test('an unknown sentence reference is removed when its repair must rebuild the review', () => {
  const previous = review({ claims: [{ ...location, fragment: 'S99' }] })
  const findings = focusedReviewIssues(previous, sentences, obligations)
  const scope = focusedRepairScope(findings.issues, sentences, obligations)
  assert.deepEqual(new Set(scope.focused_sentence_ids), new Set(['S1', 'S2', 'S3']))
  assert.deepEqual(scope.preserved_sentence_ids, [])
  const repaired = review({ claims: [location], claim_resolutions: [
    { claim_id: 'C1', resolution: 'replaced', replacement_indexes: [0], reason: 'La referencia S99 era inválida; la ubicación corresponde a S2.' },
  ] })
  const merged = mergeFocusedRepair(previous, repaired, scope, sentences)
  assert.deepEqual(merged.claims, [location])
  assert.deepEqual(focusedReviewIssues(merged, sentences, obligations).issues, [])
})

test('unknown obligations are replaced by the applicable obligation checks during full metadata repair', () => {
  const previous = review({ claims: [location], obligation_checks: [
    ...(review().obligation_checks as Row[]), { id: 'invented_obligation', verdict: 'met', sentence_ids: ['S3'], reason: '' },
  ] })
  const scope = focusedRepairScope(focusedReviewIssues(previous, sentences, obligations).issues, sentences, obligations)
  assert.deepEqual(scope.all_obligation_ids, ['business_scope', 'profile_collection'])
  const merged = mergeFocusedRepair(previous, review({ claims: [location] }), scope, sentences)
  assert.deepEqual((merged.obligation_checks as Row[]).map(item => item.id), ['business_scope', 'profile_collection'])
  assert.deepEqual(focusedReviewIssues(merged, sentences, obligations).issues, [])
})

test('focused metadata repair cannot reintroduce the removed missing-fact field', () => {
  const previous = review({ pending_checks: [{ fragment: 'S2', reason: 'Comprobar ubicación.' }], missing_fact_fragments: ['R2'] })
  const scope = focusedRepairScope(focusedReviewIssues(previous, sentences, obligations).issues, sentences, obligations)
  const pending_resolutions = [{ pending_id: 'P1', resolution: 'resolved', claim_indexes: [0], factual_value_indexes: [],
    project_value_indexes: [], reason: 'La ubicación queda contrastada por la nueva afirmación.' }]
  const merged = mergeFocusedRepair(previous, review({ claims: [location], non_factual_sentence_ids: [], obligation_checks: [], missing_fact_fragments: [], pending_resolutions }), scope, sentences)
  assert.deepEqual(merged.missing_fact_fragments, [])
  assert.deepEqual(focusedReviewIssues(merged, sentences, obligations).issues, [])
  const invalidPrevious = { ...previous, missing_fact_fragments: ['R99'] }
  const replacementScope = focusedRepairScope([{ code: 'invalid_missing_fact_reference', fragment: 'R99' }], sentences, obligations)
  const replaced = mergeFocusedRepair(invalidPrevious, review({ claims: [location], missing_fact_fragments: ['R2'], pending_resolutions }), replacementScope, sentences)
  assert.deepEqual(replaced.missing_fact_fragments, [])
})

test('repairing a floor reference preserves an already checked price in the same sentence', () => {
  const combined = [{ id: 'S1', text: 'El penthouse cuesta $550.000 y está en la sexta planta alta.' }]
  const price = { fragment: 'S1', unit_id: 'p602', field: 'published_commercial_price', operator: 'eq', value: 550000 }
  const floor = { fragment: 'S1', unit_id: 'wrong-id', field: 'floor_number', operator: 'eq', value: 6 }
  const previous = review({ non_factual_sentence_ids: [], factual_values: [price, floor], obligation_checks: [] })
  const scope = focusedRepairScope([{ code: 'invalid_unit_fact', fragment: 'S1', field: 'floor_number' }], combined, [])
  assert.equal(scope.replace_entire_sentence, false)
  assert.deepEqual(scope.replaced_fields, [{ sentence_id: 'S1', field: 'floor_number' }])
  const correctedFloor = { ...floor, unit_id: 'p602' }
  const merged = mergeFocusedRepair(previous, review({ non_factual_sentence_ids: [], factual_values: [correctedFloor], obligation_checks: [] }), scope, combined)
  assert.deepEqual(merged.factual_values, [price, correctedFloor])
  assert.deepEqual(observedNumericIssues(merged, combined), [])
  assert.deepEqual(focusedReviewIssues(merged, combined, []).issues, [])
})

test('a numeric repair cannot erase an unchecked floor just because the same sentence has a checked price', () => {
  const combined = [{ id: 'S1', text: 'El penthouse cuesta $550.000 y está en la sexta planta alta.' }]
  const price = { fragment: 'S1', unit_id: 'p602', field: 'published_commercial_price', operator: 'eq', value: 550000 }
  const floor = { fragment: 'S1', unit_id: 'wrong-id', field: 'floor_number', operator: 'eq', value: 6 }
  const previous = review({ non_factual_sentence_ids: [], factual_values: [price, floor], obligation_checks: [] })
  const catalog = [{ id: 'p602', published_commercial_price: 550000, floor_number: 5 }]
  for (const issue of [{ code: 'invalid_unit_fact', fragment: 'S1', field: 'floor_number' },
    { code: 'invalid_review_sentence', fragment: 'S1' }]) {
    const scope = focusedRepairScope([issue], combined, [])
    const merged = mergeFocusedRepair(previous, review({ factual_values: [price], non_factual_sentence_ids: [], obligation_checks: [] }), scope, combined)
    assert.ok((merged.factual_values as Row[]).includes(floor))
    assert.ok(structuredFactIssues(merged.factual_values, catalog).some(row => row.field === 'floor_number'))
  }
})

test('an explicitly identified unasserted numeric attribute can be removed without rewriting the draft', () => {
  const combined = [{ id: 'S1', text: 'El penthouse cuesta $550.000.' }]
  const price = { fragment: 'S1', unit_id: 'p602', field: 'published_commercial_price', operator: 'eq', value: 550000 }
  const phantom = { fragment: 'S1', unit_id: 'p602', field: 'floor_number', operator: 'eq', value: 6 }
  const previous = review({ non_factual_sentence_ids: [], factual_values: [price, phantom], obligation_checks: [] })
  const scope = focusedRepairScope([{ code: 'review_number_not_in_draft', fragment: 'S1', field: 'floor_number' }], combined, [])
  const dismissal = { fragment: 'S1', field: 'floor_number', resolution: 'not_asserted', reason: 'La oración solo afirma el precio; la planta vino del catálogo.' }
  const repaired = review({ factual_values: [], non_factual_sentence_ids: [], obligation_checks: [], dismissed_numeric_checks: [dismissal] })
  const merged = mergeFocusedRepair(previous, repaired, scope, combined)
  assert.deepEqual(repairDismissalsValid(previous, repaired, scope, combined), [dismissal])
  assert.deepEqual(merged.factual_values, [price])
  assert.deepEqual(merged.dismissed_numeric_checks, [dismissal])
  assert.deepEqual(observedNumericIssues(merged, combined), [])
})

test('numeric dismissals outside the repair scope or without an explicit explanation cannot erase checks', () => {
  const combined = [{ id: 'S1', text: 'El penthouse cuesta $550.000 y está en la sexta planta.' },
    { id: 'S2', text: 'El otro penthouse está en la quinta planta.' }]
  const price = { fragment: 'S1', unit_id: 'p602', field: 'published_commercial_price', operator: 'eq', value: 550000 }
  const floor = { fragment: 'S1', unit_id: 'wrong-id', field: 'floor_number', operator: 'eq', value: 6 }
  const other = { ...floor, fragment: 'S2', value: 5 }
  const previous = review({ factual_values: [price, floor, other], non_factual_sentence_ids: [], obligation_checks: [] })
  const scope = focusedRepairScope([{ code: 'invalid_unit_fact', fragment: 'S1', field: 'floor_number' }], combined, [])
  for (const dismissal of [
    { fragment: 'S2', field: 'floor_number', resolution: 'not_asserted', reason: 'Fuera de alcance.' },
    { fragment: 'S1', field: 'published_commercial_price', resolution: 'not_asserted', reason: 'Atributo conservado.' },
    { fragment: 'S1', field: 'floor_number', resolution: 'not_asserted', reason: '  ' },
    { fragment: 'S1', field: 'floor_number', resolution: 'supported', reason: 'No desestima la afirmación.' },
  ]) {
    const repaired = review({ factual_values: [], non_factual_sentence_ids: [], obligation_checks: [], dismissed_numeric_checks: [dismissal] })
    assert.deepEqual(repairDismissalsValid(previous, repaired, scope, combined), [])
    assert.deepEqual(mergeFocusedRepair(previous, repaired, scope, combined).factual_values, [price, floor, other])
  }
})

test('one numeric replacement cannot erase two units with the same attribute in a single sentence', () => {
  const combined = [{ id: 'S1', text: 'Los penthouses 602 y 605 están en la sexta planta.' }]
  const floor = { fragment: 'S1', unit_id: 'p602', field: 'floor_number', operator: 'eq', value: 6 }
  const other = { ...floor, unit_id: 'wrong-id' }
  const previous = review({ factual_values: [floor, other], non_factual_sentence_ids: [], obligation_checks: [] })
  const scope = focusedRepairScope([{ code: 'invalid_unit_fact', fragment: 'S1', field: 'floor_number' }], combined, [])
  const merged = mergeFocusedRepair(previous, review({ factual_values: [floor], non_factual_sentence_ids: [], obligation_checks: [] }), scope, combined)
  assert.equal((merged.factual_values as Row[]).length, 2)
  assert.ok((merged.factual_values as Row[]).includes(other))
  assert.ok(structuredFactIssues(merged.factual_values, [{ id: 'p602', floor_number: 6 }]).some(row => row.code === 'invalid_unit_fact'))
})

test('a targeted sentence repair cannot replace other sentences or their commercial obligations', () => {
  const originalChecks = [
    { id: 'business_scope', verdict: 'violated', sentence_ids: ['S3'], reason: 'Ofrece buscar fuera del proyecto.' },
    { id: 'profile_collection', verdict: 'met', sentence_ids: ['S3'], reason: '' },
  ]
  const previous = review({ obligation_checks: originalChecks, pending_checks: [{ fragment: 'S2', reason: 'Falta la ubicación.' }] })
  const scope = focusedRepairScope([{ code: 'review_sentence_pending', sentence_id: 'S2' }], sentences, obligations)
  const injected = review({ claims: [location, { ...location, fragment: 'S1' }, { ...location, fragment: 'S99' }],
    factual_values: [{ fragment: 'S3', field: 'bedrooms', value: 8 }], project_values: [{ fragment: 'S1', value: 9 }],
    pending_checks: [{ fragment: 'S1', reason: 'Una revisión que no se solicitó.' }], non_factual_sentence_ids: ['S3', 'S99'],
    pending_resolutions: [{ pending_id: 'P1', resolution: 'resolved', claim_indexes: [0], factual_value_indexes: [],
      project_value_indexes: [], reason: 'La primera afirmación resuelve la ubicación pendiente.' }],
    obligation_checks: [{ id: 'business_scope', verdict: 'met', sentence_ids: [], reason: '' },
      { id: 'invented', verdict: 'met', sentence_ids: [], reason: '' }],
    respuesta_propuesta: 'Texto distinto inyectado',
  })
  const merged = mergeFocusedRepair(previous, injected, scope, sentences)
  assert.deepEqual(merged.claims, [location])
  assert.deepEqual(merged.factual_values, [])
  assert.deepEqual(merged.project_values, [])
  assert.deepEqual(merged.pending_checks, [])
  assert.equal((merged.pending_repair_issues as Row[])[0].code, 'invalid_pending_repair_resolution')
  assert.deepEqual(merged.non_factual_sentence_ids, ['S1', 'S3'])
  assert.deepEqual(merged.obligation_checks, originalChecks)
  assert.equal('respuesta_propuesta' in merged, false)
  assert.deepEqual(focusedReviewIssues(merged, sentences, obligations).issues.map(issue => issue.code), ['commercial_obligation_violated'])
})

test('an obligation-only repair cannot modify facts or erase an independent violation', () => {
  const originalViolation = { id: 'business_scope', verdict: 'violated', sentence_ids: ['S3'], reason: 'Promete buscar fuera del proyecto.' }
  const previous = review({ claims: [location], obligation_checks: [originalViolation,
    { id: 'profile_collection', verdict: 'pending', sentence_ids: ['R1'], reason: 'No se completó la revisión.' }] })
  const scope = focusedRepairScope([{ code: 'review_obligation_pending', obligation_id: 'profile_collection' }], sentences, obligations)
  const fixedCheck = { id: 'profile_collection', verdict: 'met', sentence_ids: ['R1'], reason: 'Se solicitaron los datos.' }
  const merged = mergeFocusedRepair(previous, review({ claims: [{ ...location, verdict: 'unsupported' }],
    non_factual_sentence_ids: ['S2'], factual_values: [{ fragment: 'S2', value: 1 }],
    obligation_checks: [fixedCheck, { ...originalViolation, verdict: 'met' }, { id: 'unknown', verdict: 'met' }],
  }), scope, sentences)
  assert.deepEqual(merged.claims, [location])
  assert.deepEqual(merged.factual_values, [])
  assert.deepEqual(merged.non_factual_sentence_ids, ['S1', 'S3'])
  assert.deepEqual(merged.obligation_checks, [originalViolation, fixedCheck])
  const outsideReference = mergeFocusedRepair(previous, review({ obligation_checks: [{ ...fixedCheck, sentence_ids: ['S3'] }] }), scope, sentences)
  assert.deepEqual(outsideReference.obligation_checks, [originalViolation])
  assert.ok(focusedReviewIssues(outsideReference, sentences, obligations).issues.some(issue => issue.code === 'invalid_obligation_review'))
})

test('same-sentence numeric repair preserves checked facts across ID and normalized text references', () => {
  const mixed = [{ id: 'S1', text: 'El penthouse cuesta $550.000 y está en la sexta planta alta.' }, sentences[1]]
  const price = { fragment: mixed[0].text, unit_id: 'p602', field: 'published_commercial_price', operator: 'eq', value: 550000 }
  const floor = { fragment: mixed[0].text, unit_id: 'wrong', field: 'floor_number', operator: 'eq', value: 6 }
  const previous = review({ non_factual_sentence_ids: [], factual_values: [price, floor], obligation_checks: [] })
  const scope = focusedRepairScope([
    { code: 'invalid_unit_fact', fragment: mixed[0].text.replace('cuesta ', 'cuesta\n '), field: 'floor_number' },
    { code: 'unreviewed_sentence', sentence_id: 'S2' },
  ], mixed, [])
  assert.deepEqual(scope.replace_entire_sentence_ids, ['S2'])
  const repairedFloor = { ...floor, fragment: 'S1', unit_id: 'p602' }
  const merged = mergeFocusedRepair(previous, review({ claims: [location], obligation_checks: [], non_factual_sentence_ids: [],
    factual_values: [{ ...price, fragment: 'S1', value: 1 }, repairedFloor],
  }), scope, mixed)
  assert.deepEqual(merged.factual_values, [price, repairedFloor])
  assert.deepEqual(merged.claims, [location])
  assert.deepEqual(observedNumericIssues(merged, mixed), [])
  assert.deepEqual(focusedReviewIssues(merged, mixed, []).issues, [])
})

test('an out-of-scope repair result does not turn an unreviewed target into an approved sentence', () => {
  const previous = review()
  const scope = focusedRepairScope([{ code: 'unreviewed_sentence', sentence_id: 'S2' }], sentences, obligations)
  const merged = mergeFocusedRepair(previous, review({ claims: [{ ...location, fragment: 'S99' }],
    non_factual_sentence_ids: ['S99'], obligation_checks: [],
  }), scope, sentences)
  assert.deepEqual(merged.claims, [])
  assert.deepEqual(focusedReviewIssues(merged, sentences, obligations).coverage.pending_sentence_ids, ['S2'])
})

test('numeric extraction cannot replace a rounded draft value with the precise catalogue value', () => {
  const draft = [{ id: 'S1', text: 'El departamento tiene 121 m² interiores.' }]
  const incorrectExtraction = { fragment: 'S1', unit_id: 'u202', field: 'area_internal_m2', operator: 'eq', value: 120.83 }
  const findings = observedNumericIssues({ factual_values: [incorrectExtraction], project_values: [] }, draft)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].code, 'review_number_not_in_draft')
  assert.equal(findings[0].kind, 'review_metadata')
  assert.equal(findings[0].owner, 'system')
  assert.equal(findings[0].repair_owner, 'reviewer')
  assert.deepEqual(findings[0].observed_values, [121])
  assert.deepEqual(observedNumericIssues({ factual_values: [{ ...incorrectExtraction, value: 121 }] }, draft), [])
  // Matching the draft only certifies extraction. The catalogue comparison must still reject a rounded 121.
})

test('numeric extraction accepts Spanish decimal notation, written floors and equivalent grouping', () => {
  for (const [sentence, values] of [
    ['Dispone de 120,83 m² interiores en la sexta planta alta.', [120.83, 6]],
    ['El precio es $550.000 y su área interior es 120.83 m².', [550000, 120.83]],
    ['La superficie va de 120,83 a 142,09 m².', [120.83, 142.09]],
  ] as const) {
    const draft = [{ id: 'S1', text: sentence }]
    const facts = values.map(value => ({ fragment: 'S1', operator: 'eq', value }))
    assert.deepEqual(observedNumericIssues({ factual_values: facts }, draft), [], sentence)
  }
  assert.deepEqual(observedNumericIssues({ factual_values: [{ fragment: 'S1', operator: 'between', value: 120.83, upper_value: 142.09 }] },
    [{ id: 'S1', text: 'Las áreas interiores van de 120,83 a 142,09 m².' }]), [])
})

test('an URL number cannot fabricate an observed commercial value or a range endpoint', () => {
  const draft = [{ id: 'S1', text: 'Puede revisar el material en https://example.com/121.' }]
  assert.equal(observedNumericIssues({ factual_values: [{ fragment: 'S1', operator: 'eq', value: 121 }] }, draft)[0].code, 'review_number_not_in_draft')
  const range = [{ id: 'S1', text: 'Las áreas van de 120,83 a 142,09 m².' }]
  assert.equal(observedNumericIssues({ factual_values: [{ fragment: 'S1', operator: 'between', value: 120.83, upper_value: 150 }] }, range)[0].code, 'review_number_not_in_draft')
})

test('a commercial violation needs a concrete sentence or current-request reference', () => {
  const violated = { id: 'profile_collection', verdict: 'violated', reason: 'Falta solicitar la residencia actual.' }
  for (const reference of [[], ['S999']]) {
    const checks = [{ id: 'business_scope', verdict: 'met', sentence_ids: [], reason: '' }, { ...violated, sentence_ids: reference }]
    const result = focusedReviewIssues(review({ claims: [location], obligation_checks: checks }), sentences, obligations)
    assert.ok(result.issues.some(issue => issue.code === 'invalid_obligation_review'))
    assert.equal(result.issues.some(issue => issue.kind === 'commercial_content'), false)
  }
  for (const reference of [['S3'], ['R1']]) {
    const checks = [{ id: 'business_scope', verdict: 'met', sentence_ids: [], reason: '' }, { ...violated, sentence_ids: reference }]
    const result = focusedReviewIssues(review({ claims: [location], obligation_checks: checks }), sentences, obligations)
    assert.deepEqual(result.issues.map(issue => issue.code), ['commercial_obligation_violated'])
    assert.equal(result.issues[0].owner, 'reviewer')
    assert.equal(result.issues[0].repair_owner, 'writer')
  }
})
