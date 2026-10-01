import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, canWriteCrm } from '@/lib/inmobiliaria/roleAccess'

export async function requireAmenityEditor() {
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
    return { error: NextResponse.json({ error: 'No tienes permiso para editar amenidades' }, { status: 403 }) }
  }
  return { session }
}
