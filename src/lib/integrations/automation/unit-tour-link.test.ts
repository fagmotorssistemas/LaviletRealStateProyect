import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { unitTourUrl } from '@/lib/tour/unitModels'
import { appendUnitModel, unitModelDelivery } from './unit-model'
import { acceptedUnitAlternative, continueUnitAlternative, unitAlternative } from './unit-alternatives'

const unit = {
  id: 'af29eae0-658d-432a-9ea0-eba48deb89ce',
  unit_number: '202',
  category: 'departamento',
  is_published: true,
  status: 'disponible',
}

const apartment202 = {
  ...unit,
  bedrooms: 3,
  area_internal_m2: 120.83,
  floor: 'Segunda Planta Alta',
  floor_number: 2,
}

const apartment203 = {
  ...apartment202,
  id: 'f2fa77dd-226b-45a9-9693-967a64046fb2',
  unit_number: '203',
  area_internal_m2: 118.4,
}

const penthouse602 = {
  ...unit,
  id: '38096796-5f64-4022-9cf6-8549626647f1',
  unit_number: '602',
  category: 'penthouse',
  bedrooms: 3,
  area_internal_m2: 142.09,
  floor: 'Sexta Planta Alta',
  floor_number: 6,
}

describe('tour links in the conversation automation', () => {
  it('builds the public tour URL with and without a unit', () => {
    assert.equal(unitTourUrl('001'), 'https://www.lavilett.com/tour?unidad=001')
    assert.equal(unitTourUrl(), 'https://www.lavilett.com/tour')
  })

  it('uses the referenced unit instead of an inventory image URL', () => {
    const delivery = unitModelDelivery(
      { explicit: true, hasUnitMention: true, matches: [unit] },
      'Muéstreme fotos del departamento 202',
      [],
    )
    assert.equal(delivery?.url, 'https://www.lavilett.com/tour?unidad=202')
    assert.match(delivery?.caption ?? '', /departamento 202/)
    assert.doesNotMatch(delivery?.caption ?? '', /storage\/v1|\.webp|\.jpg|\.png/)
  })

  it('uses the general tour when no unit is being discussed', () => {
    const delivery = unitModelDelivery(
      { explicit: false, hasUnitMention: false, matches: [] },
      'Quiero ver fotos del proyecto',
      [],
    )
    assert.equal(delivery?.url, 'https://www.lavilett.com/tour')
    assert.equal(appendUnitModel('Claro.', delivery), delivery?.caption)
  })

  it('does not replace an unknown unit with the general tour', () => {
    const delivery = unitModelDelivery(
      { explicit: false, hasUnitMention: true, matches: [] },
      'Quiero ver fotos del departamento 999',
      [],
    )
    assert.equal(delivery, null)
  })

  it('offers broad residential alternatives before choosing an expensive unit', () => {
    const result = unitAlternative({
      catalogo: [apartment202, apartment203, penthouse602],
      historial: [],
    }, 'Estoy buscando una vivienda para vivir, pero quiero una de 5 habitaciones')

    assert.equal(result?.unit, null)
    assert.equal(result?.phase, 'compare_categories')
    assert.match(result?.reply ?? '', /no contamos con departamentos disponibles de 5 dormitorios/i)
    assert.match(result?.reply ?? '', /departamentos de 3 dormitorios/i)
    assert.match(result?.reply ?? '', /penthouses/i)
    assert.doesNotMatch(result?.reply ?? '', /602|asesor|presupuesto/i)
  })

  it('compares categories after the lead accepts without repeating the bedroom question', () => {
    const result = continueUnitAlternative({
      catalogo: [apartment202, apartment203, penthouse602],
      historial: [{
        role: 'bot',
        content: 'Actualmente no contamos con departamentos disponibles de 5 dormitorios. Sin embargo, podemos ayudarle a evaluar nuestras alternativas residenciales más amplias, entre ellas departamentos de 3 dormitorios con distribuciones generosas y penthouses, donde se encuentran las mayores superficies del proyecto. ¿Le gustaría que comparemos ambas alternativas para valorar cuál se adapta mejor a lo que busca?',
      }],
    }, 'Sí, está bien')

    assert.equal(result?.phase, 'choose_category')
    assert.match(result?.reply ?? '', /departamentos de hasta 3 dormitorios/i)
    assert.match(result?.reply ?? '', /penthouses/i)
    assert.match(result?.reply ?? '', /departamentos o los penthouses/i)
    assert.doesNotMatch(result?.reply ?? '', /cuantos dormitorios|asesor/i)
  })

  it('asks for a floor after the lead chooses apartments', () => {
    const result = continueUnitAlternative({
      catalogo: [apartment202, apartment203, penthouse602],
      historial: [{
        role: 'bot',
        content: 'Contamos con departamentos de hasta 3 dormitorios. También tenemos penthouses. ¿Desea revisar primero los departamentos o los penthouses?',
      }],
    }, 'Me interesan más los departamentos')

    assert.equal(result?.phase, 'choose_floor')
    assert.match(result?.reply ?? '', /segunda planta alta/i)
    assert.match(result?.reply ?? '', /planta prefiere/i)
    assert.doesNotMatch(result?.reply ?? '', /cuantos dormitorios|presupuesto|asesor/i)
  })

  it('lists verified units on the chosen floor and then sends the selected tour', () => {
    const floor = continueUnitAlternative({
      catalogo: [apartment202, apartment203, penthouse602],
      historial: [{
        role: 'bot',
        content: 'Perfecto. Revisemos los departamentos más amplios: tienen 3 dormitorios y hay opciones en Segunda Planta Alta. ¿Qué planta prefiere?',
      }],
    }, 'La segunda planta')

    assert.equal(floor?.phase, 'choose_unit')
    assert.match(floor?.reply ?? '', /departamento 202/i)
    assert.match(floor?.reply ?? '', /departamento 203/i)
    assert.match(floor?.reply ?? '', /Cuál de estas opciones le gustaría conocer/i)
    assert.doesNotMatch(floor?.reply ?? '', /360|https:/i)
    assert.deepEqual(floor?.offered_unit_ids, [apartment202.id, apartment203.id])

    const selected = continueUnitAlternative({
      catalogo: [apartment202, apartment203, penthouse602],
      referencia_unidad: { explicit: true, matches: [apartment202] },
      historial: [{ role: 'bot', content: floor?.reply }],
    }, 'El 202')

    assert.equal(selected?.phase, 'review_unit')
    assert.equal(selected?.unit?.id, apartment202.id)
    assert.match(selected?.reply ?? '', /presupuesto total aproximado/i)
    assert.match(selected?.reply ?? '', /monto disponible inicialmente/i)
    assert.doesNotMatch(selected?.reply ?? '', /asesor/i)

    const delivery = unitModelDelivery(
      { explicit: true, hasUnitMention: true, matches: [apartment202] },
      'El 202',
      [],
    )
    assert.equal(delivery?.url, 'https://www.lavilett.com/tour?unidad=202')
  })

  it('requires choosing the unit before sending the only penthouse tour', () => {
    const result = continueUnitAlternative({
      catalogo: [apartment202, apartment203, penthouse602],
      historial: [{
        role: 'bot',
        content: 'Contamos con departamentos de hasta 3 dormitorios. También tenemos penthouses. ¿Desea revisar primero los departamentos o los penthouses?',
      }],
    }, 'Prefiero revisar los penthouses')

    assert.equal(result?.phase, 'choose_unit')
    assert.equal(result?.unit, undefined)
    assert.deepEqual(result?.offered_unit_ids, [penthouse602.id])
    assert.match(result?.reply ?? '', /penthouse 602/i)
    assert.match(result?.reply ?? '', /gustaría conocer esta opción/i)
    assert.doesNotMatch(result?.reply ?? '', /asesor|https:|presupuesto/i)
    const accepted = continueUnitAlternative({
      catalogo: [apartment202, apartment203, penthouse602],
      referencia_unidad: { matches: [penthouse602], explicit: false },
      historial: [{ role: 'bot', content: result?.reply }],
    }, 'Sí, por favor')
    assert.equal(accepted?.phase, 'review_unit')
    assert.equal(accepted?.unit?.id, penthouse602.id)
    assert.match(accepted?.reply ?? '', /https:\/\/www\.lavilett\.com\/tour\?unidad=602/)
  })

  it('does not ask for the budget again when it is already known', () => {
    const result = continueUnitAlternative({
      catalogo: [apartment202, penthouse602],
      conversacion: { datos_conocidos: { presupuesto: 180000 } },
      historial: [{
        role: 'bot',
        content: 'Perfecto. En esta categoría tenemos el penthouse 602. ¿Le gustaría conocer esta opción?',
      }],
      referencia_unidad: { matches: [penthouse602], explicit: true },
    }, 'Quiero conocer el 602')

    assert.match(result?.reply ?? '', /comparemos esta opci.n con otra/i)
    assert.doesNotMatch(result?.reply ?? '', /presupuesto total|monto disponible inicialmente/i)
  })

  it('sends the recommended unit tour when the lead accepts the alternative in a full sentence', () => {
    const penthouse = penthouse602
    const current = 'Bueno, no necesito que sean habitaciones independientes. Entonces puede ser que el departamento 602 me convenga'
    const accepted = acceptedUnitAlternative({
      referencia_unidad: { matches: [penthouse] },
      historial: [{
        role: 'bot',
        content: 'Le recomendaría revisar el penthouse 602. ¿Necesita que los 4 sean dormitorios independientes o desea revisar la distribución de esta opción como alternativa?',
      }],
    }, current)
    assert.equal(accepted?.unit.id, penthouse.id)
    assert.match(accepted?.reply ?? '', /penthouse 602/)
    assert.doesNotMatch(accepted?.reply ?? '', /asesor/)

    const delivery = unitModelDelivery(
      { explicit: true, hasUnitMention: true, matches: [penthouse] },
      current,
      [],
    )
    const reply = appendUnitModel(accepted?.reply ?? '', delivery)
    assert.match(reply, /https:\/\/www\.lavilett\.com\/tour\?unidad=602/)
  })
})
