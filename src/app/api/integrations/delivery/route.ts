import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath } from '@/lib/inmobiliaria/roleAccess'
import { deliveryHealth, reconcileDeliveryIncident, resolveDeliveryIncident, resumeAfterKommoReview } from '@/lib/integrations/automation/delivery-state'

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
    } else if (body?.action === 'reconcile_incident' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(body.id || '')
      && ['sent', 'not_sent'].includes(body.outcome) && body.reviewed === true
      && typeof body.reviewReference === 'string' && (body.retry === undefined || typeof body.retry === 'boolean')
      && (!body.providerMessageId || typeof body.providerMessageId === 'string')) {
      await reconcileDeliveryIncident(body.id, session.profile.id, body)
    } else return NextResponse.json({ error: 'Acción no válida' }, { status: 400, headers })
    return NextResponse.json(await deliveryHealth(), { headers })
  } catch (error) {
    const busy = error instanceof Error && error.message === 'WORKER_BUSY'
    const message = error instanceof Error ? error.message : ''
    const detail = message === 'DELIVERY_REVIEW_REQUIRED' ? 'Complete la comprobación y una observación de entre 3 y 300 caracteres.'
      : message === 'DELIVERY_RETRY_CHECKPOINT_REQUIRED' ? 'Este intento no conserva una respuesta recuperable. Desmarque el reintento para guardar solo la comprobación y atienda la consulta pendiente.'
        : message === 'DELIVERY_RETRY_LIMIT' ? 'Este envío alcanzó el límite de dos reintentos comprobados. Desmarque el reintento y revise la conexión antes de continuar.'
          : message === 'DELIVERY_EVIDENCE_REQUIRED' ? 'No se encontró el mensaje enviado que corresponde a este intento. Compruebe su identificador y el historial de Kommo.'
            : message === 'DELIVERY_OUTCOME_CONFLICT' ? 'El sistema conserva una aceptación del envío. Compruebe el historial antes de marcarlo como no enviado.'
              : message === 'INCIDENT_NOT_REVIEWABLE' || message === 'DELIVERY_BATCH_CONFLICT' ? 'El estado de este intento cambió. Actualice el listado antes de guardar la comprobación.'
      : /RPC_LV_APP_RECONCILE_DELIVERY_V2_PGRST202/.test(message) ? 'Falta aplicar la migración de recuperación de envíos.'
        : /RPC_LV_APP_RECONCILE_DELIVERY_V2_P0001/.test(message) ? 'No se pudo comprobar o programar este intento. Actualice el estado; si no existe una respuesta recuperable, desmarque el reintento para guardar solo la comprobación.'
          : 'No se pudo guardar la revisión. Conserve la comprobación y vuelva a intentarlo.'
    return NextResponse.json({ error: busy ? 'El sistema está procesando. Intente de nuevo en un momento.' : detail }, { status: busy ? 409 : 503, headers })
  }
}
