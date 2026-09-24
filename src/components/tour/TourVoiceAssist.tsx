'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'
import type { TourLocale } from '@/lib/tour/tourMessages'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useVoiceInterruption } from '@/hooks/useVoiceInterruption'
import { sanitizeVoiceConversation, type VoiceConversationTurn } from '@/lib/tour/voiceConversation'
import { isVoiceQuestion } from '@/lib/tour/voiceTurnIntent'
import { Loader2, Mic, MicOff, X } from 'lucide-react'
import {
  EMPTY_VOICE_FILTERS,
  TOUR_VOICE_ASSISTANT_NAME,
  VOICE_FAREWELL,
  isConversationEnd,
  isShortAffirmative,
  isShortDecline,
  markAskedVoicePhone,
  parseListedOptionChoice,
  parsePhoneFromTranscript,
  splitSpeakChunks,
  toVoiceCatalog,
  voiceAssistantGreeting,
  wantsLeavePhone,
  withSoftPhoneAsk,
  type VoiceAssistFilters,
  type VoiceAssistResult,
  type VoiceAssistUnitCard,
} from '@/lib/tour/voiceAssist'
import { buildGaleriaStills } from '@/lib/tour/galeriaStills'
import { isShowroomIdentified } from '@/lib/tour/showroomIdentity'
import { identifyTourLead, openTourSession } from '@/lib/tour/visitorTracking'
import type { TourPublicCatalog, TourUnitSummary } from '@/types/tour'
import { cn } from '@/lib/utils'

type TourVoiceAssistProps = {
  units: TourUnitSummary[]
  onPickUnit: (unit: TourUnitSummary) => void
  /** Adelanto visual de una opción sin abrir ficha ni pedir WhatsApp. */
  onPreviewUnit?: (unit: TourUnitSummary) => void
  /** Catálogo público para miniaturas de tipología. */
  publicCatalog?: TourPublicCatalog | null
  /** Cambia al navegar (vista/ambiente) para disparar tips aleatorios. */
  sceneKey?: string
  /** Si true, el botón Mic vive fuera (columna de acciones / rail del plano). */
  hideTrigger?: boolean
  /** Ajusta anclaje del panel según plano del edificio o unidad. */
  layout?: 'plan' | 'unit'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

function optionPreviewUrl(
  card: VoiceAssistUnitCard,
  units: TourUnitSummary[],
  catalog: TourPublicCatalog | null | undefined,
): string | null {
  if (!catalog?.typologies?.length) return null
  const unit = units.find((u) => u.id === card.id)
  const typ =
    catalog.typologies.find((t) => t.id === unit?.unit_type_id) ??
    catalog.typologies.find(
      (t) => t.code === (unit?.typology_code || card.typology_code || ''),
    )
  if (!typ) return null
  let seed = 1
  for (let i = 0; i < card.id.length; i++) seed = (seed + card.id.charCodeAt(i) * (i + 1)) % 9973
  const stills = buildGaleriaStills(typ, catalog.finishes, {
    randomPerRoom: true,
    seed,
  })
  return stills[0]?.url ?? typ.renders[0]?.url ?? typ.vistas[0]?.url ?? null
}

type Phase = 'idle' | 'recording' | 'thinking' | 'speaking' | 'ready' | 'error'

type TipPlacement =
  | 'top-left'
  | 'top-right'
  | 'mid-left'
  | 'mid-right'
  | 'bottom-left'
  | 'bottom-center'

type FloatingTip = {
  id: number
  title: string
  body: string
  placement: TipPlacement
}

const TIP_COUNT_KEY = 'tour-voice-assist-tip-count-v2'
const MAX_TIPS_PER_SESSION = 5

const TIPS = [
  {
    title: 'Prueba el asistente de voz',
    body: 'Puede ayudarte a encontrar una unidad según lo que buscas.',
  },
  {
    title: 'Dile qué necesitas',
    body: 'Por ejemplo: “2 dormitorios” o “piso alto”. Te mostrará opciones.',
  },
  {
    title: '¿No sabes por dónde empezar?',
    body: 'Prueba el asistente: cuéntale tu idea y te presenta lo que tenemos.',
  },
  {
    title: 'Asistente de voz',
    body: 'Háblale o escríbele. Te sugiere unidades que encajan contigo.',
  },
] as const

const PLACEMENTS: TipPlacement[] = [
  'top-left',
  'top-right',
  'mid-left',
  'mid-right',
  'bottom-left',
  'bottom-center',
]

/** En pantallas chicas evitamos esquinas que chocan con modos / favoritos / mic. */
const PLACEMENTS_NARROW: TipPlacement[] = ['top-left', 'bottom-center']

function placementClass(placement: TipPlacement) {
  switch (placement) {
    case 'top-left':
      return 'top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] left-[max(0.75rem,env(safe-area-inset-left))] max-sm:right-auto'
    case 'top-right':
      return 'top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] right-[max(0.75rem,env(safe-area-inset-right))] max-sm:right-[max(0.75rem,env(safe-area-inset-right))] max-sm:left-auto'
    case 'mid-left':
      return 'top-[42%] left-[max(0.75rem,env(safe-area-inset-left))] -translate-y-1/2 max-sm:top-[38%]'
    case 'mid-right':
      return 'top-[42%] right-[max(4.5rem,calc(env(safe-area-inset-right)+3.5rem))] -translate-y-1/2'
    case 'bottom-left':
      return 'bottom-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))] left-[max(0.75rem,env(safe-area-inset-left))] max-sm:bottom-[max(5.25rem,calc(env(safe-area-inset-bottom)+4.25rem))]'
    case 'bottom-center':
      return 'bottom-[max(7.5rem,calc(env(safe-area-inset-bottom)+6.5rem))] left-1/2 -translate-x-1/2 max-sm:bottom-[max(6.25rem,calc(env(safe-area-inset-bottom)+5.25rem))] max-sm:w-[min(100%-1.5rem,16rem)]'
    default:
      return 'bottom-24 left-4'
  }
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!
}

function isNarrowViewport() {
  if (typeof window === 'undefined') return true
  return window.innerWidth < 640 || window.innerHeight < 520
}

function readTipCount() {
  try {
    return Number(sessionStorage.getItem(TIP_COUNT_KEY) || '0') || 0
  } catch {
    return 0
  }
}

function writeTipCount(n: number) {
  try {
    sessionStorage.setItem(TIP_COUNT_KEY, String(n))
  } catch {
    /* ignore */
  }
}

function pickMime(): { mime: string; ext: string } {
  if (typeof MediaRecorder === 'undefined') return { mime: '', ext: 'webm' }
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    return { mime: 'audio/webm;codecs=opus', ext: 'webm' }
  }
  if (MediaRecorder.isTypeSupported('audio/mp4')) {
    return { mime: 'audio/mp4', ext: 'mp4' }
  }
  if (MediaRecorder.isTypeSupported('audio/webm')) {
    return { mime: 'audio/webm', ext: 'webm' }
  }
  return { mime: '', ext: 'webm' }
}

function pickWarmVoice(locale: TourLocale): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  const spanish = voices.filter((v) => v.lang.toLowerCase().startsWith(locale))
  const prefer =
    /sabina|paulina|lucia|lucía|monica|mónica|dalia|elena|soledad|female|mujer|zira|google español|microsoft sabina|es-mx|es-ec|es-us/i
  return spanish.find((v) => prefer.test(v.name) || prefer.test(v.lang)) || spanish[0] || null
}

/** Web Speech API (Chrome/Safari); no siempre tipado en TS DOM. */
type TourSpeechRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort?: () => void
  onresult: ((event: TourSpeechRecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type TourSpeechRecognitionEvent = {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0?: { transcript: string }
  }>
}

function speakWithBrowser(text: string, locale: TourLocale): Promise<void> {
  if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.resolve()
  return new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel()
      const utter = new SpeechSynthesisUtterance(text)
      utter.lang = locale === 'en' ? 'en-US' : 'es-EC'
      utter.rate = 0.94
      utter.pitch = 1.02
      utter.volume = 1
      const voice = pickWarmVoice(locale)
      if (voice) {
        utter.voice = voice
        utter.lang = voice.lang || utter.lang
      }
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        speakWaiters=speakWaiters.filter(waiter=>waiter!==finish)
        resolve()
      }
      speakWaiters.push(finish)
      utter.onend = finish
      utter.onerror = finish
      const speakNow = () => {
        try {
          window.speechSynthesis.speak(utter)
        } catch {
          finish()
        }
      }
      // Hablar ya: no esperar voiceschanged (eso sumaba cientos de ms).
      speakNow()
      window.setTimeout(finish, Math.min(18_000, 1400 + text.length * 55))
    } catch {
      resolve()
    }
  })
}

let speakSeq = 0
const speechRequests = new Set<AbortController>()
let activeAudio: HTMLAudioElement | null = null
let activeObjectUrl: string | null = null
let speakWaiters: Array<() => void> = []

function settleSpeakWaiters() {
  const waiters = speakWaiters
  speakWaiters = []
  for (const w of waiters) w()
}

function stopSpokenAudio() {
  speakSeq++
  for(const request of speechRequests)request.abort()
  speechRequests.clear()
  try {
    activeAudio?.pause()
  } catch {
    /* ignore */
  }
  activeAudio = null
  if (activeObjectUrl) {
    try {
      URL.revokeObjectURL(activeObjectUrl)
    } catch {
      /* ignore */
    }
    activeObjectUrl = null
  }
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
  settleSpeakWaiters()
}

function playAudioBlob(blob: Blob, seq: number): Promise<void> {
  return new Promise((resolve) => {
    if (seq !== speakSeq) {
      resolve()
      return
    }
    if (activeObjectUrl) {
      try {
        URL.revokeObjectURL(activeObjectUrl)
      } catch {
        /* ignore */
      }
      activeObjectUrl = null
    }
    const url = URL.createObjectURL(blob)
    activeObjectUrl = url
    const audio = new Audio(url)
    activeAudio = audio
    const done = () => {
      speakWaiters=speakWaiters.filter(waiter=>waiter!==done)
      if (activeAudio === audio) {
        activeAudio = null
        if (activeObjectUrl === url) {
          try {
            URL.revokeObjectURL(url)
          } catch {
            /* ignore */
          }
          activeObjectUrl = null
        }
      }
      resolve()
    }
    speakWaiters.push(done)
    audio.onended = done
    audio.onerror = done
    void audio.play().catch(done)
  })
}

function getSpeechRecognitionCtor(): (new () => TourSpeechRecognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => TourSpeechRecognition
    webkitSpeechRecognition?: new () => TourSpeechRecognition
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function base64ToAudioBlob(base64: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'audio/mpeg' })
}

async function fetchOpenAiSpeakBlob(text: string, locale: TourLocale = 'es'): Promise<Blob | null> {
  const controller=new AbortController();speechRequests.add(controller)
  try {
    const res = await fetch('/api/tour/voice-assist/speak', {
      signal:controller.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 600), locale }),
    })
    if (!res.ok) return null
    const blob = await res.blob()
    return blob.size > 0 ? blob : null
  } catch {
    return null
  } finally {speechRequests.delete(controller)}
}

function warmOpenAiSpeak() {
  if (typeof window === 'undefined') return
  void fetchOpenAiSpeakBlob('Listo.')
}

/**
 * Voz OpenAI (nova). Parte en trozos y precarga el siguiente para que empiece rápido.
 * Solo cae al navegador si OpenAI/Edge fallan.
 */
async function speakText(
  text: string,
  opts?: {
    firstAudioBase64?: string | null
    onChunk?: (chunk: string, index: number) => void
    locale?: TourLocale
  },
): Promise<void> {
  const line = text.replace(/\s+/g, ' ').trim()
  const locale = opts?.locale ?? 'es'
  if (!line || typeof window === 'undefined') return

  stopSpokenAudio()
  const seq = speakSeq

  const chunks = splitSpeakChunks(line)
  let index = 0
  let nextFetch: Promise<Blob | null> | null = null
  const notify = (i: number) => {
    const chunk = chunks[i]
    if (chunk) opts?.onChunk?.(chunk, i)
  }

  if (opts?.firstAudioBase64) {
    const first = base64ToAudioBlob(opts.firstAudioBase64)
    notify(0)
    if (chunks.length > 1) nextFetch = fetchOpenAiSpeakBlob(chunks[1]!, locale)
    await playAudioBlob(first, seq)
    if (seq !== speakSeq) return
    index = 1
  } else {
    nextFetch = fetchOpenAiSpeakBlob(chunks[0]!, locale)
  }

  for (; index < chunks.length; index++) {
    if (seq !== speakSeq) return
    notify(index)
    const blob = await (nextFetch ?? fetchOpenAiSpeakBlob(chunks[index]!, locale))
    nextFetch = null
    if (seq !== speakSeq) return

    if (!blob) {
      await speakWithBrowser(chunks.slice(index).join(' '), locale)
      return
    }

    if (index + 1 < chunks.length) {
      nextFetch = fetchOpenAiSpeakBlob(chunks[index + 1]!, locale)
    }
    await playAudioBlob(blob, seq)
  }
}

/** Umbrales para cortar al terminar de hablar (VAD simple por RMS). */
const VAD_SILENCE_RMS = 0.018
const VAD_SILENCE_MS = 650
const VAD_MIN_SPEECH_MS = 220
const VAD_MAX_RECORD_MS = 22_000
const VAD_START_GRACE_MS = 280
export function TourVoiceAssist({
  units,
  onPickUnit,
  onPreviewUnit,
  publicCatalog = null,
  sceneKey = '',
  hideTrigger = false,
  layout = 'unit',
  open: openProp,
  onOpenChange,
  className,
}: TourVoiceAssistProps) {
  const { t, locale } = useTourLanguage()

  const [openUncontrolled, setOpenUncontrolled] = useState(false)
  const open = openProp ?? openUncontrolled
  const setOpen = (next: boolean) => {
    onOpenChange?.(next)
    if (openProp === undefined) setOpenUncontrolled(next)
  }
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VoiceAssistResult | null>(null)
  const [previewOptionIndex, setPreviewOptionIndex] = useState<number | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [tip, setTip] = useState<FloatingTip | null>(null)
  const tipIdRef = useRef(0)
  const turnRef=useRef(0)
  const requestRef=useRef<AbortController|null>(null)
  const cancelTurn=()=>{turnRef.current++;requestRef.current?.abort();requestRef.current=null;stopSpokenAudio()}
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recognitionRef = useRef<TourSpeechRecognition | null>(null)
  const ignoreSpeechErrorRef = useRef(false)
  const unitsRef = useRef(units)
  unitsRef.current = units
  const onPreviewUnitRef = useRef(onPreviewUnit)
  onPreviewUnitRef.current = onPreviewUnit
  const memoryFiltersRef = useRef<VoiceAssistFilters | null>(null)
  const memoryMatchesRef = useRef<VoiceAssistUnitCard[]>([])
  const seenUnitIdsRef = useRef(new Set<string>())
  const historyRef = useRef<VoiceConversationTurn[]>([])
  const phoneInvitationPendingRef = useRef(false)
  /** Conversación continua: un Hablar basta; VAD corta y reescucha tras la respuesta. */
  const conversationRef = useRef(false)
  const openRef = useRef(open)
  openRef.current = open
  const vadRafRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const mimeExtRef = useRef({ mime: '', ext: 'webm' })
  const startingListenRef = useRef(false)
  const heardSpeechRef = useRef(false)
  const typingRef = useRef(false)
  const textDraftRef = useRef(textDraft)
  textDraftRef.current = textDraft
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase

  const rememberResult = (data: VoiceAssistResult, opts?: { preserveMatches?: boolean }) => {
    setResult(data)
    if (data.filters) memoryFiltersRef.current = data.filters
    // Al elegir “opción N” no borramos la lista para poder pedir otra después.
    if (data.matches.length > 0 && !opts?.preserveMatches) {
      memoryMatchesRef.current = data.matches
      data.matches.forEach(unit => seenUnitIdsRef.current.add(unit.id))
    }
  }

  const stopVad = () => {
    if (vadRafRef.current != null) {
      cancelAnimationFrame(vadRafRef.current)
      vadRafRef.current = null
    }
  }

  const releaseMic = () => {
    stopVad()
    try {
      recognitionRef.current?.abort?.()
      recognitionRef.current?.stop()
    } catch {
      /* ignore */
    }
    recognitionRef.current = null
    try {
      if(mediaRef.current){mediaRef.current.onstop=null;mediaRef.current.ondataavailable=null}
      mediaRef.current?.stop()
    } catch {
      /* ignore */
    }
    mediaRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined)
      audioCtxRef.current = null
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined') window.speechSynthesis?.getVoices()
    warmOpenAiSpeak()
    return () => {
      turnRef.current++;requestRef.current?.abort()
      ignoreSpeechErrorRef.current = true
      conversationRef.current = false
      try {
        recognitionRef.current?.abort?.()
        recognitionRef.current?.stop()
      } catch {
        /* ignore */
      }
      releaseMic()
      stopSpokenAudio()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tips flotantes aleatorios al cambiar de vista / ambiente.
  useEffect(() => {
    if (open) {
      setTip(null)
      return
    }
    if (readTipCount() >= MAX_TIPS_PER_SESSION) return
    // ~40% de probabilidad al entrar a una vista.
    if (Math.random() > 0.4) return

    const delay = 2200 + Math.floor(Math.random() * 2800)
    const showId = window.setTimeout(() => {
      const count = readTipCount()
      if (count >= MAX_TIPS_PER_SESSION) return
      tipIdRef.current += 1
      const next = pickRandom(TIPS)
      const places = isNarrowViewport() ? PLACEMENTS_NARROW : PLACEMENTS
      setTip({
        id: tipIdRef.current,
        title: next.title,
        body: next.body,
        placement: pickRandom(places),
      })
      writeTipCount(count + 1)
    }, delay)

    return () => window.clearTimeout(showId)
  }, [sceneKey, open])

  useEffect(() => {
    if (!tip) return
    const hide = window.setTimeout(() => {
      setTip((prev) => (prev?.id === tip.id ? null : prev))
    }, 7500)
    return () => window.clearTimeout(hide)
  }, [tip])

  const dismissTip = () => setTip(null)

  const stopRecorderOnly = () => {
    stopVad()
    const rec = mediaRef.current
    if (!rec || rec.state === 'inactive') {
      mediaRef.current = null
      return
    }
    try {
      rec.stop()
    } catch {
      mediaRef.current = null
    }
  }

  const discardListening = () => {
    stopVad()
    try {
      recognitionRef.current?.abort?.()
      recognitionRef.current?.stop()
    } catch {
      /* ignore */
    }
    recognitionRef.current = null
    const rec = mediaRef.current
    if (rec && rec.state !== 'inactive') {
      rec.ondataavailable = null
      rec.onstop = () => {
        mediaRef.current = null
      }
      try {
        rec.stop()
      } catch {
        mediaRef.current = null
      }
    } else {
      mediaRef.current = null
    }
  }

  const startVadWatch = (stream: MediaStream, onSilence: () => void) => {
    stopVad()
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined)
      audioCtxRef.current = null
    }
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') void ctx.resume()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const startedAt = performance.now()
      let speechMs = 0
      let silenceMs = 0
      let lastTs = startedAt

      const tick = (now: number) => {
        const dt = Math.min(80, now - lastTs)
        lastTs = now
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i]! - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        const elapsed = now - startedAt

        if (elapsed < VAD_START_GRACE_MS) {
          vadRafRef.current = requestAnimationFrame(tick)
          return
        }

        if (rms >= VAD_SILENCE_RMS) {
          speechMs += dt
          silenceMs = 0
          if (speechMs >= VAD_MIN_SPEECH_MS) heardSpeechRef.current = true
        } else if (speechMs >= VAD_MIN_SPEECH_MS) {
          silenceMs += dt
          if (silenceMs >= VAD_SILENCE_MS) {
            onSilence()
            return
          }
        }

        if (elapsed >= VAD_MAX_RECORD_MS) {
          onSilence()
          return
        }
        vadRafRef.current = requestAnimationFrame(tick)
      }
      vadRafRef.current = requestAnimationFrame(tick)
    } catch {
      /* sin VAD: el usuario puede tocar Pausar / Listo */
    }
  }

  const finishAssistantTurn = async (
    data: VoiceAssistResult & { audio_base64?: string | null },
    pickedOption?: number | null,
    opts?: { endAfterSpeak?: boolean },
  ) => {
    data = { ...data, speak: t(data.speak), follow_up: t(data.follow_up) }
    // Abrir ficha solo cuando el visitante eligió (opción N / toque / “sí”).
    // El adelanto visual usa onPreviewUnit y no pide WhatsApp.
    const turn=turnRef.current
    const isUnitReveal = pickedOption != null

    // WhatsApp solo cuando el visitante eligió una unidad.
    const enriched = withSoftPhoneAsk(data, isShowroomIdentified(), {
      afterOptionPick: isUnitReveal,
      locale,
    })
    phoneInvitationPendingRef.current = enriched !== data
    if (data.transcript && !parsePhoneFromTranscript(data.transcript)) {
      historyRef.current = sanitizeVoiceConversation([
        ...historyRef.current,
        { role: 'user', content: data.transcript },
        { role: 'assistant', content: data.speak },
      ])
    }
    rememberResult(enriched, { preserveMatches: isUnitReveal })
    conversationRef.current = true
    setPhase('speaking')
    // Abrir ficha en paralelo mientras habla (menos sensación de espera).
    if (isUnitReveal) {
      const card =
        (enriched.matches.length === 1 ? enriched.matches[0] : null) ??
        (pickedOption != null ? memoryMatchesRef.current[pickedOption - 1] : null)
      if (card) {
        const unit = unitsRef.current.find((u) => u.id === card.id)
        if (unit) onPickUnit(unit)
      }
    }
    // Si se añadió el pedido de WhatsApp, el audio precargado ya no coincide.
    const firstAudio =
      enriched.speak === data.speak ? (data.audio_base64 ?? null) : null
    const previewDuringSpeak =
      !isUnitReveal && enriched.matches.length > 0 && Boolean(onPreviewUnitRef.current)
    setPreviewOptionIndex(null)
    if (previewDuringSpeak && enriched.matches.length === 1) {
      const only = enriched.matches[0]
      const unit = only ? unitsRef.current.find((u) => u.id === only.id) : null
      if (unit) {
        setPreviewOptionIndex(0)
        onPreviewUnitRef.current?.(unit)
      }
    }
    await speakText(enriched.speak, {
      locale,
      firstAudioBase64: firstAudio,
      onChunk: previewDuringSpeak && enriched.matches.length > 1
        ? (chunk) => {
            const m = chunk.match(/Opción\s+(\d+):/i)
            if (!m) return
            const idx = Number(m[1]) - 1
            const card = enriched.matches[idx]
            if (!card) return
            const unit = unitsRef.current.find((u) => u.id === card.id)
            if (!unit) return
            setPreviewOptionIndex(idx)
            onPreviewUnitRef.current?.(unit)
          }
        : undefined,
    })
    if(turn!==turnRef.current)return
    if (!isUnitReveal) setPreviewOptionIndex(null)
    if (!openRef.current) return

    if (opts?.endAfterSpeak) {
      conversationRef.current = false
      releaseMic()
      setPhase('ready')
      setOpen(false)
      return
    }

    // Sigue escuchando hasta “gracias” / despedida (no cortar tras una sola respuesta).
    setPhase('idle')
    await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
    if (!openRef.current || !conversationRef.current) return
    if (textDraftRef.current.trim()) {
      setPhase('ready')
      return
    }
    await startListening()
  }

  const saveVoiceLeadPhone = async (phone: string) => {
    const card = memoryMatchesRef.current[0] ?? null
    const unit = card ? unitsRef.current.find((u) => u.id === card.id) : null
    await openTourSession()
    await identifyTourLead({
      mode: 'phone',
      phone,
      consent: true,
      typology_code: unit?.typology_code ?? card?.typology_code ?? null,
      unit_id: unit?.id ?? card?.id ?? null,
      unit_number: unit?.unit_number ?? card?.unit_number ?? null,
    })
  }

  const tryHandlePhoneTurn = async (text: string): Promise<boolean> => {
    const invitationPending = phoneInvitationPendingRef.current
    phoneInvitationPendingRef.current = false
    if (isVoiceQuestion(text)) return false
    const phone = parsePhoneFromTranscript(text)
    if (phone) {
      setPhase('thinking')
      setError(null)
      try {
        // Siempre identifica/actualiza el lead con el rastro del showroom.
        await saveVoiceLeadPhone(phone)
        markAskedVoicePhone()
        await finishAssistantTurn(
          {
            transcript: text,
            speak:
              'Gracias, su contacto quedó registrado. Podemos seguir revisando los departamentos.',
            filters: memoryFiltersRef.current ?? { ...EMPTY_VOICE_FILTERS },
            matches: memoryMatchesRef.current.slice(0, 3),
            follow_up:
              'Puede decir “opción 1”, otro filtro, o gracias si no desea más información.',
          },
          null,
        )
      } catch (err) {
        setPhase('error')
        setError(
          err instanceof Error
            ? err.message
            : 'No pude guardar su WhatsApp. ¿Podría dictarlo otra vez?',
        )
        if (conversationRef.current && openRef.current) {
          window.setTimeout(() => {
            setPhase('idle')
            void startListening()
          }, 900)
        }
      }
      return true
    }

    // Solo pedir el número si aún no lo dio (evita repetir cuando ya trae dígitos mal parseados).
    if (wantsLeavePhone(text) && !isShowroomIdentified()) {
      const maybeDigits = text.replace(/\D/g, '')
      if (maybeDigits.length >= 8) {
        // Parece un intento de número que no validamos: pedir reformulación, no el flujo genérico.
        setPhase('thinking')
        setError(null)
        await finishAssistantTurn(
          {
            transcript: text,
            speak:
              'Disculpe, no pude validar el número. ¿Podría dictarlo seguido? Por ejemplo: cero nueve y los ocho dígitos.',
            filters: memoryFiltersRef.current ?? { ...EMPTY_VOICE_FILTERS },
            matches: memoryMatchesRef.current.slice(0, 3),
            follow_up: 'También puede escribirlo aquí.',
          },
          null,
        )
        return true
      }
      setPhase('thinking')
      setError(null)
      await finishAssistantTurn(
        {
          transcript: text,
          speak:
            'Con mucho gusto. Cuando quiera, dígame su WhatsApp con el código de área y lo anoto.',
          filters: memoryFiltersRef.current ?? { ...EMPTY_VOICE_FILTERS },
          matches: memoryMatchesRef.current.slice(0, 3),
          follow_up: 'Puede dictar solo el número.',
        },
        null,
      )
      return true
    }

    // Tras “¿desea dejar su WhatsApp?”, un “sí” pide el número (no reabre la opción).
    if (!isShowroomIdentified() && invitationPending && isShortAffirmative(text)) {
      setPhase('thinking')
      setError(null)
      await finishAssistantTurn(
        {
          transcript: text,
          speak: 'Perfecto. Dígame su WhatsApp, por ejemplo cero nueve y los ocho dígitos, y lo anoto.',
          filters: memoryFiltersRef.current ?? { ...EMPTY_VOICE_FILTERS },
          matches: memoryMatchesRef.current.slice(0, 3),
          follow_up: 'Puede dictar solo el número.',
        },
        null,
      )
      return true
    }

    if (!isShowroomIdentified() && invitationPending && isShortDecline(text)) {
      setPhase('thinking')
      setError(null)
      await finishAssistantTurn(
        {
          transcript: text,
          speak:
            'Sin problema. Podemos seguir revisando las opciones sin dejar ningún contacto.',
          filters: memoryFiltersRef.current ?? { ...EMPTY_VOICE_FILTERS },
          matches: memoryMatchesRef.current.slice(0, 3),
          follow_up: null,
        },
        null,
      )
      return true
    }

    return false
  }

  const buildPickedTurn = (text: string, option: number, picked: VoiceAssistUnitCard): VoiceAssistResult => {
    return {
      transcript: text,
      speak: `Perfecto, le abro la opción ${option}. Puede revisar la galería con calma.`,
      filters: memoryFiltersRef.current ?? { ...EMPTY_VOICE_FILTERS },
      matches: [picked],
      follow_up:
        'Puede preguntarme por esta unidad o compararla con las otras opciones.',
    }
  }

  const handleUserText = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    if (await tryHandlePhoneTurn(trimmed)) return

    const option = parseListedOptionChoice(trimmed, memoryMatchesRef.current.length)
    const ending = isConversationEnd(trimmed)

    if (option != null && memoryMatchesRef.current.length > 0) {
      const picked = memoryMatchesRef.current[option - 1]
      if (picked) {
        setPhase('thinking')
        setError(null)
        setTextDraft('')
        // Guarda el listado completo antes de reducir matches al elegido (para “otra opción”).
        const listed = memoryMatchesRef.current.slice()
        memoryMatchesRef.current = listed
        await finishAssistantTurn(buildPickedTurn(trimmed, option, picked), option, {
          endAfterSpeak: ending,
        })
        // Tras elegir, conserva el listado para poder pedir otra opción.
        memoryMatchesRef.current = listed
        return
      }
    }

    if (ending) {
      setPhase('thinking')
      setError(null)
      await finishAssistantTurn(
        {
          transcript: trimmed,
          speak: VOICE_FAREWELL,
          filters: memoryFiltersRef.current ?? { ...EMPTY_VOICE_FILTERS },
          matches: memoryMatchesRef.current.slice(0, 3),
          follow_up: null,
        },
        null,
        { endAfterSpeak: true },
      )
      return
    }

    requestRef.current?.abort()
    const controller=new AbortController();requestRef.current=controller
    const turn=++turnRef.current
    setPhase('thinking')
    setError(null)
    try {
      const res = await fetch('/api/tour/voice-assist', {
        signal:controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          units: toVoiceCatalog(unitsRef.current),
          previous_filters: memoryFiltersRef.current,
          previous_matches: memoryMatchesRef.current,
          seen_unit_ids: [...seenUnitIdsRef.current],
          history: historyRef.current,
          locale,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as VoiceAssistResult & {
        error?: string
        audio_base64?: string | null
      }
      if(controller.signal.aborted || turn!==turnRef.current)return
      if (!res.ok) throw new Error(data.error || 'No pude buscar ahora')
      setTextDraft('')
      await finishAssistantTurn(data, null)
    } catch (err) {
      if(controller.signal.aborted || turn!==turnRef.current)return
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Error al procesar')
      if (conversationRef.current && openRef.current) {
        window.setTimeout(() => {
          setPhase('idle')
          void startListening()
        }, 900)
      }
    }
  }

  const runTextSearch = async (text: string) => {
    await handleUserText(text)
  }

  const submitAudio = async (blob: Blob, ext: string) => {
    requestRef.current?.abort()
    const controller=new AbortController();requestRef.current=controller
    const turn=++turnRef.current
    setPhase('thinking')
    setError(null)
    try {
      const form = new FormData()
      form.set('history', JSON.stringify(historyRef.current))
      form.set('locale', locale)
      form.set('audio', blob, `voice.${ext}`)
      form.set('units', JSON.stringify(toVoiceCatalog(unitsRef.current)))
      if (memoryFiltersRef.current) {
        form.set('previous_filters', JSON.stringify(memoryFiltersRef.current))
      }
      if (memoryMatchesRef.current.length > 0) {
        form.set('previous_matches', JSON.stringify(memoryMatchesRef.current))
        form.set('seen_unit_ids', JSON.stringify([...seenUnitIdsRef.current]))
      }
      const res = await fetch('/api/tour/voice-assist', { method: 'POST', body: form, signal:controller.signal })
      const data = (await res.json().catch(() => ({}))) as VoiceAssistResult & {
        error?: string
        audio_base64?: string | null
      }
      if(controller.signal.aborted || turn!==turnRef.current)return
      if (!res.ok) throw new Error(data.error || 'No pude escuchar eso')

      const transcript = (data.transcript || '').trim()
      if (transcript && (await tryHandlePhoneTurn(transcript))) return

      const option = parseListedOptionChoice(transcript, memoryMatchesRef.current.length)
      const ending = Boolean(transcript && isConversationEnd(transcript))

      if (option != null && memoryMatchesRef.current.length > 0) {
        const picked = memoryMatchesRef.current[option - 1]
        if (picked) {
          const listed = memoryMatchesRef.current.slice()
          await finishAssistantTurn(buildPickedTurn(transcript, option, picked), option, {
            endAfterSpeak: ending,
          })
          memoryMatchesRef.current = listed
          return
        }
      }

      if (ending) {
        await finishAssistantTurn(
          {
            ...data,
            speak: VOICE_FAREWELL,
            follow_up: null,
          },
          null,
          { endAfterSpeak: true },
        )
        return
      }

      await finishAssistantTurn({ ...data, transcript }, null)
    } catch (err) {
      if(controller.signal.aborted || turn!==turnRef.current)return
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Error al procesar')
      if (conversationRef.current && openRef.current) {
        window.setTimeout(() => {
          setPhase('idle')
          void startListening()
        }, 900)
      }
    }
  }

  const submitText = async () => {
    const text = textDraft.trim()
    if (!text) return
    await runTextSearch(text)
  }

  // A browser silence timeout is not a failed user utterance. Re-arm quietly.
  const resumeQuietListening = () => {
    const turn = turnRef.current
    window.setTimeout(() => {
      if (turn !== turnRef.current || !conversationRef.current || !openRef.current ||
          typingRef.current || textDraftRef.current.trim() || ignoreSpeechErrorRef.current) return
      void startListening()
    }, 300)
  }

  const startSpeechRecognition = async (): Promise<boolean> => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return false

    startingListenRef.current = true
    try {
      setError(null)
      setPhase('recording')
      stopSpokenAudio()
      ignoreSpeechErrorRef.current = false

      const recognition = new Ctor()
      recognition.lang = locale === 'en' ? 'en-US' : 'es-EC'
      recognition.continuous = false
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      let finalText = ''
      let failed = false

      recognition.onresult = (event: TourSpeechRecognitionEvent) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const row = event.results[i]
          if (!row?.[0]) continue
          if (row.isFinal) finalText += row[0].transcript
        }
      }

      recognition.onerror = (event: { error: string }) => {
        if (recognitionRef.current !== recognition || ignoreSpeechErrorRef.current) return
        if (event.error === 'aborted' || event.error === 'no-speech') return
        failed = true
        conversationRef.current = false
        setPhase('error')
        setError('Se interrumpió el reconocimiento de voz. Vuelva a tocar Hablar para intentarlo.')
        if (event.error === 'not-allowed') {
          setPhase('error')
          setError(
            'El micrófono está bloqueado. En el candado de la barra de dirección permita el acceso y vuelva a tocar Hablar.',
          )
        }
      }

      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return
        recognitionRef.current = null
        if (failed || ignoreSpeechErrorRef.current) return
        if (!openRef.current || !conversationRef.current) return
        if (textDraftRef.current.trim() || typingRef.current) {
          setPhase('ready')
          return
        }
        const text = finalText.replace(/\s+/g, ' ').trim()
        if (!text) {
          resumeQuietListening()
          return
        }
        void handleUserText(text)
      }

      recognitionRef.current = recognition
      recognition.start()
      setPhase('recording')
      return true
    } catch {
      recognitionRef.current = null
      return false
    } finally {
      startingListenRef.current = false
    }
  }

  const startListening = async () => {
    if (startingListenRef.current) return
    if (!openRef.current) return
    if (recognitionRef.current) return
    if (mediaRef.current?.state === 'recording') return
    if (textDraftRef.current.trim()) return
    if (typingRef.current) return

    const secure =
      window.isSecureContext ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1'
    if (!secure) {
      setError(
        'El micrófono solo funciona en HTTPS o en localhost. Abre el sitio seguro o escribe abajo.',
      )
      setPhase('error')
      return
    }

    // Preferir reconocimiento nativo: sin subir audio ni esperar Whisper.
    if (await startSpeechRecognition()) return
    await startMediaRecorder()
  }

  const startMediaRecorder = async () => {
    if (startingListenRef.current) return
    if (!openRef.current) return
    if (mediaRef.current?.state === 'recording') return
    if (textDraftRef.current.trim()) return
    if (typingRef.current) return

    const secure =
      window.isSecureContext ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1'
    if (!secure) {
      setError(
        'El micrófono solo funciona en HTTPS o en localhost. Abre el sitio seguro o escribe abajo.',
      )
      setPhase('error')
      return
    }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador no permite grabar. Puede escribir su búsqueda abajo y con gusto le ayudo.')
      setPhase('error')
      return
    }

    startingListenRef.current = true
    try {
      setError(null)
      setPhase('recording')
      stopSpokenAudio()
      ignoreSpeechErrorRef.current = false

      let stream = streamRef.current
      const live = stream?.getTracks().some((t) => t.readyState === 'live')
      if (!stream || !live) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        streamRef.current = stream
        mimeExtRef.current = pickMime()
      }

      const { mime, ext } = mimeExtRef.current.mime ? mimeExtRef.current : pickMime()
      mimeExtRef.current = { mime, ext }
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      heardSpeechRef.current = false
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        if (mediaRef.current !== recorder) return
        mediaRef.current = null
        stopVad()
        const type = recorder.mimeType || mime || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        const noSpeech = !heardSpeechRef.current || blob.size < 120

        if (noSpeech) {
          if (conversationRef.current && openRef.current) resumeQuietListening()
          else setPhase('ready')
          return
        }
        void submitAudio(blob, ext)
      }
      mediaRef.current = recorder
      recorder.start()
      setPhase('recording')
      startVadWatch(stream, () => {
        if (mediaRef.current && mediaRef.current.state === 'recording') {
          stopRecorderOnly()
        }
      })
    } catch (err) {
      releaseMic()
      setPhase('error')
      conversationRef.current = false
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError(
          'El micrófono está bloqueado. En el candado de la barra de dirección (o Ajustes del celular → Safari/Chrome → Micrófono) permita el acceso y vuelva a tocar Hablar.',
        )
      } else if (name === 'NotFoundError') {
        setError('No encontré micrófono. Puede escribir abajo y con gusto le ayudo.')
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setError('El micrófono está ocupado por otra aplicación. Ciérrela y vuelva a intentar.')
      } else {
        setError('No pude usar el micrófono ahora. Puede escribir abajo, sin problema.')
      }
    } finally {
      startingListenRef.current = false
    }
  }

  const startRecording = async () => {
    cancelTurn()
    setError(null)
    conversationRef.current = true
    stopSpokenAudio()
    await startListening()
  }

  const pauseConversation = () => {
    cancelTurn()
    conversationRef.current = false
    ignoreSpeechErrorRef.current = true
    stopVad()
    try {
      recognitionRef.current?.abort?.()
      recognitionRef.current?.stop()
    } catch {
      /* ignore */
    }
    recognitionRef.current = null
    const rec = mediaRef.current
    if (rec && rec.state !== 'inactive') {
      // Descarta el fragmento actual al pausar (no enviar ruido).
      rec.ondataavailable = null
      rec.onstop = () => {
        mediaRef.current = null
      }
      try {
        rec.stop()
      } catch {
        mediaRef.current = null
      }
    }
    releaseMic()
    setPhase('ready')
  }

  const stopRecording = () => {
    const recognition = recognitionRef.current
    if (recognition) {
      try {
        recognition.stop()
      } catch {
        recognitionRef.current = null
      }
      return
    }
    // Listo manual: corta el turno pero mantiene conversación (vuelve a escuchar tras responder).
    stopRecorderOnly()
  }

  const openPanel = () => {
    setOpen(true)
  }

  const closePanel = () => {
    cancelTurn()
    ignoreSpeechErrorRef.current = true
    conversationRef.current = false
    releaseMic()
    stopSpokenAudio()
    setOpen(false)
  }

  useEffect(()=>{
    if(!open){cancelTurn();conversationRef.current=false;releaseMic()}
    // Closing from the showroom menu must also stop playback and pending responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open])

  // Al abrir: tip off + saludo (Hablar bloqueado hasta terminar de hablar / escuchar).
  useEffect(() => {
    cancelTurn()
    releaseMic()
    setResult(null)
    setError(null)
    phoneInvitationPendingRef.current = false
    // Cancel old-language audio and requests; keep the selected units and filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale])

  useEffect(() => {
    if (!open) return
    dismissTip()
    setError(null)
    typingRef.current = textDraftRef.current.trim().length > 0
    if (result) {
      conversationRef.current = true
      if (!typingRef.current) void startListening()
      else setPhase('ready')
      return
    }
    setPhase('speaking')
    const greetingTurn=turnRef.current
    const timer = window.setTimeout(() => {
      void (async () => {
        await speakText(t(voiceAssistantGreeting()), { locale })
        if(greetingTurn!==turnRef.current)return
        if (!openRef.current) return
        conversationRef.current = true
        if (textDraftRef.current.trim()) {
          setPhase('ready')
          return
        }
        await startListening()
      })()
    }, 40)
    return () => window.clearTimeout(timer)
    // Solo al pasar a abierto; no re-saludar si cambia el resultado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locale])

  // Al escribir: no escuchar. Al vaciar el campo: volver a escuchar.
  useEffect(() => {
    if (!open) return
    const typing = textDraft.trim().length > 0
    const wasTyping = typingRef.current
    typingRef.current = typing

    if (typing) {
      discardListening()
      if (phaseRef.current === 'recording') setPhase('ready')
      return
    }

    if (
      wasTyping &&
      !typing &&
      conversationRef.current &&
      phaseRef.current !== 'thinking' &&
      phaseRef.current !== 'speaking'
    ) {
      void startListening()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textDraft, open])

  const softPreview = (card: VoiceAssistUnitCard, index: number) => {
    const unit = units.find((u) => u.id === card.id)
    if (!unit || !onPreviewUnit) return
    setPreviewOptionIndex(index)
    onPreviewUnit(unit)
  }

  const pick = (card: VoiceAssistUnitCard) => {
    const listed = (
      memoryMatchesRef.current.length > 0 ? memoryMatchesRef.current : result?.matches ?? []
    ).slice()
    const idx = listed.findIndex((m) => m.id === card.id)
    const option = idx >= 0 ? idx + 1 : 1
    memoryMatchesRef.current = listed.length > 0 ? listed : [card]
    setPreviewOptionIndex(null)
    setPhase('thinking')
    setError(null)
    void finishAssistantTurn(buildPickedTurn(`opción ${option}`, option, card), option).then(() => {
      memoryMatchesRef.current = listed.length > 0 ? listed : memoryMatchesRef.current
    })
  }

  useVoiceInterruption(open && (phase==='speaking'||phase==='thinking') && conversationRef.current,()=>{void startRecording()})

  return (
    <>
      {/* Tips flotantes en posiciones aleatorias */}
      {tip && !open ? (
        <div
          className={cn(
            'pointer-events-none absolute z-[126]',
            placementClass(tip.placement),
          )}
        >
          <div
            className="pointer-events-auto w-[min(100vw-1.5rem,15rem)] max-w-[15rem] rounded-2xl border border-white/12 bg-[#14110e]/80 px-3 py-2.5 text-[#f7f3ee] shadow-[0_10px_28px_rgba(0,0,0,0.38)] backdrop-blur-md"
            role="status"
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold leading-snug tracking-wide text-[#E8D9C0]">
                {t(tip.title)}
              </p>
              <button
                type="button"
                onClick={dismissTip}
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white/80"
                aria-label={t("Cerrar tip")}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
            <p className="text-[11px] leading-snug text-white/65">{t(tip.body)}</p>
            <button
              type="button"
              onClick={openPanel}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#BDA27E]/22 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-[#E8D9C0] uppercase transition hover:bg-[#BDA27E]/32"
            >
              <Mic size={12} strokeWidth={2} />
              {t(" Probar ")}</button>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          'pointer-events-none absolute z-[125]',
          // Trigger propio (fallback): esquina inferior izquierda, arriba del zoom del plano.
          !open &&
            !hideTrigger &&
            'bottom-[max(6.75rem,calc(env(safe-area-inset-bottom)+6.25rem))] left-[max(0.75rem,env(safe-area-inset-left))]',
          // Panel abierto: en plano deja libre el rail derecho; en unidad ancla a la columna.
          open &&
            layout === 'plan' &&
            'inset-x-0 bottom-0 flex justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:inset-auto sm:bottom-[max(0.75rem,env(safe-area-inset-bottom))] sm:left-[max(0.75rem,env(safe-area-inset-left))] sm:right-auto sm:justify-start sm:p-0',
          open &&
            layout === 'unit' &&
            'inset-x-0 bottom-0 flex justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:inset-auto sm:bottom-[max(0.75rem,env(safe-area-inset-bottom))] sm:right-[max(3.75rem,calc(env(safe-area-inset-right)+3.25rem))] sm:justify-end sm:p-0',
          className,
        )}
      >
        {!open && !hideTrigger ? (
          <button
            type="button"
            onClick={openPanel}
            className="pointer-events-auto tour-glass group inline-flex h-10 w-10 items-center justify-center border border-[#BDA27E]/40 text-[#f7f3ee] shadow-[0_8px_22px_rgba(0,0,0,0.35)] transition hover:border-[#BDA27E]/65 hover:bg-white/10 sm:h-11 sm:w-11"
            aria-label={t("Abrir asistente de voz")}
            title={t("Asistente de voz")}
          >
            <Mic
              size={17}
              strokeWidth={1.75}
              className="text-[#E8D9C0] transition group-hover:scale-105"
            />
          </button>
        ) : null}
        {open ? (
          <div className="pointer-events-auto flex max-h-[min(72dvh,32rem)] w-[min(100vw-1rem,20.5rem)] flex-col overflow-hidden rounded-2xl bg-[#14110e]/92 text-[#f7f3ee] shadow-[0_16px_48px_rgba(0,0,0,0.5)] ring-1 ring-white/15 backdrop-blur-md max-sm:w-full max-sm:max-w-[22rem]">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#BDA27E]/18 text-[#E8D9C0]">
                  <Mic size={15} strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold tracking-[0.16em] text-[#BDA27E] uppercase">
                    {t(TOUR_VOICE_ASSISTANT_NAME)}
                  </p>
                  <p className="truncate text-[12px] text-white/75">{t("Asistente de La Vilet")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/15"
                aria-label={t("Cerrar asistente")}
              >
                <X size={15} />
              </button>
            </div>

          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-3">
            {phase === 'recording' ? (
              <p className="text-center text-[13px] text-[#BDA27E]">
                {t(" Le escucho… al callarse respondo y sigo atento. Si no desea más información, diga")}{t(' ')}
                <span className="font-semibold">{t("gracias")}</span> {t(" y cierro. ")}</p>
            ) : null}
            {phase === 'ready' && textDraft.trim() ? (
              <p className="text-center text-[12px] text-white/55">
                {t(" Micrófono en pausa mientras escribe. Borre el texto para volver a hablar. ")}</p>
            ) : null}
            {phase === 'thinking' ? (
              <p className="flex items-center justify-center gap-2 text-[13px] text-white/70">
                <Loader2 size={14} className="animate-spin" /> {t(" Un momento, busco opciones… ")}</p>
            ) : null}
            {(phase==='speaking'||phase==='thinking')?<div className="flex gap-3 text-xs"><button type="button" onClick={()=>void startRecording()} className="rounded border border-white/30 p-2">{t("Interrumpir y hablar")}</button><button type="button" onClick={pauseConversation} className="rounded border border-white/30 p-2">{t("Silenciar")}</button></div>:null}
            {phase === 'speaking' ? (
              <p className="flex items-center justify-center gap-2 text-[13px] text-white/70">
                <Loader2 size={14} className="animate-spin" /> {t(" Respondiendo… ")}</p>
            ) : null}
            {error ? <p className="text-[12px] text-[#f0d5c8]">{t(error)}</p> : null}

            {result ? (
              <div className="space-y-2">
                {result.transcript ? (
                  <p className="text-[11px] text-white/45">
                    {t(" Tú: ")}<span className="text-white/70">{t(result.transcript)}</span>
                  </p>
                ) : null}
                <p className="text-[13px] leading-snug text-white/90">{t(result.speak)}</p>
                {result.matches.length > 0 ? (
                  <ul className="space-y-2">
                    {result.matches.map((m, index) => {
                      const thumb = optionPreviewUrl(m, units, publicCatalog)
                      const active = previewOptionIndex === index
                      const isLocal = m.category === 'local'
                      const title =
                        result.matches.length === 1
                          ? isLocal
                            ? 'Este local'
                            : 'Esta opción'
                          : `Opción ${index + 1}`
                      return (
                        <li key={m.id}>
                          <button
                            type="button"
                            onClick={() => pick(m)}
                            onMouseEnter={() => softPreview(m, index)}
                            onFocus={() => softPreview(m, index)}
                            className={cn(
                              'flex w-full items-stretch gap-2.5 overflow-hidden rounded-xl bg-white/95 text-left text-[#1a2744] shadow-sm transition hover:bg-white',
                              active && 'ring-2 ring-[#c4a574] ring-offset-1 ring-offset-transparent',
                            )}
                          >
                            <div className="relative h-[4.5rem] w-[4.5rem] shrink-0 bg-[#e8e4dc]">
                              {thumb ? (
                                <Image
                                  src={thumb}
                                  alt={t("")}
                                  fill
                                  className="object-cover"
                                  sizes="72px"
                                  unoptimized={thumb.startsWith('http')}
                                />
                              ) : (
                                <div className="absolute inset-0 bg-gradient-to-br from-[#d8d2c6] to-[#b8b0a2]" />
                              )}
                              <span className="absolute left-1 top-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                {t(index + 1)}
                              </span>
                            </div>
                            <span className="flex min-w-0 flex-1 flex-col justify-center py-2 pr-3">
                              <span className="text-[13px] font-semibold leading-tight">{t(title)}</span>
                              <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[#3a4050]">
                                {t(m.blurb)}
                              </span>
                              <span className="mt-1 text-[10px] font-medium text-[#8a7355]">
                                {t(" Tocar para elegir ")}</span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
                {result.follow_up ? (
                  <p className="text-[11px] text-white/50">{t(result.follow_up)}</p>
                ) : null}
              </div>
            ) : phase === 'idle' ? (
              <p className="text-[13px] leading-snug text-white/75">
                {t(" Cuénteme qué busca, por ejemplo: “2 dormitorios, piso alto” o “hasta 180 mil”. ")}</p>
            ) : null}

            <div className="flex items-center gap-2">
              {phase === 'recording' && !textDraft.trim() ? (
                <>
                  <button
                    type="button"
                    onClick={() => stopRecording()}
                    className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#8a5c58] text-[11px] font-semibold tracking-[0.12em] text-white uppercase transition"
                  >
                    <MicOff size={15} /> {t(" Listo ")}</button>
                  <button
                    type="button"
                    onClick={() => pauseConversation()}
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-white/12 px-3 text-[11px] font-semibold tracking-wide text-white/85 uppercase"
                  >
                    {t(" Pausar ")}</button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={
                    Boolean(textDraft.trim()) ||
                    phase === 'thinking' ||
                    phase === 'speaking' ||
                    (phase === 'idle' && !result)
                  }
                  onClick={() => void startRecording()}
                  className={cn(
                    'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#BDA27E] text-[11px] font-semibold tracking-[0.12em] text-[#14110e] uppercase transition hover:bg-[#d4c4a8]',
                    (Boolean(textDraft.trim()) ||
                      phase === 'thinking' ||
                      phase === 'speaking' ||
                      (phase === 'idle' && !result)) &&
                      'opacity-60',
                  )}
                >
                  <Mic size={15} /> {t(" Hablar ")}</button>
              )}
            </div>

            <form
              className="flex gap-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                void submitText()
              }}
            >
              <input
                value={textDraft}
                onChange={(event) => setTextDraft(event.target.value)}
                placeholder={t("O escribe aquí…")}
                disabled={phase === 'thinking' || phase === 'speaking'}
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/25 px-2.5 py-2 text-[12px] text-white placeholder:text-white/35 outline-none focus:border-[#BDA27E]/50"
              />
              <button
                type="submit"
                disabled={phase === 'thinking' || phase === 'speaking' || !textDraft.trim()}
                className="rounded-lg bg-white/12 px-2.5 text-[11px] font-semibold tracking-wide text-white/85 uppercase disabled:opacity-40"
              >
                {t(" Ir ")}</button>
            </form>
          </div>
        </div>
        ) : null}
      </div>
    </>
  )
}
