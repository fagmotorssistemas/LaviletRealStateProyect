import 'server-only'
import {
  asPurePrice,
  filtersHaveSignal,
  isBathConceptQuestion,
  isFinancingQuestion,
  isUnsupportedCameraAsk,
  isVoiceUiAction,
  normalizeFilters,
  parseFamilySize,
  parseVoiceFiltersLocal,
  parseVoiceUiAction,
  type VoiceAssistFilters,
  type VoiceUiAction,
} from './voiceAssist'
import { isVoiceComparison } from './voiceTurnIntent'
import type { TourLocale } from './tourMessages'

export const VOICE_TURN_INTENTS = [
  'SEARCH',
  'COMPARE',
  'QUESTION',
  'ACTION',
  'FINANCIAL_SIGNAL',
  'CLARIFICATION',
  'SMALLTALK',
] as const

export type VoiceTurnIntent = (typeof VOICE_TURN_INTENTS)[number]

export type VoiceFinancialSignal = {
  type: 'down_payment' | 'monthly_budget' | 'family_size'
  value: string
}

export type VoiceTurnClassification = {
  intent: VoiceTurnIntent
  filters: VoiceAssistFilters | null
  action: VoiceUiAction | null
  financial_signal: VoiceFinancialSignal | null
  free_text_question: string | null
}

export type VoiceTurnContext = {
  transcript: string
  locale?: TourLocale
  previousFilters?: VoiceAssistFilters | null
  previousMatchIds?: string[]
}

const EMPTY_TURN: VoiceTurnClassification = {
  intent: 'CLARIFICATION',
  filters: null,
  action: null,
  financial_signal: null,
  free_text_question: null,
}

function text(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function moneyIn(transcript: string): string | null {
  const t = transcript.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  const mil = t.match(/(\d+(?:[.,]\d+)?)\s*mil\b/)
  if (mil) {
    const n = Number(mil[1].replace(',', '.'))
    return Number.isFinite(n) ? String(Math.round(n * 1000)) : null
  }
  const raw = t.match(/\$?\s?(\d{1,3}(?:[.\s]\d{3})+|\d{3,7})/)
  if (!raw) return null
  const amount = asPurePrice(raw[1])
  return amount != null ? String(Math.round(amount)) : null
}

const SEARCH_VERB = /\b(busco|buscar|busca|quiero|necesito|muestra\w*|tienes|hay|departamentos?|apartments?|show|find|looking|suites?|locales?)\b/i
const MORE_OPTIONS = /\b(otras? opciones|otros? departamentos|mas opciones|ver mas|muestra(?:me)? (?:mas|otras)|otras|more options|other apartments|show more|other options|next options)\b/i

/** Casos cerrados, antes del modelo. No decide preguntas ambiguas. */
export function obviousVoiceTurn(transcript: string): VoiceTurnClassification | null {
  const local = parseVoiceFiltersLocal(transcript)
  if (isUnsupportedCameraAsk(transcript)) {
    return { ...EMPTY_TURN, intent: 'CLARIFICATION', free_text_question: 'camera' }
  }
  const action = parseVoiceUiAction(transcript)
  if (action) return { ...EMPTY_TURN, intent: 'ACTION', action }
  if (isBathConceptQuestion(transcript)) {
    return { ...EMPTY_TURN, intent: 'QUESTION', free_text_question: 'bath_concept' }
  }
  const people = parseFamilySize(transcript)
  if (people != null && !filtersHaveSignal(local)) {
    return { ...EMPTY_TURN, intent: 'FINANCIAL_SIGNAL', financial_signal: { type: 'family_size', value: String(people) } }
  }
  const norm = transcript.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  if (/\b(entrada|inicial|enganche)\b/.test(norm)) {
    const value = moneyIn(transcript)
    if (value) return { ...EMPTY_TURN, intent: 'FINANCIAL_SIGNAL', financial_signal: { type: 'down_payment', value } }
  }
  if (/\b(cuota|mensual|al mes)\b/.test(norm)) {
    const value = moneyIn(transcript)
    if (value) return { ...EMPTY_TURN, intent: 'FINANCIAL_SIGNAL', financial_signal: { type: 'monthly_budget', value } }
  }
  if (isFinancingQuestion(transcript)) {
    return { ...EMPTY_TURN, intent: 'QUESTION', action: 'OPEN_SIMULATOR', free_text_question: 'financing' }
  }
  if (isVoiceComparison(transcript)) return { ...EMPTY_TURN, intent: 'COMPARE' }
  if (MORE_OPTIONS.test(transcript.normalize('NFD').replace(/\p{M}/gu, '')) || (filtersHaveSignal(local) && SEARCH_VERB.test(transcript))) {
    return { ...EMPTY_TURN, intent: 'SEARCH', filters: local }
  }
  return null
}

const TURN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'filters', 'action', 'financial_signal', 'free_text_question'],
  properties: {
    intent: { type: 'string', enum: [...VOICE_TURN_INTENTS] },
    filters: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['bedrooms', 'bathrooms', 'floor_pref', 'price_min', 'price_max', 'only_available', 'sort_pref', 'category'],
      properties: {
        bedrooms: { type: ['integer', 'null'] },
        bathrooms: { type: ['number', 'null'] },
        floor_pref: { type: ['string', 'null'], enum: ['bajo', 'medio', 'alto', null] },
        price_min: { type: ['number', 'null'] },
        price_max: { type: ['number', 'null'] },
        only_available: { type: 'boolean' },
        sort_pref: { type: ['string', 'null'], enum: ['barato', 'caro', null] },
        category: { type: ['string', 'null'], enum: ['departamento', 'suite', 'penthouse', 'local', null] },
      },
    },
    action: {
      type: ['string', 'null'],
      enum: ['OPEN_GALLERY', 'NEXT_PHOTO', 'PREV_PHOTO', 'OPEN_TOUR_360', 'OPEN_FLOOR_PLAN', 'OPEN_SIMULATOR', 'SAVE_FAVORITE', 'CLOSE_FICHA', null],
    },
    financial_signal: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['type', 'value'],
      properties: {
        type: { type: 'string', enum: ['down_payment', 'monthly_budget', 'family_size'] },
        value: { type: 'string' },
      },
    },
    free_text_question: { type: ['string', 'null'] },
  },
} as const

export async function classifyVoiceTurn(
  transcript: string,
  context: VoiceTurnContext,
  signal?: AbortSignal,
): Promise<VoiceTurnClassification | null> {
  const key = process.env.OPENAI_API_KEY?.trim()
  const model = process.env.OPENAI_MODEL?.trim()
  if (!key || !model) throw new Error('OPENAI_NOT_CONFIGURED')
  const timeout = AbortSignal.timeout(25_000)
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 400,
      instructions: [
        'Clasifica un turno del showroom La Vilet. Devuelve solo el JSON del schema.',
        'SEARCH: pide unidades por dormitorios, baños, piso, presupuesto, categoría o más opciones.',
        'COMPARE: pide comparar opciones ya mostradas.',
        'QUESTION: pregunta por la unidad en pantalla, un concepto, el precio de una opción ya vista o por qué algo cuesta lo que cuesta. No reinicies la búsqueda.',
        'ACTION: pide abrir galería, pasar foto, tour 360, plano, simulador, guardar favorito o cerrar ficha. action es esa orden. Mover la cámara libremente no es una acción: usa CLARIFICATION.',
        'FINANCIAL_SIGNAL: dice el tamaño de la familia, una entrada o una cuota mensual. value es el número en texto, sin inventar.',
        'CLARIFICATION: falta un dato para continuar, o pide algo que la pantalla no puede hacer, como mover la cámara.',
        'SMALLTALK: saludo o tema ajeno al showroom.',
        'Una familia de ocho personas es FINANCIAL_SIGNAL family_size "8", no SMALLTALK.',
        'Una pregunta de concepto sobre 1.5 o 2.5 baños es QUESTION.',
        'No inventes filtros que no se dijeron. Si no hay filtros, filters es null.',
        context.locale === 'en' ? 'The visitor is speaking English.' : 'El visitante habla español.',
      ].join(' '),
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: JSON.stringify({
            mensaje: transcript,
            filtros_previos: context.previousFilters ?? null,
            opciones_en_pantalla: context.previousMatchIds ?? [],
          }),
        }],
      }],
      text: { format: { type: 'json_schema', name: 'tour_voice_turn', strict: true, schema: TURN_SCHEMA } },
    }),
  })
  if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`)
  const body = object(await response.json())
  if (body.status !== 'completed') throw new Error('OPENAI_INCOMPLETE')
  const output = (Array.isArray(body.output) ? body.output : [])
    .map(object)
    .flatMap((item) => (Array.isArray(item.content) ? item.content.map(object) : []))
    .filter((item) => item.type === 'output_text')
    .map((item) => text(item.text))
    .join('')
  if (!output) return null
  const parsed = object(JSON.parse(output))
  const intent = text(parsed.intent)
  if (!(VOICE_TURN_INTENTS as readonly string[]).includes(intent)) return null
  const signalRaw = object(parsed.financial_signal)
  const signalType = text(signalRaw.type)
  const financial: VoiceFinancialSignal | null = signalType === 'down_payment' || signalType === 'monthly_budget' || signalType === 'family_size'
    ? { type: signalType, value: text(signalRaw.value).slice(0, 40) }
    : null
  return {
    intent: intent as VoiceTurnIntent,
    filters: parsed.filters ? normalizeFilters(object(parsed.filters) as Partial<VoiceAssistFilters>) : null,
    action: isVoiceUiAction(parsed.action) ? parsed.action : null,
    financial_signal: financial,
    free_text_question: parsed.free_text_question == null ? null : text(parsed.free_text_question).slice(0, 400),
  }
}
