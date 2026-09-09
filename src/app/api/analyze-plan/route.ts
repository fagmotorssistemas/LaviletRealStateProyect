import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED_EXT = /\.(jpe?g|png|webp|bmp)$/i

function analyzerUrl() {
  return (process.env.PLAN_ANALYZER_URL || 'http://127.0.0.1:8001').replace(/\/$/, '')
}

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const file = form.get('image')
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'Falta el campo image (multipart/form-data)' },
        { status: 400 },
      )
    }
    if (file.size <= 0) {
      return NextResponse.json({ success: false, error: 'Imagen vacía' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ success: false, error: 'Imagen demasiado grande (máx 25MB)' }, { status: 400 })
    }
    if (file.type && !file.type.startsWith('image/') && !ALLOWED_EXT.test(file.name)) {
      return NextResponse.json({ success: false, error: 'Formato no soportado' }, { status: 400 })
    }

    const upstream = new FormData()
    upstream.append('image', file, file.name || 'plan.png')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90_000)
    let res: Response
    try {
      res = await fetch(`${analyzerUrl()}/analyze`, {
        method: 'POST',
        body: upstream,
        signal: controller.signal,
      })
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'
      return NextResponse.json(
        {
          success: false,
          error: aborted
            ? 'Timeout al analizar el plano'
            : `Servicio Python no disponible (${analyzerUrl()}). Iniciá uvicorn en el puerto 8001.`,
        },
        { status: aborted ? 504 : 503 },
      )
    } finally {
      clearTimeout(timeout)
    }

    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const detail =
        payload && typeof payload === 'object' && 'detail' in payload
          ? String((payload as { detail: unknown }).detail)
          : `Error del analizador (${res.status})`
      return NextResponse.json({ success: false, error: detail }, { status: res.status })
    }

    if (!payload?.success) {
      return NextResponse.json(
        { success: false, error: payload?.error || 'Análisis sin resultado' },
        { status: 500 },
      )
    }

    if (!Array.isArray(payload.apartments) || payload.apartments.length === 0) {
      return NextResponse.json(
        {
          ...payload,
          success: true,
          error: 'Ningún departamento detectado con confianza suficiente. Probá editar manualmente.',
        },
        { status: 200 },
      )
    }

    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 },
    )
  }
}
