-- PREPARED ONLY. No historical evaluation or replay is executed by installation.
create table public.lead_interest_evaluations (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id),
 source_message_id text not null,
 source_sent_at timestamptz not null,
 evaluated_at timestamptz not null default now(),
 recognized_events jsonb not null,
 rules_snapshot jsonb not null,
 score integer,
 temperature text,
 unique(lead_id,source_message_id)
);
alter table public.lead_interest_evaluations enable row level security;
revoke all on public.lead_interest_evaluations from public,anon,authenticated,service_role;
grant select on public.lead_interest_evaluations to service_role;

create function public.lv_evaluate_message_interest(p_lead_id uuid,p_events jsonb,p_source_message_id text)
returns void language plpgsql security definer set search_path='' as $$
declare source_at timestamptz; eval_id uuid; current_score int; current_temp text;
begin
 -- Existing interpretation is the caller; source must be a stored customer message.
 perform 1 from public.leads where id=p_lead_id
   and tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
   and project_id='b1b2c3d4-0001-4000-8000-000000000001' for update;
 if not found then raise exception 'INTEREST_SCOPE_MISMATCH'; end if;
 if jsonb_typeof(p_events) is distinct from 'array' then raise exception 'INVALID_INTEREST_EVENTS'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_events) e where not exists(
   select 1 from public.lead_scoring_rules r where r.event_type=e and r.active and r.points>=0))
 then raise exception 'INVALID_INTEREST_RULE'; end if;
 select m.sent_at into source_at from public.messages m join public.conversations c on c.id=m.conversation_id
 where c.lead_id=p_lead_id and m.external_message_id=p_source_message_id and m.role='cliente'
   and nullif(trim(m.content),'') is not null;
 if not found then raise exception 'INTEREST_CUSTOMER_EVIDENCE_REQUIRED'; end if;
 insert into public.lead_interest_evaluations(lead_id,source_message_id,source_sent_at,recognized_events,rules_snapshot)
 values(p_lead_id,p_source_message_id,source_at,p_events,jsonb_build_object(
   'rules',(select jsonb_agg(to_jsonb(r)) from public.lead_scoring_rules r where r.active),
   'thresholds',(select jsonb_build_object('warm',c.temperature_warm_min,'hot',c.temperature_hot_min)
      from public.project_automation_config c join public.leads l on l.project_id=c.project_id where l.id=p_lead_id)))
 on conflict do nothing returning id into eval_id;
 if eval_id is null then return; end if;
 if jsonb_array_length(p_events)>0 then
   perform public.apply_lead_events(p_lead_id,p_events,p_source_message_id);
 else
   -- A completed interpretation without new signals is evidence of evaluation,
   -- not a reason to change commercial stage, consent or accumulated points.
   update public.leads set temperature_updated_at=now() where id=p_lead_id;
 end if;
 select temperature_score,temperature into current_score,current_temp from public.leads where id=p_lead_id;
 update public.lead_interest_evaluations set score=current_score,temperature=current_temp where id=eval_id;
end $$;
revoke all on function public.lv_evaluate_message_interest(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.lv_evaluate_message_interest(uuid,jsonb,text) to service_role;

-- Retire the unused competing writer. Keep the currently called 7/14 day rules.
create or replace function public.lv3_store_cooling(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin raise exception 'LEGACY_COOLING_DISABLED_USE_CANONICAL_DECAY'; end $$;
revoke all on function public.lv3_store_cooling(jsonb) from public,anon,authenticated,service_role;
