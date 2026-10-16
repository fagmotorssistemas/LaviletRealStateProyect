import { NextResponse } from 'next/server'
import { automationSettings, secretMatches } from '@/lib/integrations/automation/config'
import { autoConfig } from '@/lib/integrations/automation/data'
import { automationModelForRole } from '@/lib/integrations/automation/ai-model-routing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Read-only deployment preflight. Never runs a worker or changes a contact. */
export async function GET(request: Request) {
  const provided = request.headers.get('authorization')?.replace(/^Bearer /, '') || null
  if (!secretMatches(provided, process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const settings = automationSettings(), config = await autoConfig()
    return NextResponse.json({
      boundaryVersion: 1,
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      mode: settings.mode,
      live: settings.live,
      environmentLeadRestricted: Boolean(settings.testLeadId),
      webhookContactRestricted: Boolean(process.env.KOMMO_WEBHOOK_ALLOWED_CONTACT_ID?.trim()),
      enabled: config.enabled === true,
      dryRun: config.dry_run !== false,
      testOnly: config.test_only !== false,
      audience: config._audience,
      conversationAnalysisModel: automationModelForRole('interpretation') || null,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'No se pudo comprobar la configuración' }, { status: 503 })
  }
}
