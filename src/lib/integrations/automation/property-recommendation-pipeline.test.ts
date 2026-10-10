import assert from 'node:assert/strict'
import test from 'node:test'
import { object, text, type Row } from './data'
import { commercialJourneyPlan } from './commercial-journey'
import { catalogDialogueReply } from './catalog-dialogue'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { progressivePendingQuestion } from './progressive-options'
import { rememberPropertyReply, resolvePropertyTurn } from './property-context'
import { normalizeTurnSemantics } from './turn-semantics'
import { actualContinuation } from './continuation-validation'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const catalog: Row[] = [
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, floor_number: 2, floor: 'Segunda planta alta',
    area_internal_m2: 120.83, published_commercial_price: 250000 },
  { id: 'd302', unit_number: '302', category: 'departamento', bedrooms: 3, floor_number: 3, floor: 'Tercera planta alta',
    area_internal_m2: 120.83, published_commercial_price: 270000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, floor: 'Sexta planta alta',
    area_internal_m2: 142.09, published_commercial_price: 550000 },
].map(unit => ({ ...unit, status: 'disponible', is_published: true }))

function info(kind: 'category' | 'floor', current: string): Row {
  const floor = kind === 'floor'
  return { catalogo: catalog, catalogo_verificacion: catalog, catalog_read: { complete: true },
    lead: { purchase_purpose: 'vivir' }, recorrido_comercial: {},
    politica_comercial: { precios_autorizados: true }, financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], journey: {} },
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca', residence_status: 'confirmed' },
    instalaciones: [{ category: 'seguridad_confort', amenity_name: '2 ascensores de última generación', description: 'Ascensores modernos y eficientes' }],
    hechos_confirmados: { budget: { status: 'maximum_total', amount: 300000, confidence: 'high', evidence: 'Mi presupuesto total es de 300 mil' } },
    property_context: { query: { group: 'residential', category: floor ? 'departamento' : null, operation: 'search',
      filters: { bedrooms: 3, floor_number: floor ? 0 : null } }, selected_ids: [],
      ...(floor ? { category_preference: { category: 'departamento', confirmed: true, evidence: 'Sí, exploremos departamentos' } } : {}) },
    semantica_turno: { primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
      budget: { status: 'not_discussed' }, property: { group: 'residential', category: null, operation: 'search',
        filters: { floor_number: floor ? 0 : null, bedrooms: floor ? null : 3 }, evidence: current, confidence: 'high' } },
    solicitudes_interpretadas: [{ domain: 'property', request: current, evidence: current, confidence: 'high', topics: ['property_options'] }] }
}

for (const mode of ['normal', 'demonstration', 'disabled'] as const) for (const kind of ['category', 'floor'] as const)
  test(`${mode}: ${kind} proposal survives writer, review, sent receipt and the next yes`, async () => {
    const current = kind === 'category' ? 'Me gustaría algo de tres dormitorios'
      : 'Prefiero una planta baja para no subir tantas gradas'
    const input = info(kind, current), plan = commercialJourneyPlan(input), draft = catalogDialogueReply(input, current)!
    const floor = kind === 'floor', reply = floor
      ? `No hay departamentos de tres dormitorios en planta baja. Podemos revisar la segunda planta alta. El proyecto cuenta con dos ascensores. ${text(plan.question)}`
      : `Considerando su presupuesto, podemos comenzar por los departamentos de tres dormitorios. ${text(plan.question)}`
    const metadata = { role: floor ? 'necessary_clarification' : 'optional_continuation',
      purpose: floor ? 'clarify_request' : 'choose_property', missing_datum: floor ? 'Aceptar la segunda planta alta' : '',
      next_decision: floor ? 'Revisar las unidades de esa planta' : 'Conocer la planta preferida',
      continuation_id: plan.question_id, continuation_act: plan.question_act }
    assert.equal(actualContinuation(reply).id, plan.question_id)
    assert.equal(actualContinuation(reply).act, plan.question_act)
    const tasks: string[] = []
    const audit = { ...draft.audit, semantic_review_enabled: true, business_risk_review_enabled: true, commercial_journey: plan }
    const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
      () => completeTurnReply({ current, baseReply: draft.reply, verified: { ...input, siguiente_paso_comercial: plan }, audit },
        async (_rules, raw, _schema, _image, _file, _tone, task) => {
          const context = object(raw); tasks.push(task || '')
          const obligation = rows(context.obligaciones_del_turno).find(row => row.id === 'commercial_next_step')!
          assert.equal(obligation.question_id, plan.question_id)
          if (task === 'writing') {
            if (floor) assert.ok(rows(object(context.contexto_verificado).instalaciones).some(f => /2 ascensores/.test(text(f.amenity_name))))
            return { reply, question: metadata, requests: rows(context.referencias_solicitud).map(ref => ({ fragment: ref.id,
              intent: 'Responder y conservar la propuesta', request_type: 'general_information', status: 'answered', evidence: reply, fact_key: null })) }
          }
          return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: { ...metadata, offered_action: 'none' } }
        }))
    assert.equal(result.reply, reply, JSON.stringify(result.audit.final_validation))
    assert.equal(result.needsAdvisor, false)
    assert.deepEqual(tasks, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
    const pending = progressivePendingQuestion(result.reply, { ...audit, turn_completeness: result.audit })
    assert.equal(pending.id, plan.question_id)
    assert.equal(pending.act, plan.question_act)
    assert.equal(object(object(pending.proposed_query).filters).bedrooms, 3)
    if (floor) assert.equal(object(object(pending.proposed_query).filters).floor_number, 2)
    else assert.equal(object(pending.proposed_query).category, 'departamento')
    const context = rememberPropertyReply(catalog, object(input.property_context), result.reply, { pending_question: pending })
    const yes = 'Sí, está bien'
    const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'answer_previous', primary_evidence: yes, confidence: 'high',
      property: { operation: 'none', reference_kind: 'none', evidence: yes, confidence: 'high' },
      answer_to_previous: { question_id: pending.id, kind: 'affirmative', evidence: yes, confidence: 'high' } } }, yes, pending)
    const resolved = resolvePropertyTurn(catalog, yes, { _property_context: context, _pending_question: pending }, [], semantics)
    assert.equal(resolved.query.category, 'departamento')
    assert.deepEqual(resolved.context.selected_ids, [])
    assert.equal(object(resolved.query.filters).bedrooms, 3)
    const next = commercialJourneyPlan({ ...input, property_context: resolved.context, semantica_turno: semantics })
    assert.equal(next.question_id, floor ? 'unit_choice' : 'property_floor')
  })
