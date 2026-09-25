import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { greetingForTurn, naturalConversationReply } from './conversation-style'
import { isProjectInformationRequest, projectInformationChoiceReply, projectInformationReply } from './commercial-experience'
import { BROCHURE_URL, wantsBrochure } from './project-material'

const info = (history: unknown[] = []) => ({
  historial: history,
  posicionamiento_proyecto: {},
  modo_comercial: 'lanzamiento',
  estado_proyecto: null,
  instalaciones: [
    { amenity_name: 'Piscina exclusiva para residentes' },
    { amenity_name: 'Gimnasio' },
    { amenity_name: 'Jardines' },
    { amenity_name: 'Seguridad y monitoreo' },
  ],
})

describe('project information conversation', () => {
  it('uses interpreted project intent for a typo after a greeting', () => {
    const reply = projectInformationReply({ ...info([{ role: 'bot', content: 'Hola, ¿en qué podemos ayudarle?' }]),
      semantica_turno: { primary_intent: 'project_information', confidence: 'high', property: { operation: 'search' } } }, 'Quieor informacion', BROCHURE_URL)
    assert.match(reply, /brochure/)
    assert.match(reply, /Puertas del Sol/)
  })
  it('does not restart the project presentation with an active property, but allows an explicit topic change', () => {
    const context = { ...info(), property_context: { selected_ids: ['u502'], query: { category: 'departamento' } } }
    assert.equal(projectInformationReply(context, 'Quiero información', BROCHURE_URL), '')
    assert.match(projectInformationReply(context, 'Quiero información general del proyecto', BROCHURE_URL), /brochure/)
  })
  it('leaves mixed project questions to the full response instead of consuming them as an overview', () => {
    assert.equal(projectInformationReply({ ...info(), semantica_turno: {
      primary_intent: 'project_information', confidence: 'high', requests: [{ domain: 'property' }, { domain: 'property' }],
    } }, 'Quiero información del proyecto y saber si admiten mascotas', BROCHURE_URL), '')
  })
  it('does not replace specific project questions or operational requests with an overview', () => {
    for (const current of ['Quiero información del proyecto y el precio del 502',
      'Quiero información del proyecto y agendar una visita', 'Quiero información del proyecto y del crédito',
      'Quiero información del proyecto, cuándo es la entrega', 'Quiero información del proyecto y sus departamentos de 3 dormitorios']) {
      assert.equal(projectInformationReply(info(), current, BROCHURE_URL), '', current)
    }
  })
  it('greets a first substantive message, explains the project and includes the brochure', () => {
    const reply = projectInformationReply(info(), 'Quiero información', BROCHURE_URL)

    assert.match(reply, /^Hola\. Claro que sí, con mucho gusto\./)
    assert.match(reply, /suites y departamentos/i)
    assert.match(reply, /locales comerciales/i)
    assert.match(reply, /piscina, gimnasio, jardines y medidas de seguridad/i)
    assert.match(reply, /brochure-la-vilet-v5\.pdf/)
    assert.match(reply, /información de alguna de estas opciones\?$/i)
    assert.equal(isProjectInformationRequest('Compárteme información del proyecto'), true)
    assert.equal(isProjectInformationRequest('Envíeme el PDF'), false)
  })

  it('uses the lead greeting once on a first message', () => {
    const current = 'Buenas tardes, quiero más información del proyecto'
    const at = '2026-09-21T18:15:00.000Z'
    const base = projectInformationReply(info(), current, BROCHURE_URL)
    const reply = naturalConversationReply(base, '', greetingForTurn(current, [], null, at), at)

    assert.match(reply, /^Buenas tardes\. Claro que sí, con mucho gusto\./)
    assert.equal((reply.match(/Buenas tardes/gi) || []).length, 1)
    assert.doesNotMatch(reply, /Buenas tardes\. Hola\./i)
  })

  it('does not greet again after the bot already welcomed the lead', () => {
    const history = [{ role: 'bot', content: 'Hola, un gusto saludarle. ¿En qué podemos ayudarle?' }]
    const reply = projectInformationReply(info(history), 'Quiero información del proyecto', BROCHURE_URL)

    assert.match(reply, /^Claro que sí, con mucho gusto\./)
    assert.doesNotMatch(reply, /^Hola\b/)
  })

  it('answers the reported generic request after an earlier greeting with the full overview and brochure', () => {
    const history = [{ role: 'bot', content: 'Hola, un gusto saludarle. ¿En qué podemos ayudarle?' }]
    const reply = projectInformationReply(info(history), 'Buenas tardes, Quiero información', BROCHURE_URL)

    assert.match(reply, /^Claro que sí, con mucho gusto\./)
    assert.match(reply, /Puertas del Sol, Cuenca/i)
    assert.match(reply, /suites y departamentos/i)
    assert.match(reply, /locales comerciales/i)
    assert.match(reply, /brochure-la-vilet-v5\.pdf/i)
    assert.doesNotMatch(reply, /^Hola\b|^Buenas tardes\b/i)
  })

  it('asks which property family the lead wants after a generic acceptance', () => {
    const history = [{
      role: 'bot',
      content: `Puede conocer el proyecto con más detalle en el brochure: ${BROCHURE_URL}\n\n¿Le gustaría que le compartamos información de alguna de estas opciones?`,
    }]
    const reply = projectInformationChoiceReply('Sí', history)

    assert.match(reply, /suites y departamentos/i)
    assert.match(reply, /locales comerciales/i)
    assert.match(reply, /con cuál de estas opciones le gustaría empezar\?$/i)
    assert.equal(wantsBrochure('Sí', history), false)
    assert.equal(wantsBrochure('Envíeme el brochure', history), true)
  })
})
