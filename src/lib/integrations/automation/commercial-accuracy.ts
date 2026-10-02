import { object, type Row } from './data'

export const NUMERIC_RELATION_WRITING_RULES = `Conserve también la relación matemática al expresar una cifra. Use las agregaciones ya calculadas de evidencia_turno.groups para el mismo grupo y filtro, sin reconstruirlas de memoria ni mezclar categorías.
- min es un mínimo alcanzado: hay al menos una opción exactamente en ese valor. «Desde», «a partir de» y «el mínimo es» conservan ese significado; «todos superan» lo cambia.
- max es un máximo alcanzado: «hasta» o «el máximo es» incluyen ese valor; «todos cuestan menos» lo excluye.
- range incluye ambos extremos. Si coinciden, comunique un valor único, sin inventar variación. Un rango de grupo no implica que todos sus miembros tengan el mismo valor ni que estén disponibles todos los valores intermedios.
- Respete igualdad, mayor/menor e inclusión de límites para precios, áreas, dimensiones, dormitorios y plantas. Un precio igual al presupuesto sí está dentro de él. Un mínimo igual al presupuesto no demuestra que todas las opciones lo superen.
Mantenga redacción libre. No necesita enumerar más cifras ni añadir una explicación matemática al cliente. Antes de entregar la respuesta, compruebe que las comparaciones expresan los datos recibidos, incluida la igualdad en los extremos.`

const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export const COMMERCIAL_ACCURACY_RULES = '\nDistinga hechos verificados, información desconocida y restricciones internas de redacción. «No tenemos información para afirmarlo» NUNCA significa «la política del proyecto lo prohíbe». La intención de arrendar es contexto para elegir inmueble, no una pregunta automática sobre respaldo financiero: no añada explicaciones bancarias que el cliente no pidió. No anuncie criterios propios de un banco sin una fuente verificada. Una declaración atendida al usarla para seleccionar opciones no necesita repetirse como respuesta. Ante «¿me recomienda?», ayude a comparar precio, área, distribución, acceso y uso con datos verificados; evite párrafos evasivos sobre una recomendación final. Si falta un dato decisivo, pregúntelo directamente una sola vez. No recomiende rentabilidad ni éxito comercial garantizados. Priorice unidades dentro del presupuesto: si una opción lo supera, indique la diferencia sin asumir flexibilidad. No infiera seguridad, tránsito peatonal, demanda o conveniencia para un negocio por la sola cercanía de comercios. No afirme aceptación ni prohibición bancaria sin respaldo.\n'

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
