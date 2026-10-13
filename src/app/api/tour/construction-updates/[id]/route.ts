import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstructionEditor } from '@/lib/tour/amenityAccess'
import { constructionPublicPath } from '@/lib/tour/constructionStorage'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import type { ConstructionMedia } from '@/lib/tour/constructionProgress'

export const runtime = 'nodejs'

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
