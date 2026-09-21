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
