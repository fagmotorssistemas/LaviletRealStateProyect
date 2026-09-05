import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, canWriteCrm } from '@/lib/inmobiliaria/roleAccess'
import { loadTypologyHotspots, parseTypologyHotspots, saveTypologyHotspots } from '@/lib/tour/typologyHotspots'

export const runtime = 'nodejs'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function assertEditor() {
  const session = await getSessionProfile()
  if (!session) return jsonError('No autenticado', 401)
  const canEdit =
    canAccessPath(session.profile.role, '/inmobiliaria/inventario') && canWriteCrm(session.profile.role)
  if (!canEdit) return jsonError('No tienes permiso para editar puntos 360', 403)
  return null
}

export async function GET(request: Request) {
  const denied = await assertEditor()
  if (denied) return denied
  const typologyCode = new URL(request.url).searchParams.get('typology_code')?.trim() ?? ''
  if (!typologyCode) return jsonError('Falta typology_code', 400)
  const hotspots = await loadTypologyHotspots(createAdminClient(), typologyCode)
  return NextResponse.json({ hotspots })
}

export async function PUT(request: Request) {
  const denied = await assertEditor()
  if (denied) return denied
  const body = (await request.json().catch(() => null)) as {
    typology_code?: string
    hotspots?: unknown
  } | null
  const typologyCode = body?.typology_code?.trim() ?? ''
  if (!typologyCode) return jsonError('Falta typology_code', 400)
  try {
    const hotspots = await saveTypologyHotspots(
      createAdminClient(),
      typologyCode,
      parseTypologyHotspots(body?.hotspots),
    )
    return NextResponse.json({ hotspots })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron guardar los puntos'
    return jsonError(message, 500)
  }
}
