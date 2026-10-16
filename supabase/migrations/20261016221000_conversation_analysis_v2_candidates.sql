-- Include urgent operational signals before 24h of inactivity. A contact with
-- incoming work is excluded, without starving all other contacts globally.
create or replace function public.lv_idle_analysis_candidate(p_tenant_id uuid,p_project_id uuid,p_allowed_lead_ids uuid[] default null)
returns table(lead_id uuid,project_id uuid) language sql stable security definer set search_path=public as $$
 select l.id,l.project_id from public.leads l
 join lateral(select c.id from public.conversations c where c.lead_id=l.id order by c.last_message_at desc nulls last,c.id limit 1) c on true
 join lateral(select max(m.sent_at) last_at from public.messages m where m.conversation_id=c.id) latest on true
 left join lateral(select a.created_at,a.source_last_message_at,a.analysis from public.lead_conversation_analyses a
   where a.conversation_id=c.id order by a.created_at desc,a.id limit 1) evaluated on true
 where l.tenant_id=p_tenant_id and l.project_id=p_project_id and (p_allowed_lead_ids is null or l.id=any(p_allowed_lead_ids))
   and not exists(select 1 from public.lv_integration_events e where e.tenant_id=l.tenant_id and e.project_id=l.project_id
     and e.kind='inbound' and e.status in ('pending','processing') and e.payload->>'kommoId'=l.kommo_id::text)
   and (latest.last_at<now()-interval '24 hours' or l.handoff_status in ('queued','assigned','acknowledged') and l.seller_response_due_at<now()
     or exists(select 1 from public.lead_reservation_requests r where r.lead_id=l.id and r.notification_status in ('failed','pending_assignment'))
     or exists(select 1 from public.lv_integration_events e where e.tenant_id=l.tenant_id and e.project_id=l.project_id
       and e.status in ('failed','uncertain','cancelled') and e.result->>'requires_review'='true'
       and (e.payload->>'kommoId'=l.kommo_id::text or e.contact_key=l.kommo_id::text)))
   and (evaluated.created_at is null or evaluated.analysis->>'version' is distinct from '2'
     or evaluated.source_last_message_at<latest.last_at or l.updated_at>evaluated.created_at
     or exists(select 1 from public.lv_integration_events e where e.tenant_id=l.tenant_id and e.project_id=l.project_id
       and e.status in ('failed','uncertain','cancelled') and e.result->>'requires_review'='true' and e.received_at>evaluated.created_at
       and (e.payload->>'kommoId'=l.kommo_id::text or e.contact_key=l.kommo_id::text))
     or exists(select 1 from public.lead_conversation_analysis_reviews r where r.lead_id=l.id and r.created_at>evaluated.created_at)
     or l.handoff_status in ('queued','assigned','acknowledged') and l.seller_response_due_at<now()
       and l.seller_response_due_at>evaluated.created_at
       and not exists(select 1 from jsonb_array_elements(coalesce(evaluated.analysis#>'{operational_snapshot,signals}','[]'::jsonb)) s where s->>'key'='advisor_overdue'))
 order by (l.handoff_status in ('queued','assigned','acknowledged') and l.seller_response_due_at<now()) desc nulls last,
   evaluated.created_at asc nulls first,l.last_interaction_at,l.id limit 1;
$$;
revoke all on function public.lv_idle_analysis_candidate(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.lv_idle_analysis_candidate(uuid,uuid,uuid[]) to service_role;
