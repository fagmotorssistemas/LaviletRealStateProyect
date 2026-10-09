import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { unitTourUrl } from '@/lib/tour/unitModels'
import { appendUnitModel, unitModelDelivery, selectedUnitModelDelivery, unitModelRequestReply } from './unit-model'
import { replyLinkContract, replyLinkIssues } from './response-plan'
import { resolvePropertyTurn } from './property-context'
import { completeTurnReply } from './turn-completeness'
import { object, type Row } from './data'
import { acceptedUnitAlternative, continueUnitAlternative, unitAlternative } from './unit-alternatives'
import { showroomRequest } from './virtual-showroom'

describe('the selected unit tour survives final writing', () => {
  const unit = { id: 'unit-502', unit_number: '502', category: 'departamento', bedrooms: 3,
    floor_number: 5, is_published: true, status: 'disponible' }
  const current = 'detralleme el 502 por favor'
  const resolved = () => resolvePropertyTurn([unit], current, {}, [], {
    primary_intent: 'select_property', confidence: 'high', primary_evidence: current,
    property: { operation: 'select', category: 'departamento', reference_kind: 'explicit',
      unit_numbers: ['502'], evidence: current, confidence: 'high' },
  })
  const delivery = () => selectedUnitModelDelivery(resolved(), current, [])!
  const verified = () => ({ catalogo: [unit], property_context: resolved().context, historial: [] })

  it('requires the configured tour on first selection, including a route that resumes financing', () => {
    for (const source of ['catalog_select', 'property_unit_selected', 'financing']) {
      const tour = delivery()
      assert.equal(tour.url, unitTourUrl('502'))
      assert.match(tour.caption, /departamento 502/)
      const contract = replyLinkContract('', { source, unit_model: tour }, { current, verified: verified() })
      assert.deepEqual(contract.required_links, [tour.url])
      assert.deepEqual(replyLinkIssues('Le detallo el departamento elegido.', contract), ['required_link_omitted'])
      assert.deepEqual(replyLinkIssues(`Puede recorrerlo aquí: ${tour.url}`, contract), [])
    }
  })

  it('does not invent a selection for an ambiguous set, a details query or a commercial unit', () => {
    const ref = resolved()
    for (const change of [{ needsClarification: true }, { matches: [] }, { matches: [unit, { ...unit, id: 'other' }] },
      { query: { operation: 'details' } }, { matches: [{ ...unit, category: 'local' }] },
      { context: { selected_ids: [] } }]) {
      assert.equal(selectedUnitModelDelivery({ ...ref, ...change }, current, []), null)
    }
  })

  it('respects declined tours and previous delivery while allowing an explicit resend', () => {
    const tour = delivery(), audit = { source: 'catalog_select', selected_unit_ids: [unit.id], unit_model: tour }
    for (const message of ['Quiero el 502, no me envíe el recorrido', 'Quiero el 502 pero no quiero el tour 360']) {
      assert.equal(selectedUnitModelDelivery(resolved(), message, []), null)
      const contract = replyLinkContract('', audit, { current: message, verified: verified() })
      assert.ok(!contract.required_links.includes(tour.url))
      assert.ok(!contract.allowed_links.includes(tour.url))
    }
    for (const prior of [{ historial: [{ role: 'bot', content: tour.url }] },
      { historial: [], estado_conversacion: { unit_models_sent: [unit.id] } }]) {
      const info = { ...verified(), ...prior }
      const contract = replyLinkContract('', audit, { current, verified: info })
      assert.ok(!contract.required_links.includes(tour.url))
      assert.ok(!contract.allowed_links.includes(tour.url))
      const resend = replyLinkContract('', audit, { current: 'Envíeme otra vez el recorrido del 502', verified: info })
      assert.ok(resend.required_links.includes(tour.url))
      assert.ok(resend.allowed_links.includes(tour.url))
    }
    const clientQuote = replyLinkContract('', audit, { current, verified: { ...verified(), historial: [{ role: 'cliente', content: tour.url }] } })
    assert.ok(clientQuote.required_links.includes(tour.url), 'A client quoting a URL does not prove a prior bot delivery.')
  })

  it('passes the required URL to the final writer without adding an AI call', async () => {
    const tour = delivery(), calls: string[] = [], failures: string[] = []
    const reply = `Puede explorar el departamento en el recorrido virtual 360: ${tour.url}. Es una representación del proyecto.`
    const result = await completeTurnReply({ current, baseReply: reply,
      verified: { ...verified(), catalog_search: { embeddingsEnabled: true },
        solicitudes_interpretadas: [{ domain: 'property', confidence: 'high', request: 'Conocer el departamento 502', evidence: current }] },
      audit: { source: 'catalog_select', selected_unit_ids: [unit.id], unit_model: tour,
        semantic_review_enabled: true, business_risk_review_enabled: true } },
    async (_rules, data, _schema, _image, _file, _tone, task) => {
      const input = object(data); calls.push(task!)
      if (task === 'review') return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [],
        question: { role: 'none', purpose: 'none', missing_datum: '', next_decision: '', offered_action: 'none' } }
      try {
        assert.deepEqual(object(input.contrato_redaccion).enlaces_obligatorios, [tour.url])
        assert.equal(object(object(input.estado_operativo).unit_model).url, tour.url)
      } catch (error) { failures.push(String(error)) }
      return { reply, question: { role: 'none', purpose: 'none', missing_datum: '', next_decision: '' },
        requests: (input.referencias_solicitud as Row[]).map(ref => ({ fragment: ref.id, intent: 'Conocer el departamento', status: 'answered',
          evidence: reply, fact_key: null, request_type: 'general_information' })) }
    })
    assert.deepEqual(failures, [])
    assert.deepEqual(calls, ['writing', 'review'])
    assert.equal(result.audit.status, 'checked')
    assert.ok(result.reply.includes(tour.url))
  })
})

describe('virtual showroom context',()=>{
  it('interprets a correction without merging messages or inventing a new catalogue request',()=>{
    const previous={role:'cliente',content:'Entonces como puedo ver los edificios?'}
    const result=showroomRequest('Los departamentos perdon',[previous])
    assert.equal(result?.kind,'visual_correction')
    assert.equal(result?.current,'Los departamentos perdon')
    assert.equal(result?.context,previous.content)
    assert.equal(showroomRequest('Los departamentos perdon',[previous,{role:'bot',content:'Otra pregunta'}]),null)
    assert.equal(showroomRequest('Los departamentos perdon',[{role:'cliente',content:'¿Qué precio tienen?'}]),null)
    assert.equal(showroomRequest('No quiero ver los departamentos'),null)
  })
  it('offers a general representation for broad choices without choosing a unit',()=>{
    const reference={explicit:false,allowGeneralTour:true,matches:[{id:'a',unit_number:'801',category:'departamento'},{id:'b',unit_number:'802',category:'departamento'}]}
    const delivery=unitModelDelivery(reference,'Quiero ver el recorrido virtual',[])
    assert.equal(delivery?.unit_id,null)
    assert.equal(delivery?.url,unitTourUrl())
    assert.match(delivery?.caption||'',/representación del proyecto/)
    assert.equal(unitModelDelivery({...reference,hasUnitMention:true},'Quiero ver el recorrido virtual',[]),null)
  })
})

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
    assert.match(selected?.reply ?? '', /presupuesto total aproximado.*para la compra/i)
    assert.equal(selected?.reply.match(/¿/g)?.length, 1)
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

  it('clarifies an existing amount without asking for the amount again or offering other units', () => {
    const result = continueUnitAlternative({
      catalogo: [apartment202, penthouse602],
      hechos_confirmados: { budget: { status: 'amount', amount: 180000, confidence: 'high', evidence: 'Cuento con 180 mil dólares' } },
      historial: [{
        role: 'bot',
        content: 'Perfecto. En esta categoría tenemos el penthouse 602. ¿Le gustaría conocer esta opción?',
      }],
      referencia_unidad: { matches: [penthouse602], explicit: true },
    }, 'Quiero conocer el 602')

    assert.match(result?.reply ?? '', /monto corresponde.*presupuesto total.*entrada/i)
    assert.doesNotMatch(result?.reply ?? '', /comparemos.*otra/i)
    assert.doesNotMatch(result?.reply ?? '', /qué presupuesto aproximado|con qué monto/i)
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


describe('unit model reply preserves the catalogue category without choosing an option', () => {
  it('names penthouse, department, suite and commercial units accurately', () => {
    const labels = { penthouse: 'un penthouse', departamento: 'un departamento', suite: 'una suite', local: 'un local comercial' }
    for (const [category, label] of Object.entries(labels)) {
      const item = { id: 'unit-602', unit_number: '602', category, bedrooms: category === 'suite' ? 1 : 3, area_internal_m2: 142.09 }
      const reply = unitModelRequestReply([item], 'Me interesa el 602', true)
      assert.ok(reply.includes('unidad 602: es ' + label), category)
      assert.match(reply, /142,09 m² interiores/)
      assert.doesNotMatch(reply, /elegida|seleccionada|reservada|confirmad|cita/i)
      if (category === 'local') assert.doesNotMatch(reply, /dormitorio/i)
      else assert.match(reply, category === 'suite' ? /un dormitorio/ : /3 dormitorios/)
    }
  })

  it('does not invent a category, selection or choice from an ambiguous or compound request', () => {
    const penthouse = { id: 'unit-602', unit_number: '602', category: 'penthouse', bedrooms: 3 }
    assert.equal(unitModelRequestReply([], 'Me interesa el 602', true), '')
    assert.equal(unitModelRequestReply([penthouse, { ...penthouse, id: 'other', unit_number: '603' }], 'Me interesa el 602', true), '')
    assert.equal(unitModelRequestReply([penthouse], 'Me interesa el 602', false), '')
    assert.equal(unitModelRequestReply([penthouse], 'Me interesa el 602, pero quiero saber el precio', true), '')
    assert.equal(unitModelRequestReply([penthouse], 'Me interesa el 602 pero no quiero el recorrido', true), '')
    const unknown = unitModelRequestReply([{ ...penthouse, category: null }], 'Me interesa el 602', true)
    assert.match(unknown, /es una unidad/)
    assert.doesNotMatch(unknown, /penthouse|departamento|suite|local comercial|dormitorio/)
  })
})
