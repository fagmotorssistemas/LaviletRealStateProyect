import { hasAffordabilityConcern } from './financing'
import { object, text, type Row } from './data'
import { statedBudget } from './price-reply'
import { normalized } from './sdr-rules'

const rows = (value: unknown) => (Array.isArray(value) ? value : []).map(object)
const money = (value: number) => `USD ${value.toLocaleString('es-EC', { maximumFractionDigits: 2 })}`

function floorOrder(unit: Row) {
  const floor = normalized(text(unit.floor))
  if (/planta baja|piso bajo/.test(floor)) return 0
  const number = Number(unit.floor_number)
  return Number.isFinite(number) ? number : 99
}

function unitLabel(unit: Row) {
  return text(unit.unit_number).trim()
}

function floorLabel(unit: Row) {
  const floor = text(unit.floor).trim()
  if (floor) return floor.toLocaleLowerCase('es-EC')
  const number = Number(unit.floor_number)
  if (number === 0) return 'planta baja'
  if (number === 1) return 'primera planta alta'
  return number > 1 ? `planta ${number}` : ''
}

function hasApprovedSectorContext(info: Row) {
  const keys = new Set(rows(info.contexto_sector).map(fact => text(fact.fact_key)))
  return [
    'puertas_del_sol_posicionamiento',
    'puertas_del_sol_plazas_comerciales',
    'puertas_del_sol_servicios_cercanos',
  ].every(key => keys.has(key))
}

function availableCapital(info: Row): number | null {
  const semantics = object(info.semantica_turno), budget = object(semantics.budget)
  if (['down_payment', 'initial_capital'].includes(text(budget.subject)) && typeof budget.amount === 'number') return budget.amount
  const amount = rows(semantics.financing_amounts).find(value => value.role === 'down_payment' && typeof value.amount === 'number')
  return amount ? Number(amount.amount) : null
}

/**
 * A location priority plus limited initial capital is a comparison request, not
 * a request for the project's map. Build the answer only from approved sector
 * facts, the current published catalogue and enabled financing partners.
 */
export function commercialLocationBudgetRecommendation(info: Row, current: string): string {
  const lead = object(info.lead)
  const semantics = object(info.semantica_turno)
  const localContext = object(semantics.property).category === 'local' || lead.preferred_category === 'local'
  const locationPriority = rows(info.solicitudes_interpretadas || semantics.requests).some(request =>
    Array.isArray(request.topics) && request.topics.includes('location'))
  const initialCapital = availableCapital(info)
  const budget = initialCapital ?? statedBudget(current, info)
  if (!localContext || !locationPriority || budget === null || (!initialCapital && !hasAffordabilityConcern(current, info))) return ''
  if (!hasApprovedSectorContext(info)) return ''

  const policy = object(info.politica_comercial)
  if (policy.precios_autorizados !== true) return ''
  const locals = rows(info.catalogo).filter(unit => unit.category === 'local'
    && unit.is_published !== false && (!unit.status || unit.status === 'disponible')
    && Number(unit.published_commercial_price) > 0)
  if (!locals.length) return ''

  const byPrice = [...locals].sort((a, b) => Number(a.published_commercial_price) - Number(b.published_commercial_price)
    || unitLabel(a).localeCompare(unitLabel(b), 'es', { numeric: true }))
  const closest = byPrice.find(unit => Number(unit.published_commercial_price) >= budget) || byPrice.at(-1)!
  const ground = [...locals].sort((a, b) => floorOrder(a) - floorOrder(b)
    || unitLabel(a).localeCompare(unitLabel(b), 'es', { numeric: true }))[0]
  const known = object(object(info.conversacion).datos_conocidos)
  const business = text(known.actividad_comercial) ? `su ${text(known.actividad_comercial)}` : 'su negocio'
  const groundFloor = floorLabel(ground)
  const closestFloor = floorLabel(closest)
  const closestPrice = Number(closest.published_commercial_price)
  const difference = Math.max(0, closestPrice - budget)
  const partners = Array.isArray(object(info.financiamiento).partners)
    ? (object(info.financiamiento).partners as unknown[]).map(text).filter(Boolean) : []
  const approximate = policy.precios_aproximados === true

  const sector = `Puertas del Sol aporta un entorno atractivo para ${business}: combina una zona residencial consolidada con plazas comerciales, supermercados, bancos, cafeterías y otros servicios cercanos. Para ${business}, esta mezcla de vivienda y actividad comercial hace que la ubicación sea un punto importante para evaluar.`
  const comparison = ground.id !== closest.id
    ? `Dentro de La Vilet también podemos comparar la posición de cada local. El ${unitLabel(ground)} está en ${groundFloor || 'el nivel de acceso'} y conviene revisarlo si prioriza una mayor exposición dentro del edificio, mientras que el ${unitLabel(closest)}, ubicado en ${closestFloor || 'otro nivel del edificio'}, representa una inversión considerablemente menor.`
    : `Dentro de La Vilet también podemos revisar la posición de cada local. El ${unitLabel(closest)} está en ${closestFloor || 'el edificio'} y es la alternativa de menor inversión publicada en el catálogo actual.`
  const priceKind = approximate ? 'precio referencial vigente' : 'precio publicado'
  const budgetRole = initialCapital ? 'el capital que tiene disponible inicialmente' : 'su presupuesto disponible'
  const financing = difference > 0 && partners.length
    ? ` Quedaría una diferencia de ${money(difference)} que podemos ayudarle a evaluar mediante financiamiento con ${partners.join(' o ')}.`
    : difference > 0 ? ` Quedaría una diferencia de ${money(difference)}; podemos revisar con el equipo las alternativas de pago vigentes.` : ''
  const recommendation = `Tomando los ${money(budget)} como ${budgetRole}, la alternativa más cercana es el ${unitLabel(closest)}, con un ${priceKind} de ${money(closestPrice)}.${financing}`
  const close = `Mi recomendación sería revisar primero la distribución y ubicación exacta del ${unitLabel(closest)} para comprobar si funciona para ${business === 'un restaurante' ? 'su restaurante' : 'su negocio'}${difference > 0 ? ' y, al mismo tiempo, analizar la alternativa de financiamiento' : ''}. ¿Le gustaría que avancemos con esa opción?`
  return [sector, comparison, recommendation, close].join('\n\n')
}
