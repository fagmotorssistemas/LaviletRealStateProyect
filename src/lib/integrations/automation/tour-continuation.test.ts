import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tourContinuation } from './tour-continuation'

const unit = { id: 'p605', category: 'penthouse', unit_number: '605', published_commercial_price: 550000 }
const policy = { politica_comercial: { precios_autorizados: true } }

describe('shared continuation after a selected unit tour', () => {
  it('asks the missing budget once without introducing other properties', () => {
    const answer = tourContinuation({ perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' } }, unit)
    assert.equal(answer.question, '¿Qué presupuesto aproximado tiene previsto para la compra?')
    assert.equal(answer.pending_question.id, 'budget_amount')
    assert.equal(answer.reply.match(/\?/g)?.length, 1)
  })

  it('clarifies a known 70 thousand amount instead of assuming a total or entry', () => {
    const answer = tourContinuation({ conversacion: { datos_conocidos: { presupuesto: 70000, presupuesto_texto: 'Cuento con 70 mil dólares' } } }, unit)
    assert.equal(answer.pending_question.id, 'budget_kind')
    assert.equal(answer.budget.amount, 70000)
    assert.doesNotMatch(answer.reply, /diferencia|no alcanza|otra opción/i)
  })

  it('uses explicit current budget semantics ahead of old declarations', () => {
    const answer = tourContinuation({ ...policy, lead: { budget: 70000 }, semantica_turno: {
      budget: { status: 'maximum_total', amount: 600000, confidence: 'high', evidence: 'Mi presupuesto total es 600 mil' },
    } }, unit)
    assert.equal(answer.budget.amount, 600000)
    assert.match(answer.reply, /dentro del presupuesto total/)
    assert.doesNotMatch(answer.question, /presupuesto|entrada|otra/)
  })

  it('retains an explicit total from the client history and checks only authorized prices', () => {
    const info = { historial: [{ role: 'cliente', content: 'Mi presupuesto total es 500 mil dólares' }] }
    assert.doesNotMatch(tourContinuation(info, unit).reply, /supera/)
    const answer = tourContinuation({ ...policy, ...info }, unit)
    assert.equal(answer.budget.status, 'maximum_total')
    assert.match(answer.reply, /supera el presupuesto total/)
    assert.doesNotMatch(answer.reply, /financiamiento|otra opción/)
  })

  it('treats the stated entry as entry and offers only verified financing information', () => {
    const info = { ...policy, lead: { behavior_signals: { sdr: { presupuesto_texto: 'Tengo 70 mil dólares para la entrada' } } } }
    const answer = tourContinuation({ ...info, financiamiento: { partners: ['Banco Pichincha'] } }, unit)
    assert.equal(answer.budget.status, 'initial_capital')
    assert.match(answer.question, /conocer las opciones de financiamiento para esta unidad/)
    assert.doesNotMatch(answer.reply, /presupuesto total|aprobado|diferencia/)
    assert.doesNotMatch(tourContinuation(info, unit).reply, /financiamiento/)
  })

  it('consumes the clarification of a previously ambiguous amount without asking again', () => {
    const answer = tourContinuation({ historial: [
      { role: 'cliente', content: 'Cuento con 70 mil dólares' },
      { role: 'bot', content: '¿Ese monto corresponde a su presupuesto total para la compra o al dinero disponible para la entrada?' },
      { role: 'cliente', content: 'Para la entrada' },
    ] }, unit)
    assert.equal(answer.budget.amount, 70000)
    assert.equal(answer.budget.status, 'initial_capital')
    assert.doesNotMatch(answer.question, /presupuesto|entrada/)
  })

  it('accepts a bare amount only in the budget answer context', () => {
    const answer = tourContinuation({ historial: [
      { role: 'bot', content: '¿Qué presupuesto aproximado tiene previsto para la compra?' },
      { role: 'cliente', content: '600 mil' },
    ] }, unit)
    assert.equal(answer.budget.status, 'maximum_total')
    assert.equal(answer.budget.amount, 600000)
    assert.equal(tourContinuation({}, unit, 'El 605 por favor').budget.status, 'not_discussed')
    assert.equal(tourContinuation({}, unit, 'Tengo 3 hijos').budget.status, 'not_discussed')
    assert.equal(tourContinuation({ conversacion: { ultima_respuesta: '¿Qué presupuesto tiene para la compra?' } }, unit, 'El 605 por favor').budget.status, 'not_discussed')
  })

  it('respects refusal, uncertainty and deferred budget memory', () => {
    for (const info of [
      { semantica_turno: { budget: { status: 'declines_to_disclose', confidence: 'high' } } },
      { memoria_comercial: { deferred_fields: ['presupuesto'] } },
      { historial: [{ role: 'cliente', content: 'Prefiero no compartir mi presupuesto' }] },
      { historial: [{ role: 'bot', content: '¿Cuál es su presupuesto?' }, { role: 'cliente', content: 'No lo he pensado' }] },
    ]) {
      const answer = tourContinuation(info, unit)
      assert.doesNotMatch(answer.question, /presupuesto|entrada|otra opción/)
      assert.equal(answer.question, '¿Qué le gustaría revisar con más detalle de esta opción?')
    }
  })

  it('does not mine bot prices or monthly income as a purchase budget', () => {
    const answer = tourContinuation({ historial: [
      { role: 'bot', content: 'El valor es USD 550.000. ¿Cuál es su presupuesto?' },
      { role: 'cliente', content: 'Mi ingreso mensual es 2000 dólares' },
    ] }, unit)
    assert.equal(answer.budget.status, 'not_discussed')
    assert.equal(answer.pending_question.id, 'budget_amount')
  })

  it('anchors budget amounts after their declarations instead of a preceding unit number', () => {
    for (const current of ['El 605 y cuento con 70 mil dólares', 'Quiero la 605, tengo 70 mil dólares para la entrada']) {
      const answer = tourContinuation({}, unit, current)
      assert.equal(answer.budget.amount, 70000, current)
    }
    const total = tourContinuation({}, unit, 'Quiero la 605, mi presupuesto total es 600 mil dólares')
    assert.equal(total.budget.amount, 600000)
    assert.equal(total.budget.status, 'maximum_total')
    for (const current of ['Tengo el penthouse 605 en mente', 'El 605 cuesta 550 mil dólares', 'Tengo 3 hijos y prefiero el 605']) {
      assert.equal(tourContinuation({}, unit, current).budget.amount, null, current)
    }
  })

  it('keeps a separately declared purchase budget distinct from salary and household numbers', () => {
    const current = 'Mi salario es de 2000 dólares al mes; me interesa el 605 y mi presupuesto total es 600 mil dólares'
    assert.equal(tourContinuation({}, unit, current).budget.amount, 600000)
    assert.equal(tourContinuation({}, unit, 'Tengo 3 hijos y cuento con 70 mil dólares').budget.amount, 70000)
    assert.equal(tourContinuation({}, unit, 'Mi ingreso mensual es 2000 dólares y tengo el 605 en mente').budget.amount, null)
    assert.equal(tourContinuation({}, unit, '70 mil dólares para la entrada').budget.amount, 70000)
  })

  it('does not add a discovery question when the client has requested another action', () => {
    for (const primary_intent of ['request_visit', 'ask_financing']) {
      const answer = tourContinuation({ semantica_turno: { primary_intent, confidence: 'high' } }, unit)
      assert.equal(answer.reply, '')
      assert.equal(answer.reason, 'requested_action_pending')
    }
  })

  it('does not restart a financial review already underway', () => {
    const answer = tourContinuation({ lead: { behavior_signals: { sdr: { presupuesto_texto: 'Tengo 70 mil para la entrada' } } },
      financiamiento: { partners: ['Banco Pichincha'], current: { explicit_consent: true } } }, unit)
    assert.equal(answer.reason, 'financing_already_started')
    assert.doesNotMatch(answer.question, /financiamiento|presupuesto|entrada/)
  })
})
