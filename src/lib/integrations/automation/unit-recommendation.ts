import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { appendUnitModel, unitModelDelivery } from './unit-model'

const words: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercer: 3, tercero: 3, tercera: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6 }
const count = (value: string) => words[value] ?? Number(value)

/** Offer one catalog-backed starting point without turning household size into a qualification fact. */
export function unitRecommendation(info: Row, current: string, summary: Row = {}) {
  const m = normalized(current)
  if (!/\b(?:me interesa|busco|quiero|quisiera|me gustaria)\b/.test(m)
    || /[¿?]|\bno\b|precio|cuanto|cuesta|valen|valor|financ|credito|cita|visita|alquil|arrend|rentar|plazo|entrega|descuento|incluye|ofrece|ubicacion|donde|vehiculo|vuelo|moto|carro|local/.test(m)
    // Unhandled physical/budget constraints belong to the full commercial flow.
    || /presupuesto|barat|economic|piscina|jardin|terraza|patio|balcon|parqueadero|garaje|ascensor|vista (?:al|hacia)|\b(?:cuatro|cinco|seis|[4-9])\s+(?:dormitorios?|habitaciones?|recamaras?)\b/.test(m)
    || /\b\d{3,4}\b/.test(m)) return null
  const residential = /\b(?:depart[ae]mentos?|deptos?|dptos?|apartamentos?)\b/.test(m)
  const suite = /\bsuites?\b/.test(m)
  if (residential === suite) return null
  const bedroomMatch = m.match(/\b(un|uno|una|dos|tres|[1-3])\s+(?:dormitorios?|habitaciones?|recamaras?)\b/)
  if (/\b(?:[1-3]|uno|dos|tres)\s+(?:o|a)\s+(?:[1-3]|uno|dos|tres)\s+(?:dormitorios?|habitaciones?)\b/.test(m)) return null
  const bedrooms = bedroomMatch ? count(bedroomMatch[1]) : null
  const highFloors = /\b(?:pisos?|plantas?)\s+alt[oa]s?\b|\bultim[oa]s?\s+(?:pisos?|plantas?)\b/.test(m)
  const floorMatch = m.match(/\b(?:piso|planta)\s+(\d{1,2}|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa])\b/)
    ?? m.match(/\b(\d{1,2}|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa])\s+(?:piso|planta)\b/)
  const floor = floorMatch ? count(floorMatch[1]) : null
  if (bedrooms === null && !highFloors && floor === null) return null
  const threePeople = /\b(?:para|somos)\s+(?:3|tres)\s+personas\b/.test(m)
  const catalog = (Array.isArray(info.catalogo) ? info.catalogo : []).map(object)
  const candidates = catalog.filter(unit => unit.category === (suite ? 'suite' : 'departamento')
    && unit.is_published !== false && (!unit.status || unit.status === 'disponible')
    && (bedrooms === null || Number(unit.bedrooms) === bedrooms)
    && (floor === null || Number(unit.floor_number) === floor)
    && (!highFloors || Number(unit.floor_number) >= 4))
  // Two bedrooms are merely a starting option for a three-person household, not a
  // claim about suitability or an update to the lead's preferred_bedrooms field.
  const unit = candidates.sort((a, b) => {
    if (threePeople && bedrooms === null) {
      const rank = (value: Row) => Number(value.bedrooms) === 2 ? 0 : Number(value.bedrooms) >= 3 ? 1 : 2
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
    }
    return Number(a.floor_number) - Number(b.floor_number) || text(a.unit_number).localeCompare(text(b.unit_number), 'es', { numeric: true })
  })[0]
  if (!unit) return null
  const label = `${unit.category === 'suite' ? 'la suite' : 'el departamento'} ${text(unit.unit_number)}`
  const unitFloor = text(unit.floor).trim() || (Number.isFinite(Number(unit.floor_number)) && unit.floor_number != null ? `piso ${unit.floor_number}` : '')
  const roomCount = Number(unit.bedrooms), area = Number(unit.area_internal_m2)
  const details = [roomCount > 0 ? `${roomCount === 1 ? 'un dormitorio' : `${roomCount} dormitorios`}` : '',
    area > 0 ? `${area.toLocaleString('es-EC', { maximumFractionDigits: 2 })} m² interiores` : ''].filter(Boolean)
  const reply = `Podemos empezar por ${label}${unitFloor ? `, en ${unitFloor.toLocaleLowerCase('es')}` : ''}.${details.length ? ` Tiene ${details.join(' y ')}.` : ''}`
  const model = unitModelDelivery({ explicit: true, matches: [unit] }, current, info.historial, summary._unit_models_sent)
  return { reply: appendUnitModel(reply, model), audit: { source: 'unit_recommendation', fallback: false,
    unit_reference: { ids: [unit.id], numbers: [unit.unit_number] }, ...(model ? { unit_model: model } : {}) } }
}
