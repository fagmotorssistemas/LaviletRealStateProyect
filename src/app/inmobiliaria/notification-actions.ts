'use server'

import { getSessionProfile, getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { automationSettings } from '@/lib/integrations/automation/config'
import { autoConfig, scope } from '@/lib/integrations/automation/data'

/** Repair internal alerts only. Never invokes a chat worker or sends WhatsApp. */
export async function recoverReservationNotifications(): Promise<{ ok: boolean; reason?: string; processed?: number }> {
  try {
    const session = await getSessionProfile()
    if (!session || !['asesor', 'admin'].includes(session.profile.role || '')) return { ok: false, reason: 'forbidden' }
    const settings = automationSettings()
    if (!settings.live) return { ok: true, reason: 'disabled' }
    const signal = AbortSignal.timeout(10_000)
    const { supabase } = await getSessionUser()
    // Establish the session's project access before reading private requests.
    const access = await supabase.from('projects').select('id').eq('id', scope.project_id).eq('tenant_id', scope.tenant_id)
      .abortSignal(signal).maybeSingle()
    if (access.error) return { ok: false, reason: 'access_unavailable' }
    if (!access.data) return { ok: true, reason: 'no_project_access' }
    const admin = createAdminClient()
    const profile = await admin.from('profiles').select('role,is_active').eq('id', session.user.id).abortSignal(signal).maybeSingle()
    if (profile.error) return { ok: false, reason: 'access_unavailable' }
    if (!profile.data?.is_active || !['asesor', 'admin'].includes(profile.data.role)) return { ok: false, reason: 'forbidden' }
    if (profile.data.role === 'asesor') {
      const member = await admin.from('project_salespeople').select('id').match(scope).eq('salesperson_id', session.user.id)
        .abortSignal(signal).maybeSingle()
      if (member.error) return { ok: false, reason: 'access_unavailable' }
      if (!member.data) return { ok: true, reason: 'no_project_membership' }
    }
    const config = await autoConfig()
    if (config.enabled !== true || config.dry_run !== false) return { ok: true, reason: 'disabled' }
    let leadIds: string[] | null = settings.testLeadId ? [settings.testLeadId] : null
    if (config.test_only === true) {
      const allowed = Array.isArray(config.test_lead_ids) ? config.test_lead_ids.filter((id): id is string => typeof id === 'string') : []
      if (!allowed.length) return { ok: true, processed: 0 }
      leadIds = leadIds ? leadIds.filter(id => allowed.includes(id)) : allowed
    }
    if (leadIds && !leadIds.length) return { ok: true, processed: 0 }
    // Existing SQL selects at most 50 latest pending requests in this authorized
    // project and owns eligibility, rotation, locking and alert idempotency.
    const result = await admin.rpc('lv_retry_reservation_alerts', { p_project_id: scope.project_id, p_lead_ids: leadIds }).abortSignal(signal)
    if (result.error) return { ok: false, reason: ['PGRST202', '42883'].includes(result.error.code) ? 'migration_required' : 'recovery_failed' }
    if (!Number.isSafeInteger(result.data) || result.data < 0) return { ok: false, reason: 'recovery_failed' }
    return { ok: true, processed: result.data }
  } catch {
    return { ok: false, reason: 'recovery_failed' }
  }
}
