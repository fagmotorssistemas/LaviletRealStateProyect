export const KNOWLEDGE_SECTIONS = [
  { id: 'proyecto', label: 'Información del proyecto', description: 'Datos confirmados sobre el proyecto y su ubicación.', entries: [
    { title: 'Descripción y materiales', description: 'Ficha del proyecto, descripción y documentos en su fuente original.', href: '/inmobiliaria/proyectos/{projectId}', owner: 'Datos del proyecto' },
    { title: 'Estado del proyecto', description: 'Avance de obra, condiciones y lugares habilitados para visitas.', href: 'proyecto', owner: 'Datos del proyecto' },
    { title: 'Plazo de entrega', description: 'Fecha confirmada o estimada, mes y año, solo año, plazo en meses o fecha aún sin definir.', href: 'proyecto#project-delivery', owner: 'Administrador' },
    { title: 'Ubicación', description: 'Punto de encuentro y ubicación compartida con el cliente.', href: 'ubicacion', owner: 'Datos del proyecto' },
  ] },
  { id: 'catalogo', label: 'Catálogo y precios', description: 'Una sola fuente para las cifras que comunica el asistente.', entries: [
    { title: 'Unidades del inventario', description: 'Características, superficies y estado de las unidades del catálogo.', href: '/inmobiliaria/inventario', owner: 'Sistema y catálogo' },
    { title: 'Precios de las unidades', description: 'Valores comerciales y permiso para informar precios en lanzamiento.', href: 'precios', owner: 'Sistema y catálogo' },
  ] },
  { id: 'politicas', label: 'Políticas comerciales', description: 'Condiciones confirmadas para comprar, reservar, pagar o visitar.', entries: [
    { title: 'Entrada y financiamiento', description: 'Entrada del proyecto, reserva y condiciones editables de JEP y Banco Pichincha.', href: 'financiamiento', owner: 'Administrador' },
    { title: 'Descuentos por compra anticipada', description: 'Activación, porcentaje, unidades, vigencia y condiciones de descuentos autorizados.', href: 'descuentos', owner: 'Administrador' },
  ] },
  { id: 'conversacion', label: 'Conversación', description: 'Preguntas, entrega de materiales y forma de comunicarse.', entries: [
    { title: 'Guion y preguntas', description: 'Preguntas del bot, instrucciones por tema y recopilación de datos.', href: 'guion', owner: 'IA y controles del sistema' },
    { title: 'Personalidad', description: 'Tono, calidez y nivel de detalle de las respuestas.', href: 'estilo', owner: 'IA redactora' },
    { title: 'Revisión final de mensajes', description: 'Activar o desactivar la revisión para todos los contactos del proyecto.', href: 'pruebas#response-review-title', owner: 'Administrador' },
  ] },
  { id: 'operacion', label: 'Operación', description: 'Condiciones de atención, equipo y seguimientos.', entries: [
    { title: 'Atención y seguimientos', description: 'Etapa comercial, visitas, horarios, asesores, SLA y seguimientos.', href: 'reglas', owner: 'Sistema' },
    { title: 'Modo de pruebas', description: 'Controles para probar la automatización.', href: 'pruebas', owner: 'Sistema' },
  ] },
] as const
export type KnowledgeSection = typeof KNOWLEDGE_SECTIONS[number]['id']
export function knowledgeSectionFor(active: string): KnowledgeSection | undefined {
  return KNOWLEDGE_SECTIONS.find(section => section.entries.some(entry => entry.href === active))?.id
}
export const knowledgeHref = (section: string) => `/inmobiliaria/automatizacion/conocimiento?seccion=${section}`
