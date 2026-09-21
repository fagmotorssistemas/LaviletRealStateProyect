import { unitTourUrl } from '@/lib/tour/unitModels'
import { object, text, type Row } from './data'
import { statedBudget } from './price-reply'
import { normalized } from './sdr-rules'

type PropertyCategory = 'suite' | 'departamento' | 'local'

const rows = (value: unknown) => (Array.isArray(value) ? value : []).map(object)
const categoryLabels: Record<PropertyCategory, { singular: string; plural: string }> = {
  suite: { singular: 'suite', plural: 'suites' },
  departamento: { singular: 'departamento', plural: 'departamentos' },
  local: { singular: 'local comercial', plural: 'locales comerciales' },
}
const numberWords: Record<string, number> = {
  baja: 0, cero: 0, primera: 1, primero: 1, uno: 1, segunda: 2, segundo: 2, dos: 2,
  tercera: 3, tercero: 3, tres: 3, cuarta: 4, cuarto: 4, cuatro: 4,
  quinta: 5, quinto: 5, cinco: 5, sexta: 6, sexto: 6, seis: 6,
  septima: 7, septimo: 7, siete: 7, octava: 8, octavo: 8, ocho: 8,
}

function availableCatalog(info: Row, category?: PropertyCategory) {
  return rows(info.catalogo).filter(unit => (!category || unit.category === category)
    && unit.is_published !== false && (!unit.status || unit.status === 'disponible'))
}

function categoryFrom(value: unknown): PropertyCategory | null {
  const category = text(value)
  return ['suite', 'departamento', 'local'].includes(category) ? category as PropertyCategory : null
}

function mentionedCategory(current: string): PropertyCategory | null {
  const message = normalized(current)
  if (/\blocal(?:es)?(?: comerciales?)?\b/.test(message)) return 'local'
  if (/\bsuites?\b/.test(message)) return 'suite'
  if (/\bdepart(?:a|e)?mentos?\b|\bdeptos?\b/.test(message)) return 'departamento'
  return null
}

function currentCategory(info: Row, current: string) {
  return mentionedCategory(current) || categoryFrom(object(info.lead).preferred_category)
}

function money(value: unknown) {
  return `USD ${Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 })}`
}

function priceRange(units: Row[]) {
  const prices = units.map(unit => Number(unit.published_commercial_price)).filter(value => value > 0)
  if (!prices.length) return ''
  const minimum = Math.min(...prices), maximum = Math.max(...prices)
  return minimum === maximum ? money(minimum) : `${money(minimum)} a ${money(maximum)}`
}

function categoryWasChosen(current: string) {
  const message = normalized(current)
  if (!mentionedCategory(current) || /[?¿]/.test(current)) return false
  if (/\b(?:precio|valor|cuesta|financ|credito|presupuesto|planta|piso|dormitorio|habitacion|metros|m2|visita|cita)\b/.test(message)) return false
  return /\b(?:prefiero|me interesa|me conviene|elijo|escojo|me quedo con|quiero (?:una?|el)|quisiera (?:una?|el))\b/.test(message)
    || /^(?:una? |el )?(?:suite|departamento|local(?: comercial)?)$/.test(message)
}

function simpleLivingPurpose(current: string) {
  const message = normalized(current)
  if (mentionedCategory(current) || /[?¿]/.test(current)) return false
  return /^(?:(?:yo )?(?:quiero|quisiera|busco|necesito) (?:algo|una vivienda|un lugar|una opcion) )?para vivir(?: (?:ahi|alli|en la vilet))?$/.test(message)
    || /^(?:quiero|quisiera|busco|necesito) (?:algo|una vivienda|un lugar) para vivir(?: con mi familia)?$/.test(message)
}

function budgetUncertain(current: string) {
  const message = normalized(current)
  return /\bno (?:se|estoy segur[oa]|tengo claro|tengo idea|he pensado)\b/.test(message)
    && /\b(?:presupuesto|cuanto|dinero|invertir|gastar|pagar)\b/.test(message)
}

function historyRows(info: Row) {
  return rows(info.historial)
}

function lastOutbound(info: Row) {
  return text(object(info.conversacion).ultima_respuesta)
    || text(historyRows(info).filter(row => ['bot', 'asesor'].includes(text(row.role))).at(-1)?.content)
}

function budgetFromInfo(info: Row, current = '') {
  const direct = statedBudget(current)
  if (direct !== null) return direct
  const lead = object(info.lead)
  for (const value of [lead.budget_max, lead.budget]) {
    const amount = Number(value)
    if (Number.isFinite(amount) && amount > 0) return amount
  }
  const signal = text(object(object(lead.behavior_signals).sdr).presupuesto_texto)
  const signaled = statedBudget(signal)
  if (signaled !== null) return signaled
  for (const row of historyRows(info).filter(row => row.role === 'cliente').reverse()) {
    const amount = statedBudget(text(row.content))
    if (amount !== null) return amount
  }
  return null
}

function budgetWasDeferred(info: Row, current = '') {
  if (budgetUncertain(current)) return true
  const history = historyRows(info)
  let lastBot = ''
  for (const row of history) {
    if (['bot', 'asesor'].includes(text(row.role))) lastBot = normalized(text(row.content))
    else if (row.role === 'cliente' && /presupuesto|cuanto.*invertir/.test(lastBot) && budgetUncertain(text(row.content))) return true
  }
  return false
}

function floorNumber(current: string, allowBareAnswer: boolean) {
  const message = normalized(current)
  const numeric = message.match(/\b(?:planta|piso|nivel)\s*(?:numero\s*)?(\d{1,2})\b/)
  if (numeric) return Number(numeric[1])
  if (/\bplanta baja\b|\bpiso bajo\b/.test(message)) return 0
  for (const [word, number] of Object.entries(numberWords)) {
    if (new RegExp(`\\b${word}(?:\\s+(?:planta|piso|nivel))?\\b`).test(message)
      && (allowBareAnswer || /planta|piso|nivel/.test(message))) return number
  }
  return null
}

function floorLabel(unit: Row) {
  const configured = text(unit.floor).trim()
  if (configured) return configured
  const floor = Number(unit.floor_number)
  return floor === 0 ? 'Planta Baja' : Number.isFinite(floor) ? `Planta ${floor}` : 'Planta por definir'
}

function floorOptions(units: Row[], pricesAllowed: boolean) {
  const groups = new Map<number, Row[]>()
  for (const unit of units) {
    const floor = Number(unit.floor_number)
    if (!Number.isFinite(floor)) continue
    groups.set(floor, [...(groups.get(floor) || []), unit])
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, floorUnits]) => {
    const range = pricesAllowed ? priceRange(floorUnits) : ''
    return `${floorLabel(floorUnits[0])}${range ? ` (${range})` : ''}`
  })
}

function explicitUnitSelection(info: Row, current: string) {
  const reference = object(info.referencia_unidad)
  const matches = rows(reference.matches)
  if (matches.length !== 1 || reference.explicit !== true) return null
  const message = normalized(current)
  if (!/\b(?:me interesa|prefiero|elijo|escojo|me quedo con|quiero (?:revisar|conocer|esa?|la|el)|quisiera (?:revisar|conocer|esa?|la|el))\b/.test(message)) return null
  return matches[0]
}

function purposeReply(info: Row) {
  const catalog = availableCatalog(info)
  const bedrooms = [...new Set(catalog.filter(unit => unit.category === 'departamento')
    .map(unit => Number(unit.bedrooms)).filter(value => value > 0))].sort((a, b) => a - b)
  const departments = bedrooms.length
    ? `departamentos de ${bedrooms.join(' o ')} dormitorios`
    : 'departamentos en distintas plantas del edificio'
  const suites = catalog.some(unit => unit.category === 'suite') ? ' También contamos con suites de un dormitorio.' : ''
  return `Para vivir en La Vilet, disponemos de ${departments}.${suites} ¿Le interesaría más revisar las suites o los departamentos?`
}

function categoryReply(info: Row, current: string, category: PropertyCategory) {
  const label = categoryLabels[category]
  if (category === 'suite') {
    const fit = /\b(?:vivo solo|vivo sola|para mi solo|para mi sola)\b/.test(normalized(current))
      ? 'Una suite puede adaptarse muy bien a lo que busca.'
      : 'Perfecto, podemos concentrarnos en las suites.'
    return `${fit} Tenemos opciones en distintas plantas, con diferencias de ubicación y valor. ¿Podría compartirnos un presupuesto aproximado para orientarle hacia las alternativas más convenientes?`
  }
  if (category === 'departamento') {
    const bedrooms = [...new Set(availableCatalog(info, category).map(unit => Number(unit.bedrooms)).filter(value => value > 0))].sort((a, b) => a - b)
    return `Perfecto. Disponemos de ${label.plural}${bedrooms.length ? ` de ${bedrooms.join(' o ')} dormitorios` : ''} en distintas plantas. ¿Podría compartirnos un presupuesto aproximado para orientarle hacia las opciones más convenientes?`
  }
  return `Perfecto. Contamos con ${label.plural} en diferentes ubicaciones dentro del edificio, con variaciones de planta, exposición y valor. ¿Podría compartirnos un presupuesto aproximado para orientar mejor la búsqueda?`
}

function uncertainBudgetReply(info: Row, category: PropertyCategory) {
  const units = availableCatalog(info, category)
  const pricesAllowed = object(info.politica_comercial).precios_autorizados === true
  const floors = floorOptions(units, pricesAllowed)
  const label = categoryLabels[category]
  const options = floors.length ? ` Estas son las plantas disponibles: ${floors.join('; ')}.` : ''
  const question = category === 'local'
    ? '¿Qué ubicación dentro del edificio le interesaría revisar primero?'
    : `¿En cuál de estas plantas le gustaría tener su ${label.singular}?`
  return `No se preocupe. Primero podemos encontrar ${category === 'local' ? 'el local' : `la opción de ${label.singular}`} que mejor se adapte a usted y después evaluar si necesita financiamiento.${options} ${question}`
}

function compareFloorsReply(info: Row, category: PropertyCategory) {
  const pricesAllowed = object(info.politica_comercial).precios_autorizados === true
  const floors = floorOptions(availableCatalog(info, category), pricesAllowed)
  const label = categoryLabels[category]
  if (!floors.length) return ''
  const question = category === 'local'
    ? '¿Qué ubicación dentro del edificio le gustaría revisar primero?'
    : `¿En cuál de estas plantas le gustaría revisar ${category === 'suite' ? 'una' : 'un'} ${label.singular}?`
  return `Perfecto. Podemos comparar las opciones disponibles por planta y valor: ${floors.join('; ')}. ${question}`
}

function floorReply(info: Row, category: PropertyCategory, floor: number) {
  const pricesAllowed = object(info.politica_comercial).precios_autorizados === true
  const units = availableCatalog(info, category).filter(unit => Number(unit.floor_number) === floor)
    .sort((a, b) => Number(a.published_commercial_price || Infinity) - Number(b.published_commercial_price || Infinity)
      || text(a.unit_number).localeCompare(text(b.unit_number), 'es', { numeric: true }))
  if (!units.length) return ''
  const options = units.slice(0, 6).map(unit => {
    const price = pricesAllowed && Number(unit.published_commercial_price) > 0 ? `, ${money(unit.published_commercial_price)}` : ''
    return `${categoryLabels[category].singular} ${text(unit.unit_number)}${price}`
  })
  return `En ${floorLabel(units[0])} tenemos estas opciones: ${options.join('; ')}. ¿Cuál le gustaría revisar?`
}

function selectedUnitReply(info: Row, unit: Row, current: string) {
  const category = categoryFrom(unit.category) || 'departamento'
  const label = categoryLabels[category].singular
  const location = floorLabel(unit)
  const pricesAllowed = object(info.politica_comercial).precios_autorizados === true
  const price = pricesAllowed && Number(unit.published_commercial_price) > 0 ? Number(unit.published_commercial_price) : null
  const approximate = object(info.politica_comercial).precios_aproximados === true
  const budget = budgetFromInfo(info, current)
  const deferred = budgetWasDeferred(info, current)
  let reply = `Perfecto. ${category === 'suite' ? 'La' : 'El'} ${label} ${text(unit.unit_number)} está ${location ? `en ${location}` : 'disponible'}`
  if (price) reply += ` y su valor${approximate ? ' referencial de lanzamiento' : ''} es de ${money(price)}.`
  else reply += '.'
  if (category !== 'local' && /^\d{3,4}$/.test(text(unit.unit_number))) {
    reply += ` Puede explorar${category === 'suite' ? 'la' : 'lo'} en el recorrido virtual: ${unitTourUrl(text(unit.unit_number))}`
  }
  if (!price) return reply
  if (budget !== null && budget < price) {
    reply += ` Considerando los ${money(budget)} que tiene disponibles, quedaría una diferencia de ${money(price - budget)}. Si esta es la unidad que desea considerar, podemos revisar alternativas de financiamiento para esa diferencia. ¿Le gustaría avanzar con esa revisión?`
  } else if (budget !== null) {
    reply += ` Esta opción se encuentra dentro del presupuesto que indicó. ¿Le gustaría continuar con esta unidad o compararla con otra?`
  } else if (deferred) {
    reply += ' Como todavía está definiendo su presupuesto, podemos revisar alternativas de financiamiento sobre esta unidad cuando lo desee. ¿Le gustaría evaluar esa posibilidad?'
  } else {
    reply += ' ¿Con qué presupuesto aproximado cuenta para evaluar esta opción y determinar si necesitaría financiamiento?'
  }
  return reply
}

export function propertySelectionReply(info: Row, current: string): { reply: string; audit: Row } | null {
  const selected = explicitUnitSelection(info, current)
  if (selected) return { reply: selectedUnitReply(info, selected, current), audit: {
    source: 'property_unit_selected', unit_reference: { ids: [selected.id], numbers: [selected.unit_number] }, fallback: false,
  } }

  const category = currentCategory(info, current)
  const previous = normalized(lastOutbound(info))
  const genericUncertainty = /^(?:no (?:se|estoy segur[oa]|tengo claro|tengo idea)|todavia no lo se)$/.test(normalized(current))
  const positiveAnswer = /^(?:si|si por favor|claro|de acuerdo|esta bien|perfecto|por favor)$/.test(normalized(current))
  if (category && positiveAnswer && /comparemos las opciones por planta y valor/.test(previous)) {
    const reply = compareFloorsReply(info, category)
    if (reply) return { reply, audit: { source: 'property_floor_comparison', fallback: false } }
  }
  const floor = category ? floorNumber(current, /planta|piso|nivel/.test(previous)) : null
  if (category && floor !== null && (/planta|piso|nivel/.test(normalized(current)) || /planta|piso|nivel/.test(previous))) {
    const reply = floorReply(info, category, floor)
    if (reply) return { reply, audit: { source: 'property_floor_options', selected_floor: floor, fallback: false } }
  }

  if (category && (budgetUncertain(current) || genericUncertainty && /presupuesto|cuanto.*invertir/.test(previous))) {
    return { reply: uncertainBudgetReply(info, category), audit: { source: 'property_budget_deferred', fallback: false } }
  }

  if (!category && genericUncertainty && /suites|departamentos|locales comerciales/.test(previous)) {
    return { reply: 'Está bien, puede decidirlo con calma. Podemos continuar cuando tenga una preferencia o si desea comparar las diferencias entre las opciones.', audit: { source: 'property_category_deferred', fallback: false } }
  }

  if (!category && (budgetUncertain(current) || genericUncertainty && /presupuesto|cuanto.*invertir/.test(previous))) {
    return { reply: 'No se preocupe. Primero podemos identificar qué tipo de propiedad se adapta mejor a lo que busca y después revisar el presupuesto. ¿Le interesan las suites, los departamentos o los locales comerciales?', audit: { source: 'property_budget_deferred', fallback: false } }
  }

  if (category && categoryWasChosen(current)) {
    return { reply: categoryReply(info, current, category), audit: { source: 'property_category_selected', category, fallback: false } }
  }

  if (simpleLivingPurpose(current)) {
    return { reply: purposeReply(info), audit: { source: 'property_living_options', fallback: false } }
  }
  return null
}

export function financingPrerequisiteReply(info: Row, current: string) {
  const financing = object(info.financiamiento)
  const currentFinancing = object(financing.current)
  const previous = normalized(lastOutbound(info))
  const continuingExistingReview = Object.keys(currentFinancing).length > 0
    || /[?¿]/.test(lastOutbound(info)) && /financ|credito|revision|banco|cooperativa|pichincha|jep|jardin azuayo/.test(previous)
  if (currentFinancing.explicit_consent === true || continuingExistingReview) return ''
  const catalog = availableCatalog(info)
  const reference = rows(object(info.referencia_unidad).matches)
  const savedUnitId = text(object(info.lead).unit_id)
  const unit = reference.length === 1 ? reference[0] : catalog.find(candidate => text(candidate.id) === savedUnitId)
  const category = currentCategory(info, current)
  const budget = budgetFromInfo(info, current)
  const deferred = budgetWasDeferred(info, current)
  if (!unit) {
    if (!category) return 'Podemos ayudarle a revisar alternativas de financiamiento. Primero necesitamos identificar la propiedad sobre la que desea realizar la evaluación. ¿Está buscando una suite, un departamento o un local comercial?'
    if (budget === null && !deferred) return `Podemos ayudarle con el financiamiento. Primero definamos qué ${categoryLabels[category].singular} desea evaluar. ¿Con qué presupuesto aproximado cuenta para orientar la selección?`
    return `Podemos ayudarle con el financiamiento. Primero necesitamos elegir la ${category === 'suite' ? 'suite' : category === 'departamento' ? 'unidad' : 'opción'} concreta sobre la que se realizará la evaluación. ¿En qué planta le gustaría buscar?`
  }
  if (budget === null && !deferred) return `Ya tenemos identificad${unit.category === 'suite' ? 'a' : 'o'} ${unit.category === 'suite' ? 'la suite' : unit.category === 'local' ? 'el local' : 'el departamento'} ${text(unit.unit_number)}. Antes de iniciar la revisión financiera, ¿con qué presupuesto o capital aproximado cuenta?`
  return ''
}
