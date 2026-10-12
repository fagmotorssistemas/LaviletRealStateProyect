import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { buildTourWhatsAppMessage } from './tourWhatsApp'

test('WhatsApp describes common areas without exposing their codes', () => {
  const message = buildTourWhatsAppMessage({ context: 'zona_comun', commonAreaCode: 'DESCANSO' })
  assert.match(message, /la zona de descanso/)
  assert.doesNotMatch(message, /DESCANSO/)
})

test('WhatsApp distinguishes gallery, tour, comparison, and floor plan', () => {
  const unit = { unitNumber: '606', category: 'penthouse', bedrooms: 2 }
  const gallery = buildTourWhatsAppMessage({ context: 'unidad', ...unit, roomLabel: 'Cocina', viewMode: 'galeria' })
  const tour = buildTourWhatsAppMessage({ context: 'unidad', ...unit, roomLabel: 'Sala', viewMode: 'tour' })
  const comparison = buildTourWhatsAppMessage({ context: 'comparador', ...unit, compareUnit: { unitNumber: '205', category: 'suite' } })
  const plan = buildTourWhatsAppMessage({ context: 'plano', floorLabel: 'Planta baja' })
  assert.match(gallery, /el penthouse 606 de 2 dormitorios.*foto de la cocina/)
  assert.match(tour, /recorriendo la sala en 360°/)
  assert.match(comparison, /el penthouse 606 de 2 dormitorios y la suite 205/)
  assert.match(plan, /la planta baja/)
  assert.notEqual(gallery, tour)
})

test('WhatsApp supplies English copy without typology codes', () => {
  const message = buildTourWhatsAppMessage({ context: 'unidad', unitNumber: '205', category: 'suite', roomLabel: 'Cocina', viewMode: 'galeria', locale: 'en' })
  assert.match(message, /the suite 205/)
  assert.match(message, /photo of the kitchen/)
  assert.doesNotMatch(message, /1G|DESCANSO/)
})
