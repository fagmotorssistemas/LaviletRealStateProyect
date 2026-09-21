import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { commercialLocationBudgetRecommendation } from './commercial-location-recommendation'

const info = {
  lead: { preferred_category: 'local' },
  conversacion: { datos_conocidos: { actividad_comercial: 'restaurante' } },
  politica_comercial: { precios_autorizados: true, precios_aproximados: true },
  financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'] },
  contexto_sector: [
    { fact_key: 'puertas_del_sol_posicionamiento' },
    { fact_key: 'puertas_del_sol_plazas_comerciales' },
    { fact_key: 'puertas_del_sol_servicios_cercanos' },
  ],
  catalogo: [
    { id: '1', category: 'local', unit_number: 'LC-01', floor: 'Planta Baja', floor_number: 0, published_commercial_price: 535000 },
    { id: '11', category: 'local', unit_number: 'LC-11', floor: 'Primera Planta Alta', floor_number: 1, published_commercial_price: 145000 },
  ],
}

describe('commercial location and available capital recommendation', () => {
  it('answers sector and building location, preserves literal capital and offers the closest local', () => {
    const reply = commercialLocationBudgetRecommendation(info,
      'Para mí lo más importante es la ubicación del local, pero no tengo todo para invertir, tengo 50 mil dólares. ¿Qué opciones tengo?')
    assert.match(reply, /Puertas del Sol aporta un entorno atractivo para un restaurante/)
    assert.match(reply, /LC-01 está en planta baja/)
    assert.match(reply, /LC-11, ubicado en primera planta alta/)
    assert.match(reply, /USD 50[.\s]000/)
    assert.match(reply, /USD 145[.\s]000/)
    assert.match(reply, /USD 95[.\s]000/)
    assert.match(reply, /Banco Pichincha o Cooperativa JEP/)
    assert.doesNotMatch(reply, /Mapa:|tránsito|rentabilidad garantizada|aprobación garantizada/)
  })

  it('does not expose prices when the interface policy hides them', () => {
    assert.equal(commercialLocationBudgetRecommendation({ ...info,
      politica_comercial: { precios_autorizados: false, precios_aproximados: true } },
    'La ubicación del local es importante y no tengo todo el dinero; tengo 50 mil dólares'), '')
  })
})
