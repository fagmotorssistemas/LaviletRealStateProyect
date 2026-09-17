import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'

export const UNIT_ALTERNATIVE_RULES = `
ALTERNATIVAS DE INMUEBLES, EN TODOS LOS TONOS Y FLUJOS:
Si el catálogo verificado no ofrece lo solicitado, explique brevemente qué requisito no cumple y recomiende una alternativa concreta publicada y disponible, justificándola con datos reales de área interior, dormitorios, planta o espacios. No se limite a enumerar tipos y volver a preguntar qué quiere. No use siempre la misma unidad: considere conjuntamente las necesidades y el presupuesto conocidos; si una alternativa supera el presupuesto, indique la diferencia solo cuando los precios estén autorizados y no asuma flexibilidad. Si no conoce el precio, no afirme que se ajusta al presupuesto.
Una característica no documentada es desconocida, no prueba de que no exista. No invente estudios, habitaciones convertibles, vistas ni comodidad equivalente. No convierta balcones en área interior. Si el requisito es indispensable o ya rechazó esa alternativa, reconozca que no hay coincidencia y no insista. Recomendar tres dormitorios no cambia la preferencia declarada de cinco ni significa que el cliente aceptó el cambio.
Ofrezca revisar la distribución solo cuando sea pertinente; no envíe automáticamente un recorrido ni cambie a otra unidad si pidió una cita para una unidad concreta. Mantenga el agendamiento, la pregunta de financiamiento y las demás solicitudes activas. Esta regla aplica cuando se consultan alternativas, no obliga a añadir ofertas en cada turno, recordatorio o plantilla aprobada. El estilo adapta la redacción, nunca estos hechos y restricciones.
`

/** Verified starting point for numerical residential requirements; no lead mutations. */
export function unitAlternative(info: Row, current: string, budget: number|null = null) {
  const m=normalized(current.replace(/m²/g,'m2'))
  const earlier=(Array.isArray(info.historial)?info.historial:[]).map(object).filter(r=>r.role==='cliente').map(r=>normalized(text(r.content))).join(' ')
  // Let the contextual writer reconcile earlier constraints or rejected options;
  // a new sentence must not erase an already stated budget or a firm requirement.
  if(/no me sirve|no me interesa|no quiero|indispensable|presupuesto|cuento con|dispongo de|\d+ (?:mil|dolares|usd)|terraza|patio|jardin|estudio|oficina/.test(earlier))return null
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
  const catalog=(Array.isArray(info.catalogo)?info.catalogo:[]).map(object).filter(u=>u.category==='departamento'&&u.is_published!==false&&(!u.status||u.status==='disponible'))
  if(!catalog.length)return null
  const matches=(u:Row)=>(bedrooms===null||Number(u.bedrooms)===bedrooms)&&(level===null||Number(u.floor_number)===level)&&(size===null||Number(u.area_internal_m2)>=size)
  if(catalog.some(matches))return null
  if(catalog.some(u=>(bedrooms!==null&&u.bedrooms==null)||(level!==null&&u.floor_number==null)||(size!==null&&u.area_internal_m2==null)))return null
  const requirement=[bedrooms!==null?`${bedrooms} dormitorios`:'',level!==null?`piso ${level}`:'',size!==null?`al menos ${size.toLocaleString('es-EC')} m² interiores`:''].filter(Boolean).join(', ')
  const intro=bedrooms!==null&&level===null&&size===null?`Actualmente no contamos con departamentos disponibles de ${bedrooms} dormitorios.`:`Actualmente no contamos con un departamento disponible que reúna estas características: ${requirement}.`
  if(/indispensable|obligatorio|exactamente|\bsolo\b|no (?:acepto|quiero).*alternativ/.test(m))return {reply:intro,unit:null}
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
  const reason=largest?` Es una de las opciones de mayor superficie interior entre nuestros departamentos de ${unit.bedrooms} dormitorios.`:''
  return {reply:`${intro} Le recomendaría revisar el departamento ${text(unit.unit_number)}: tiene ${details.join(', ')}.${reason} Podemos mostrarle su distribución para que valore si se adapta a lo que busca.`,unit}
}
