import test from 'node:test'
import assert from 'node:assert/strict'
import { financingInputs } from './financing'

const context = { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {} }
const yes = { financing_consent: true, turn_semantics: { primary_intent: 'ask_financing', confidence: 'high',
  answer_to_previous: { question_id: 'financing_invitation', kind: 'affirmative', evidence: 'Sí', confidence: 'high' } } }

test('a stale formal label cannot authorize a review from an informational or unrelated emitted question', () => {
  for (const reply of [
    '¿Desea que le explique las opciones de financiamiento?',
    '¿Desea revisar las opciones de financiamiento?',
    '¿Le gustaría conocer los requisitos para iniciar la revisión financiera?',
    '¿Quiere que le explique cómo continuar con el proceso de financiamiento?',
    '¿Podemos revisar las tasas de Banco Pichincha?',
    'Podemos acompañarle con Cooperativa JEP. ¿Desea avanzar?',
    'Hay financiamiento con Cooperativa JEP. ¿Qué le parece?',
    'Podemos financiar. ¿Desea continuar con el penthouse 602?',
    'Podemos financiar. ¿Desea iniciar la reserva del penthouse 602?',
    'Podemos financiar. ¿Desea visitar nuestra oficina?',
  ]) assert.equal(financingInputs(yes, 'Sí', reply, context, { kind: 'financing_consent', reply }).consent, null, reply)
})

test('an unambiguous emitted operational financing invitation permits a grounded yes', () => {
  for (const reply of [
    '¿Desea iniciar la revisión financiera?',
    '¿Desea que continuemos con el proceso de financiamiento?',
    '¿Le gustaría que le ayudemos a iniciar la revisión con Banco Pichincha para su caso?',
    '¿Iniciamos la evaluación financiera?',
    '¿Continuamos con el proceso de financiamiento?',
    '¿Desea que recopilemos los datos para su evaluación financiera?',
  ]) assert.equal(financingInputs(yes, 'Sí', reply, context, { kind: 'financing_consent', reply }).consent, true, reply)
})

test('conditional permission, a lender choice and a unit answer cannot substitute financing consent', () => {
  const reply = '¿Desea iniciar la revisión financiera?'
  for (const current of ['No gracias', 'Sí, solo si me aseguran la aprobación', 'Con Cooperativa JEP'])
    assert.equal(financingInputs({}, current, reply, context, { kind: 'financing_consent', reply }).consent, null, current)
  assert.equal(financingInputs({ ...yes, turn_semantics: { ...yes.turn_semantics,
    answer_to_previous: { question_id: 'unit_choice', kind: 'affirmative', evidence: 'Sí', confidence: 'high' } } },
    'Sí', reply, context, { kind: 'financing_consent', reply }).consent, null)
})
