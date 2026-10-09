import 'server-only'
import { compareVoiceUnits } from './compareVoiceUnits'
import { answerVoiceQuestion } from './voiceConversationServer'
import { classifyVoiceTurn, obviousVoiceTurn, type VoiceTurnClassification } from './voiceTurnClassifier'
import type { VoiceConversationTurn } from './voiceConversation'
import { translateTourText, type TourLocale } from './tourMessages'
import {
  asPurePrice,
  bedroomsForFamilySize,
  bathroomsSpoken,
  bathConceptSpoken,
  buildSpeakLine,
  correctSpokenPrices,
  filtersHaveSignal,
  formatPriceSpoken,
  guardSpokenText,
  isBathConceptQuestion,
  isFinancingQuestion,
  isVoiceUiAction,
  voiceUiActionLine,
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
  type VoiceUiAction,
  type VoiceAssistCatalogUnit,
  type VoiceAssistFilters,
  type VoiceAssistResult,
  type VoiceAssistUnitCard,
} from '@/lib/tour/voiceAssist'

export type VoiceScreenContext = {
  viewMode?: string | null
  fichaOpen?: boolean
  hasUnit?: boolean
  galleryCount?: number | null
}

/** La acción solo se ejecuta si el estado de la pantalla la permite. */
export function resolveVoiceAction(action: VoiceUiAction | null, context?: VoiceScreenContext | null): VoiceUiAction | null {
  if (!action) return null
  if (!context) return action
  const needsUnit = action === 'NEXT_PHOTO' || action === 'PREV_PHOTO' || action === 'OPEN_GALLERY' || action === 'OPEN_TOUR_360' || action === 'OPEN_SIMULATOR' || action === 'SAVE_FAVORITE'
  if (needsUnit && context.hasUnit === false) return null
  if ((action === 'NEXT_PHOTO' || action === 'PREV_PHOTO') && context.galleryCount === 0) return null
  if ((action === 'NEXT_PHOTO' || action === 'PREV_PHOTO') && context.fichaOpen === false && context.viewMode !== 'galeria') {
    return context.hasUnit === false ? null : 'OPEN_GALLERY'
  }
  return action
}

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
    'soft_needs',
    'off_topic',
    'assistant_note',
    'intent',
    'ui_action',
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
    category: { type: ['string', 'null'], enum: ['departamento', 'suite', 'penthouse', 'local', null] },
    or_groups: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'bedrooms', 'bathrooms'],
        properties: {
          category: { type: ['string', 'null'], enum: ['departamento', 'suite', 'penthouse', 'local', null] },
          bedrooms: { type: ['integer', 'null'] },
          bathrooms: { type: ['number', 'null'] },
        },
      },
    },
    soft_needs: { type: 'array', items: { type: 'string' } },
    off_topic: { type: 'boolean' },
    assistant_note: { type: 'string' },
    intent: { type: 'string', enum: ['question', 'search', 'action', 'farewell', 'other'] },
    ui_action: {
      type: ['string', 'null'],
      enum: ['OPEN_GALLERY', 'NEXT_PHOTO', 'PREV_PHOTO', 'OPEN_TOUR_360', 'OPEN_FLOOR_PLAN', 'OPEN_SIMULATOR', 'SAVE_FAVORITE', 'CLOSE_FICHA', null],
    },
  },
} as const

export async function transcribeTourVoice(audio: Blob, fileName: string, locale: TourLocale = 'es'): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) throw new Error('OPENAI_NOT_CONFIGURED')

  const form = new FormData()
  form.set('model', process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'whisper-1')
  form.set('file', audio, fileName || 'audio.webm')
  form.set('language', locale)
  form.set(
    'prompt',
    locale === 'en' ? 'Visitor in the La Vilet real estate showroom in Ecuador. Apartments, bedrooms, floors, budgets, commercial units. Transcribe only audible speech in English; use digits for phone numbers.' : 'Visitante en showroom inmobiliario en Ecuador. Habla de dormitorios, pisos, presupuesto, tipologías, locales comerciales o puede dictar un WhatsApp/celular. Transcribe solo lo audible; números de teléfono con dígitos.',
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
): Promise<VoiceAssistFilters & { assistant_note: string; off_topic: boolean; intent: string; ui_action: VoiceUiAction | null }> {
  const key = process.env.OPENAI_API_KEY?.trim()
  const model = process.env.OPENAI_MODEL?.trim()
  if (!key || !model) throw new Error('OPENAI_NOT_CONFIGURED')

  const instructions = [
    'Eres el asistente de voz del showroom inmobiliario La Vilet (Ecuador).',
    'Tu rol es ayudar a buscar departamentos, suites, penthouses o locales comerciales: dormitorios, baños, piso, presupuesto, tipología, categoría, disponibilidad, código de unidad, o “más barato” / “más caro”.',
    'Si pide UNA sola categoría: category="local"|"suite"|"departamento"|"penthouse" y or_groups=null.',
    'Si mezcla categorías (ej. “locales y departamentos de 1 habitación”, “suites o locales”): category=null y or_groups=[{category,bedrooms,bathrooms}, ...]. En locales bedrooms/bathrooms van null; en departamentos/suites/penthouses aplica el número dicho.',
    'Extrae filtros del mensaje del visitante. No inventes números que no se dijeron. Si no hay dato, usa null.',
    'Presupuestos en dólares: "200 mil" = 200000, "1.2 millones" = 1200000.',
    'Piso alto ≈ floor_pref alto; bajo ≈ bajo; intermedio ≈ medio.',
    'Si pide disponibles, only_available=true.',
    'Si pide lo más barato, económico o de menor precio: sort_pref="barato". Si pide lo más caro, premium o de lujo: sort_pref="caro".',
    'off_topic=true SOLO si el mensaje NO trata del showroom (chistes, clima, política, deportes, tecnología genérica, etc.).',
    'off_topic=false si pide locales comerciales, departamentos, suites, mezclas, filtros, opciones, precios, financiamiento, crédito, cuotas o cómo usarte.',
    'Si off_topic=true, deja filtros en null (only_available puede ser true), sort_pref=null, category=null, or_groups=null, soft_needs=[].',
    'soft_needs: necesidades humanas que no son un filtro de base de datos, como vista, mascota, inversión, alquiler, terraza grande. Lista vacía si no hay.',
    'intent: question si pide consejo, comparación, explicación o financiamiento; search si pide unidades; action si pide abrir galería, cambiar foto, mover la cámara, ir a un dormitorio, 360, plano o cerrar ficha; farewell si se despide; other si no encaja.',
    'ui_action: OPEN_GALLERY, NEXT_PHOTO, PREV_PHOTO, OPEN_TOUR_360, OPEN_FLOOR_PLAN, OPEN_SIMULATOR, SAVE_FAVORITE o CLOSE_FICHA solo si intent=action; si no, null. Mover la cámara no es una acción.',
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
    intent: text(parsed.intent),
    ui_action: isVoiceUiAction(parsed.ui_action) ? parsed.ui_action : null,
  }
}

export async function runTourVoiceAssist(params: {
  transcript: string
  catalog: VoiceAssistCatalogUnit[]
  previousFilters?: VoiceAssistFilters | null
  previousMatches?: VoiceAssistUnitCard[] | null
  history?: VoiceConversationTurn[]
  signal?: AbortSignal
  locale?: TourLocale
  seenUnitIds?: string[]
  screen?: VoiceScreenContext | null
}): Promise<VoiceAssistResult> {
  const transcript = params.transcript.trim()
  if (!transcript || isUnclearOrSilentSpeech(transcript)) {
    const { speak, follow_up } = speakUnclearSpeechClarification()
    return {
      transcript,
      speak: translateTourText(speak, params.locale ?? 'es'),
      filters: params.previousFilters ?? normalizeFilters({ only_available: true }),
      matches: (params.previousMatches ?? []).slice(0, 3),
      follow_up,
    }
  }
  if (params.catalog.length === 0) {
    return {
      transcript,
      speak: params.locale === 'en' ? 'The inventory is still loading. I can help you in a moment.' : 'Un momento, todavía estoy cargando el inventario. En unos segundos con gusto le ayudo.',
      filters: normalizeFilters({ only_available: true }),
      matches: [],
      follow_up: null,
    }
  }

  const locale = params.locale ?? 'es'
  const previous = wantsFreshSearch(transcript) ? null : (params.previousFilters ?? null)
  const previousMatches = wantsFreshSearch(transcript) ? [] : (params.previousMatches ?? [])
  const seal = (result: VoiceAssistResult): VoiceAssistResult => ({
    ...result,
    speak: guardSpokenText(
      correctSpokenPrices(result.speak, params.catalog.map((unit) => unit.price)),
      params.catalog,
      locale,
    ),
  })
  const unavailable = (matches: VoiceAssistUnitCard[] = previousMatches): VoiceAssistResult => seal({
    transcript,
    speak: locale === 'en' ? 'I could not look that up right now. Please try again.' : 'No puedo responder en este momento, intenta de nuevo.',
    filters: previous ?? normalizeFilters({ only_available: true }),
    matches,
    follow_up: null,
  })
  const localFilters = parseVoiceFiltersLocal(transcript)
  const more = /\b(otras? opciones|otros? departamentos|mas opciones|ver mas|muestra(?:me)? (?:mas|otras)|otras|more options|other apartments|show more|other options|next options)\b/i.test(transcript.normalize('NFD').replace(/\p{M}/gu, ''))

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

  const baseFilters = previous ?? normalizeFilters({ only_available: true })
  const consult = async (filters: VoiceAssistFilters) => {
    let answer: Awaited<ReturnType<typeof answerVoiceQuestion>> = null
    try {
      answer = await answerVoiceQuestion({ ...params, transcript, previousMatches, previousFilters: filters })
    } catch (error) {
      if (params.signal?.aborted) throw new Error('VOICE_TURN_CANCELLED')
      const message = error instanceof Error ? error.message : ''
      if (message.includes('429') || message === 'VOICE_ANSWER_UNKNOWN_UNIT') return unavailable(previousMatches)
    }
    return seal({
      transcript,
      speak: answer?.speak ?? (locale === 'en' ? 'I could not look that up right now. Please try again.' : 'No puedo responder en este momento, intenta de nuevo.'),
      filters,
      matches: answer?.unitIds.length
        ? answer.unitIds.flatMap((id) => {
            const unit = params.catalog.find((item) => item.id === id)
            return unit ? [toVoiceUnitCard(unit)] : []
          })
        : previousMatches,
      follow_up: null,
      ui_action: answer?.ui_action ?? null,
    })
  }

  let turn: VoiceTurnClassification | null = obviousVoiceTurn(transcript)
  if (!turn) {
    try {
      turn = await classifyVoiceTurn(transcript, {
        transcript,
        locale,
        previousFilters: previous,
        previousMatchIds: previousMatches.map((unit) => unit.id),
      }, params.signal)
    } catch (error) {
      if (params.signal?.aborted) throw new Error('VOICE_TURN_CANCELLED')
      const message = error instanceof Error ? error.message : ''
      if (message.includes('429')) return unavailable([])
      console.error('tour voice-assist classify', message)
      if (filtersHaveSignal(localFilters) || more) {
        turn = { intent: 'SEARCH', filters: localFilters, action: null, financial_signal: null, free_text_question: null }
      } else {
        return unavailable()
      }
    }
  }
  if (!turn) return unavailable()

  if (turn.intent === 'ACTION' || (turn.action && turn.intent !== 'QUESTION' && turn.intent !== 'FINANCIAL_SIGNAL')) {
    const resolved = resolveVoiceAction(turn.action, params.screen)
    if (!resolved) {
      return seal({
        transcript,
        speak: locale === 'en'
          ? 'I can open the gallery, the tour, or the floor plan once a unit is selected.'
          : 'Puedo abrirle la galería, el recorrido o el plano cuando haya una unidad elegida.',
        filters: baseFilters,
        matches: previousMatches,
        follow_up: null,
      })
    }
    return seal({
      transcript,
      speak: voiceUiActionLine(resolved, locale),
      filters: baseFilters,
      matches: previousMatches,
      follow_up: null,
      ui_action: resolved,
    })
  }

  if (turn.intent === 'CLARIFICATION' && turn.free_text_question === 'camera') {
    return seal({
      transcript,
      speak: locale === 'en'
        ? 'I can open the 360 tour, change the photo, or move to another unit. I cannot move the camera inside the tour.'
        : 'Puedo abrirle el recorrido, cambiar la foto o pasar a otra unidad. No puedo mover la cámara dentro del recorrido.',
      filters: baseFilters,
      matches: previousMatches,
      follow_up: null,
    })
  }

  if (turn.intent === 'SMALLTALK' || (turn.intent === 'CLARIFICATION' && isLikelyOffTopic(transcript) && !isFinancingQuestion(transcript))) {
    const { speak, follow_up } = speakOffTopicClarification(transcript)
    return seal({ transcript, speak, filters: baseFilters, matches: previousMatches.slice(0, 3), follow_up })
  }

  if (turn.intent === 'COMPARE') {
    const comparison = compareVoiceUnits(transcript, params.catalog, previousMatches.map((unit) => unit.id), locale)
    if (comparison) return seal({ ...comparison, filters: previous ?? comparison.filters })
    return consult(baseFilters)
  }

  if (turn.intent === 'QUESTION' || turn.intent === 'CLARIFICATION') {
    if (turn.free_text_question === 'bath_concept' || isBathConceptQuestion(transcript)) {
      return seal({
        transcript,
        speak: bathConceptSpoken(locale),
        filters: baseFilters,
        matches: previousMatches,
        follow_up: null,
      })
    }
    if (turn.free_text_question === 'financing' || turn.action === 'OPEN_SIMULATOR' || isFinancingQuestion(transcript)) {
      return seal({
        transcript,
        speak: locale === 'en'
          ? 'The catalog does not include rates or terms. I am opening the simulator so you can review the bank options.'
          : 'El catálogo no incluye tasas ni plazos. Le abro el simulador para revisar las opciones con los convenios bancarios.',
        filters: baseFilters,
        matches: previousMatches,
        follow_up: null,
        ui_action: 'OPEN_SIMULATOR',
      })
    }
    return consult(mergeVoiceFilters(previous, turn.filters ?? localFilters))
  }

  if (turn.intent === 'FINANCIAL_SIGNAL' && turn.financial_signal?.type === 'family_size') {
    const bedrooms = bedroomsForFamilySize(Number(turn.financial_signal.value))
    turn = {
      ...turn,
      intent: 'SEARCH',
      filters: normalizeFilters({ bedrooms, only_available: true }),
    }
  } else if (turn.intent === 'FINANCIAL_SIGNAL' && turn.financial_signal) {
    const amount = asPurePrice(turn.financial_signal.value)
    const prices = (previousMatches.length ? previousMatches : params.catalog)
      .map((unit) => unit.price)
      .filter((price): price is number => price != null && price > 0)
    const reference = prices.length ? Math.min(...prices) : null
    const low = amount != null && reference != null && amount < reference * 0.2
    const amountSpoken = formatPriceSpoken(amount, locale)
    const referenceSpoken = formatPriceSpoken(reference, locale)
    const speak = turn.financial_signal.type === 'monthly_budget'
      ? (locale === 'en'
        ? `I noted a monthly budget of ${amountSpoken ?? 'that amount'}. The catalog does not include the monthly payment, so I cannot confirm whether it is enough. I am opening the simulator.`
        : `Anoto una cuota de ${amountSpoken ?? 'ese monto'}. El catálogo no trae la cuota mensual, así que no puedo confirmar si alcanza. Le abro el simulador.`)
      : low
        ? (locale === 'en'
          ? `A down payment of ${amountSpoken} is low next to a published price of ${referenceSpoken}. There are agreements with banks. I am opening the simulator.`
          : `Con una entrada de ${amountSpoken}, frente a un precio publicado de ${referenceSpoken}, esa entrada es baja. Hay convenios con entidades bancarias. Le abro el simulador para revisarlo.`)
        : (locale === 'en'
          ? `I noted a down payment of ${amountSpoken ?? 'that amount'}. The catalog does not include loan terms, so I cannot confirm whether it is enough. I am opening the simulator.`
          : `Anoto una entrada de ${amountSpoken ?? 'ese monto'}. El catálogo no trae las condiciones del crédito, así que no puedo confirmar si alcanza. Le abro el simulador para verlo con los convenios bancarios.`)
    return seal({
      transcript,
      speak,
      filters: baseFilters,
      matches: previousMatches,
      follow_up: null,
      ui_action: 'OPEN_SIMULATOR',
    })
  }

  const extracted = turn.filters ?? localFilters
  const filters = mergeVoiceFilters(previous, extracted)
  const allMatches = matchVoiceUnits(params.catalog, filters, params.catalog.length)
  const repeated = previous && JSON.stringify(previous) === JSON.stringify(filters)
  const excludeSeen = more || (repeated && !/barat|cheap|econom|menor precio|lowest|caro|expensive|highest/i.test(transcript))
  const seen = new Set([...(params.seenUnitIds ?? []), ...previousMatches.map(unit => unit.id)])
  const remaining = excludeSeen ? allMatches.filter(unit => !seen.has(unit.id)) : allMatches
  if (allMatches.length && !remaining.length) {
    const nearby = suggestNearbyVoiceUnits(params.catalog, softenFiltersToSuggestions(filters, allMatches), 3)
      .filter((unit) => !seen.has(unit.id))
    if (nearby.length) {
      const { speak, follow_up } = buildSpeakLine(nearby, filters, { suggested: true })
      return {
        transcript,
        filters: softenFiltersToSuggestions(filters, nearby),
        matches: nearby,
        follow_up,
        speak: params.locale === 'en'
          ? `Those exact matches are already on screen. A nearby alternative: ${nearby.map((unit) => unit.unit_number).join(', ')}.`
          : `Ya le mostré las que cumplen exactamente. ${speak}`,
      }
    }
    return {
      transcript, filters, matches: [], follow_up: null,
      speak: params.locale === 'en' ? `We have reviewed all ${allMatches.length} matching units. Would you like to change a filter?` : `Ya revisamos las ${allMatches.length} unidades que cumplen esos filtros. ¿Quiere cambiar alguno para ver más opciones?`,
    }
  }
  const exactMatches = remaining.slice(0, 3)
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

  if (filters.soft_needs.length) {
    let answer: Awaited<ReturnType<typeof answerVoiceQuestion>> = null
    try {
      answer = await answerVoiceQuestion({
        ...params,
        transcript,
        previousMatches: matches,
        previousFilters: filters,
      })
    } catch {
      if (params.signal?.aborted) throw new Error('VOICE_TURN_CANCELLED')
    }
    if (answer?.speak) {
      const prices = [...matches, ...params.catalog].map((unit) => unit.price)
      const picked = answer.unitIds.flatMap((id) => {
        const unit = params.catalog.find((item) => item.id === id)
        return unit ? [toVoiceUnitCard(unit)] : []
      })
      return seal({
        transcript,
        speak: correctSpokenPrices(answer.speak, prices),
        filters: replyFilters,
        matches: picked.length ? picked : matches,
        follow_up: null,
        ui_action: answer.ui_action,
      })
    }
  }

  const { speak, follow_up } = buildSpeakLine(matches, filters, { suggested })
  if (params.locale === 'en') return seal({ transcript, filters: replyFilters, matches, follow_up: null,
    speak: matches.length ? `${suggested ? 'These are nearby alternatives, with different features.' : `${allMatches.length} units match your filters.`} ${matches.map((unit, index) => `Option ${index + 1}, unit ${unit.unit_number}: ${[unit.bedrooms != null ? `${unit.bedrooms} bedrooms` : null, unit.bathrooms != null ? bathroomsSpoken(unit.bathrooms, 'en') : null, unit.area_total_m2 != null ? `${unit.area_total_m2} square meters` : null, unit.price != null ? formatPriceSpoken(unit.price, 'en') : null].filter(Boolean).join(', ')}.`).join(' ')}` : 'No units match these filters. Would you like to change the budget or bedroom count?' })
  return seal({ transcript, speak, filters: replyFilters, matches, follow_up })
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

async function synthesizeWithOpenAI(input: string, locale: TourLocale): Promise<ArrayBuffer | null> {
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
    if (locale === 'en') body.instructions = 'You are Lia, the La Vilet showroom assistant in Ecuador. Speak natural, warm, professional English at a conversational pace. Read prices and numbers naturally. Do not add any content.'
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

/**
 * Respaldo de voz. @andresaya/edge-tts no es un cliente oficial: scrapea un servicio de Microsoft
 * y puede dejar de funcionar sin aviso. OpenAI TTS es el camino principal.
 */
async function synthesizeWithEdge(input: string, locale: TourLocale): Promise<ArrayBuffer> {
  const { EdgeTTS } = await import('@andresaya/edge-tts')
  const tts = new EdgeTTS()
  const voice = locale === 'en' ? 'en-US-JennyNeural' : process.env.EDGE_TTS_VOICE?.trim() || 'es-EC-AndreaNeural'

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
export async function synthesizeTourVoice(rawText: string, locale: TourLocale = 'es'): Promise<ArrayBuffer | null> {
  let safeText = rawText
  if (/\{\{(?:PRICE|AREA):/.test(safeText)) {
    console.error('[voice-token-unresolved]', safeText)
    safeText = locale === 'en' ? 'Give me a second while I confirm that figure.' : 'Dame un segundo que confirmo esa cifra.'
  }
  const input = prepareSpeechText(safeText)
  if (!input) return null

  try {
    const openai = await synthesizeWithOpenAI(input, locale)
    if (openai && openai.byteLength > 0) return openai
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TTS_OPENAI_FAILED'
    console.warn('tour voice-assist openai tts', message)
  }

  try {
    return await synthesizeWithEdge(input, locale)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TTS_EDGE_FAILED'
    console.error('tour voice-assist edge tts', message)
  }

  return null
}
