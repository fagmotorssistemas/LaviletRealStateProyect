/** Requested subjects describe relevance, never a permission or catalogue fact. */
export const REQUEST_TOPICS = [
  'project_overview', 'location', 'purchase_price', 'commercial_stage',
  'construction_status', 'delivery', 'spatial_fit', 'accessibility',
  'property_features', 'property_options', 'financing', 'visualization',
] as const
export type RequestTopic = typeof REQUEST_TOPICS[number]
export const REQUEST_TOPICS_SCHEMA = { type: 'array', items: { type: 'string', enum: [...REQUEST_TOPICS] } }

/** Missing topics in historical extractions remain missing, not an assertion of absence. */
export function normalizedRequestTopics(value: unknown): RequestTopic[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [...new Set(value.filter((topic): topic is RequestTopic => typeof topic === 'string'
    && (REQUEST_TOPICS as readonly string[]).includes(topic)))]
}

export const REQUEST_TOPICS_RULES = `TEMAS POR SOLICITUD: cada requests[].topics contiene únicamente los temas explícitamente preguntados o indispensables para resolver esa solicitud actual o pendiente validada. Use los valores del esquema según su significado: presentación general del proyecto, ubicación, precio de compra, etapa comercial, estado de construcción, entrega, adecuación espacial, accesibilidad, características, opciones inmobiliarias, financiamiento o visualización. Separe los temas de solicitudes distintas, incluso dentro de un mismo mensaje. Seleccionar categoría o dormitorios corresponde a property_options, no implica purchase_price ni project_overview. Una situación personal no implica spatial_fit salvo que el cliente pida evaluar concretamente si un espacio sirve o cómo acomodarse. No etiquete temas solo porque existan en la memoria, el catálogo o el texto de una pregunta del bot. Todos los dominios admiten topics; [] expresa que no solicita ninguno de estos temas. Estos temas no crean hechos, filtros, permisos, consentimiento ni acciones.`
