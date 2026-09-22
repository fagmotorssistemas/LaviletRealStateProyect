import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { commercialEngagement, explicitPropertyInterest } from './commercial-engagement'

describe('explicitPropertyInterest — falsos negativos CTWA', () => {
  it('reconoce disponibilidad de un bien identificado', () => {
    assert.equal(
      explicitPropertyInterest(
        'Hola. ¿Puedo obtener más información sobre este bien que está en venta?',
      ),
      true,
    )
    assert.equal(
      explicitPropertyInterest('Buenas noches todavía está disponible'),
      true,
    )
  })

  it('no convierte saludo ni consulta genérica sin contexto de inmueble', () => {
    assert.equal(explicitPropertyInterest('Hola'), false)
    assert.equal(explicitPropertyInterest('ok gracias'), false)
    assert.equal(
      explicitPropertyInterest(
        'Hola. ¿Puedo obtener más información sobre esto?',
      ),
      false,
    )
  })

  it('reconoce precio/visita con tipología', () => {
    assert.equal(
      explicitPropertyInterest('Quisiera agendar una visita al departamento'),
      true,
    )
    assert.equal(explicitPropertyInterest('¿Cuánto cuesta esta suite?'), true)
  })

  it('las consultas de precio y disponibilidad respetan un rechazo previo guardado o en el historial', () => {
    const history = [{ role: 'cliente', content: 'No estoy interesado por el momento' }]
    for (const current of ['Cuánto vale el departamento y aceptan mascotas?', '¿Cuánto cuesta esta suite?', 'Buenas noches todavía está disponible']) {
      assert.equal(explicitPropertyInterest(current), true, current)
      assert.equal(commercialEngagement(current, [], { passive_sales: true }).passive, true, current)
      assert.equal(commercialEngagement(current, history).passive, true, current)
      assert.deepEqual(commercialEngagement(current, []), { passive: false, interested: true }, current)
    }
  })

  it('una petición explícita de compra, visita o financiamiento permite retomar la orientación', () => {
    for (const current of ['Ahora sí quiero comprar un departamento', 'Quisiera agendar una visita al departamento', 'Quiero revisar mi financiamiento']) {
      assert.deepEqual(commercialEngagement(current, [], { passive_sales: true }), { passive: false, interested: true }, current)
    }
  })
})
