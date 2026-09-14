'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, MicOff, X } from 'lucide-react'
import {
  toVoiceCatalog,
  type VoiceAssistResult,
  type VoiceAssistUnitCard,
} from '@/lib/tour/voiceAssist'
import type { TourUnitSummary } from '@/types/tour'
import { cn } from '@/lib/utils'

type TourVoiceAssistProps = {
  units: TourUnitSummary[]
  onPickUnit: (unit: TourUnitSummary) => void
  /** Cambia al navegar (vista/ambiente) para disparar tips aleatorios. */
  sceneKey?: string
  /** Si true, el botón Mic vive fuera (columna de acciones) y aquí solo panel/tips. */
  hideTrigger?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

type Phase = 'idle' | 'recording' | 'thinking' | 'ready' | 'error'

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

function pickWarmVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  const spanish = voices.filter((v) => v.lang.toLowerCase().startsWith('es'))
  const prefer =
    /sabina|paulina|lucia|lucía|monica|mónica|dalia|elena|soledad|female|mujer|zira|google español|microsoft sabina|es-mx|es-ar|es-us/i
  return spanish.find((v) => prefer.test(v.name) || prefer.test(v.lang)) || spanish[0] || null
}

function speakText(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'es-ES'
    utter.rate = 0.94
    utter.pitch = 1.08
    utter.volume = 1
    const voice = pickWarmVoice()
    if (voice) {
      utter.voice = voice
      utter.lang = voice.lang || 'es-ES'
    }
    // Algunas voces cargan async la primera vez.
    const speakNow = () => window.speechSynthesis.speak(utter)
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.addEventListener('voiceschanged', speakNow, { once: true })
      window.setTimeout(speakNow, 250)
    } else {
      speakNow()
    }
  } catch {
    /* ignore */
  }
}

export function TourVoiceAssist({
  units,
  onPickUnit,
  sceneKey = '',
  hideTrigger = false,
  open: openProp,
  onOpenChange,
  className,
}: TourVoiceAssistProps) {
  const [openUncontrolled, setOpenUncontrolled] = useState(false)
  const open = openProp ?? openUncontrolled
  const setOpen = (next: boolean) => {
    onOpenChange?.(next)
    if (openProp === undefined) setOpenUncontrolled(next)
  }
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VoiceAssistResult | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [tip, setTip] = useState<FloatingTip | null>(null)
  const tipIdRef = useRef(0)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recognitionRef = useRef<{ stop: () => void; abort?: () => void } | null>(null)
  const ignoreSpeechErrorRef = useRef(false)
  const unitsRef = useRef(units)
  unitsRef.current = units

  useEffect(() => {
    if (typeof window !== 'undefined') window.speechSynthesis?.getVoices()
    return () => {
      ignoreSpeechErrorRef.current = true
      try {
        recognitionRef.current?.abort?.()
        recognitionRef.current?.stop()
      } catch {
        /* ignore */
      }
      try {
        mediaRef.current?.stop()
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
    }
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

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRef.current = null
  }

  const runTextSearch = async (text: string) => {
    setPhase('thinking')
    setError(null)
    try {
      const res = await fetch('/api/tour/voice-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, units: toVoiceCatalog(unitsRef.current) }),
      })
      const data = (await res.json().catch(() => ({}))) as VoiceAssistResult & { error?: string }
      if (!res.ok) throw new Error(data.error || 'No pude buscar ahora')
      setResult(data)
      setPhase('ready')
      setTextDraft('')
      speakText(data.speak)
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Error al procesar')
    }
  }

  const submitAudio = async (blob: Blob, ext: string) => {
    setPhase('thinking')
    setError(null)
    try {
      const form = new FormData()
      form.set('audio', blob, `voice.${ext}`)
      form.set('units', JSON.stringify(toVoiceCatalog(unitsRef.current)))
      const res = await fetch('/api/tour/voice-assist', { method: 'POST', body: form })
      const data = (await res.json().catch(() => ({}))) as VoiceAssistResult & { error?: string }
      if (!res.ok) throw new Error(data.error || 'No pude escuchar eso')
      setResult(data)
      setPhase('ready')
      speakText(data.speak)
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Error al procesar')
    }
  }

  const submitText = async () => {
    const text = textDraft.trim()
    if (!text) return
    await runTextSearch(text)
  }

  const startMediaRecorder = async () => {
    const secure =
      window.isSecureContext ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1'
    if (!secure) {
      setError(
        'El micrófono no está disponible en esta dirección. Abre http://localhost:3000 o escribe abajo, sin problema.',
      )
      setPhase('error')
      return
    }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador no permite grabar. Escribe tu búsqueda abajo y te ayudo igual.')
      setPhase('error')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const { mime, ext } = pickMime()
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || mime || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        stopTracks()
        if (blob.size < 800) {
          setPhase('error')
          setError('No pude capturar el audio. Toca Hablar, cuéntame qué buscas y después Listo.')
          return
        }
        void submitAudio(blob, ext)
      }
      mediaRef.current = recorder
      recorder.start()
      setPhase('recording')
    } catch (err) {
      stopTracks()
      setPhase('error')
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Necesito permiso del micrófono. Si prefieres, escribe abajo y te ayudo igual.')
      } else if (name === 'NotFoundError') {
        setError('No encontré micrófono. Escribe abajo y te ayudo con gusto.')
      } else {
        setError('No pude usar el micrófono ahora. Escribe abajo, sin problema.')
      }
    }
  }

  const startRecording = async () => {
    setError(null)
    setResult(null)
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()

    type Recog = {
      lang: string
      continuous: boolean
      interimResults: boolean
      maxAlternatives: number
      start: () => void
      stop: () => void
      abort?: () => void
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
      onerror: ((event: { error?: string }) => void) | null
      onend: (() => void) | null
    }

    const SRCtor =
      (
        window as unknown as {
          SpeechRecognition?: new () => Recog
          webkitSpeechRecognition?: new () => Recog
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => Recog
        }
      ).webkitSpeechRecognition

    // SpeechRecognition suele fallar si TTS sigue activo o con es-EC.
    if (SRCtor) {
      try {
        // Pedir mic primero mejora el permiso en Chrome/Edge.
        try {
          const warm = await navigator.mediaDevices.getUserMedia({ audio: true })
          warm.getTracks().forEach((t) => t.stop())
        } catch {
          /* si falla, igual intentamos SR o caemos a grabación */
        }

        ignoreSpeechErrorRef.current = false
        const recognition = new SRCtor()
        recognition.lang = 'es-ES'
        recognition.continuous = false
        recognition.interimResults = false
        recognition.maxAlternatives = 1
        recognitionRef.current = recognition
        setPhase('recording')

        recognition.onresult = (event) => {
          const said = event.results[0]?.[0]?.transcript?.trim() || ''
          recognitionRef.current = null
          if (!said) {
            void startMediaRecorder()
            return
          }
          setTextDraft(said)
          void runTextSearch(said)
        }

        recognition.onerror = (event) => {
          if (ignoreSpeechErrorRef.current) return
          recognitionRef.current = null
          const code = event.error || ''
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            setPhase('error')
            setError('Permiso de micrófono pendiente. También puedes escribir abajo y te ayudo.')
            return
          }
          // no-speech / network / aborted → grabación alternativa
          setError('Repite un momento y toca Listo cuando termines.')
          void startMediaRecorder()
        }

        recognition.onend = () => {
          recognitionRef.current = null
        }

        recognition.start()
        return
      } catch {
        /* MediaRecorder */
      }
    }

    await startMediaRecorder()
  }

  const stopRecording = () => {
    const recognition = recognitionRef.current
    if (recognition) {
      // stop() suele disparar onresult con lo escuchado; no marcar error todavía.
      try {
        recognition.stop()
      } catch {
        recognitionRef.current = null
        void startMediaRecorder()
      }
      return
    }

    const rec = mediaRef.current
    if (!rec || rec.state === 'inactive') {
      stopTracks()
      setPhase('idle')
      return
    }
    try {
      rec.stop()
    } catch {
      stopTracks()
      setPhase('idle')
    }
  }

  const openPanel = () => {
    setOpen(true)
  }

  const closePanel = () => {
    ignoreSpeechErrorRef.current = true
    if (phase === 'recording') stopRecording()
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
    setOpen(false)
  }

  // Al abrir (desde tip, botón propio o columna de acciones): tip off + saludo.
  useEffect(() => {
    if (!open) return
    dismissTip()
    setPhase('idle')
    setError(null)
    if (result) return
    const timer = window.setTimeout(() => {
      speakText(
        '¡Hola! Qué gusto tenerte por aquí. Cuéntame qué estás buscando: por ejemplo, dos dormitorios o piso alto.',
      )
    }, 350)
    return () => window.clearTimeout(timer)
    // Solo al pasar a abierto; no re-saludar si cambia el resultado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const pick = (card: VoiceAssistUnitCard) => {
    const unit = units.find((u) => u.id === card.id)
    if (!unit) return
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
    onPickUnit(unit)
  }

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
                {tip.title}
              </p>
              <button
                type="button"
                onClick={dismissTip}
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white/80"
                aria-label="Cerrar tip"
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
            <p className="text-[11px] leading-snug text-white/65">{tip.body}</p>
            <button
              type="button"
              onClick={openPanel}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#BDA27E]/22 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-[#E8D9C0] uppercase transition hover:bg-[#BDA27E]/32"
            >
              <Mic size={12} strokeWidth={2} />
              Probar
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          'pointer-events-none absolute z-[125]',
          // Trigger propio (solo plano / sin columna de acciones): esquina inferior derecha.
          !open &&
            !hideTrigger &&
            'bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.5rem,env(safe-area-inset-right))]',
          // Panel abierto: sheet centrado abajo; en desktop anclado a la derecha.
          open &&
            'inset-x-0 bottom-0 flex justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:inset-auto sm:bottom-[max(0.75rem,env(safe-area-inset-bottom))] sm:right-[max(3.75rem,calc(env(safe-area-inset-right)+3.25rem))] sm:justify-end sm:p-0',
          className,
        )}
      >
        {!open && !hideTrigger ? (
          <button
            type="button"
            onClick={openPanel}
            className="pointer-events-auto tour-glass group inline-flex h-10 w-10 items-center justify-center border border-[#BDA27E]/40 text-[#f7f3ee] shadow-[0_8px_22px_rgba(0,0,0,0.35)] transition hover:border-[#BDA27E]/65 hover:bg-white/10 sm:h-11 sm:w-11"
            aria-label="Abrir asistente de voz"
            title="Asistente de voz"
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
                    Asistente
                  </p>
                  <p className="truncate text-[12px] text-white/75">Estoy para ayudarte</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/15"
                aria-label="Cerrar asistente"
              >
                <X size={15} />
              </button>
            </div>

          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-3">
            {phase === 'recording' ? (
              <p className="text-center text-[13px] text-[#BDA27E]">
                Te escucho… cuéntame con calma y toca Listo
              </p>
            ) : null}
            {phase === 'thinking' ? (
              <p className="flex items-center justify-center gap-2 text-[13px] text-white/70">
                <Loader2 size={14} className="animate-spin" /> Un momento, busco opciones…
              </p>
            ) : null}
            {error ? <p className="text-[12px] text-[#f0d5c8]">{error}</p> : null}

            {result ? (
              <div className="space-y-2">
                {result.transcript ? (
                  <p className="text-[11px] text-white/45">
                    Tú: <span className="text-white/70">{result.transcript}</span>
                  </p>
                ) : null}
                <p className="text-[13px] leading-snug text-white/90">{result.speak}</p>
                {result.matches.length > 0 ? (
                  <ul className="space-y-1.5">
                    {result.matches.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => pick(m)}
                          className="flex w-full flex-col items-start rounded-xl bg-white/95 px-3 py-2 text-left text-[#1a2744] shadow-sm transition hover:bg-white"
                        >
                          <span className="text-[13px] font-semibold">Unidad {m.unit_number}</span>
                          <span className="text-[11px] text-[#3a4050]">{m.blurb}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {result.follow_up ? (
                  <p className="text-[11px] text-white/50">{result.follow_up}</p>
                ) : null}
              </div>
            ) : phase === 'idle' ? (
              <p className="text-[13px] leading-snug text-white/75">
                Cuéntame qué buscas, por ejemplo: “2 dormitorios, piso alto” o “hasta 180 mil”.
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={phase === 'thinking'}
                onClick={() => (phase === 'recording' ? stopRecording() : void startRecording())}
                className={cn(
                  'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase transition',
                  phase === 'recording'
                    ? 'bg-[#8a5c58] text-white'
                    : 'bg-[#BDA27E] text-[#14110e] hover:bg-[#d4c4a8]',
                  phase === 'thinking' && 'opacity-60',
                )}
              >
                {phase === 'recording' ? (
                  <>
                    <MicOff size={15} /> Listo
                  </>
                ) : (
                  <>
                    <Mic size={15} /> Hablar
                  </>
                )}
              </button>
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
                placeholder="O escribe aquí…"
                disabled={phase === 'thinking' || phase === 'recording'}
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/25 px-2.5 py-2 text-[12px] text-white placeholder:text-white/35 outline-none focus:border-[#BDA27E]/50"
              />
              <button
                type="submit"
                disabled={phase === 'thinking' || phase === 'recording' || !textDraft.trim()}
                className="rounded-lg bg-white/12 px-2.5 text-[11px] font-semibold tracking-wide text-white/85 uppercase disabled:opacity-40"
              >
                Ir
              </button>
            </form>
          </div>
        </div>
        ) : null}
      </div>
    </>
  )
}
