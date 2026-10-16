create table public.lead_conversation_analyses (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,project_id uuid not null,
 lead_id uuid not null references public.leads(id),conversation_id uuid not null references public.conversations(id),
 source_last_message_at timestamptz,source_fingerprint text not null,
 analysis jsonb not null,created_at timestamptz not null default now(),
 unique(conversation_id,source_fingerprint)
);
alter table public.lead_conversation_analyses enable row level security;
revoke all on public.lead_conversation_analyses from public,anon,authenticated;
grant all on public.lead_conversation_analyses to service_role;

create index conversation_analyses_lead_recent on public.lead_conversation_analyses(lead_id,created_at desc);
create function public.lv_idle_analysis_candidate(p_tenant_id uuid,p_project_id uuid,p_allowed_lead_ids uuid[] default null)
returns table(lead_id uuid,project_id uuid) language sql stable security definer set search_path=public as $$
 select l.id,l.project_id from public.leads l
 join lateral(select c.id from public.conversations c where c.lead_id=l.id
   order by c.last_message_at desc nulls last,c.id limit 1) c on true
 join lateral(select max(m.sent_at) as last_at from public.messages m where m.conversation_id=c.id) latest on true
 where l.tenant_id=p_tenant_id and l.project_id=p_project_id
   and (p_allowed_lead_ids is null or l.id=any(p_allowed_lead_ids))
   and latest.last_at<now()-interval '24 hours'
   and not exists(select 1 from public.lead_conversation_analyses a where a.conversation_id=c.id
     and a.source_last_message_at>=latest.last_at and a.analysis->>'inactivity'='true'
     and a.analysis->>'version'='1' and a.analysis->>'handoff_status'=coalesce(l.handoff_status,'none')
     and a.analysis->>'opt_out'=(l.tracking_opt_out_at is not null)::text)
 order by l.last_interaction_at,l.id limit 1;
$$;
revoke all on function public.lv_idle_analysis_candidate(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.lv_idle_analysis_candidate(uuid,uuid,uuid[]) to service_role;
