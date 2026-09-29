-- Retain the scoring engine's decision without executing a handoff here.
-- Installation does not evaluate historical messages or assign any lead.
alter table public.lead_interest_evaluations
  add column handoff_decision jsonb;

comment on column public.lead_interest_evaluations.handoff_decision is
  'Atomic result of the scoring evaluation. Advice only; the conversational action must verify the current request and execute/verify any handoff separately.';

-- Keep the void signature for callers deployed before the v2 RPC.
create or replace function public.lv_evaluate_message_interest(
  p_lead_id uuid,
  p_events jsonb,
  p_source_message_id text
)
returns void language plpgsql security definer set search_path='' as $$
declare
  source_at timestamptz;
  eval_id uuid;
  current_score integer;
  current_temp text;
  scoring_decision jsonb;
begin
  perform 1 from public.leads
    where id=p_lead_id
      and tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
      and project_id='b1b2c3d4-0001-4000-8000-000000000001'
    for update;
  if not found then raise exception 'INTEREST_SCOPE_MISMATCH'; end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'INVALID_INTEREST_EVENTS';
  end if;

  select m.sent_at into source_at
    from public.messages m
    join public.conversations c on c.id=m.conversation_id
    where c.lead_id=p_lead_id
      and m.external_message_id=p_source_message_id
      and m.role='cliente'
      and nullif(trim(m.content),'') is not null;
  if not found then raise exception 'INTEREST_CUSTOMER_EVIDENCE_REQUIRED'; end if;

  -- A retry returns the original result even if scoring rules changed later.
  -- It cannot replace that message's events with a different interpretation.
  perform 1 from public.lead_interest_evaluations
    where lead_id=p_lead_id and source_message_id=p_source_message_id;
  if found then return; end if;

  if exists (
    select 1 from jsonb_array_elements_text(p_events) e
    where not exists (
      select 1 from public.lead_scoring_rules r
      where r.event_type=e and r.active and r.points>=0
    )
  ) then raise exception 'INVALID_INTEREST_RULE'; end if;

  insert into public.lead_interest_evaluations(
    lead_id,source_message_id,source_sent_at,recognized_events,rules_snapshot
  ) values (
    p_lead_id,p_source_message_id,source_at,p_events,jsonb_build_object(
      'rules',(select jsonb_agg(to_jsonb(r)) from public.lead_scoring_rules r where r.active),
      'thresholds',(
        select jsonb_build_object('warm',c.temperature_warm_min,'hot',c.temperature_hot_min)
        from public.project_automation_config c
        join public.leads l on l.project_id=c.project_id where l.id=p_lead_id
      )
    )
  ) returning id into eval_id;

  if jsonb_array_length(p_events)>0 then
    select jsonb_build_object(
      'temperature',r.temperature,
      'temperature_score',r.temperature_score,
      'handoff_required',r.handoff_required,
      'handoff_reason',r.handoff_reason,
      'decision_source','apply_lead_events'
    ) into scoring_decision
    from public.apply_lead_events(p_lead_id,p_events,p_source_message_id) r;
  else
    -- Empty extraction records an evaluation, not a commercial action.
    update public.leads set temperature_updated_at=now() where id=p_lead_id;
    select temperature_score,temperature into current_score,current_temp
      from public.leads where id=p_lead_id;
    scoring_decision:=jsonb_build_object(
      'temperature',current_temp,
      'temperature_score',current_score,
      'handoff_required',false,
      'handoff_reason',null,
      'decision_source','no_new_signals'
    );
  end if;

  update public.lead_interest_evaluations
    set score=(scoring_decision->>'temperature_score')::integer,
      temperature=scoring_decision->>'temperature',
      handoff_decision=scoring_decision
    where id=eval_id;
end $$;

create function public.lv_evaluate_message_interest_v2(
  p_lead_id uuid,
  p_events jsonb,
  p_source_message_id text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  evaluation public.lead_interest_evaluations;
  decision jsonb;
  historical_reason text;
begin
  -- The existing endpoint owns evidence, scope, locking and idempotency.
  perform public.lv_evaluate_message_interest(p_lead_id,p_events,p_source_message_id);
  select * into strict evaluation from public.lead_interest_evaluations
    where lead_id=p_lead_id and source_message_id=p_source_message_id;
  decision:=evaluation.handoff_decision;

  if decision is null then
    -- Pre-migration rows did not retain the return value. Recover advice from
    -- their original evidence/snapshot only; never reapply points or stage.
    -- Keep the scoring engine's original visit > reservation > hot ordering.
    historical_reason:=case
      when jsonb_array_length(evaluation.recognized_events)=0 then null
      when evaluation.recognized_events ? 'requested_visit' then 'solicito una visita'
      when evaluation.recognized_events ? 'asked_reservation' then 'pregunto como reservar'
      when evaluation.temperature='caliente' then
        'alcanzo ' || coalesce(evaluation.rules_snapshot#>>'{thresholds,hot}','60') || ' puntos o mas'
      else null
    end;
    decision:=jsonb_build_object(
      'temperature',evaluation.temperature,
      'temperature_score',evaluation.score,
      'handoff_required',historical_reason is not null,
      'handoff_reason',historical_reason,
      'decision_source','historical_snapshot'
    );
  end if;

  return decision || jsonb_build_object(
    'evaluation_id',evaluation.id,
    'lead_id',evaluation.lead_id,
    'source_message_id',evaluation.source_message_id,
    'source_sent_at',evaluation.source_sent_at,
    'recognized_events',evaluation.recognized_events
  );
end $$;

revoke all on function public.lv_evaluate_message_interest(uuid,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.lv_evaluate_message_interest(uuid,jsonb,text) to service_role;
revoke all on function public.lv_evaluate_message_interest_v2(uuid,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.lv_evaluate_message_interest_v2(uuid,jsonb,text) to service_role;
