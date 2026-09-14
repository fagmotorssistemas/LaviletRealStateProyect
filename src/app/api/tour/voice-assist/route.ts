import { NextResponse } from 'next/server'
import type { VoiceAssistCatalogUnit } from '@/lib/tour/voiceAssist'
import { runTourVoiceAssist, transcribeTourVoice } from '@/lib/tour/voiceAssistServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_UNITS = 250
const MAX_AUDIO_BYTES = 8 * 1024 * 1024

function asCatalog(raw: unknown): VoiceAssistCatalogUnit[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, MAX_UNITS)
    .map((row) => {
      const u = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      const num = (v: unknown) => {
        if (v == null || v === '') return null
        const n = typeof v === 'number' ? v : Number(v)
        return Number.isFinite(n) ? n : null
      }
      return {
        id: String(u.id ?? ''),
        unit_number: String(u.unit_number ?? ''),
        floor: u.floor == null ? null : String(u.floor),
        floor_number: num(u.floor_number),
        bedrooms: num(u.bedrooms),
        bathrooms: num(u.bathrooms),
        area_total_m2: num(u.area_total_m2),
        price: num(u.price),
        status: String(u.status ?? ''),
        typology_code: u.typology_code == null ? null : String(u.typology_code),
      }
    })
    .filter((u) => u.id && u.unit_number)
}

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim()) {
      return NextResponse.json(
        { error: 'Falta configurar OPENAI_API_KEY / OPENAI_MODEL en el servidor' },
        { status: 503 },
      )
    }

    const contentType = request.headers.get('content-type') || ''
    let transcript = ''
    let catalog: VoiceAssistCatalogUnit[] = []

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const unitsRaw = form.get('units')
      if (typeof unitsRaw === 'string') {
        try {
          catalog = asCatalog(JSON.parse(unitsRaw))
        } catch {
          return NextResponse.json({ error: 'Catálogo inválido' }, { status: 400 })
        }
      }
      const textField = form.get('text')
      if (typeof textField === 'string' && textField.trim()) {
        transcript = textField.trim().slice(0, 2000)
      }
      const audio = form.get('audio')
      if (audio && typeof audio === 'object' && 'arrayBuffer' in audio && 'size' in audio) {
        const blob = audio as Blob
        if (blob.size > MAX_AUDIO_BYTES) {
          return NextResponse.json({ error: 'Audio demasiado grande' }, { status: 413 })
        }
        const name =
          'name' in audio && typeof (audio as File).name === 'string' && (audio as File).name
            ? (audio as File).name
            : (blob.type || '').includes('mp4')
              ? 'audio.mp4'
              : 'audio.webm'
        transcript = await transcribeTourVoice(blob, name)
      }
    } else {
      let body: { text?: string; units?: unknown }
      try {
        body = (await request.json()) as typeof body
      } catch {
        return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
      }
      transcript = String(body.text ?? '')
        .trim()
        .slice(0, 2000)
      catalog = asCatalog(body.units)
    }

    if (!transcript) {
      return NextResponse.json({ error: 'Di algo o escribe tu búsqueda' }, { status: 400 })
    }

    const result = await runTourVoiceAssist({ transcript, catalog })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'VOICE_ASSIST_FAILED'
    console.error('tour voice-assist', message)
    if (message === 'OPENAI_NOT_CONFIGURED') {
      return NextResponse.json(
        { error: 'Falta configurar OPENAI_API_KEY / OPENAI_MODEL en el servidor' },
        { status: 503 },
      )
    }
    if (message.includes('429')) {
      return NextResponse.json(
        {
          error:
            'OpenAI sin cuota o límite alcanzado (429). Recarga crédito en platform.openai.com o usa búsquedas simples por texto (“2 dormitorios”).',
        },
        { status: 429 },
      )
    }
    const status = message.startsWith('TRANSCRIPTION_') || message.startsWith('OPENAI_') ? 502 : 500
    return NextResponse.json(
      { error: 'No pude procesar tu pedido. Prueba de nuevo en un momento.' },
      { status },
    )
  }
}
