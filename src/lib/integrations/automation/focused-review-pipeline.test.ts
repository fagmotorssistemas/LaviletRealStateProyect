import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { completeTurnReply } from './turn-completeness'
import { object, text, type Row } from './data'
import { FOCUSED_REVIEW_VERSION } from './focused-review'
import { AIRequestGuardError, OpenAIRequestError } from './openai-request'
import { requireReviewedResponse, ResponseReviewRecoveryError } from './response-review-recovery'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const unit = { id: 'd202', unit_number: '202', category: 'departamento', status: 'disponible', is_published: true,
  area_internal_m2: 120.83, bedrooms: 3, floor_number: 2, published_commercial_price: 245123 }
const noQuestion = { purpose: 'none', role: 'none', missing_datum: '', next_decision: '' }
function writer(context: Row, reply: string, question: Row = noQuestion): Row {
  const reference = rows(context.referencias_solicitud)[0]
  assert.ok(reference?.id, 'El sistema debe suministrar una referencia canónica de la consulta.')
  return { reply, requests: [{ fragment: reference.id, intent: 'Atender la consulta actual', request_type: 'general_information',
    status: 'answered', evidence: 'Presentación y datos pertinentes a la consulta.', fact_key: null }], question }
}
function reviewer(context: Row, extra: Row = {}): Row {
  const numericChecks = rows(context.referencias_numericas).map(reference => {
    const factIndex = rows(extra.factual_values).findIndex(fact => fact.value === reference.value || fact.upper_value === reference.value)
    const article = reference.text === 'una'
    assert.ok(factIndex >= 0 || reference.value === 202 || article, 'Estas pruebas solo afirman la superficie y el identificador 202.')
    return { numeric_id: reference.id, classification: article ? 'not_quantity' : factIndex >= 0 ? 'business_quantity' : 'unit_identifier',
      factual_value_indexes: factIndex >= 0 ? [factIndex] : [], project_value_indexes: [],
      unit_ids: factIndex >= 0 || article ? [] : [unit.id], reason: article ? 'Artículo de una guía personalizada.' : factIndex >= 0 ? 'Superficie interior expresada en el borrador.' : 'Número del departamento.' }
  })
  return { review_contract: FOCUSED_REVIEW_VERSION, claims: [], factual_values: [], project_values: [],
    non_factual_sentence_ids: [], pending_checks: [],
    numeric_checks: numericChecks,
    ...(context.reparacion_revision ? { dismissed_numeric_checks: [], claim_resolutions: [], pending_resolutions: [] } : {}),
    obligation_checks: rows(context.obligaciones_aplicables).map(obligation => ({ id: obligation.id, verdict: 'met', sentence_ids: ['R1'], reason: 'El borrador cumple la obligación aplicable.' })),
    ...extra }
}
function locationClaim(context: Row, fragment: string): Row {
  const source = rows(context.evidencia_afirmaciones).find(source => text(source.path).startsWith('contexto_verificado.proyecto'))
  assert.ok(source?.id, 'La ubicación debe tener una fuente del proyecto, no del historial.')
  return { fragment, subject: 'Ubicación de La Vilet en Cuenca', polarity: 'affirmation', claim_kind: 'project_fact',
    verdict: 'supported', evidence_ids: [source.id], evidence: 'La ubicación consta en la información verificada del proyecto.' }
}
function areaFact(fragment: string, value: number): Row {
  return { fragment, subject_category: 'departamento', unit_id: unit.id, field: 'area_internal_m2', operator: 'eq', value, upper_value: null, measurement_unit: 'm2', value_scope: 'individual' }
}
function harness(handle: (context: Row, schema: Row, task: string) => Row) {
  const calls: { context: Row; schema: Row; task: string }[] = [], failures: string[] = []
  const ajv = new Ajv({ allErrors: true })
  const generate: NonNullable<Parameters<typeof completeTurnReply>[1]> = async (_instructions, input, schema, _image, _file, _tone, task = 'data') => {
    const context = object(input)
    assert.ok(schema)
    calls.push({ context, schema, task })
    try {
      const answer = handle(context, schema, task)
      const validate = ajv.compile(schema)
      assert.ok(validate(answer), `La salida simulada debe cumplir el schema dinámico real: ${ajv.errorsText(validate.errors)}`)
      return answer
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
      throw error
    }
  }
  return { generate, calls, failures }
}

const penthouses = [106.58, 142.09, 109.69, 99.71, 140.53, 124.41].map((area, index) => ({
  ...unit, id: `p${601 + index}`, unit_number: String(601 + index), category: 'penthouse', area_internal_m2: area,
}))
const mixedCatalog = [...penthouses, { ...unit, id: 'l001', unit_number: '001', category: 'local', area_internal_m2: 46.65 }]
const penthouseRange = 'group:penthouse:all:range'
test('semantic pending repair reaches final approval without regenerating the writer or approved checks', async () => {
  const reply = 'El penthouse está en el último nivel.'
  let reviews = 0
  const mock = harness((context, _schema, task) => {
    if (task === 'writing') return writer(context, reply)
    reviews++
    const sentence = rows(context.oraciones_borrador)[0]
    if (reviews === 1) return reviewer(context, { pending_checks: [{ fragment: sentence.id, reason: 'Falta una cifra para último nivel.' }] })
    assert.deepEqual(context.referencias_numericas, [])
    assert.deepEqual(context.obligaciones_aplicables, [])
    assert.equal(rows(object(object(context.reparacion_revision).ficha_anterior).pending_checks)[0].pending_id, 'P1')
    const answer = reviewer(context, { claims: [{ ...locationClaim(context, text(sentence.id)), subject: 'Ubicación del penthouse en el último nivel',
      evidence: 'La documentación del proyecto indica expresamente esta ubicación.' }], pending_resolutions: [{
      pending_id: 'P1', resolution: 'resolved', claim_indexes: [0], factual_value_indexes: [], project_value_indexes: [], reason: 'Relación respaldada por el proyecto.' }] })
    delete answer.dismissed_numeric_checks; delete answer.claim_resolutions
    return answer
  })
  const result = await completeTurnReply({ current: '¿Dónde se ubica el penthouse?', baseReply: reply,
    verified: { proyecto: { ubicacion_penthouse: 'Último nivel del edificio.' } }, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.deepEqual(mock.failures, [])
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.equal(mock.calls.filter(call => call.task === 'writing').length, 1)
  assert.equal(reviews, 2)
  assert.equal(rows(result.audit.repair_attempts)[0].scope, 'semantic_pending_only')
})

function rangeFact(fragment: string, value: number, source = penthouseRange): Row {
  return { fragment, subject_category: 'penthouse', unit_id: source, field: 'area_internal_m2', operator: 'between',
    value, upper_value: 142.09, measurement_unit: 'm2', value_scope: 'group_summary' }
}

test('range repair receives the exact authoritative endpoints and a coherent rejection, then accepts the corrected draft', async () => {
  for (const repeatError of [false, true]) {
    let writers = 0
    const mock = harness((context, _schema, task) => {
      if (task === 'writing') {
        writers++
        if (writers === 2) {
          const repair = object(context.reparacion)
          assert.equal(object(repair.evaluacion_anterior).answers_supported, false)
          const target = rows(repair.correcciones_concretas).find(row => row.code === 'catalog_range_mismatch')!
          assert.equal(object(target.source).id, penthouseRange)
          assert.deepEqual(target.authoritative, { value: 99.71, upper_value: 142.09 })
          assert.equal(context.oraciones_borrador, undefined)
        }
        const minimum = writers === 1 || repeatError ? '106,58' : '99,71'
        return writer(context, writers === 1 ? `Los penthouses tienen entre ${minimum} y 142,09 m² interiores.`
          : `La superficie interior de los penthouses va desde ${minimum} hasta 142,09 m².`)
      }
      const ref = rows(context.oraciones_borrador)[0]
      const minimum = writers === 1 || repeatError ? 106.58 : 99.71
      return reviewer(context, { factual_values: [rangeFact(text(ref.id), minimum)] })
    })
    const result = await completeTurnReply({ current: 'Estoy buscando algo amplio, ¿qué me recomienda?',
      baseReply: 'Información del proyecto.', verified: { catalogo: mixedCatalog }, audit: { semantic_review_enabled: true },
    }, mock.generate)
    assert.deepEqual(mock.failures, [])
    assert.equal(result.audit.status, repeatError ? 'rejected_review' : 'checked', JSON.stringify(result.audit))
    assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review', 'review', 'writing', 'review'])
    const progress = object(rows(result.audit.repair_attempts).find(row => row.target === 'commercial_draft')?.progress)
    assert.equal(progress.status, repeatError ? 'same_numeric_defect' : 'validated')
    if (repeatError) assert.throws(() => requireReviewedResponse(result.audit), ResponseReviewRecoveryError)
    else assert.match(result.reply, /99,71/)
  }
})

test('a reviewer assigning a penthouse range to the mixed catalogue repairs only its reference', async () => {
  for (const repairReference of [true, false]) {
    const reply = 'Los penthouses tienen entre 99,71 y 142,09 m² interiores.'
    const mock = harness((context, _schema, task) => {
      if (task === 'writing') return writer(context, reply)
      const repairing = !!context.reparacion_revision
      if (repairing) {
        const issues = rows(object(context.reparacion_revision).errores)
        assert.ok(issues.some(issue => issue.code === 'numeric_subject_source_mismatch'))
        assert.equal(issues.some(issue => issue.code === 'catalog_range_mismatch'), false,
          'La cifra 46,65 de locales no debe convertirse en una corrección del texto sobre penthouses.')
      }
      const ref = rows(context.oraciones_borrador)[0]
      return reviewer(context, { factual_values: [rangeFact(text(ref.id), 99.71,
        repairing && repairReference ? penthouseRange : 'group:context:all:range')] })
    })
    const result = await completeTurnReply({ current: '¿Qué superficie tienen los penthouses?', baseReply: reply,
      verified: { catalogo: mixedCatalog }, audit: { semantic_review_enabled: true },
    }, mock.generate)
    assert.deepEqual(mock.failures, [])
    assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review', 'review'])
    assert.equal(result.audit.status, repairReference ? 'checked' : 'rejected_review', JSON.stringify(result.audit))
    if (repairReference) assert.equal(result.reply, reply)
    else assert.throws(() => requireReviewedResponse(result.audit), ResponseReviewRecoveryError)
  }
})

test('review transport exhaustion reaches recovery without discarding or rewriting the draft', async () => {
  for (const failure of [new OpenAIRequestError(0, true, 2, '', 'timeout'), new OpenAIRequestError(503, true, 2), new AIRequestGuardError()]) {
    const mock = harness((context, _schema, task) => {
      if (task === 'writing') return writer(context, 'La Vilet se encuentra en Cuenca.')
      throw failure
    })
    await assert.rejects(() => completeTurnReply({ current: 'Me interesa el proyecto.', baseReply: 'Información del proyecto.',
      verified: { proyecto: { ubicacion: 'Cuenca' } }, audit: { semantic_review_enabled: true },
    }, mock.generate), error => error === failure)
    assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review'])
  }
})

test('a transport failure during reviewer metadata repair also reaches recovery', async () => {
  const failure = new OpenAIRequestError(0, true, 2, '', 'timeout')
  const mock = harness((context, _schema, task) => {
    if (task === 'writing') return writer(context, 'La Vilet se encuentra en Cuenca.')
    if (context.reparacion_revision) throw failure
    // An omitted factual sentence triggers the existing metadata repair.
    return reviewer(context)
  })
  await assert.rejects(() => completeTurnReply({ current: 'Me interesa el proyecto.', baseReply: 'Información del proyecto.',
    verified: { proyecto: { ubicacion: 'Cuenca' } }, audit: { semantic_review_enabled: true },
  }, mock.generate), error => error === failure)
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review', 'review'])
})

test('focused pipeline approves a grounded project presentation and profile question through the real dynamic schema', async () => {
  const current = 'como esta, esoty interesado en el proyecto'
  const reply = 'Gracias por su interés. La Vilet está en Puertas del Sol, Cuenca. Para compartirle el brochure y darle una guía personalizada, ¿podría indicarnos su nombre y dónde reside actualmente?'
  const profileQuestion = { purpose: 'collect_lead_profile', role: 'required_collection', missing_datum: 'Nombre y residencia actual', next_decision: 'Compartir el brochure y orientar según los datos declarados.' }
  const mock = harness((context, schema, task) => {
    if (task === 'writing') return writer(context, reply, profileQuestion)
    assert.equal(task, 'review')
    const properties = object(schema.properties)
    for (const removed of ['factual_inventory_complete', 'sentence_inventory', 'question', 'review_issues', 'missing_fact_fragments']) assert.equal(removed in properties, false)
    const refs = rows(context.oraciones_borrador)
    const location = refs.find(sentence => text(sentence.text).includes('Puertas del Sol'))!
    assert.ok(rows(context.obligaciones_aplicables).some(obligation => obligation.id === 'profile_collection'))
    assert.ok(rows(context.obligaciones_aplicables).some(obligation => obligation.id === 'profile_full_name'))
    assert.ok(rows(context.obligaciones_aplicables).some(obligation => obligation.id === 'profile_current_residence'))
    assert.ok(rows(context.obligaciones_aplicables).some(obligation => obligation.id === 'opening_scope'))
    assert.equal(object(object(context.contrato_redaccion).estado_comercial).requiere_captura, true)
    return reviewer(context, { claims: [locationClaim(context, text(location.id))],
      non_factual_sentence_ids: refs.filter(sentence => sentence.id !== location.id).map(sentence => sentence.id) })
  })
  const result = await completeTurnReply({ current, baseReply: 'Información inicial del proyecto.',
    verified: { proyecto: { ubicacion: 'Puertas del Sol, Cuenca' }, perfil_lead: {} },
    audit: { source: 'project_overview', semantic_review_enabled: true, profile_introduction: {
      generic_introduction: true, question_purpose: 'collect_profile', brochure_deferred: true,
    } },
  }, mock.generate)
  assert.deepEqual(mock.failures, [])
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review'])
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(object(result.audit.semantic_review).review_contract, FOCUSED_REVIEW_VERSION)
})

test('focused pipeline repairs only the unchecked sentence and preserves another sentence exact facts', async () => {
  const reply = 'El departamento 202 tiene 120,83 m² interiores. La Vilet está en Cuenca.'
  let initialFact: Row | undefined, locationId = '', reviews = 0
  const mock = harness((context, schema, task) => {
    if (task === 'writing') return writer(context, reply)
    reviews++
    const refs = rows(context.oraciones_borrador)
    if (reviews === 1) {
      const area = refs.find(sentence => text(sentence.text).includes('120,83'))!
      const location = refs.find(sentence => text(sentence.text).includes('Cuenca'))!
      initialFact = areaFact(text(area.id), 120.83)
      locationId = text(location.id)
      // This schema-valid omission reproduces an unfinished review without calling the fact false.
      return reviewer(context, { factual_values: [initialFact] })
    }
    assert.equal(reviews, 2)
    assert.deepEqual(refs.map(sentence => sentence.id), [locationId])
    assert.deepEqual(rows(context.obligaciones_aplicables), [])
    assert.equal(context.respuesta_propuesta, reply)
    const claimVariants = rows(object(object(object(schema.properties).claims).items).anyOf)
    assert.ok(claimVariants.length)
    for (const variant of claimVariants) assert.deepEqual(object(variant.properties).fragment, { type: 'string', enum: [locationId] })
    assert.deepEqual(object(context.reparacion_revision).oraciones_conservadas, [initialFact!.fragment])
    return reviewer(context, { claims: [locationClaim(context, locationId)] })
  })
  const result = await completeTurnReply({ current: '¿Qué superficie tiene el departamento 202 y dónde está el proyecto?', baseReply: reply,
    verified: { catalogo: [unit], proyecto: { ubicacion: 'Cuenca' } }, audit: { semantic_review_enabled: true },
  }, mock.generate)
  assert.deepEqual(mock.failures, [])
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review', 'review'])
  const facts = rows(object(result.audit.semantic_review).factual_values)
  assert.equal(facts.length, 1)
  assert.equal(facts[0].value, 120.83)
  assert.equal(facts[0].unit_id, unit.id)
  const repair = rows(result.audit.repair_attempts)[0]
  assert.equal(repair.target, 'review_metadata')
  assert.deepEqual(repair.focused_sentence_ids, [locationId])
  assert.deepEqual(repair.preserved_sentence_ids, [initialFact!.fragment])
})

test('an unchanged writer repair cannot get a new reviewer lottery for an incorrect exact value', async () => {
  const reply = 'El departamento 202 tiene 121 m² interiores.'
  let reviews = 0, writers = 0
  const mock = harness((context, _schema, task) => {
    if (task === 'writing') {
      writers++
      assert.ok(writers <= 2)
      return writer(context, reply)
    }
    reviews++
    assert.ok(reviews <= 2, 'No se puede sortear otra aprobación después de repetir el mismo borrador incorrecto.')
    const sentence = rows(context.oraciones_borrador)[0]
    return reviewer(context, { factual_values: [areaFact(text(sentence.id), 121)] })
  })
  const result = await completeTurnReply({ current: '¿Qué superficie interior tiene el departamento 202?',
    baseReply: 'El departamento 202 tiene 120,83 m² interiores.', verified: { catalogo: [unit] },
    audit: { semantic_review_enabled: true },
  }, mock.generate)
  assert.deepEqual(mock.failures, [])
  assert.equal(result.audit.status, 'rejected_review', JSON.stringify(result.audit))
  assert.notEqual(result.reply, reply)
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review', 'review', 'writing'])
  assert.deepEqual(result.audit.issues, ['writer_repair_unchanged'])
  assert.ok(rows(object(result.audit.semantic_review).validation_details).some(issue => issue.code === 'catalog_value_mismatch'))
})
