import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { object, type Row } from './data'
import { resolveTurnIntent } from './turn-intent'
import { leadIntroductionTurn, PROFILE_INVITATION } from './lead-introduction'

const summary = 'La Vilet integra viviendas y espacios comerciales.'
function verified(current: string, specific: boolean): Row {
  const requests = [{ domain: 'property', confidence: 'high', request: specific ? 'Consultar precios' : 'Información general del proyecto', evidence: current }]
  const semantics = { primary_intent: specific ? 'ask_price' : 'project_information', primary_evidence: current, confidence: 'high', requests,
    property: { operation: 'none', reference_kind: 'none', filters: {}, unit_numbers: [] }, budget: { status: 'not_discussed' } }
  return { semantica_turno: semantics, solicitudes_interpretadas: requests,
    contrato_turno: resolveTurnIntent({ current, semantics, requests, scope: { kind: 'neutral', uncertain: false } }),
    configuracion_presentacion_proyecto: { available: true, summary, source: 'Responsable del proyecto' }, proyecto: { name: 'La Vilet' } }
}
test('an omitted initial project description is repaired while preserving the approved summary and profile question', async () => {
  const current = 'Saludos, quiero informacion por favor', info = verified(current, false)
  const requests = (info.solicitudes_interpretadas as Row[]).map(request => ({ ...request, topics: ['project_overview'] }))
  info.solicitudes_interpretadas = requests
  object(info.semantica_turno).requests = requests
  info.contrato_turno = resolveTurnIntent({ current, semantics: object(info.semantica_turno), requests, scope: { kind: 'property', uncertain: false } })
  const intro = leadIntroductionTurn({ current, projectInfo: info, extracted: { requests, turn_semantics: info.semantica_turno },
    reply: '¿Qué le gustaría conocer?', audit: { source: 'commercial', resolved_turn_intent: info.contrato_turno } })
  let writingCalls = 0, reviewCalls = 0
  const question = { text: PROFILE_INVITATION.match(/¿.+\?/)![0], purpose: 'collect_lead_profile', role: 'required_collection',
    missing_datum: 'Nombre y residencia actual', next_decision: 'collect_profile', continuation_id: 'lead_profile', continuation_act: 'profile' }
  const result = await withResponseReviewPolicy({ enabled: true, observationOnly: false, updatedAt: null }, () => completeTurnReply({
    current, baseReply: intro.reply, verified: info, audit: { ...intro.audit, semantic_review_enabled: true, business_risk_review_enabled: true },
  }, async (_rules, input, _schema, _image, _file, _tone, task) => {
    const context = object(input), obligations = context.obligaciones_del_turno as Row[]
    assert.ok(obligations.some(obligation => obligation.id === 'opening_presentation'))
    if (task === 'writing') {
      writingCalls++
      const draft = writingCalls === 1 ? 'Con gusto le orientamos. '+PROFILE_INVITATION : summary+' '+PROFILE_INVITATION
      assert.equal(object(object(context.contexto_verificado).presentacion_general_proyecto).summary, summary)
      assert.equal(object(object(object(context.contrato_redaccion).estado_comercial).presentacion_proyecto).approved_summary, summary)
      if (writingCalls === 2) assert.ok(context.reparacion)
      return { reply: draft, question, requests: (context.referencias_solicitud as Row[]).map(ref => ({ fragment: ref.id,
        intent: 'Información general del proyecto', request_type: 'general_information', status: 'answered', evidence: draft, fact_key: null })) }
    }
    reviewCalls++
    return { review_contract: 'business-risk-v2', verdict: reviewCalls === 1 ? 'block' : 'pass', facts: [],
      findings: reviewCalls === 1 ? [{ category: 'turn_goal', statement: 'Con gusto le orientamos.',
        reason: 'Se omitió opening_presentation: ofrecer brochure y solicitar perfil no describe el proyecto.',
        authoritative_fact: summary }] : [], question: { ...question, offered_action: 'none' } }
  }))
  assert.equal(writingCalls, 2)
  assert.equal(reviewCalls, 2)
  assert.match(result.reply, /La Vilet integra viviendas y espacios comerciales/)
  assert.ok(result.reply.endsWith(PROFILE_INVITATION))
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.status, 'checked')
})
for (const observation of [false, true]) for (const specific of [false, true]) {
  test('the actual writer receives a selected general summary only, observation='+observation+', specific='+specific, async () => {
    const current = specific ? '¿Cuánto cuestan las viviendas?' : 'Quiero información del proyecto'
    let instructions = '', context: Row = {}
    const reply = specific ? 'Para consultar los precios, ¿qué tipo de vivienda le interesa?' : summary+' ¿Podría indicarnos su nombre y en qué ciudad o país reside actualmente?'
    await withResponseReviewPolicy({ enabled: true, observationOnly: observation, updatedAt: null }, () => completeTurnReply({
      current, baseReply: reply, verified: verified(current, specific), audit: { semantic_review_enabled: true, business_risk_review_enabled: true,
        ...(observation ? { response_review_observation: { enabled: true, test_contact: true } } : {}) },
    }, async (rules, input, _schema, _image, _file, _tone, task) => {
      if (task === 'writing') {
        instructions = String(rules); context = object(input)
        return { reply, question: null, requests: [{ fragment: 'R1', intent: 'Información', request_type: 'general_information', status: 'answered', evidence: reply, fact_key: null }] }
      }
      return { review_contract: 'business-risk-v2', verdict: 'pass', facts: [], findings: [], question: null }
    }))
    assert.ok(instructions, 'writer was called')
    const selected = object(context.contexto_verificado)
    assert.equal(selected.configuracion_presentacion_proyecto, undefined)
    if (specific) {
      assert.equal(selected.presentacion_general_proyecto, undefined)
      assert.doesNotMatch(instructions, /Presentación general del proyecto/)
      assert.doesNotMatch(JSON.stringify(context), /Responsable del proyecto/)
    } else {
      assert.equal(object(selected.presentacion_general_proyecto).summary, summary)
      assert.match(instructions, /Presentación general del proyecto/)
      assert.match(instructions, /Conserve las cantidades autorizadas del resumen; no añada fichas, precios, estado de obra o fechas ajenos/)
      assert.match(instructions, /pregunta de perfil o la decisión pendiente/)
    }
  })
}
