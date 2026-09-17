import { object, type Row } from './data'

const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export const COMMERCIAL_ACCURACY_RULES = '\nDistinga hechos verificados, información desconocida y restricciones internas de redacción. «No tenemos información para afirmarlo» NUNCA significa «la política del proyecto lo prohíbe». La intención de arrendar es contexto para elegir inmueble, no una pregunta automática sobre respaldo financiero: no añada explicaciones bancarias que el cliente no pidió. No anuncie criterios propios de un banco sin una fuente verificada. Una declaración atendida al usarla para seleccionar opciones no necesita repetirse como respuesta. Ante «¿me recomienda?», ayude a comparar precio, área, distribución, acceso y uso con datos verificados; evite párrafos evasivos sobre una recomendación final. Si falta un dato decisivo, pregúntelo directamente una sola vez. No recomiende rentabilidad ni éxito comercial garantizados. Priorice unidades dentro del presupuesto: si una opción lo supera, indique la diferencia y pregunte si existe flexibilidad, sin asumirla. No infiera seguridad, tránsito peatonal, demanda o conveniencia para un negocio por la sola cercanía de comercios. El revisor debe rechazar tanto una aceptación bancaria inventada como una prohibición inventada.\n'

export function inventedRentalPolicy(sentence:string,verified:Row):boolean {
  const v=normalize(sentence)
  if(!/arriend|arrend|renta|alquil|ingresos futuros/.test(v))return false
  if(/politica del proyecto|proyecto (?:no )?permite|proyecto prohibe/.test(v) && /respaldo|financier|credito|ingreso/.test(v))return true
  if(typeof object(verified.financing_policy).future_rental_income_accepted==='boolean')return false
  return /(?:banco|entidad|cooperativa|politica).{0,70}(?:no acept|prohib|no permit|exclu).{0,90}(?:ingreso|arriend|renta|respaldo)/.test(v)
}

export function recommendationClarification(info:Row,current:string):string {
  if(!/^(?:entonces )?(?:si )?(?:me |lo |la )?(?:recomienda|recomiendas|recomiendan)(?: entonces)?$/.test(normalize(current).replace(/[¿?.,!]/g,'').trim()))return ''
  const lead=object(info.lead)
  if(lead.preferred_category!=='local'||lead.purchase_purpose)return ''
  return 'Para comparar las opciones, ¿lo usaría para su propio negocio o lo compraría para arrendarlo?'
}

export function sectorClaimsReply(reply:string):string {
  // Preserve descriptions and actual security installations; remove only unsupported conclusions.
  return reply.replace(/(El sector|La zona) es residencial, seguro y bastante tranquilo/gi,'$1 es residencial')
    .replace(/\s*Es una zona que resulta conveniente para abrir un local, ya que combina el paso de residentes y una oferta variada de servicios alrededor\./gi,'')
}
