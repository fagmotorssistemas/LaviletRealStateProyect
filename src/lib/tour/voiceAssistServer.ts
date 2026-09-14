import 'server-only'
import {
  buildSpeakLine,
  filtersHaveSignal,
  matchVoiceUnits,
  normalizeFilters,
  parseVoiceFiltersLocal,
  type VoiceAssistCatalogUnit,
  type VoiceAssistFilters,
  type VoiceAssistResult,
} from '@/lib/tour/voiceAssist'

function text(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

const FILTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'bedrooms',
    'bathrooms',
    'floor_min',
    'floor_max',
    'floor_pref',
    'price_min',
    'price_max',
    'typology_code',
    'only_available',
    'area_min_m2',
    'assistant_note',
  ],
  properties: {
    bedrooms: { type: ['integer', 'null'] },
    bathrooms: { type: ['number', 'null'] },
    floor_min: { type: ['integer', 'null'] },
    floor_max: { type: ['integer', 'null'] },
    floor_pref: { type: ['string', 'null'], enum: ['bajo', 'medio', 'alto', null] },
    price_min: { type: ['number', 'null'] },
    price_max: { type: ['number', 'null'] },
    typology_code: { type: ['string', 'null'] },
    only_available: { type: 'boolean' },
    area_min_m2: { type: ['number', 'null'] },
    assistant_note: { type: 'string' },
  },
} as const

export async function transcribeTourVoice(audio: Blob, fileName: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) throw new Error('OPENAI_NOT_CONFIGURED')

  const form = new FormData()
  form.set('model', process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'whisper-1')
  form.set('file', audio, fileName || 'audio.webm')
  form.set('language', 'es')
  form.set(
    'prompt',
    'Visitante en showroom inmobiliario en Ecuador. Habla de dormitorios, pisos, presupuesto, tipologías. Transcribe solo lo audible.',
  )

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.ok) throw new Error(`TRANSCRIPTION_HTTP_${response.status}`)
  const transcript = text(object(await response.json()).text).trim()
  if (!transcript || transcript.length > 4000) throw new Error('INVALID_TRANSCRIPTION')
  return transcript
}

async function extractFilters(transcript: string): Promise<VoiceAssistFilters & { assistant_note: string }> {
  const key = process.env.OPENAI_API_KEY?.trim()
  const model = process.env.OPENAI_MODEL?.trim()
  if (!key || !model) throw new Error('OPENAI_NOT_CONFIGURED')

  const instructions = [
    'Eres el asistente de voz del showroom La Vilet (Ecuador).',
    'Extrae filtros de búsqueda inmobiliaria del mensaje del visitante.',
    'No inventes números que no se dijeron. Si no hay dato, usá null.',
    'Presupuestos en dólares: "200 mil" = 200000, "1.2 millones" = 1200000.',
    'Piso alto ≈ floor_pref alto; bajo ≈ bajo; intermedio ≈ medio.',
    'Si pide disponibles, only_available=true.',
    'assistant_note: frase corta interna (no para el cliente).',
  ].join(' ')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 500,
      instructions,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Mensaje del visitante:\n${transcript}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'tour_voice_filters',
          strict: true,
          schema: FILTER_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`)
  const result = object(await response.json())
  if (result.status !== 'completed') throw new Error('OPENAI_INCOMPLETE')
  const output = (Array.isArray(result.output) ? result.output : [])
    .map(object)
    .flatMap((item) => (Array.isArray(item.content) ? item.content.map(object) : []))
    .filter((item) => item.type === 'output_text')
    .map((item) => text(item.text))
    .join('')
  if (!output) throw new Error('OPENAI_INVALID_OUTPUT')
  const parsed = object(JSON.parse(output))
  return {
    ...normalizeFilters(parsed as Partial<VoiceAssistFilters>),
    assistant_note: text(parsed.assistant_note).slice(0, 200),
  }
}

export async function runTourVoiceAssist(params: {
  transcript: string
  catalog: VoiceAssistCatalogUnit[]
}): Promise<VoiceAssistResult> {
  const transcript = params.transcript.trim()
  if (!transcript) throw new Error('EMPTY_TRANSCRIPT')
  if (params.catalog.length === 0) {
    return {
      transcript,
      speak: 'Todavía no tengo el inventario cargado. Prueba en unos segundos.',
      filters: normalizeFilters({ only_available: true }),
      matches: [],
      follow_up: null,
    }
  }

  // 1) Parser local (gratis, sin cuota). Cubre “2 dormitorios”, “piso alto”, etc.
  let filters = parseVoiceFiltersLocal(transcript)

  // 2) Si no hay señal clara, intentar OpenAI; si falla (429/etc), seguimos con local.
  if (!filtersHaveSignal(filters)) {
    try {
      const extracted = await extractFilters(transcript)
      const { assistant_note: _note, ...fromAi } = extracted
      filters = fromAi
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('429')) {
        // Sin cuota: devolver mensaje útil en vez de tumbar toda la búsqueda.
        return {
          transcript,
          speak:
            'Disculpa, ahora mismo no puedo interpretar pedidos muy abiertos. Si me dices algo concreto como “2 dormitorios”, “piso alto” o “hasta 180 mil”, te ayudo de inmediato.',
          filters,
          matches: [],
          follow_up: 'Escribe dormitorios, piso o presupuesto cuando quieras.',
        }
      }
      console.error('tour voice-assist extract', message)
    }
  }

  const matches = matchVoiceUnits(params.catalog, filters, 3)
  const { speak, follow_up } = buildSpeakLine(matches, filters)
  return { transcript, speak, filters, matches, follow_up }
}
