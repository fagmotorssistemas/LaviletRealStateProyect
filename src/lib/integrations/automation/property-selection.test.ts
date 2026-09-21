import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { budgetOptionsReply, priceReplyIssues, statedBudget } from './price-reply'
import { financingPrerequisiteReply, propertySelectionReply } from './property-selection'
import { resolveCatalogReference } from './catalog-reference'

const suite001 = { id: 'suite-001', category: 'suite', unit_number: '001', floor: 'Planta Baja', floor_number: 0, bedrooms: 1, published_commercial_price: 210000 }
const suite210 = { id: 'suite-210', category: 'suite', unit_number: '210', floor: 'Segunda Planta Alta', floor_number: 2, bedrooms: 1, published_commercial_price: 250000 }
const apartment202 = { id: 'apartment-202', category: 'departamento', unit_number: '202', floor: 'Segunda Planta Alta', floor_number: 2, bedrooms: 3, published_commercial_price: 300000 }
const apartment301 = { id: 'apartment-301', category: 'departamento', unit_number: '301', floor: 'Tercera Planta Alta', floor_number: 3, bedrooms: 2, published_commercial_price: 280000 }
const local01 = { id: 'local-01', category: 'local', unit_number: 'LC-01', floor: 'Planta Baja', floor_number: 0, published_commercial_price: 535000 }

const baseInfo = (overrides: Record<string, unknown> = {}) => ({
  lead: {},
  historial: [],
  catalogo: [suite001, suite210, apartment202, apartment301, local01],
  politica_comercial: { precios_autorizados: true, precios_aproximados: true },
  financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {} },
  referencia_unidad: { explicit: false, matches: [] },
  modo_comercial: 'lanzamiento',
  ...overrides,
})

describe('property selection journey', () => {
  it('uses disponemos when presenting residential options', () => {
    const result = propertySelectionReply(baseInfo(), 'Quiero algo para vivir')

    assert.match(result?.reply || '', /^Para vivir en La Vilet, disponemos de/i)
    assert.doesNotMatch(result?.reply || '', /La Vilet, dispone de/i)
    assert.match(result?.reply || '', /suites o los departamentos/i)
  })

  it('asks for a budget after a category choice without disclosing prices', () => {
    const result = propertySelectionReply(baseInfo({ lead: { preferred_category: 'suite', purchase_purpose: 'vivir' } }), 'Prefiero una suite, vivo solo y es mejor para mí')

    assert.match(result?.reply || '', /puede adaptarse muy bien/i)
    assert.match(result?.reply || '', /presupuesto aproximado/i)
    assert.doesNotMatch(result?.reply || '', /210\.000|310\.000|USD|\$/)
  })

  it('uses real floors and ranges when the lead cannot define a budget', () => {
    const info = baseInfo({
      lead: { preferred_category: 'suite', purchase_purpose: 'vivir' },
      historial: [{ role: 'bot', content: '¿Podría compartirnos un presupuesto aproximado?' }],
    })
    const result = propertySelectionReply(info, 'No estoy seguro de mi presupuesto')

    assert.match(result?.reply || '', /primero podemos encontrar/i)
    assert.match(result?.reply || '', /Planta Baja \(USD 210\.000\)/i)
    assert.match(result?.reply || '', /Segunda Planta Alta \(USD 250\.000\)/i)
    assert.match(result?.reply || '', /después evaluar si necesita financiamiento/i)
  })

  it('lists the units on the floor selected by the lead', () => {
    const info = baseInfo({
      lead: { preferred_category: 'suite' },
      historial: [{ role: 'bot', content: '¿En cuál de estas plantas le gustaría tener su suite?' }],
    })
    const result = propertySelectionReply(info, 'En la segunda planta')

    assert.match(result?.reply || '', /suite 210, USD 250\.000/i)
    assert.match(result?.reply || '', /Cuál le gustaría revisar/i)
  })

  it('continues an insufficient-budget comparison with real floor ranges', () => {
    const info = baseInfo({
      lead: { preferred_category: 'suite' },
      historial: [{ role: 'bot', content: '¿Prefiere que comparemos las opciones por planta y valor?' }],
    })
    const result = propertySelectionReply(info, 'Sí, por favor')

    assert.match(result?.reply || '', /comparar las opciones disponibles por planta y valor/i)
    assert.match(result?.reply || '', /Planta Baja \(USD 210\.000\)/i)
    assert.match(result?.reply || '', /Segunda Planta Alta \(USD 250\.000\)/i)
  })

  it('shows the chosen unit, its tour and the gap against the known budget', () => {
    const reference = resolveCatalogReference([suite001, suite210], 'Me interesa la 210')
    assert.equal(reference.matches[0]?.id, suite210.id)
    const info = baseInfo({
      lead: { preferred_category: 'suite', behavior_signals: { sdr: { presupuesto_texto: 'Tengo un presupuesto de 100 mil dólares' } } },
      referencia_unidad: reference,
    })
    const result = propertySelectionReply(info, 'Me interesa la 210')

    assert.match(result?.reply || '', /suite 210/i)
    assert.match(result?.reply || '', /tour\?unidad=210/i)
    assert.match(result?.reply || '', /diferencia de USD 150\.000/i)
    assert.match(result?.reply || '', /avanzar con esa revisión/i)
  })

  it('does not start financing until a unit and budget status are known', () => {
    const withoutUnit = financingPrerequisiteReply(baseInfo({ lead: { preferred_category: 'suite' } }), 'Quiero financiamiento')
    assert.match(withoutUnit, /primero definamos qué suite/i)
    assert.match(withoutUnit, /presupuesto aproximado/i)

    const withoutBudget = financingPrerequisiteReply(baseInfo({ lead: { preferred_category: 'suite', unit_id: suite210.id } }), 'Quiero financiamiento')
    assert.match(withoutBudget, /suite 210/i)
    assert.match(withoutBudget, /presupuesto o capital aproximado/i)

    const ready = financingPrerequisiteReply(baseInfo({ lead: {
      preferred_category: 'suite', unit_id: suite210.id,
      behavior_signals: { sdr: { presupuesto_texto: 'Tengo 100 mil dólares' } },
    } }), 'Sí, quiero iniciar la revisión')
    assert.equal(ready, '')
  })
})

describe('budget and price timing', () => {
  it('parses a natural approximate budget and recommends before financing', () => {
    assert.equal(statedBudget('Tengo un presupuesto aproximado de 100 mil dólares'), 100000)
    const reply = budgetOptionsReply(baseInfo({ lead: { preferred_category: 'suite' } }), 'Tengo un presupuesto aproximado de 100 mil dólares')

    assert.match(reply, /no alcanza para cubrir el valor total/i)
    assert.match(reply, /primero conviene identificar la unidad/i)
    assert.match(reply, /por planta y valor/i)
  })

  it('rejects unsolicited prices in a generated category-choice reply', () => {
    const issues = priceReplyIssues('Las opciones tienen un valor referencial de lanzamiento desde $210.000.', baseInfo({ lead: { preferred_category: 'suite' } }), 'Prefiero una suite')
    assert.deepEqual(issues, ['style'])
  })
})
