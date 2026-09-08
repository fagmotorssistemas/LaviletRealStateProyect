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
] as const

export const DEFAULT_SCRIPT_QUESTIONS: { stage: ScriptStage; sort_order: number; question_text: string }[] = [
  {
    stage: 'lanzamiento',
    sort_order: 10,
    question_text: '¿Me permite su nombre para atenderle de forma personalizada?',
  },
  {
    stage: 'lanzamiento',
    sort_order: 20,
    question_text: '¿Le interesa un departamento o una suite?',
  },
  {
    stage: 'lanzamiento',
    sort_order: 30,
    question_text: '¿Lo busca para vivir o como inversión?',
  },
  {
    stage: 'lanzamiento',
    sort_order: 40,
    question_text: '¿Nos autoriza a mantenerle informado sobre el proyecto por este medio?',
  },
]

const TOPIC_LABELS: Record<string, string> = {
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
