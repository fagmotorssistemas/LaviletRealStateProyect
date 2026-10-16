import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstructionEditor } from '@/lib/tour/amenityAccess'
import { constructionPublicPath } from '@/lib/tour/constructionStorage'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import type { ConstructionMedia } from '@/lib/tour/constructionProgress'

export const runtime = 'nodejs'

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireConstructionEditor()
  if (auth.error) return auth.error

  try {
    const { id } = await context.params
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
    }
    const body = await request.json().catch(() => null)
    const date = body?.date
    const description = body?.description
    const media = body?.media
    const parsedDate = new Date(`${date}T12:00:00Z`)
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })
    }
    if (typeof description !== 'string' || description.length > 5000) {
      return NextResponse.json({ error: 'Descripción inválida' }, { status: 400 })
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
    const { data, error } = await admin.from('construction_updates')
      .update({ date, description: description.trim(), media: cleanMedia })
      .eq('id', id)
      .select('id,date,title,description,media')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 })
    return NextResponse.json({ item: data })
  } catch (error) {
    console.error('PATCH /api/tour/construction-updates/[id]', error)
    return NextResponse.json({ error: 'No se pudo actualizar el avance de obra' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireConstructionEditor()
  if (auth.error) return auth.error

  try {
    const { id } = await context.params
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
    }
    const admin = createAdminClient()
    const { data, error: readError } = await admin
      .from('construction_updates')
      .select('media')
      .eq('id', id)
      .maybeSingle()
    if (readError) throw readError
    if (!data) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 })

    const paths = (Array.isArray(data.media) ? data.media : [])
      .map((item: ConstructionMedia) => constructionPublicPath(admin, item))
      .filter((path: string | null): path is string => Boolean(path))
    if (paths.length) {
      const { error: storageError } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).remove(paths)
      if (storageError) throw storageError
    }
    const { error: deleteError } = await admin.from('construction_updates').delete().eq('id', id)
    if (deleteError) throw deleteError
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/tour/construction-updates/[id]', error)
    return NextResponse.json({ error: 'No se pudo borrar el avance de obra' }, { status: 500 })
  }
}
