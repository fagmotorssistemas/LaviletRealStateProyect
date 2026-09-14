import { NextResponse } from 'next/server'
import { synthesizeTourVoice } from '@/lib/tour/voiceAssistServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    let body: { text?: string }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
    }

    const text = String(body.text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600)
    if (!text) {
      return NextResponse.json({ error: 'Falta el texto' }, { status: 400 })
    }

    const audio = await synthesizeTourVoice(text)
    if (!audio) {
      return NextResponse.json({ error: 'TTS_UNAVAILABLE' }, { status: 503 })
    }

    return new NextResponse(Buffer.from(audio), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TTS_FAILED'
    console.error('tour voice-assist speak', message)
    return NextResponse.json({ error: 'No pude generar la voz' }, { status: 502 })
  }
}
