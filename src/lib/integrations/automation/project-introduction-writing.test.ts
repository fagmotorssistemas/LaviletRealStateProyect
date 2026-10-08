import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { object, type Row } from './data'
import { resolveTurnIntent } from './turn-intent'

const summary = 'La Vilet integra viviendas y espacios comerciales.'
function verified(current: string, specific: boolean): Row {
  const requests = [{ domain: 'property', confidence: 'high', request: specific ? 'Consultar precios' : 'Información general del proyecto', evidence: current }]
  const semantics = { primary_intent: specific ? 'ask_price' : 'project_information', primary_evidence: current, confidence: 'high', requests,
    property: { operation: 'none', reference_kind: 'none', filters: {}, unit_numbers: [] }, budget: { status: 'not_discussed' } }
  return { semantica_turno: semantics, solicitudes_interpretadas: requests,
    contrato_turno: resolveTurnIntent({ current, semantics, requests, scope: { kind: 'neutral', uncertain: false } }),
    configuracion_presentacion_proyecto: { available: true, summary, source: 'Responsable del proyecto' }, proyecto: { name: 'La Vilet' } }
}
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
      assert.match(instructions, /No añada cantidades, plantas, precios/)
      assert.match(instructions, /pregunta de perfil o la decisión pendiente/)
    }
  })
}
