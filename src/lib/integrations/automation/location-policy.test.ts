import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LOCATION_DISCLOSURE_RULES, locationDisclosurePolicy, projectLocationForPrompt } from './location-policy'
import { locationAnswer, withVisitLocation } from './visit-location'

const address = 'Ricardo Darquea Granda y Elena Landívar, Puertas del Sol, Cuenca'
const map = 'https://www.google.com/maps/search/?api=1&query=-2.892287,-79.030259'
const verified = {
  proyecto: { name: 'La Vilet', address, description: `La Vilet está en ${address} y ofrece comodidad.` },
  ubicacion_general: { sector: 'Puertas del Sol', city: 'Cuenca' }, ubicacion: map,
  catalogo: [{ id: '201', bedrooms: 2, area_internal_m2: 109.69, published_commercial_price: 270000 }],
  politicas_negocio: [{ content: `Puede ver la oficina aquí: ${map}` }],
  politica_visitas: { launchDestination: 'office', visit_location_url: map },
  estado_proyecto: { stage: 'launch', destinations: [{ address, latitude: -2.89, longitude: -79.03 }] },
}

describe('project location authority and prompt projection', () => {
  it('separates a general introduction and sector query from detailed directions', () => {
    for (const current of ['Hola, quiero información de apartamentos', '¿En qué sector queda?', '¿En qué ciudad está?']) {
      const policy = locationDisclosurePolicy({ current, verified })
      assert.equal(policy.exact_location_allowed, false, current)
      assert.equal(policy.map_allowed, false, current)
      assert.deepEqual(policy.general_location, { sector: 'Puertas del Sol', city: 'Cuenca' })
      const projected = projectLocationForPrompt(verified, policy)
      const sources = JSON.stringify(projected)
      assert.ok(!sources.includes(address), current)
      assert.ok(!sources.includes(map), current)
      assert.ok(!sources.includes('latitude'), current)
      assert.match(sources, /Puertas del Sol/)
      assert.deepEqual(projected.catalogo, verified.catalogo)
      assert.equal((projected.proyecto as { description: string }).description, 'La Vilet está en Puertas del Sol, Cuenca y ofrece comodidad.')
      assert.equal(withVisitLocation('Podemos coordinar una visita a la oficina.', projected, true), 'Podemos coordinar una visita a la oficina.')
    }
    assert.equal(verified.proyecto.address, address, 'Source projection does not mutate authority.')
    assert.equal(verified.ubicacion, map)
  })
  it('allows verified direction and map facts after an explicit current request', () => {
    for (const current of ['¿Dónde queda La Vilet?', 'Envíeme la ubicación', '¿Cómo llego a la oficina?',
      'Quiero información del departamento y el mapa', '¿En qué sector queda? Además deme la dirección.']) {
      const policy = locationDisclosurePolicy({ current, verified })
      assert.equal(policy.exact_location_allowed, true, current)
      const projected = projectLocationForPrompt(verified, policy)
      assert.equal((projected.proyecto as { address: string }).address, address)
      assert.equal(projected.ubicacion, map)
      const reply = withVisitLocation('Esta es la dirección solicitada.', projected, true)
      assert.ok(reply.includes(address))
      assert.ok(reply.includes(map))
    }
  })
  it('honors separate refusals of the map or textual address within compound requests', () => {
    const addressOnly = locationDisclosurePolicy({ current: 'Deme la dirección. No quiero el mapa.', verified })
    assert.equal(addressOnly.address_allowed, true)
    assert.equal(addressOnly.map_allowed, false)
    const addressSources = projectLocationForPrompt(verified, addressOnly)
    assert.equal((addressSources.proyecto as { address: string }).address, address)
    assert.ok(!JSON.stringify(addressSources).includes(map))
    const addressReply = withVisitLocation('Aquí tiene la dirección.', addressSources, true)
    assert.ok(addressReply.includes(address))
    assert.ok(!addressReply.includes(map))

    const mapOnly = locationDisclosurePolicy({ current: 'No necesito la dirección. Envíeme el mapa.', verified })
    assert.equal(mapOnly.address_allowed, false)
    assert.equal(mapOnly.map_allowed, true)
    const mapSources = projectLocationForPrompt(verified, mapOnly)
    assert.equal((mapSources.proyecto as { address?: string }).address, undefined)
    const mapReply = withVisitLocation('Aquí tiene el mapa.', mapSources, true)
    assert.ok(!mapReply.includes(address))
    assert.ok(mapReply.includes(map))

    const changedMind = locationDisclosurePolicy({ current: 'No quiero el mapa. Envíeme el mapa.', verified })
    assert.equal(changedMind.map_allowed, true)
  })
  it('does not treat an invitation, submitted request or model claim as a confirmed visit', () => {
    for (const audit of [
      { source: 'visit_intake', action: 'submitted', registration_verified: true, request_id: 'v1' },
      { visit_result: { action: 'awaiting_advisor', request_id: 'v1' } },
      { visit_result: { action: 'confirmed' } },
      { completed_visit_action: { action: 'cancelled' } },
      { completed_visit_action: { action: 'confirmed', channel: 'virtual' } },
    ]) assert.equal(locationDisclosurePolicy({ current: 'sí, gracias', verified, audit }).exact_location_allowed, false)
  })
  it('allows only completed confirmed in-person operation facts, independently of prose', () => {
    for (const audit of [
      { completed_visit_action: { action: 'confirmed', request_id: 'v1' } },
      { visit_result: { action: 'confirmed', request_id: 'v1' }, registration_verified: true },
    ]) {
      const policy = locationDisclosurePolicy({ current: 'sí, gracias', verified, audit })
      assert.equal(policy.exact_location_allowed, true)
      assert.equal(policy.reason, 'verified_in_person_confirmation')
    }
  })
  it('preserves conversational evidence without turning it into authority to resend an old map', () => {
    const history = [{ role: 'bot', content: `Dirección: ${address}\nMapa: ${map}` }]
    const info = { ...verified, historial: history }
    const projected = projectLocationForPrompt(info, locationDisclosurePolicy({ current: '¿Qué precio tiene?', verified: info }))
    assert.deepEqual(projected.historial, history)
    assert.equal(projected.ubicacion, undefined)
    assert.equal((projected.proyecto as { address?: string }).address, undefined)
    assert.match(LOCATION_DISCLOSURE_RULES, /también en texto libre/)
    assert.match(LOCATION_DISCLOSURE_RULES, /el permiso para comunicar su detalle/)
  })
  it('never invents a coarse address from absent authority or an unrelated city', () => {
    assert.deepEqual(locationDisclosurePolicy({ current: '¿En qué ciudad está?', verified: {} }).general_location, {})
    assert.equal(locationAnswer({ proyecto: { address: 'Otra calle de Quito' } }, 'general'), '')
    assert.equal(locationAnswer({ ubicacion_general: { sector: 'Centro', city: 'Loja' } }, 'general'), 'La Vilet se ubica en Centro, Loja.')
  })
})
