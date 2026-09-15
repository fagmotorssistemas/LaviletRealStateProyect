import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath } from '@/lib/inmobiliaria/roleAccess'
import { deliveryHealth, resolveDeliveryIncident, resumeAfterKommoReview } from '@/lib/integrations/automation/delivery-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }

export async function GET() {
  try {
    const session = await getSessionProfile()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401, headers })
    if (!canAccessPath(session.profile.role, '/inmobiliaria/automatizacion', session.profile.crm_paths)) {
      return NextResponse.json({ error: 'Sin acceso a automatización' }, { status: 403, headers })
    }
    return NextResponse.json(await deliveryHealth(), { headers })
  } catch { return NextResponse.json({ error: 'No se pudo comprobar el estado de los envíos' }, { status: 503, headers }) }
}

export async function POST(request: Request) {
  try {
    const session = await getSessionProfile()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401, headers })
    if (session.profile.role !== 'admin') return NextResponse.json({ error: 'Solo administradores' }, { status: 403, headers })
    if (request.headers.get('origin') !== new URL(request.url).origin || !request.headers.get('content-type')?.includes('application/json')) {
      return NextResponse.json({ error: 'Solicitud no permitida' }, { status: 403, headers })
    }
    const body = await request.json()
    if (body?.action === 'resume_after_account_review') {
      await resumeAfterKommoReview(session.profile.id)
    } else if (body?.action === 'incident_reviewed' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(body.id || '')) {
      await resolveDeliveryIncident(body.id, session.profile.id)
    } else return NextResponse.json({ error: 'Acción no válida' }, { status: 400, headers })
    return NextResponse.json(await deliveryHealth(), { headers })
  } catch (error) {
    const busy = error instanceof Error && error.message === 'WORKER_BUSY'
    return NextResponse.json({ error: busy ? 'El sistema está procesando. Intente de nuevo en un momento.' : 'No se pudo guardar la revisión' }, { status: busy ? 409 : 503, headers })
  }
}
