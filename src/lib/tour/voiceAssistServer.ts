import 'server-only'
import {
  buildSpeakLine,
  filtersHaveSignal,
  findCatalogUnitByCode,
  isLikelyOffTopic,
  isUnclearOrSilentSpeech,
  matchVoiceUnits,
  mergeVoiceFilters,
  normalizeFilters,
  parseOptionChoice,
  parseUnitCodeMention,
  parseVoiceFiltersLocal,
  softenFiltersToSuggestions,
  speakOffTopicClarification,
  speakPickedOption,
  speakUnclearSpeechClarification,
  suggestNearbyVoiceUnits,
  toVoiceUnitCard,
  wantsFreshSearch,
  type VoiceAssistCatalogUnit,
  type VoiceAssistFilters,
  type VoiceAssistResult,
  type VoiceAssistUnitCard,
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
    'sort_pref',
    'category',
    'or_groups',
    'off_topic',
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
    sort_pref: { type: ['string', 'null'], enum: ['barato', 'caro', null] },
    category: { type: ['string', 'null'], enum: ['departamento', 'suite', 'local', null] },
    or_groups: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'bedrooms', 'bathrooms'],
        properties: {
          category: { type: ['string', 'null'], enum: ['departamento', 'suite', 'local', null] },
          bedrooms: { type: ['integer', 'null'] },
          bathrooms: { type: ['number', 'null'] },
        },
      },
    },
    off_topic: { type: 'boolean' },
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
    'Visitante en showroom inmobiliario en Ecuador. Habla de dormitorios, pisos, presupuesto, tipologías, locales comerciales o puede dictar un WhatsApp/celular. Transcribe solo lo audible; números de teléfono con dígitos.',
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

async function extractFilters(
  transcript: string,
): Promise<VoiceAssistFilters & { assistant_note: string; off_topic: boolean }> {
  const key = process.env.OPENAI_API_KEY?.trim()
  const model = process.env.OPENAI_MODEL?.trim()
  if (!key || !model) throw new Error('OPENAI_NOT_CONFIGURED')

  const instructions = [
    'Eres el asistente de voz del showroom inmobiliario La Vilet (Ecuador).',
    'Tu rol es ayudar a buscar departamentos, suites o locales comerciales: dormitorios, baños, piso, presupuesto, tipología, categoría, disponibilidad, código de unidad, o “más barato” / “más caro”.',
    'Si pide UNA sola categoría: category="local"|"suite"|"departamento" y or_groups=null.',
    'Si mezcla categorías (ej. “locales y departamentos de 1 habitación”, “suites o locales”): category=null y or_groups=[{category,bedrooms,bathrooms}, ...]. En locales bedrooms/bathrooms van null; en departamentos/suites aplica el número dicho.',
    'Extrae filtros del mensaje del visitante. No inventes números que no se dijeron. Si no hay dato, usa null.',
    'Presupuestos en dólares: "200 mil" = 200000, "1.2 millones" = 1200000.',
    'Piso alto ≈ floor_pref alto; bajo ≈ bajo; intermedio ≈ medio.',
    'Si pide disponibles, only_available=true.',
    'Si pide lo más barato, económico o de menor precio: sort_pref="barato". Si pide lo más caro, premium o de lujo: sort_pref="caro".',
    'off_topic=true SOLO si el mensaje NO trata del showroom (chistes, clima, política, deportes, tecnología genérica, etc.).',
    'off_topic=false si pide locales comerciales, departamentos, suites, mezclas, filtros, opciones, precios o cómo usarte.',
    'Si off_topic=true, deja filtros en null (only_available puede ser true), sort_pref=null, category=null, or_groups=null.',
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
    off_topic: parsed.off_topic === true,
  }
}

export async function runTourVoiceAssist(params: {
  transcript: string
  catalog: VoiceAssistCatalogUnit[]
  previousFilters?: VoiceAssistFilters | null
  previousMatches?: VoiceAssistUnitCard[] | null
}): Promise<VoiceAssistResult> {
  const transcript = params.transcript.trim()
  if (!transcript || isUnclearOrSilentSpeech(transcript)) {
    const { speak, follow_up } = speakUnclearSpeechClarification()
    return {
      transcript,
      speak,
      filters: params.previousFilters ?? normalizeFilters({ only_available: true }),
      matches: (params.previousMatches ?? []).slice(0, 3),
      follow_up,
    }
  }
  if (params.catalog.length === 0) {
    return {
      transcript,
      speak: 'Un momento, todavía estoy cargando el inventario. En unos segundos con gusto le ayudo.',
      filters: normalizeFilters({ only_available: true }),
      matches: [],
      follow_up: null,
    }
  }

  const previous = wantsFreshSearch(transcript) ? null : (params.previousFilters ?? null)
  const previousMatches = wantsFreshSearch(transcript) ? [] : (params.previousMatches ?? [])

  // “Opción 1 / la primera” → elegir de la lista anterior (no repetir búsqueda).
  const option = parseOptionChoice(transcript)
  if (option != null && previousMatches.length > 0) {
    const picked = previousMatches[option - 1]
    if (picked) {
      const filters = previous ?? normalizeFilters({ only_available: true })
      const { speak, follow_up } = speakPickedOption(picked, filters)
      return { transcript, speak, filters, matches: [picked], follow_up }
    }
    return {
      transcript,
      speak: `Le había mostrado ${previousMatches.length} opciones. ¿Cuál de esas le gustaría ver?`,
      filters: previous ?? normalizeFilters({ only_available: true }),
      matches: previousMatches,
      follow_up: 'Puede decir “opción 1” o tocarla en la lista.',
    }
  }

  // Pedido directo por código (“el 202”): memoria + ficha, sin decir el número en voz.
  const unitCode = parseUnitCodeMention(transcript)
  if (unitCode) {
    const hit = findCatalogUnitByCode(params.catalog, unitCode)
    if (hit) {
      const filters = mergeVoiceFilters(previous, parseVoiceFiltersLocal(transcript))
      const matches = [toVoiceUnitCard(hit)]
      const { speak, follow_up } = speakPickedOption(matches[0], filters)
      return { transcript, speak, filters, matches, follow_up }
    }
    return {
      transcript,
      speak:
        'No encontré esa unidad por ahora. ¿Quiere que busquemos por dormitorios, baños o piso?',
      filters: previous ?? normalizeFilters({ only_available: true }),
      matches: [],
      follow_up: 'Por ejemplo: “2 baños” o “piso alto”.',
    }
  }

  const offTopicReply = () => {
    const { speak, follow_up } = speakOffTopicClarification(transcript)
    return {
      transcript,
      speak,
      filters: previous ?? normalizeFilters({ only_available: true }),
      matches: previousMatches.slice(0, 3),
      follow_up,
    } satisfies VoiceAssistResult
  }

  // Fuera de tema claro (clima, chistes, etc.): aclara el rol sin gastar en búsqueda.
  if (isLikelyOffTopic(transcript)) {
    return offTopicReply()
  }

  // 1) Parser local (gratis). Cubre “2 dormitorios”, “2 baños”, “piso alto”, etc.
  let extracted = parseVoiceFiltersLocal(transcript)
  let aiOffTopic = false

  // 2) Si no hay señal clara, intentar OpenAI; si falla, seguimos con local/memoria.
  if (!filtersHaveSignal(extracted)) {
    try {
      const fromAi = await extractFilters(transcript)
      const { assistant_note: _note, off_topic, ...rest } = fromAi
      aiOffTopic = off_topic
      extracted = rest
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('429') && !previous) {
        return {
          transcript,
          speak:
            'Disculpe, ahora no puedo interpretar pedidos muy abiertos. Si me indica algo concreto como “2 dormitorios”, “2 baños” o “hasta 180 mil”, con gusto le ayudo.',
          filters: extracted,
          matches: [],
          follow_up: 'Puede escribir dormitorios, baños, piso o presupuesto.',
        }
      }
      console.error('tour voice-assist extract', message)
    }
  }

  if (aiOffTopic) {
    return offTopicReply()
  }

  const filters = mergeVoiceFilters(previous, extracted)
  if (!filtersHaveSignal(filters)) {
    if (isLikelyOffTopic(transcript)) {
      return offTopicReply()
    }
    return {
      transcript,
      speak:
        'Con gusto le ayudo. Puede pedirme departamentos, suites o locales comerciales; también por dormitorios, baños, piso, presupuesto o lo más económico. ¿Por dónde le gustaría empezar?',
      filters,
      matches: [],
      follow_up: 'Por ejemplo: “locales comerciales”, “2 baños” o “el más económico”.',
    }
  }

  const exactMatches = matchVoiceUnits(params.catalog, filters, 3)
  let matches = exactMatches
  let suggested = false
  let replyFilters = filters

  if (exactMatches.length === 0) {
    const nearby = suggestNearbyVoiceUnits(params.catalog, filters, 3)
    if (nearby.length > 0) {
      matches = nearby
      suggested = true
      // Hablar con el pedido original; guardar filtros suavizados para seguir la charla.
      replyFilters = softenFiltersToSuggestions(filters, nearby)
    }
  }

  const { speak, follow_up } = buildSpeakLine(matches, filters, { suggested })
  return { transcript, speak, filters: replyFilters, matches, follow_up }
}

const TTS_VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
])

/** Prepara el texto para que el TTS respire y suene menos “leído”. */
function prepareSpeechText(raw: string): string {
  let t = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''

  t = t.replace(/\s*[—–]\s*/g, ', ')
  t = t.replace(/\s*·\s*/g, ', ')
  t = t.replace(/\s*\/\s*/g, ' o ')
  // Pausas naturales tras frases.
  t = t.replace(/([.!?])([^\s])/g, '$1 $2')
  t = t.replace(/,\s*/g, ', ')
  // Separar opciones para que no las lea en ráfaga.
  t = t.replace(/\bOpción\s+(\d+)\s*:/gi, '. Opción $1:')
  // Evita ráfagas de signos.
  t = t.replace(/!{2,}/g, '!')
  t = t.replace(/\?{2,}/g, '?')
  t = t.replace(/\.{2,}/g, '.')
  // La Vilet: ayuda a pronunciar con fluidez.
  t = t.replace(/\bLa Vilet\b/gi, 'La Vilét')
  t = t.replace(/\bLavilet\b/gi, 'La Vilét')

  return t.replace(/\s+/g, ' ').trim().slice(0, 600)
}

async function synthesizeWithOpenAI(input: string): Promise<ArrayBuffer | null> {
  const key = process.env.OPENAI_API_KEY?.trim()
  const model = process.env.OPENAI_TTS_MODEL?.trim()
  if (!key || !model) return null

  // shimmer/nova/coral: tono más cercano y amable en español.
  const voiceRaw = (process.env.OPENAI_TTS_VOICE?.trim() || 'shimmer').toLowerCase()
  const voice = TTS_VOICES.has(voiceRaw) ? voiceRaw : 'shimmer'
  const speedRaw = Number(process.env.OPENAI_TTS_SPEED || '1.0')
  const speed = Number.isFinite(speedRaw) ? Math.min(1.1, Math.max(0.8, speedRaw)) : 1.0

  const body: Record<string, unknown> = {
    model,
    voice,
    input,
    response_format: 'mp3',
    speed,
  }

  if (/gpt-4o|mini-tts/i.test(model)) {
    body.instructions = [
      'Eres Lia, asesora del showroom La Vilet en Ecuador.',
      'Habla como una persona real, amable y acogedora, en una conversación presencial (usted).',
      'Español latinoamericano natural. Suena cálida, cercana y profesional; nunca robótica ni apurada.',
      'Invita a preguntar con naturalidad. Ritmo conversacional, con pausas breves en comas.',
      'Varía un poco la entonación, como alguien que atiende con gusto.',
      'Pronuncia precios y números con naturalidad (por ejemplo: doscientos diez mil dólares).',
    ].join(' ')
  }

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`TTS_HTTP_${response.status}`)
  return response.arrayBuffer()
}

/** Voces neurales de Edge (gratis): suenan naturales en español EC. */
async function synthesizeWithEdge(input: string): Promise<ArrayBuffer> {
  const { EdgeTTS } = await import('@andresaya/edge-tts')
  const tts = new EdgeTTS()
  const voice = process.env.EDGE_TTS_VOICE?.trim() || 'es-EC-AndreaNeural'

  await tts.synthesize(input, voice, {
    rate: process.env.EDGE_TTS_RATE?.trim() || '+0%',
    pitch: process.env.EDGE_TTS_PITCH?.trim() || '+1Hz',
    volume: '100%',
  })

  const buffer = tts.toBuffer()
  if (!buffer || buffer.length === 0) throw new Error('EDGE_TTS_EMPTY')
  const copy = new Uint8Array(buffer.length)
  copy.set(buffer)
  return copy.buffer
}

/**
 * TTS natural para el showroom: OpenAI primero; Edge como respaldo.
 */
export async function synthesizeTourVoice(rawText: string): Promise<ArrayBuffer | null> {
  const input = prepareSpeechText(rawText)
  if (!input) return null

  try {
    const openai = await synthesizeWithOpenAI(input)
    if (openai && openai.byteLength > 0) return openai
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TTS_OPENAI_FAILED'
    console.warn('tour voice-assist openai tts', message)
  }

  try {
    return await synthesizeWithEdge(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TTS_EDGE_FAILED'
    console.error('tour voice-assist edge tts', message)
  }

  return null
}
