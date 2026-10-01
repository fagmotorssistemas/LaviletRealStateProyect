import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAmenityEditor } from '@/lib/tour/amenityAccess'
import { amenityWebpPath, isAmenityWebpName, listStoredAmenities } from '@/lib/tour/amenityStorage'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'

export const runtime = 'nodejs'

/** Galería pública: WebP de amenidades en Storage, sin leer archivos del proyecto. */
export async function GET() {
  try {
    const admin = createAdminClient()
    const items = await listStoredAmenities(admin)
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('GET /api/tour/amenities', error)
    const message = error instanceof Error ? error.message : 'No se pudieron consultar las amenidades'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAmenityEditor()
    if (auth.error) return auth.error

    const body = (await request.json().catch(() => ({}))) as { name?: string }
    const name = String(body.name ?? '').trim()
    if (!isAmenityWebpName(name)) {
      return NextResponse.json({ error: 'Archivo inválido' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).remove([amenityWebpPath(name)])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/tour/amenities', error)
    const message = error instanceof Error ? error.message : 'No se pudo borrar la amenidad'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
