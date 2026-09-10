export type ScriptStage = 'lanzamiento' | 'precalificacion' | 'nutricion' | 'preventa'

export type ScriptQuestionRow = {
  id: string
  tenant_id: string | null
  project_id: string | null
  stage: ScriptStage
  sort_order: number
  question_text: string
  is_active: boolean
}

export type TopicPromptRow = {
  id: number
  name: string
  load_when: string | null
  content: string
  is_active: boolean
  mode: string
  version: number
  notes: string | null
}

export type AutomationGuionPayload = {
  tenantId: string
  questions: ScriptQuestionRow[]
  topics: TopicPromptRow[]
}

export const SCRIPT_STAGE_OPTIONS: { value: ScriptStage; label: string }[] = [
  { value: 'lanzamiento', label: 'Lanzamiento' },
  { value: 'precalificacion', label: 'Precalificación' },
  { value: 'nutricion', label: 'Nutrición' },
  { value: 'preventa', label: 'Preventa' },
]

export const ENGINEER_PROMPT_NAMES = [
  'respuesta_comercial',
  'clasificador_intenciones',
  'extractor_eventos',
  'resumen_conversacion',
  'guion_preguntas',
  'saludo_inicial',
  'revisor_respuesta',
] as const

export const SDR_PROMPT_ORDER = ['respuesta_comercial', 'saludo_inicial', 'revisor_respuesta', 'resumen_conversacion', 'extractor_eventos']
export function topicPromptHelp(name: string) {
  if (name === 'respuesta_comercial') return 'Edite aquí el tono, la orientación de venta y los ejemplos de conversación. El catálogo y las reglas de citas determinan qué puede ofrecer.'
  if (name === 'saludo_inicial') return 'Texto literal para el primer saludo breve del cliente. En los siguientes saludos se retoma la conversación.'
  if (name === 'revisor_respuesta') return 'Revisa el borrador antes de enviarlo. Conserve el formato JSON con aprobada y motivos.'
  if (name === 'resumen_conversacion') return 'Conserva el contexto y los datos respondidos. Mantenga el formato JSON indicado en el texto.'
  if (name === 'extractor_eventos') return 'Detecta preferencias y solicitudes. Mantenga las propiedades JSON y las reglas de evidencia y consentimiento.'
  return 'Plantilla de referencia guardada. El SDR actual no la consulta por separado; incorpore las instrucciones necesarias en Conversación y orientación comercial.'
}

export const DEFAULT_SCRIPT_QUESTIONS: { stage: ScriptStage; sort_order: number; question_text: string }[] = [
  {
    stage: 'lanzamiento',
    sort_order: 10,
    question_text: '¿Está buscando una vivienda o un local comercial?',
  },
  {
    stage: 'lanzamiento',
    sort_order: 20,
    question_text: '¿Lo busca para uso propio o como inversión?',
  },
  {
    stage: 'lanzamiento',
    sort_order: 30,
    question_text: '¿Qué característica sería la más importante al elegir?',
  },
  {
    stage: 'lanzamiento',
    sort_order: 40,
    question_text: '¿Tiene un presupuesto aproximado en mente?',
  },
]

const TOPIC_LABELS: Record<string, string> = {
  respuesta_comercial: 'Conversación y orientación comercial',
  saludo_inicial: 'Primera bienvenida (solo una vez)',
  revisor_respuesta: 'Revisión antes del envío',
  resumen_conversacion: 'Memoria y continuidad',
  extractor_eventos: 'Datos y solicitudes del cliente',
  clasificador_intenciones: 'Clasificador heredado (no utilizado por el nuevo SDR)',
  rol: 'Identidad y tono',
  bienvenida: 'Bienvenida',
  ubicacion: 'Ubicación',
  horarios: 'Horarios',
  sobre_lavilet: 'Sobre Lavilet',
  informacion_proyecto: 'Información del proyecto',
  departamentos: 'Departamentos',
  suites: 'Suites',
  locales_comerciales: 'Locales comerciales',
  busqueda_unidad: 'Búsqueda de unidad',
  consulta_unidad: 'Consulta de unidad',
  disponibilidad: 'Disponibilidad',
  caracteristicas_unidad: 'Características',
  precio: 'Precio',
  presupuesto_cliente: 'Presupuesto del cliente',
  formas_pago: 'Formas de pago',
  financiamiento: 'Financiamiento',
  contado: 'Pago de contado',
  planos: 'Planos',
  renders: 'Renders e imágenes',
  brochure: 'Brochure',
  amenities: 'Áreas comunales',
  acabados: 'Acabados',
  visita: 'Visita',
  agendar_visita: 'Agendar visita',
  fecha_entrega: 'Fecha de entrega',
  estado_construccion: 'Avance de obra',
  inversion: 'Inversión',
  reserva: 'Reserva',
  negociacion: 'Negociación',
  objeciones: 'Objeciones',
  contrato: 'Contrato',
  documentacion: 'Documentación',
  hablar_asesor: 'Hablar con un asesor',
  numero_llamadas: 'Teléfono y llamadas',
  despedida: 'Despedida',
  insultos: 'Lenguaje ofensivo',
  vacante: 'Consultas laborales',
}

export function topicPromptLabel(name: string) {
  return TOPIC_LABELS[name] ?? name.replaceAll('_', ' ')
}
