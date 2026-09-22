import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { unitTourUrl } from '@/lib/tour/unitModels'
import { preferredPropertyCategory } from './property-selection'

export const UNIT_ALTERNATIVE_RULES = `
ALTERNATIVAS DE INMUEBLES, EN TODOS LOS TONOS Y FLUJOS:
Si el catálogo verificado no ofrece la cantidad de dormitorios solicitada, explique brevemente la limitación y pida permiso para comparar los departamentos más amplios y los penthouses. No elija todavía una unidad ni suponga que el cliente acepta menos dormitorios, un penthouse o un precio mayor. Cuando acepte comparar, explique ambas categorías con datos reales y pregunte cuál desea revisar primero.
Después de que el cliente elija una categoría, avance con un solo dato útil pendiente. Para departamentos amplios, pregunte la planta entre las que realmente tienen opciones; después enumere las unidades verificadas de esa planta y pregunte cuál le gustaría conocer. Una categoría mencionada para rechazarla o explicar una objeción no es la categoría elegida. Interprete "el más grande" o "el primero" sobre las últimas opciones que realmente se presentaron, no sobre una preferencia antigua. Si elige una unidad o pide su recorrido, comparta el enlace correspondiente; que quede una sola opción no significa que ya la haya elegido. No repita dormitorios, propósito, categoría, planta ni presupuesto ya conocidos.
Para requisitos distintos de dormitorios, recomiende una alternativa concreta publicada y disponible solo cuando la comparación sea inequívoca, justificándola con datos reales de área interior, dormitorios, planta o espacios. Considere conjuntamente las necesidades y el presupuesto conocidos; si una alternativa supera el presupuesto, indique la diferencia solo cuando los precios estén autorizados y no asuma flexibilidad. Si no conoce el precio, no afirme que se ajusta al presupuesto.
Una característica no documentada es desconocida, no prueba de que no exista. No invente estudios, habitaciones convertibles, vistas ni comodidad equivalente. No convierta balcones en área interior. Si el requisito es indispensable o ya rechazó esa alternativa, reconozca que no hay coincidencia y no insista. Recomendar tres dormitorios no cambia la preferencia declarada de cinco ni significa que el cliente aceptó el cambio.
Ofrezca revisar la distribución solo cuando sea pertinente; no envíe automáticamente un recorrido ni cambie a otra unidad si pidió una cita para una unidad concreta. Mantenga el agendamiento, la pregunta de financiamiento y las demás solicitudes activas. Esta regla aplica cuando se consultan alternativas, no obliga a añadir ofertas en cada turno, recordatorio o plantilla aprobada. El estilo adapta la redacción, nunca estos hechos y restricciones.
`

type AlternativeJourney = {
  reply: string
  phase: 'compare_categories' | 'choose_category' | 'choose_floor' | 'choose_unit' | 'review_unit'
  unit?: Row | null
  units?: Row[]
  offered_unit_ids?: string[]
  selected_unit_ids?: string[]
}

const residentialUnits = (info: Row) => (Array.isArray(info.catalogo) ? info.catalogo : [])
  .map(object)
  .filter(unit => ['departamento', 'penthouse'].includes(text(unit.category))
    && unit.is_published !== false && (!unit.status || unit.status === 'disponible'))

const lastBotReply = (info: Row) => {
  const history = (Array.isArray(info.historial) ? info.historial : []).map(object)
  return text([...history].reverse().find(row => ['bot', 'asesor'].includes(text(row.role)))?.content)
}

const number = (value: unknown) => Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 })

const unitLabel = (unit: Row) => `${unit.category === 'penthouse' ? 'el penthouse' : 'el departamento'} ${text(unit.unit_number)}`

const unitDetails = (unit: Row) => [
  Number(unit.bedrooms) > 0 ? `${Number(unit.bedrooms)} dormitorios` : '',
  Number(unit.area_internal_m2) > 0 ? `${number(unit.area_internal_m2)} m² interiores` : '',
  text(unit.floor).trim(),
].filter(Boolean).join(', ')

const nextUnitQuestion = (info: Row) => {
  const known = object(object(info.conversacion).datos_conocidos)
  const deferred = object(info.memoria_comercial).deferred_fields
  const budgetDeferred = Array.isArray(deferred) && deferred.includes('presupuesto')
  if (known.presupuesto || text(known.presupuesto_texto).trim() || budgetDeferred) {
    return '¿Desea que comparemos esta opción con otra de la misma categoría?'
  }
  return 'Para afinar la recomendación, ¿tiene un presupuesto total aproximado o un monto disponible inicialmente para la entrada?'
}

const positiveAnswer = (message: string) => /^(?:si|si por favor|si esta bien|si me parece bien|claro|de acuerdo|esta bien|me parece bien|perfecto|bueno|a ver|revisemos|veamos)(?: gracias)?$/.test(message)

const wantsComparison = (message: string) => /\b(?:diferencia|comparar|comparacion|ambas|ambos|cual conviene|que cambia)\b/.test(message)

const floorNumber = (message: string) => {
  const words: Record<string, number> = { primera: 1, primer: 1, segunda: 2, segundo: 2, tercera: 3, tercer: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5, sexta: 6, sexto: 6 }
  const explicit = message.match(/\b(?:piso|planta)\s+(\d{1,2}|primera|primer|segunda|segundo|tercera|tercer|cuarta|cuarto|quinta|quinto|sexta|sexto)\b/)
    || message.match(/\b(primera|primer|segunda|segundo|tercera|tercer|cuarta|cuarto|quinta|quinto|sexta|sexto)\s+(?:piso|planta)\b/)
  if (explicit) return words[explicit[1]] || Number(explicit[1])
  const standalone = message.match(/^(?:la |el )?(\d{1,2}|primera|primer|segunda|segundo|tercera|tercer|cuarta|cuarto|quinta|quinto|sexta|sexto)(?: planta| piso)?$/)
  return standalone ? words[standalone[1]] || Number(standalone[1]) : null
}

function compareResidentialCategories(catalog: Row[]): AlternativeJourney | null {
  const apartments = catalog.filter(unit => unit.category === 'departamento')
  const penthouses = catalog.filter(unit => unit.category === 'penthouse')
  if (!apartments.length && !penthouses.length) return null
  const apartmentRooms = Math.max(0, ...apartments.map(unit => Number(unit.bedrooms) || 0))
  const apartmentAreas = apartments.map(unit => Number(unit.area_internal_m2)).filter(value => value > 0)
  const penthouseAreas = penthouses.map(unit => Number(unit.area_internal_m2)).filter(value => value > 0)
  const apartmentSummary = apartments.length
    ? `Contamos con departamentos${apartmentRooms ? ` de hasta ${apartmentRooms} dormitorios` : ''}${apartmentAreas.length ? `, con opciones de hasta ${number(Math.max(...apartmentAreas))} m² interiores` : ''}.`
    : ''
  const penthouseSummary = penthouses.length
    ? `También tenemos penthouses${penthouseAreas.length ? `, entre ellos opciones de hasta ${number(Math.max(...penthouseAreas))} m² interiores` : ''}${penthouseAreas.length && (!apartmentAreas.length || Math.max(...penthouseAreas) >= Math.max(...apartmentAreas)) ? '; allí se encuentra la mayor superficie residencial del catálogo actual' : ''}.`
    : ''
  const categories = apartments.length && penthouses.length
    ? '¿Desea revisar primero los departamentos o los penthouses?'
    : apartments.length ? '¿Desea que revisemos los departamentos disponibles?' : '¿Desea que revisemos los penthouses disponibles?'
  return { reply: [apartmentSummary, penthouseSummary, categories].filter(Boolean).join(' '), phase: 'choose_category' }
}

function apartmentFloorReply(catalog: Row[]): AlternativeJourney | null {
  const apartments = catalog.filter(unit => unit.category === 'departamento')
  if (!apartments.length) return null
  const maxBedrooms = Math.max(0, ...apartments.map(unit => Number(unit.bedrooms) || 0))
  const spacious = maxBedrooms ? apartments.filter(unit => Number(unit.bedrooms) === maxBedrooms) : apartments
  const floors = [...new Map([...spacious]
    .sort((a, b) => Number(a.floor_number) - Number(b.floor_number))
    .map(unit => [Number(unit.floor_number), text(unit.floor).trim() || `planta ${Number(unit.floor_number)}`])).values()]
  if (!floors.length) return null
  return {
    reply: `Perfecto. Revisemos los departamentos más amplios: ${maxBedrooms ? `tienen ${maxBedrooms} dormitorios y ` : ''}hay opciones en ${floors.join(', ')}. ¿Qué planta prefiere?`,
    phase: 'choose_floor',
  }
}

function categoryUnitsReply(catalog: Row[], category: 'departamento' | 'penthouse'): AlternativeJourney | null {
  const candidates = catalog.filter(unit => unit.category === category)
    .sort((a, b) => Number(b.area_internal_m2) - Number(a.area_internal_m2) || text(a.unit_number).localeCompare(text(b.unit_number)))
  if (!candidates.length) return null
  if (candidates.length === 1) {
    const unit = candidates[0]
    return {
      reply: `Perfecto. En esta categoría tenemos ${unitLabel(unit)}${unitDetails(unit) ? `: ${unitDetails(unit)}` : ''}. ¿Le gustaría conocer esta opción?`,
      phase: 'choose_unit',
      units: [unit],
      offered_unit_ids: [text(unit.id)],
    }
  }
  const choices = candidates.slice(0, 4).map(unit => `${unitLabel(unit)}${unitDetails(unit) ? ` (${unitDetails(unit)})` : ''}`)
  return {
    reply: `Perfecto. Estas son las opciones disponibles: ${choices.join('; ')}. ¿Cuál de estas opciones le gustaría conocer?`,
    phase: 'choose_unit',
    units: candidates.slice(0, 4),
    offered_unit_ids: candidates.slice(0, 4).map(unit => text(unit.id)),
  }
}

/** Continúa, sin LLM, la comparación residencial que el bot dejó pendiente. */
export function continueUnitAlternative(info: Row, current: string): AlternativeJourney | null {
  const catalog = residentialUnits(info)
  if (!catalog.length) return null
  const message = normalized(current)
  const previous = normalized(lastBotReply(info))
  const context = object(info.property_context)
  const phase = context.journey === 'residential_alternatives' ? text(context.phase) : ''
  const semantics = object(info.semantica_turno)
  const reference = object(info.referencia_unidad)
  if (reference.needsClarification) return null
  if (['ask_price', 'request_visit', 'ask_financing'].includes(text(semantics.primary_intent))) return null
  if (/\b(?:dormitorios?|habitaciones?|cuartos?|metros|m2|terrazas?|patios?|jardin|jardines|estudios?|oficinas?|piscinas?|parqueaderos?|garajes?|indispensable|obligatorio|exactamente)\b/.test(message)) return null
  const selectedCategory = preferredPropertyCategory(current, semantics)
  const offeredCategories = /(?:compararle ambas alternativas|departamentos?[\s\S]{0,180}penthouses?|penthouses?[\s\S]{0,180}departamentos?)/.test(previous)
    && /alternativas?|comparar|compararle|revisar/.test(previous)
  const categoryQuestion = phase === 'choose_category'
    || /revisar primero los departamentos o los penthouses|departamentos o los penthouses/.test(previous)

  if (!selectedCategory && (offeredCategories || phase === 'compare_categories') && (positiveAnswer(message) || wantsComparison(message))) return compareResidentialCategories(catalog)

  if (offeredCategories || categoryQuestion || ['choose_floor', 'choose_unit'].includes(phase)) {
    const category = selectedCategory
    if (category === 'departamento') return apartmentFloorReply(catalog)
    if (category === 'penthouse') return categoryUnitsReply(catalog, 'penthouse')
    if (categoryQuestion && positiveAnswer(message)) {
      if (catalog.every(unit => unit.category === 'departamento')) return apartmentFloorReply(catalog)
      if (catalog.every(unit => unit.category === 'penthouse')) return categoryUnitsReply(catalog, 'penthouse')
      return { reply: 'Claro. ¿Desea empezar por los departamentos o por los penthouses?', phase: 'choose_category' }
    }
  }

  if (phase === 'choose_floor' || /que planta prefiere/.test(previous)) {
    const requestedFloor = floorNumber(message)
    if (requestedFloor === null) return null
    const apartments = catalog.filter(unit => unit.category === 'departamento')
    const maxBedrooms = Math.max(0, ...apartments.map(unit => Number(unit.bedrooms) || 0))
    const spacious = apartments.filter(unit => (!maxBedrooms || Number(unit.bedrooms) === maxBedrooms)
      && Number(unit.floor_number) === requestedFloor)
    if (!spacious.length) return {
      reply: `En esa planta no aparece un departamento de ${maxBedrooms || 'la categoría más amplia'} dormitorios disponible. Puedo mostrarle las plantas que sí tienen opciones.`,
      phase: 'choose_floor',
    }
    if (spacious.length === 1) return categoryUnitsReply(spacious, 'departamento')
    const choices = spacious.map(unit => `${unitLabel(unit)} (${unitDetails(unit)})`)
    return { reply: `En ${text(spacious[0].floor).trim() || `la planta ${requestedFloor}`} están disponibles ${choices.join('; ')}. ¿Cuál de estas opciones le gustaría conocer?`, phase: 'choose_unit', units: spacious, offered_unit_ids: spacious.map(unit => text(unit.id)) }
  }

  if (phase === 'choose_unit' || /cual.*(?:explorar en 360|opciones.*conocer)|le gustaria conocer esta opcion/.test(previous)) {
    if (['ask_price', 'request_visit', 'ask_financing'].includes(text(semantics.primary_intent))
      || /\b(?:precio|cuesta|valor|diferencia|comparar|visita|cita|agendar|financiamiento|credito)\b/.test(message)) return null
    const matches = Array.isArray(reference.matches) ? reference.matches.map(object)
      .filter(unit => ['departamento', 'penthouse'].includes(text(unit.category))) : []
    if (matches.length === 1) {
      const accepted = reference.explicit === true || reference.reason === 'relative_selection'
        || object(semantics.property).reference_kind === 'relative'
        || positiveAnswer(message) || /\b(?:me interesa|prefiero|quiero|quisiera|elijo|escojo|mas grande|mas pequeno)\b/.test(message)
      if (!accepted) return null
      const unit = catalog.find(candidate => candidate.id === matches[0].id)
      if (!unit) return null
      const details = unitDetails(unit)
      return {
        reply: `${unitLabel(unit).charAt(0).toUpperCase() + unitLabel(unit).slice(1)}${details ? ` tiene ${details}` : ' es la opción seleccionada'}. Puede explorarlo en 360 aquí: ${unitTourUrl(text(unit.unit_number))}\n\n${nextUnitQuestion(info)}`,
        phase: 'review_unit',
        unit,
        selected_unit_ids: [text(unit.id)],
      }
    }
  }
  return null
}

/**
 * Resuelve la aceptación de una alternativa que el bot acaba de recomendar.
 * La decisión se apoya en una unidad explícita del catálogo y en la propuesta
 * inmediatamente anterior; una preferencia no se convierte en una promesa de
 * idoneidad ni necesita verificación humana.
 */
export function acceptedUnitAlternative(info: Row, current: string) {
  const message = normalized(current)
  if (/\b(?:no me (?:conviene|sirve|interesa)|no quiero|descarto|prefiero otra)\b/.test(message)) return null

  const reference = object(info.referencia_unidad)
  const matches = Array.isArray(reference.matches) ? reference.matches.map(object) : []
  if (matches.length !== 1) return null

  const unit = matches[0]
  const unitNumber = text(unit.unit_number).trim()
  if (!unitNumber) return null

  const history = (Array.isArray(info.historial) ? info.historial : []).map(object)
  const previous = normalized(text([...history].reverse().find(row => ['bot', 'asesor'].includes(text(row.role)))?.content))
  const offeredThisUnit = previous.includes(normalized(unitNumber))
    && /\b(?:alternativa|recomendaria revisar|revisar la distribucion|mostrarle su distribucion)\b/.test(previous)
  if (!offeredThisUnit) return null

  const accepts = /\b(?:puede ser|podria ser)\b[\s\S]{0,100}\b(?:convenga|sirva|funcione|interese)\b/.test(message)
    || /\b(?:me interesa|me conviene|me sirve|quiero revisar|quisiera revisar|revisemos|veamos)\b/.test(message)
    || /\bno (?:necesito|requiero)\b[\s\S]{0,90}\b(?:independientes?|separad[oa]s?)\b/.test(message)
  if (!accepts) return null

  const label = `${unit.category === 'penthouse' ? 'el penthouse' : unit.category === 'suite' ? 'la suite' : 'el departamento'} ${unitNumber}`
  const bedrooms = Number(unit.bedrooms)
  const area = Number(unit.area_internal_m2)
  const details = [
    bedrooms > 0 ? `${bedrooms} dormitorios` : '',
    area > 0 ? `${area.toLocaleString('es-EC', { maximumFractionDigits: 2 })} m² interiores` : '',
    text(unit.floor).trim(),
  ].filter(Boolean)
  const flexibleRooms = /\bno (?:necesito|requiero)\b[\s\S]{0,90}\b(?:independientes?|separad[oa]s?)\b/.test(message)
  const opening = flexibleRooms
    ? `Entiendo. Como no necesita que todos los dormitorios sean independientes, ${label} puede ser una alternativa para valorar.`
    : `Entiendo. ${label.charAt(0).toUpperCase() + label.slice(1)} puede ser una alternativa para valorar.`
  return {
    reply: opening + (details.length ? ` Tiene ${details.join(', ')}.` : ''),
    unit,
  }
}

/** Verified starting point for numerical residential requirements; no lead mutations. */
export function unitAlternative(info: Row, current: string, budget: number|null = null) {
  const m=normalized(current.replace(/m²/g,'m2'))
  const history=(Array.isArray(info.historial)?info.historial:[]).map(object)
  const earlier=history.filter(r=>r.role==='cliente').map(r=>normalized(text(r.content))).join(' ')
  const currentBedroomRequest = /\b(?:\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:dormitorios?|habitaciones?|cuartos?)\b/.test(m)
  // Let the contextual writer reconcile earlier constraints or rejected options;
  // a new sentence must not erase an already stated budget or a firm requirement.
  if(/no me sirve|no me interesa|no quiero|indispensable|terraza|patio|jardin|estudio|oficina/.test(earlier)
    || (!currentBedroomRequest && /presupuesto|cuento con|dispongo de|\d+ (?:mil|dolares|usd)/.test(earlier)))return null
  if(/\b(?:local|casa|suite|cita|visita|agendar|credito|financiamiento)\b/.test(m))return null
  if(!/depart[ae]mento|apartamento|dormitorio|habitacion|cuarto/.test(m))return null
  if(/\b\d{3}\b/.test(m)&&!/\b\d{3}\s*(?:m2|m²|metros)/.test(m))return null
  if(/\bno (?:quiero|necesito|busco)|\b(?:antes|anteriormente|ya dije)\b/.test(m))return null
  const words:Record<string,number>={uno:1,un:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10}
  const rooms=m.match(/\b(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:dormitorios?|habitaciones?|cuartos?)\b/)
  const floor=m.match(/\b(?:piso|planta)\s+(\d{1,2})\b/)
  const area=current.toLowerCase().match(/\b(\d+(?:[.,]\d+)?)\s*(?:m2\b|m²|metros cuadrados\b)/)
  if(!rooms&&!floor&&!area)return null
  // Complex ranges and additional physical constraints require the full contextual writer.
  if(/\b(?:entre|menos de|hasta|o bien)\b|\b\d+\s+(?:o|a)\s+\d+|\b(?:dos|tres|cuatro|cinco)\s+o\s+|terraza|patio|jardin|piscina|vista|parqueadero|garaje|estudio|oficina|sala de tv/.test(m))return null
  const bedrooms=rooms?Number(words[rooms[1]]||rooms[1]):null
  const level=floor?Number(floor[1]):null
  const size=area?Number(area[1].replace(',','.')):null
  const catalog=(Array.isArray(info.catalogo)?info.catalogo:[]).map(object).filter(u=>['departamento','penthouse'].includes(text(u.category))&&u.is_published!==false&&(!u.status||u.status==='disponible'))
  if(!catalog.length)return null
  const matches=(u:Row)=>(bedrooms===null||Number(u.bedrooms)===bedrooms)&&(level===null||Number(u.floor_number)===level)&&(size===null||Number(u.area_internal_m2)>=size)
  if(catalog.some(matches))return null
  if(catalog.some(u=>(bedrooms!==null&&u.bedrooms==null)||(level!==null&&u.floor_number==null)||(size!==null&&u.area_internal_m2==null)))return null
  const requirement=[bedrooms!==null?`${bedrooms} dormitorios`:'',level!==null?`piso ${level}`:'',size!==null?`al menos ${size.toLocaleString('es-EC')} m² interiores`:''].filter(Boolean).join(', ')
  const intro=bedrooms!==null&&level===null&&size===null?`Actualmente no contamos con departamentos disponibles de ${bedrooms} dormitorios.`:`Actualmente no contamos con un departamento disponible que reúna estas características: ${requirement}.`
  if(/indispensable|obligatorio|exactamente|\bsolo\b|no (?:acepto|quiero).*alternativ/.test(m))return {reply:intro,unit:null}
  const previousBot=[...history].reverse().find(row=>row.role==='bot')
  const previousReply=normalized(text(previousBot?.content))
  const sameUnavailableBedrooms=bedrooms!==null&&new RegExp(`no (?:contamos|tenemos|hay|ofrecemos)[\\s\\S]{0,100}(?:de |con )?${bedrooms} dormitorios`).test(previousReply)
  if(sameUnavailableBedrooms&&!/[¿?]|\bpor que\b/.test(m)) {
    const independent=/\bindependientes?\b/.test(m)?' independientes':''
    const categories = [catalog.some(unit=>unit.category==='departamento')?'los departamentos más amplios':'',catalog.some(unit=>unit.category==='penthouse')?'los penthouses':''].filter(Boolean)
    return {reply:`Entiendo: necesita ${bedrooms} dormitorios${independent}. En este momento ninguna unidad residencial disponible en La Vilet cumple ese requisito; nuestras opciones llegan hasta ${Math.max(...catalog.map(unit=>Number(unit.bedrooms)).filter(value=>value>0))} dormitorios. ¿Desea ${categories.length>1?'comparar':'revisar'} ${categories.join(' y ')} teniendo presente esa diferencia?`,unit:null,phase:'compare_categories'}
  }
  if(bedrooms!==null&&level===null&&size===null) {
    const apartments = catalog.filter(unit => unit.category === 'departamento')
    const penthouses = catalog.filter(unit => unit.category === 'penthouse')
    const maxApartmentBedrooms = Math.max(0, ...apartments.map(unit => Number(unit.bedrooms) || 0))
    const maxApartmentArea = Math.max(0, ...apartments.map(unit => Number(unit.area_internal_m2) || 0))
    const maxPenthouseArea = Math.max(0, ...penthouses.map(unit => Number(unit.area_internal_m2) || 0))
    const penthousePositioning = maxPenthouseArea >= maxApartmentArea && maxPenthouseArea > 0
      ? ', donde se encuentran las mayores superficies del proyecto'
      : ''
    const alternatives = [
      apartments.length ? `departamentos${maxApartmentBedrooms ? ` de ${maxApartmentBedrooms} dormitorios` : ''} con distribuciones generosas` : '',
      penthouses.length ? `penthouses${penthousePositioning}` : '',
    ].filter(Boolean).join(' y ')
    const question = apartments.length && penthouses.length
      ? '¿Le gustaría que comparemos ambas alternativas para valorar cuál se adapta mejor a lo que busca?'
      : '¿Le gustaría que revisemos estas opciones para valorar si alguna se adapta a lo que busca?'
    return {
      reply:`${intro} Sin embargo, podemos ayudarle a evaluar nuestras alternativas residenciales más amplias: ${alternatives}. ${question}`,
      unit:null,
      phase:'compare_categories',
    }
  }
  let candidates=catalog
  if(budget!==null) {
    candidates=candidates.filter(u=>Number(u.published_commercial_price)>0&&Number(u.published_commercial_price)<=budget)
    if(!candidates.length)return null // Do not assert affordability without verified prices.
  }
  const score=(u:Row)=>(bedrooms===null?0:Math.abs(Number(u.bedrooms)-bedrooms)*100)+(level===null?0:Math.abs(Number(u.floor_number)-level)*10)+(size===null?0:Math.max(0,size-Number(u.area_internal_m2)))
  const unit=[...candidates].sort((a,b)=>score(a)-score(b)||Number(b.area_internal_m2)-Number(a.area_internal_m2)||text(a.unit_number).localeCompare(text(b.unit_number)))[0]
  const details=[Number(unit.bedrooms)>0?`${unit.bedrooms} dormitorios`:'',Number(unit.area_internal_m2)>0?`${Number(unit.area_internal_m2).toLocaleString('es-EC')} m² interiores`:'',text(unit.floor),Array.isArray(unit.spaces)&&unit.spaces.includes('Balcones')?'balcones':''].filter(Boolean)
  if(!details.length)return null
  const largest=Number(unit.area_internal_m2)>0&&catalog.filter(u=>u.bedrooms===unit.bedrooms).every(u=>Number(u.area_internal_m2)>0&&Number(u.area_internal_m2)<=Number(unit.area_internal_m2))
  const label=text(unit.category)==='penthouse'?'el penthouse':'el departamento'
  const reason=largest?` Es la opción de mayor superficie interior entre nuestras unidades residenciales de ${unit.bedrooms} dormitorios.`:''
  const closing=bedrooms!==null&&level===null&&size===null?` ¿Necesita que los ${bedrooms} sean dormitorios independientes o desea revisar la distribución de esta opción como alternativa?`:` Podemos mostrarle su distribución para que valore si se adapta a lo que busca.`
  return {reply:`${intro} Le recomendaría revisar ${label} ${text(unit.unit_number)}: tiene ${details.join(', ')}.${reason}${closing}`,unit}
}
