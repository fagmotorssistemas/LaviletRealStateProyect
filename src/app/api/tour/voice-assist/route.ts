import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { TOUR_TENANT_ID, TOUR_PROJECT_ID } from '@/lib/tour/trackingIds'
import {
  normalizeFilters,
  resolveVoiceCategory,
  speakUnclearSpeechClarification,
  splitSpeakChunks,
  type VoiceAssistCatalogUnit,
  type VoiceAssistFilters,
  type VoiceAssistUnitCard,
} from '@/lib/tour/voiceAssist'
import { runTourVoiceAssist, synthesizeTourVoice, transcribeTourVoice } from '@/lib/tour/voiceAssistServer'

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
        category: resolveVoiceCategory({
          category: u.category == null ? null : String(u.category),
          unit_number: String(u.unit_number ?? ''),
          bedrooms: num(u.bedrooms),
        }),
      }
    })
    .filter((u) => u.id && u.unit_number)
}

function asPreviousFilters(raw: unknown): VoiceAssistFilters | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return normalizeFilters(raw as Partial<VoiceAssistFilters>)
}

function asPreviousMatches(raw: unknown): VoiceAssistUnitCard[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, 5)
    .map((row) => {
      const u = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      const num = (v: unknown) => {
        if (v == null || v === '') return null
        const n = typeof v === 'number' ? v : Number(v)
        return Number.isFinite(n) ? n : null
      }
      const id = String(u.id ?? '')
      const unit_number = String(u.unit_number ?? '')
      if (!id || !unit_number) return null
      return {
        id,
        unit_number,
        floor: u.floor == null ? null : String(u.floor),
        floor_number: num(u.floor_number),
        bedrooms: num(u.bedrooms),
        bathrooms: num(u.bathrooms),
        area_total_m2: num(u.area_total_m2),
        price: num(u.price),
        status: String(u.status ?? ''),
        typology_code: u.typology_code == null ? null : String(u.typology_code),
        category: resolveVoiceCategory({
          category: u.category == null ? null : String(u.category),
          unit_number,
          bedrooms: num(u.bedrooms),
        }),
        blurb: String(u.blurb ?? ''),
      } satisfies VoiceAssistUnitCard
    })
    .filter((row): row is VoiceAssistUnitCard => row != null)
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
    let previousFilters: VoiceAssistFilters | null = null
    let previousMatches: VoiceAssistUnitCard[] = []

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
      const memoryRaw = form.get('previous_filters')
      if (typeof memoryRaw === 'string' && memoryRaw.trim()) {
        try {
          previousFilters = asPreviousFilters(JSON.parse(memoryRaw))
        } catch {
          previousFilters = null
        }
      }
      const matchesRaw = form.get('previous_matches')
      if (typeof matchesRaw === 'string' && matchesRaw.trim()) {
        try {
          previousMatches = asPreviousMatches(JSON.parse(matchesRaw))
        } catch {
          previousMatches = []
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
      let body: {
        text?: string
        units?: unknown
        previous_filters?: unknown
        previous_matches?: unknown
      }
      try {
        body = (await request.json()) as typeof body
      } catch {
        return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
      }
      transcript = String(body.text ?? '')
        .trim()
        .slice(0, 2000)
      catalog = asCatalog(body.units)
      previousFilters = asPreviousFilters(body.previous_filters)
      previousMatches = asPreviousMatches(body.previous_matches)
    }

    if (!transcript) {
      // Audio vacío / silencio: respuesta amable (no error ni “fuera de tema”).
      const soft = speakUnclearSpeechClarification()
      return NextResponse.json({
        transcript: '',
        speak: soft.speak,
        filters: previousFilters ?? normalizeFilters({ only_available: true }),
        matches: previousMatches.slice(0, 3),
        follow_up: soft.follow_up,
      })
    }

    // Never use prices or availability supplied by the browser as inventory truth.
    const admin=tryCreateAdminClient()
    if(!admin)return NextResponse.json({error:'Inventario no disponible'},{status:503})
    const {data:inventory,error:inventoryError}=await admin.from('units')
      .select('id,unit_number,floor,floor_number,bedrooms,bathrooms,area_total_m2,published_commercial_price,status,category')
      .eq('tenant_id',TOUR_TENANT_ID).eq('project_id',TOUR_PROJECT_ID).eq('is_published',true).order('unit_number').limit(MAX_UNITS)
    if(inventoryError)return NextResponse.json({error:'No se pudo comprobar el inventario'},{status:503})
    catalog=asCatalog((inventory ?? []).map(u=>({...u,price:u.published_commercial_price})))
    previousMatches=previousMatches.flatMap(old=>{const current=catalog.find(u=>u.id===old.id);return current?[{...current,blurb:''}]:[]})
    const result = await runTourVoiceAssist({
      transcript,
      catalog,
      previousFilters,
      previousMatches,
    })

    // Primer trozo de audio OpenAI junto a la respuesta → el cliente habla antes.
    let audio_base64: string | null = null
    try {
      const firstChunk = splitSpeakChunks(result.speak)[0]
      if (firstChunk) {
        const audio = await synthesizeTourVoice(firstChunk)
        if (audio && audio.byteLength > 0) {
          audio_base64 = Buffer.from(audio).toString('base64')
        }
      }
    } catch (error) {
      console.warn(
        'tour voice-assist first audio',
        error instanceof Error ? error.message : 'TTS_FIRST_CHUNK_FAILED',
      )
    }

    return NextResponse.json({ ...result, audio_base64 })
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
