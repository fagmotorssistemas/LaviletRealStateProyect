import { object, text, type Row } from './data'

/** The same instructions and code-owned guidance reach every final writer route.
 * Keep the instruction compact; the detailed guidance appears once in context. */
export const CONTEXTUAL_NEEDS_WRITER_RULES = `ORIENTACIÓN SOBRE NECESIDADES PERSONALES: razone con hechos verificados, distinguiendo declaraciones, hipótesis y conclusiones condicionadas. Cumpla razonamiento_contextual.guidance y sus límites: no invente medidas ni garantice cabida por superficie total. Las inferencias no son selecciones ni permisos. Responda las dudas actuales y retome solo el siguiente paso comercial pendiente, sin repetir datos confirmados.`

export const CONTEXTUAL_NEEDS_GUIDANCE = `ORIENTACIÓN SOBRE NECESIDADES PERSONALES
Relacione las situaciones del cliente (familia, edad, movilidad, mascotas o muebles) con características pertinentes y verificadas de las opciones que están revisando. Puede razonar y explicar ventajas o limitaciones con lenguaje prudente; no se limite a repetir la ficha. Distinga hechos del proyecto, declaraciones del cliente, hipótesis ilustrativas y conclusiones condicionadas. Una edad no demuestra movilidad reducida; hijos o familiares no determinan el total de habitantes ni los dormitorios exigidos; mascotas no acreditan permisos del proyecto. No convierta estas inferencias en filtros confirmados, selección de unidad, reserva, cita o consentimiento financiero.
Para camas, muebles, autos o circulación, la superficie total del inmueble no demuestra que un objeto quepa en una habitación o parqueadero. Tampoco convierta los m² de una zona en largo y ancho. Una estimación espacial necesita medidas pertinentes de la zona y del objeto, distribución y obstáculos conocidos; distinga una comparación de medidas de una confirmación de cabida. Use razonamiento cualitativo si faltan datos. Las medidas típicas varían: si emplea un ejemplo, identifíquelo expresamente como supuesto ilustrativo, nunca como medida del cliente o del proyecto. No invente cifras para completar una operación.
Puede explicar cálculos sencillos con operandos identificables en razonamiento_contextual: indique qué se está calculando, sus medidas y unidades, y presente el resultado como estimación condicionada cuando corresponda. Un área calculada no es la superficie publicada del inmueble, ni prueba capacidad, accesibilidad o cumplimiento de una norma. Conserve exactas las cifras oficiales. No calcule tasas, cuotas, rentabilidad, descuentos ni condiciones comerciales a partir de supuestos: siguen sus fuentes y procedimientos autorizados.
Si falta la medida exacta, explique concretamente qué no puede comprobar. Compartir brochure o tour no acredita acceso a planos, cotas ni haberlos examinado. Solo proponga revisar documentos disponibles para esa unidad según la evidencia; en otro caso puede ofrecer orientación opcional del equipo en la oficina habilitada sin prometer planos, medidas, una cita ni acceso a obra o viviendas terminadas. Una duda de distribución no significa indecisión ni solicitud de asesor; no derive automáticamente ni inicie la coordinación sin aceptación.
Responda las dudas actuales y luego retome únicamente la decisión vigente de siguiente_paso_comercial. Una consulta informativa no reinicia categoría, dormitorios, planta, unidad, importe de entrada o financiamiento ya confirmados. No reabra elecciones ni repita precios y nombres por costumbre. Si falta un dato indispensable para responder, comunique esa limitación antes de continuar; no pregunte medidas que el cliente no puede conocer ni condicione toda la conversación a resolverlas. Conserve el paso comercial pendiente y sus permisos, sin inventar una selección o consentimiento para avanzar.`

/** Keep supplementary project features for an interpreted evaluation, rather
 * than requiring the customer to know the feature's technical name. This only
 * selects evidence; it does not assert suitability or change catalogue filters. */
export function needsSupplementaryFeatures(verified: Row): boolean {
  const semantics = object(verified.semantica_turno), property = object(semantics.property)
  const request = object(semantics.catalog_request || verified.catalog_request)
  const shared = Array.isArray(object(verified.contrato_turno).requests) ? object(verified.contrato_turno).requests as Row[] : []
  const interpreted = Array.isArray(verified.solicitudes_interpretadas || semantics.requests)
    ? (verified.solicitudes_interpretadas || semantics.requests) as Row[] : []
  const identity = (value: Row) => JSON.stringify([value.request, value.evidence, text(value.source) || 'current',
    value.source === 'pending' ? value.source_message_id : null])
  const sharedIdentities = new Set(shared.map(value => identity(object(value))))
  const requests = [...shared, ...interpreted.filter(value => !sharedIdentities.has(identity(object(value))))].map(object)
  // An initial, interpreted project question can need features the customer
  // cannot name. Preserve their full evidence without creating a preference.
  const initialInformation = semantics.primary_intent === 'project_information' && semantics.confidence === 'high'
    && property.operation === 'none' && request.purpose === 'none'
    && requests.some(value => value.domain === 'property' && value.confidence === 'high'
      && value.source !== 'pending' && !!text(value.evidence).trim())
  return initialInformation || ['details', 'compare'].includes(text(request.purpose))
    || ['details', 'compare'].includes(text(property.operation))
    || Array.isArray(request.semantic_preferences) && request.semantic_preferences.length > 0
    || Array.isArray(semantics.housing_quantities) && semantics.housing_quantities.some(value => {
      const quantity = object(value)
      return quantity.confidence === 'high' && quantity.role === 'evaluation'
    })
}
