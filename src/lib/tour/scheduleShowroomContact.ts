import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TOUR_PROJECT_ID, TOUR_TENANT_ID } from './trackingIds';
import { observedShowroomUnit } from './showroomInterest';
export async function scheduleShowroomContact(admin: SupabaseClient, input: {
    leadId: string;
    sessionId: string | null;
    visitorKey: string;
    name?: string;
    contactConsent: boolean;
    explicitUnit?: string | null;
}) {
    if (!input.contactConsent || !input.sessionId)
        return { scheduled: false, reason: 'contact_permission_or_session_missing' };
    const visitor = await admin.from('tour_visitors').select('id').eq('tenant_id', TOUR_TENANT_ID).eq('visitor_key', input.visitorKey).maybeSingle();
    if (visitor.error || !visitor.data)
        return { scheduled: false, reason: 'visitor_unverified' };
    const [session, lead, dwell] = await Promise.all([
        admin.from('tour_sessions').select('id,visitor_id,lead_id').eq('id', input.sessionId).eq('visitor_id', visitor.data.id).eq('lead_id', input.leadId).maybeSingle(),
        admin.from('leads').select('id,tracking_opt_out_at').eq('id', input.leadId).eq('tenant_id', TOUR_TENANT_ID).eq('project_id', TOUR_PROJECT_ID).maybeSingle(),
        admin.from('lv_showroom_unit_dwell').select('unit_id,seconds').eq('session_id', input.sessionId),
    ]);
    if (session.error || lead.error || !session.data || !lead.data || lead.data.tracking_opt_out_at)
        return { scheduled: false, reason: 'contact_unverified_or_stopped' };
    // A missing tracking table can only reduce specificity, never fabricate interest.
    const unitId = observedShowroomUnit(dwell.error ? [] : dwell.data || [], input.explicitUnit);
    let label: string | null = null, verifiedId: string | null = null;
    if (unitId) {
        const unit = await admin.from('units').select('id,unit_number,category').eq('id', unitId).eq('tenant_id', TOUR_TENANT_ID).eq('project_id', TOUR_PROJECT_ID).eq('is_published', true).maybeSingle();
        if (unit.data) {
            verifiedId = unit.data.id;
            label = `${unit.data.category === 'local' ? 'el local' : unit.data.category === 'penthouse' ? 'el penthouse' : unit.data.category === 'suite' ? 'la suite' : 'el departamento'} ${unit.data.unit_number}`;
        }
    }
    const result = await admin.from('lv_showroom_contacts').upsert({ tenant_id: TOUR_TENANT_ID, project_id: TOUR_PROJECT_ID, lead_id: input.leadId, session_id: input.sessionId, unit_id: verifiedId, unit_label: label,
        form_name: input.name?.trim() || null, consent_at: new Date().toISOString(), consent_source: 'showroom_whatsapp_checkbox_v1' }, { onConflict: 'project_id,lead_id', ignoreDuplicates: true });
    return { scheduled: !result.error, reason: result.error ? 'schedule_unavailable' : null };
}
