import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstructionEditor } from '@/lib/tour/amenityAccess'
import { constructionPublicPath } from '@/lib/tour/constructionStorage'
import type { ConstructionMedia, ConstructionUpdate } from '@/lib/tour/constructionProgress'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('construction_updates')
      .select('id,date,title,description,media')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ items: (data ?? []) as ConstructionUpdate[] }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('GET /api/tour/construction-updates', error)
    return NextResponse.json({ error: 'No se pudo consultar el avance de obra' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireConstructionEditor()
  if (auth.error) return auth.error

  try {
    const body = (await request.json().catch(() => ({}))) as Partial<ConstructionUpdate>
    const date = String(body.date ?? '')
    const title = String(body.title ?? '').trim()
    const description = String(body.description ?? '').trim()
    const media = body.media
    const parsedDate = new Date(`${date}T12:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })
    }
    if (!title || title.length > 160 || description.length > 5000) {
      return NextResponse.json({ error: 'Título o descripción inválidos' }, { status: 400 })
    }
    if (!Array.isArray(media) || !media.length || media.length > 30) {
      return NextResponse.json({ error: 'Agrega entre 1 y 30 fotos o videos' }, { status: 400 })
    }
    const admin = createAdminClient()
    const cleanMedia: ConstructionMedia[] = []
    for (const item of media) {
      if (!item || (item.type !== 'image' && item.type !== 'video') || typeof item.url !== 'string' || typeof item.caption !== 'string' || item.caption.length > 300 || !constructionPublicPath(admin, item)) {
        return NextResponse.json({ error: 'Archivo de obra inválido' }, { status: 400 })
      }
      cleanMedia.push({ type: item.type, url: item.url, caption: item.caption.trim() })
    }
    const { data, error } = await admin
      .from('construction_updates')
      .insert({ date, title, description, media: cleanMedia })
      .select('id,date,title,description,media')
      .single()
    if (error) throw error
    return NextResponse.json({ item: data }, { status: 201 })
  } catch (error) {
    console.error('POST /api/tour/construction-updates', error)
    return NextResponse.json({ error: 'No se pudo guardar el avance de obra' }, { status: 500 })
  }
}
