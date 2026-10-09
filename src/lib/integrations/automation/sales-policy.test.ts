import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { salesPlan } from './sales-policy'

describe('sales offers use complete words for refusals and uncertainty', () => {
  it('retains an eligible visit offer after bueno and respects actual refusals', () => {
    const unit = { id: 'u502', unit_number: '502', category: 'departamento', bedrooms: 3,
      floor_number: 5, published_commercial_price: 300000 }
    const info = { catalogo: [unit], politica_comercial: { precios_autorizados: true },
      perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' }, lead: { purchase_purpose: 'vivir' },
      hechos_confirmados: { budget: { status: 'maximum_total', amount: 400000, confidence: 'high', evidence: 'Mi presupuesto total es 400000' } },
      property_context: { selected_ids: ['u502'], query: { group: 'residential', category: 'departamento', filters: { bedrooms: 3 }, operation: 'select' } },
      politica_visitas: { allowSuggestions: true, launchDestination: 'office' }, modelo_3d: { se_adjunta_en_esta_respuesta: true } }
    const summary = { _commercial_journey: { reservation_declined_ids: ['u502'] } }
    for (const current of ['Quiero una visita', 'Bueno quiero una visita', 'Bueno deseo una visita']) {
      assert.equal(salesPlan(info, current, summary).action, 'invite_visit', current)
    }
    for (const current of ['No quiero una visita', 'Bueno, no deseo una visita', 'Solo quiero información']) {
      const plan = salesPlan(info, current, summary)
      assert.notEqual(plan.action, 'invite_visit', current)
      assert.equal(plan.closing, '', current)
    }
  })

  it('does not suppress quoted options because bueno precedes a positive request', () => {
    const info = { precio_cotizado: true, unidades_cotizadas: [{ category: 'departamento', unit_number: '502' }] }
    for (const current of ['Quiero ver opciones', 'Bueno quiero ver opciones', 'Bueno necesito ver opciones']) {
      assert.equal(salesPlan(info, current, {}).action, 'offer_units', current)
    }
    for (const current of ['No quiero ver opciones', 'Bueno, no necesito ver opciones', 'Solo el precio']) {
      assert.equal(salesPlan(info, current, {}).action, 'discover', current)
    }
  })

  it('keeps brochure sharing for positive requests and suppresses actual material refusals', () => {
    const info = { historial: [{ role: 'bot', content: '¿Lo busca para vivir o invertir?' },
      { role: 'cliente', content: 'Vivir' }, { role: 'bot', content: '¿Cuántos dormitorios necesita?' }] }
    for (const current of ['Quiero información', 'Bueno quiero información', 'Bueno deseo material']) {
      assert.equal(salesPlan(info, current, {}).action, 'share_brochure', current)
    }
    for (const current of ['No quiero información', 'Bueno, no deseo material', 'No necesito el brochure']) {
      assert.equal(salesPlan(info, current, {}).action, 'answer_only', current)
    }
  })

  it('does not infer uncertainty from the last letters of bueno', () => {
    for (const current of ['Estoy seguro', 'Bueno estoy seguro', 'Sé lo que busco', 'Bueno sé lo que busco']) {
      assert.equal(salesPlan({}, current, {}).action, 'discover', current)
    }
    for (const current of ['No estoy seguro', 'Bueno, no estoy seguro', 'No sé lo que busco', 'No he pensado']) {
      assert.equal(salesPlan({}, current, {}).action, 'answer_only', current)
    }
  })
})
