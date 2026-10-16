import 'server-only';
import { autoConfig,db, object, one, permitted, rpc, scope, text, type Row } from './data';
import { automationSettings } from './config';
import { botStopped, getKommoLead, launchSalesbot, ProviderError, setKommoField, verifyShowroomTemplates } from './kommo';
import { showroomButtonReply,showroomInvitationBody } from '@/lib/tour/showroomInterest';
import { audienceAllows } from './audience-boundary';
export async function processShowroomContacts(config: Row, guard: () => Promise<void>) {
    const stale = await db().from('lv_showroom_contacts').update({ status: 'uncertain', reason: 'interrupted_check_kommo_before_retry' }).match(scope)
        .eq('status', 'processing').lt('attempted_at', new Date(Date.now() - 5 * 60000).toISOString());
    if (stale.error) {
        if (stale.error.code === 'PGRST205')
            return { reason: 'migration_pending' };
        throw Error('SHOWROOM_CONTACT_READ_FAILED');
    }
    let candidates = db().from('lv_showroom_contacts').select('*').match(scope).eq('status', 'scheduled').lte('available_at', new Date().toISOString()).order('created_at').limit(2);
    const singleTestLead=automationSettings().testLeadId;
    if(singleTestLead)candidates=candidates.eq('lead_id',singleTestLead);
    else if(config.test_only===true)candidates=candidates.in('lead_id',Array.isArray(config.test_lead_ids)?config.test_lead_ids:[]);
    const jobs=await candidates;
    if (jobs.error)
        throw Error('SHOWROOM_CONTACT_READ_FAILED');
    const result: Row[] = [];
    let approved: Awaited<ReturnType<typeof verifyShowroomTemplates>> | undefined;
    for (const invitation of jobs.data || []) {
        await guard();
        if (!audienceAllows(config._audience, text(invitation.consent_at), text(invitation.created_at) || undefined)) {
            await db().from('lv_showroom_contacts').update({status:'cancelled',reason:'before_audience_activation'}).eq('id',invitation.id).eq('status','scheduled');
            continue;
        }
        const lead = await one('leads', invitation.lead_id);
        if (!permitted(config, lead, automationSettings().testLeadId))
            continue;
        const conversations = await db().from('conversations').select('id').eq('lead_id', lead.id);
        if (conversations.error)
            throw Error('SHOWROOM_HISTORY_READ_FAILED');
        const ids = (conversations.data || []).map(row => row.id);
        const messages = ids.length ? await db().from('messages').select('id').in('conversation_id', ids).in('role', ['cliente', 'asesor']).limit(1) : { data: [], error: null };
        if (messages.error)
            throw Error('SHOWROOM_HISTORY_READ_FAILED');
        if (lead.tracking_opt_out_at || lead.bot_enabled !== true || messages.data?.length || ['assigned', 'acknowledged', 'queued'].includes(text(lead.handoff_status))) {
            await db().from('lv_showroom_contacts').update({ status: 'cancelled', reason: 'conversation_or_human_attention_or_stopped' }).eq('id', invitation.id).eq('status', 'scheduled');
            continue;
        }
        const kommoId = Number(lead.kommo_id);
        if (!Number.isSafeInteger(kommoId) || kommoId < 1) {
            await db().from('lv_showroom_contacts').update({available_at:new Date(Date.now()+5*60000).toISOString(),reason:'awaiting_kommo_contact_link'}).eq('id',invitation.id).eq('status','scheduled');
            continue;
        }
        approved ??= await verifyShowroomTemplates();
        const kind = invitation.unit_id ? 'unit' : 'general';
        if (!approved[kind]) {
            await db().from('lv_showroom_contacts').update({ status: 'scheduled', available_at:new Date(Date.now()+15*60000).toISOString(),reason: 'approved_template_missing_or_mismatched' }).eq('id', invitation.id);
            continue;
        }
        if (botStopped(await getKommoLead(kommoId)))
            continue;
        const claim = await db().from('lv_showroom_contacts').update({ status: 'processing', attempted_at: new Date().toISOString(), attempts: invitation.attempts + 1 })
            .eq('id', invitation.id).eq('status', 'scheduled').select('id').maybeSingle();
        if (claim.error)
            throw Error('SHOWROOM_CLAIM_FAILED');
        if (!claim.data)
            continue;
        let launching = false;
        try {
            if (kind === 'unit')
                await setKommoField(kommoId, 538638, invitation.unit_label);
            await guard();
            // Check consent, handoff and last client activity again after remote reads.
            const fresh = await one('leads', invitation.lead_id);
            const currentConfig=await autoConfig();
            if (!audienceAllows(currentConfig._audience, text(invitation.consent_at), text(invitation.created_at) || undefined)) {
                await db().from('lv_showroom_contacts').update({status:'cancelled',reason:'before_audience_activation'}).eq('id',invitation.id);
                continue;
            }
            const later = ids.length ? await db().from('messages').select('id').in('conversation_id', ids).in('role', ['cliente', 'asesor']).limit(1) : { data: [], error: null };
            if (later.error)
                throw Error('SHOWROOM_FINAL_HISTORY_FAILED');
            const pending=await db().from('lv_integration_events').select('id').match(scope).eq('kind','inbound')
              .eq('payload->>kommoId',String(kommoId)).in('status',['pending','processing','uncertain']).limit(1);
            if(pending.error)throw Error('SHOWROOM_PENDING_INPUT_READ_FAILED');
            if (!permitted(currentConfig, fresh, automationSettings().testLeadId) || fresh.tracking_opt_out_at || fresh.bot_enabled !== true || later.data?.length || pending.data?.length || ['assigned', 'acknowledged', 'queued'].includes(text(fresh.handoff_status))) {
                await db().from('lv_showroom_contacts').update({ status: 'cancelled', reason: 'context_changed' }).eq('id', invitation.id);
                continue;
            }
            if(botStopped(await getKommoLead(kommoId))){await db().from('lv_showroom_contacts').update({status:'cancelled',reason:'kommo_paused'}).eq('id',invitation.id);continue;}
            await guard();
            launching = true;
            await launchSalesbot(kommoId, kind === 'unit' ? 26428 : 26430, {audience:currentConfig._audience,sourceAt:text(invitation.consent_at),jobCreatedAt:text(invitation.created_at)||undefined});
            const saved = await db().from('lv_showroom_contacts').update({ status: 'accepted', accepted_at: new Date().toISOString(), reason: 'provider_accepted_not_delivery_confirmed' }).eq('id', invitation.id);
            if (saved.error)
                throw Error('SHOWROOM_RECEIPT_SAVE_FAILED');
            result.push({ id: invitation.id, status: 'accepted', kind });
        }
        catch (error) {
            const uncertain = launching && (!(error instanceof ProviderError) || error.uncertain);
            const retryable=!uncertain&&invitation.attempts<2&&(!launching||error instanceof ProviderError&&error.status===429);
            await db().from('lv_showroom_contacts').update({ status: uncertain ? 'uncertain' : retryable?'scheduled':'failed',
                available_at:new Date(Date.now()+5*60000).toISOString(),reason: uncertain ? 'check_kommo_before_retry' : 'provider_rejected_or_pre_send_failure' }).eq('id', invitation.id);
            result.push({ id: invitation.id, status: uncertain ? 'uncertain' : retryable?'scheduled':'failed' });
        }
    }
    return { contacts: result };
}
/** Specific entry receipt; no global interpretation of "sí" as showroom consent. */
export async function applyShowroomEntry(lead: Row, summary: Row, current: string): Promise<Row> {
    const contact = await db().from('lv_showroom_contacts').select('*').match(scope).eq('lead_id', lead.id).in('status', ['accepted','responded'])
        .order('accepted_at', { ascending: false }).limit(1).maybeSingle();
    if (contact.error) {
        if (contact.error.code === 'PGRST205')
            return summary;
        throw Error('SHOWROOM_ENTRY_READ_FAILED');
    }
    const invitation = contact.data;
    if (!invitation)
        return summary;
    const profile: Row = { ...object(summary._lead_profile), entry_origin: 'showroom' };
    if (!text(profile.full_name) && invitation.form_name) {
        profile.full_name = invitation.form_name;
        profile.sources = { ...object(profile.sources), full_name: { source: 'showroom_form', evidence: invitation.form_name, record_id: invitation.id } };
    }
    // Retain form identity across a failed reply without accepting twice.
    if(invitation.status==='responded')return {...summary,_lead_profile:profile};
    if(Date.now()-Date.parse(invitation.accepted_at)>7*24*3600000)return {...summary,_lead_profile:profile};
    const conversations = await db().from('conversations').select('id').eq('lead_id', lead.id);
    if (conversations.error)
        throw Error('SHOWROOM_REPLY_CONTEXT_FAILED');
    const ids = (conversations.data || []).map(row => row.id);
    const newer = ids.length ? await db().from('messages').select('id,content').in('conversation_id', ids).in('role', ['bot', 'asesor']).gt('sent_at', invitation.accepted_at).order('sent_at',{ascending:false}).limit(10) : { data: [], error: null };
    if (newer.error)
        throw Error('SHOWROOM_REPLY_CONTEXT_FAILED');
    const normalize=(value:unknown)=>text(value).replace(/\s+/g,' ').trim();
    const invitationBody=normalize(showroomInvitationBody(invitation.unit_label));
    // A delayed echo of this Salesbot is the invitation itself, not a new topic.
    if (newer.data?.some(message=>normalize(message.content)!==invitationBody))
        return {...summary,_lead_profile:profile};
    const answer = showroomButtonReply(current) || 'question';
    const update = await db().from('lv_showroom_contacts').update({ status: 'responded', response_kind: answer }).eq('id', invitation.id).eq('status', 'accepted');
    if (update.error)
        throw Error('SHOWROOM_ENTRY_WRITE_FAILED');
    if (answer === 'stop') {
        await rpc('set_tracking_preference', { p_lead_id: lead.id, p_consent: false, p_reason: 'showroom_opt_out' });
        await db().from('lv_showroom_contacts').update({ status: 'cancelled', reason: 'opt_out' }).match(scope).eq('lead_id', lead.id).eq('status', 'scheduled');
        await db().from('lv_integration_events').update({status:'cancelled',result:{action:'cancelled',reason:'showroom_opt_out'}}).match(scope).eq('kind','maintenance')
          .eq('payload->>leadId',String(lead.id)).eq('status','pending').in('payload->>task',['nutrition_24h','nutrition_week_one','nutrition_week_two','nutrition_week_three']);
    }
    const next: Row = { ...summary, _lead_profile: profile, _brand_introduced: true,
        _showroom_entry: { id: invitation.id, unit_id: invitation.unit_id, response_kind: answer },
        _interaction_mode: { mode: 'information_only', evidence: current, source: 'showroom_information_invitation' } };
    if (['information','question'].includes(answer) && invitation.unit_id) {
        const question = { id: 'showroom_information', act: 'material', question: '¿Le gustaría recibir información sobre este espacio o sobre el proyecto?', target_ids: [invitation.unit_id], candidate_ids: [invitation.unit_id] };
        next._pending_question = question;
        next._interpretation_pending = true;
        next._property_context = { ...object(summary._property_context), version: 2, focused_ids: [invitation.unit_id], offered_ids: [invitation.unit_id],
            pending_question: question, query: { operation: 'details', scope: 'offered' }, selected_ids: [] };
    }
    return next;
}
