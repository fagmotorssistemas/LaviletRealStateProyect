import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readinessInvitation, readinessPlacePhrase, readinessRules, validateReadiness, type ProjectReadiness } from '@/lib/inmobiliaria/projectReadiness'
import { visitTruthReply } from './visit-copy'

const office: ProjectReadiness = { stage: 'not_started', progress: 'La obra todavía no ha iniciado',
  verifiedOn: '2026-10-01', enabledPlaces: ['office'], primaryPlace: 'office', conditions: 'Coordinar disponibilidad', officeAtProjectSite: true }

test('office invitation names the same site but offers orientation without unavailable plans', () => {
  const question = readinessInvitation(office)
  assert.match(question, /oficina.*sitio del proyecto.*orientación/)
  assert.equal(question.match(/\?/g)?.length, 1)
  assert.doesNotMatch(question, /planos|recorrer la obra|unidades terminadas/)
  assert.match(readinessPlacePhrase(office, 'office'), /orientación/)
  assert.match(readinessRules(office), /atender allí no habilita recorrer la obra ni las unidades/)
})

test('orientation copy does not change physical readiness or enabled destinations', () => {
  assert.deepEqual(validateReadiness(office), office)
  assert.equal(readinessPlacePhrase({ ...office, officeAtProjectSite: false }, 'office'), 'nuestra oficina para revisar el proyecto')
  const model: ProjectReadiness = { ...office, enabledPlaces: ['office', 'model'], primaryPlace: 'model' }
  assert.match(readinessInvitation(model), /departamento modelo.*oficina/)
  assert.equal(readinessInvitation({ ...office, enabledPlaces: [], primaryPlace: 'none' }), '')
})

test('a fabricated finished-apartment visit is replaced by the authorized on-site office invitation', () => {
  const reply = visitTruthReply('Puede visitar personalmente los departamentos.', {
    estado_proyecto: office, politica_visitas: { launchDestination: 'office' },
  }, {}, [], value => [value])
  assert.match(reply, /oficina.*sitio del proyecto.*orientación/)
  assert.doesNotMatch(reply, /Puede visitar personalmente los departamentos|planos/)
})

test('legacy office fallback also avoids a promise of available plans or a registered appointment', () => {
  const reply = visitTruthReply('Podemos visitar personalmente los departamentos.', {
    modo_comercial: 'lanzamiento', politica_visitas: { launchDestination: 'office' },
  }, {}, [], value => [value])
  assert.match(reply, /oficina.*orientarle.*no hay departamentos terminados/)
  assert.doesNotMatch(reply, /planos|registrada|confirmada/)
})
