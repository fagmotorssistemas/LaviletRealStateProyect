'use server';
import { assertCanAccessCrmPath, getSessionUser } from '@/lib/auth/session';
import { tryCreateAdminClient } from '@/lib/supabase/admin';
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants';
import { readPipelinePages, readPipelineRelated } from '@/services/leadPipelineSources.service';
import { analyzeLeadConversation } from '@/lib/integrations/automation/conversation-analysis';
import { object, text } from '@/lib/integrations/automation/data';
export async function getConversationAnalysisDashboard() {
    await assertCanAccessCrmPath('/inmobiliaria/analisis-conversaciones');
    const { supabase } = await getSessionUser(), tenants = await getAccessibleTenantIds(supabase);
    const leads = await readPipelinePages((from, to) => supabase.from('leads').select('id,name,source,project_id,temperature,assigned_to,project:projects(name)').in('tenant_id', tenants).order('id').range(from, to));
    const ids = leads.map(row => text(row.id)), admin = tryCreateAdminClient();
    if (!admin)
        throw Error('No está disponible el análisis en el servidor.');
    const [conversations, reviews] = await Promise.all([
        readPipelineRelated(ids, (chunk, from, to) => supabase.from('conversations').select('id,lead_id,summary,last_message_at').in('lead_id', chunk).order('id').range(from, to)),
        readPipelineRelated(ids, (chunk, from, to) => admin.from('lead_conversation_analyses').select('id,lead_id,analysis,created_at,source_last_message_at').in('lead_id', chunk).order('id').range(from, to)),
    ]);
    return leads.map(lead => {
        const conversation = conversations.filter(row => row.lead_id === lead.id).sort((a, b) => text(b.last_message_at).localeCompare(text(a.last_message_at)))[0];
        const summary = object(conversation?.summary), profile = object(summary._lead_profile), property = object(object(summary._interpretation_memory).property);
        const review = reviews.filter(row => row.lead_id === lead.id).sort((a, b) => text(b.created_at).localeCompare(text(a.created_at)))[0];
        return { id: text(lead.id), name: text(lead.name) || 'Contacto sin nombre', projectId: text(lead.project_id), projectName: text(object(lead.project).name) || 'Proyecto sin nombre', source: ({ waba: 'WhatsApp', whatsapp: 'WhatsApp', showroom_360: 'Showroom 360' } as Record<string, string>)[text(lead.source)] || text(lead.source) || 'Sin origen', temperature: text(lead.temperature),
            residence: text(profile.residence_city || profile.residence_country) || 'Sin residencia declarada', category: text(property.category) || 'Sin tipo declarado',
            lastMessageAt: text(conversation?.last_message_at), analysis: review ? object(review.analysis) : null, reviewAt: text(review?.created_at), stale: !!review && Date.parse(text(conversation?.last_message_at)) > Date.parse(text(review.source_last_message_at)) + 1000 };
    });
}
export async function evaluateConversation(leadId: string) {
    await assertCanAccessCrmPath('/inmobiliaria/analisis-conversaciones');
    const { supabase } = await getSessionUser();
    const lead = await supabase.from('leads').select('id,project_id').eq('id', leadId).maybeSingle();
    if (lead.error || !lead.data?.project_id)
        throw Error('No tiene acceso al lead solicitado.');
    await analyzeLeadConversation(lead.data.id, lead.data.project_id);
    return { ok: true };
}
