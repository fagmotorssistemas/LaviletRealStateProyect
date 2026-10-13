import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, canWriteCrm } from '@/lib/inmobiliaria/roleAccess'

async function requireTourMediaEditor(label: string) {
  const session = await getSessionProfile()
  if (!session) {
    return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  }
  const canManage = canAccessPath(
    session.profile.role,
    '/inmobiliaria/inventario',
    session.profile.crm_paths,
  )
  if (!canManage || !canWriteCrm(session.profile.role)) {
    return { error: NextResponse.json({ error: `No tienes permiso para editar ${label}` }, { status: 403 }) }
  }
  return { session }
}

export function requireAmenityEditor() {
  return requireTourMediaEditor('amenidades')
}

export function requireConstructionEditor() {
  return requireTourMediaEditor('el avance de obra')
}
