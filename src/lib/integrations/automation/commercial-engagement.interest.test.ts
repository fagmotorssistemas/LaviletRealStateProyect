import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { explicitPropertyInterest } from './commercial-engagement'

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
})
