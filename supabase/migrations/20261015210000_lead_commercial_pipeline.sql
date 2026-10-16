-- Canonical pipeline is projected from evidence, not the legacy bot-step column.
-- Installing this migration never replays a chat, sends a message or reserves inventory.
create table public.lead_commercial_profiles (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  nutrition_active boolean not null default false,
  nutrition_reason text,
  purchase_horizon text,
  nutrition_evidence text,
  contact_consent boolean not null default false,
  resume_at timestamptz,
  next_action text,
  next_action_at timestamptz,
  next_action_owner_id uuid references public.profiles(id),
  opportunity_status text not null default 'open' check(opportunity_status in ('open','lost')),
  closure_reason text,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_commercial_profile_nutrition_proof check(not nutrition_active or (
    nullif(trim(nutrition_reason),'') is not null
    and nullif(trim(purchase_horizon),'') is not null
    and nullif(trim(nutrition_evidence),'') is not null and contact_consent)),
  constraint lead_commercial_profile_loss_reason check(opportunity_status <> 'lost' or nullif(trim(closure_reason),'') is not null),
  constraint lead_commercial_profile_action check(next_action_at is null or nullif(trim(next_action),'') is not null)
);
create index lead_commercial_profiles_tenant on public.lead_commercial_profiles(tenant_id);
create table public.lead_commercial_profile_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  actor_id uuid references public.profiles(id),
  reason text not null,
  old_data jsonb,
  new_data jsonb not null,
  created_at timestamptz not null default now()
);
create index lead_commercial_profile_history_lead on public.lead_commercial_profile_history(lead_id,created_at desc);

create function public.lv_can_manage_lead_commercial_profile(p_lead_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.leads l join public.profiles p on p.id=auth.uid()
    where l.id=p_lead_id and p.is_active is true
      and (p.role::text='admin' or (p.role::text='asesor' and exists(
        select 1 from public.project_salespeople ps
        where ps.salesperson_id=p.id and ps.tenant_id=l.tenant_id and ps.project_id=l.project_id
      )))
  );
$$;
revoke all on function public.lv_can_manage_lead_commercial_profile(uuid) from public,anon;
grant execute on function public.lv_can_manage_lead_commercial_profile(uuid) to authenticated,service_role;
alter table public.lead_commercial_profiles enable row level security;
alter table public.lead_commercial_profile_history enable row level security;
create policy lead_commercial_profiles_read on public.lead_commercial_profiles for select to authenticated
  using(public.lv_can_manage_lead_commercial_profile(lead_id)
    and exists(select 1 from public.leads l where l.id=lead_id and l.tenant_id=lead_commercial_profiles.tenant_id));
create policy lead_commercial_profile_history_read on public.lead_commercial_profile_history for select to authenticated
  using(public.lv_can_manage_lead_commercial_profile(lead_id)
    and exists(select 1 from public.leads l where l.id=lead_id and l.tenant_id=lead_commercial_profile_history.tenant_id));
revoke all on public.lead_commercial_profiles,public.lead_commercial_profile_history from public,anon,authenticated;
grant select on public.lead_commercial_profiles,public.lead_commercial_profile_history to authenticated;
grant all on public.lead_commercial_profiles,public.lead_commercial_profile_history to service_role;

create function public.save_lead_commercial_profile(
  p_lead_id uuid,
  p_nutrition_active boolean,
  p_nutrition_reason text,
  p_purchase_horizon text,
  p_nutrition_evidence text,
  p_contact_consent boolean,
  p_resume_at timestamptz,
  p_next_action text,
  p_next_action_at timestamptz,
  p_opportunity_status text,
  p_closure_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare customer public.leads; previous public.lead_commercial_profiles; saved public.lead_commercial_profiles;
begin
  if not public.lv_can_manage_lead_commercial_profile(p_lead_id) then raise exception 'LEAD_PROFILE_FORBIDDEN'; end if;
  select * into strict customer from public.leads where id=p_lead_id for update;
  if customer.assigned_to is not null and customer.assigned_to is distinct from auth.uid()
    and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role::text='admin' and p.is_active is true) then
    raise exception 'LEAD_PROFILE_OWNER_REQUIRED';
  end if;
  if p_opportunity_status not in ('open','lost') or p_opportunity_status is null then raise exception 'INVALID_OPPORTUNITY_STATUS'; end if;
  if p_opportunity_status='lost' and exists(select 1 from public.unit_sales_closings where lead_id=p_lead_id) then
    raise exception 'SALE_ALREADY_RECORDED';
  end if;
  select * into previous from public.lead_commercial_profiles where lead_id=p_lead_id;
  insert into public.lead_commercial_profiles(lead_id,tenant_id,nutrition_active,nutrition_reason,purchase_horizon,
    nutrition_evidence,contact_consent,resume_at,next_action,next_action_at,next_action_owner_id,
    opportunity_status,closure_reason,updated_by)
  values(p_lead_id,customer.tenant_id,coalesce(p_nutrition_active,false),nullif(trim(p_nutrition_reason),''),
    nullif(trim(p_purchase_horizon),''),nullif(trim(p_nutrition_evidence),''),coalesce(p_contact_consent,false),
    p_resume_at,nullif(trim(p_next_action),''),p_next_action_at,customer.assigned_to,
    p_opportunity_status,case when p_opportunity_status='lost' then nullif(trim(p_closure_reason),'') else null end,auth.uid())
  on conflict(lead_id) do update set nutrition_active=excluded.nutrition_active,nutrition_reason=excluded.nutrition_reason,
    purchase_horizon=excluded.purchase_horizon,nutrition_evidence=excluded.nutrition_evidence,
    contact_consent=excluded.contact_consent,resume_at=excluded.resume_at,next_action=excluded.next_action,
    next_action_at=excluded.next_action_at,next_action_owner_id=excluded.next_action_owner_id,
    opportunity_status=excluded.opportunity_status,closure_reason=excluded.closure_reason,
    updated_by=excluded.updated_by,updated_at=now()
  returning * into saved;
  insert into public.lead_commercial_profile_history(lead_id,tenant_id,actor_id,reason,old_data,new_data)
  values(customer.id,customer.tenant_id,auth.uid(),
    case when saved.opportunity_status='lost' then saved.closure_reason
      when saved.nutrition_active then saved.nutrition_reason else 'Actualización de la ficha comercial' end,
    case when previous.lead_id is null then null else to_jsonb(previous) end,to_jsonb(saved));
  return to_jsonb(saved);
end $$;
revoke all on function public.save_lead_commercial_profile(uuid,boolean,text,text,text,boolean,timestamptz,text,timestamptz,text,text) from public,anon;
grant execute on function public.save_lead_commercial_profile(uuid,boolean,text,text,text,boolean,timestamptz,text,timestamptz,text,text) to authenticated;

-- Preserve the legacy enum for old clients. It is not the canonical board stage.
-- In particular, a question about reservations never proves an operational request.
-- Preserve installed argument names: older deployments used different names
-- and PostgreSQL forbids renaming inputs with CREATE OR REPLACE.
do $install$
declare names text[];
begin
  select p.proargnames into names from pg_catalog.pg_proc p
    where p.oid=pg_catalog.to_regprocedure('public.set_lead_stage(uuid,text,text)');
  execute format($definition$
create or replace function public.set_lead_stage(%I uuid,%I text,%I text)
returns void language plpgsql security definer set search_path='' as $body$
declare
  pipeline_lead_id alias for $1; pipeline_stage alias for $2; pipeline_reason alias for $3;
  customer public.leads; target text:=pipeline_stage;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.lv_can_manage_lead_commercial_profile(pipeline_lead_id) then
    raise exception 'LEAD_STAGE_FORBIDDEN';
  end if;
  select * into strict customer from public.leads where id=pipeline_lead_id for update;
  if target='reserva_venta' and not exists(
    select 1 from public.lead_reservation_requests r where r.lead_id=pipeline_lead_id
      and jsonb_array_length(r.unit_ids)>0 and nullif(trim(r.evidence),'') is not null
  ) and not exists(select 1 from public.unit_sales_closings s where s.lead_id=pipeline_lead_id) then
    target:='preventa';
  end if;
  if customer.stage in ('perdido','descartado') or array_position(array['nuevo','contacto_inicial','precalificacion','preventa','reserva_venta'],customer.stage)
    > array_position(array['nuevo','contacto_inicial','precalificacion','preventa','reserva_venta'],target) then return; end if;
  if customer.stage is distinct from target then
    update public.leads set stage=target,stage_reason=pipeline_reason,stage_updated_at=now(),updated_at=now() where id=pipeline_lead_id;
    insert into public.lead_stage_history(lead_id,from_stage,to_stage,reason,created_at)
      values(pipeline_lead_id,customer.stage,target,pipeline_reason,now());
  end if;
end $body$;
  $definition$,coalesce(names[1],'p_lead_id'),coalesce(names[2],'p_stage'),coalesce(names[3],'p_reason'));
end $install$;
revoke all on function public.set_lead_stage(uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_lead_stage(uuid,text,text) to service_role;

-- Keep score, idempotency, temperature history and handoff advice unchanged.
-- Temperature alone no longer advances the legacy commercial stage.
create or replace function public.apply_lead_events(p_lead_id uuid,p_events jsonb,p_source_message_id text default null)
returns table(temperature text,temperature_score integer,handoff_required boolean,handoff_reason text)
language plpgsql security definer set search_path='' as $$
declare
  v_event text; v_rule public.lead_scoring_rules; v_key text; v_old_temp text; v_new_temp text;
  v_score integer; v_handoff_reason text; v_project uuid; v_warm integer:=25; v_hot integer:=60;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.lv_can_manage_lead_commercial_profile(p_lead_id) then
    raise exception 'SCORING_SCOPE_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_events,'[]'::jsonb))<>'array' then raise exception 'INVALID_INTEREST_EVENTS'; end if;
  select l.temperature,l.project_id into v_old_temp,v_project from public.leads l where l.id=p_lead_id for update;
  if not found then raise exception 'Lead no encontrado'; end if;
  if v_project is not null then
    select coalesce(c.temperature_warm_min,25),coalesce(c.temperature_hot_min,60) into v_warm,v_hot
      from public.project_automation_config c where c.project_id=v_project;
    if not found then v_warm:=25; v_hot:=60; end if;
  end if;
  for v_event in select jsonb_array_elements_text(coalesce(p_events,'[]'::jsonb)) loop
    select * into v_rule from public.lead_scoring_rules r where r.event_type=v_event and r.active;
    if found then
      v_key:=case when v_rule.repeatable then coalesce(p_source_message_id,gen_random_uuid()::text)||':'||v_event else 'milestone:'||v_event end;
      insert into public.lead_score_events(lead_id,event_type,points,reason,source_message_id,idempotency_key)
        values(p_lead_id,v_event,v_rule.points,v_rule.reason,p_source_message_id,v_key)
        on conflict(lead_id,idempotency_key) do nothing;
    end if;
  end loop;
  select greatest(0,coalesce(sum(e.points),0))::integer into v_score from public.lead_score_events e where e.lead_id=p_lead_id;
  v_new_temp:=case when v_score>=v_hot then 'caliente' when v_score>=v_warm then 'tibio' else 'frio' end;
  update public.leads set temperature=v_new_temp,temperature_score=v_score,temperature_updated_at=now(),updated_at=now() where id=p_lead_id;
  if v_old_temp is distinct from v_new_temp then
    insert into public.lead_temperature_history(lead_id,from_temperature,to_temperature,score,reason,created_at)
    values(p_lead_id,v_old_temp,v_new_temp,v_score,coalesce((select string_agg(r.reason,', ')
      from public.lead_scoring_rules r where r.event_type in(select jsonb_array_elements_text(coalesce(p_events,'[]'::jsonb)))),
      'recalculo por eventos'),now());
  end if;
  if coalesce(p_events,'[]'::jsonb) ?| array['asked_reservation','asked_price','asked_financing','requested_visit','asked_availability'] then
    perform public.set_lead_stage(p_lead_id,'preventa','Consulta comercial; no autoriza una reserva ni un trámite');
  elsif coalesce(p_events,'[]'::jsonb) ?| array['declared_unit_type','declared_purchase_purpose'] then
    perform public.set_lead_stage(p_lead_id,'precalificacion','Declaró necesidades de compra');
  end if;
  select case when coalesce(p_events,'[]'::jsonb) ? 'requested_visit' then 'solicito una visita'
    when coalesce(p_events,'[]'::jsonb) ? 'asked_reservation' then 'pregunto como reservar'
    when v_new_temp='caliente' then 'alcanzo '||v_hot||' puntos o mas' else null end into v_handoff_reason;
  return query select v_new_temp,v_score,(v_handoff_reason is not null),v_handoff_reason;
end $$;
revoke all on function public.apply_lead_events(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_lead_events(uuid,jsonb,text) to service_role;

comment on table public.lead_commercial_profiles is
  'Nutrición y acciones independientes de la etapa comercial. No programa mensajes ni acredita ventas. Escritura auditada mediante RPC.';

-- These are observations made by the canonical projector, not a reconstruction
-- of unobserved historical transitions. First observation always has from=NULL.
create table public.lead_commercial_stage_observations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  from_stage text check(from_stage in ('nuevo','contacto_inicial','necesidad_identificada','interes_comercial','proceso_reserva','venta_cerrada')),
  to_stage text not null check(to_stage in ('nuevo','contacto_inicial','necesidad_identificada','interes_comercial','proceso_reserva','venta_cerrada')),
  reason text not null check(nullif(trim(reason),'') is not null),
  evidence jsonb not null check(jsonb_typeof(evidence)='array'),
  source_at timestamptz,
  observed_at timestamptz not null default clock_timestamp(),
  actor_id uuid references public.profiles(id)
);
create index lead_commercial_stage_observations_latest on public.lead_commercial_stage_observations(lead_id,observed_at desc);
alter table public.lead_commercial_stage_observations enable row level security;
create policy lead_commercial_stage_observations_read on public.lead_commercial_stage_observations for select to authenticated
  using(public.lv_can_manage_lead_commercial_profile(lead_id)
    and exists(select 1 from public.leads l where l.id=lead_id and l.tenant_id=lead_commercial_stage_observations.tenant_id));
revoke all on public.lead_commercial_stage_observations from public,anon,authenticated;
grant select on public.lead_commercial_stage_observations to authenticated;
grant all on public.lead_commercial_stage_observations to service_role;

create function public.record_lead_commercial_stage_observation(
  p_lead_id uuid,p_stage text,p_reason text,p_evidence jsonb,p_source_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare customer public.leads; previous public.lead_commercial_stage_observations; saved public.lead_commercial_stage_observations;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'PIPELINE_OBSERVATION_SERVICE_REQUIRED'; end if;
  select * into strict customer from public.leads where id=p_lead_id for update;
  if p_stage is null or p_stage not in ('nuevo','contacto_inicial','necesidad_identificada','interes_comercial','proceso_reserva','venta_cerrada') then
    raise exception 'INVALID_COMMERCIAL_STAGE';
  end if;
  if jsonb_typeof(p_evidence) is distinct from 'array' or nullif(trim(p_reason),'') is null then
    raise exception 'COMMERCIAL_STAGE_EVIDENCE_REQUIRED';
  end if;
  if p_stage<>'nuevo' and jsonb_array_length(p_evidence)=0 then raise exception 'COMMERCIAL_STAGE_EVIDENCE_REQUIRED'; end if;
  select * into previous from public.lead_commercial_stage_observations where lead_id=p_lead_id order by observed_at desc,id desc limit 1;
  if found and previous.to_stage=p_stage then return to_jsonb(previous); end if;
  insert into public.lead_commercial_stage_observations(lead_id,tenant_id,from_stage,to_stage,reason,evidence,source_at,actor_id)
    values(customer.id,customer.tenant_id,previous.to_stage,p_stage,p_reason,p_evidence,p_source_at,null)
    returning * into saved;
  return to_jsonb(saved);
end $$;
revoke all on function public.record_lead_commercial_stage_observation(uuid,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.record_lead_commercial_stage_observation(uuid,text,text,jsonb,timestamptz) to service_role;

create function public.record_lead_commercial_stage_observations(p_observations jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare observation jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'PIPELINE_OBSERVATION_SERVICE_REQUIRED'; end if;
  if jsonb_typeof(p_observations) is distinct from 'array' then raise exception 'INVALID_PIPELINE_OBSERVATIONS'; end if;
  if jsonb_array_length(p_observations)>200 then raise exception 'PIPELINE_OBSERVATION_BATCH_TOO_LARGE'; end if;
  for observation in select value from jsonb_array_elements(p_observations) order by value->>'lead_id' loop
    if jsonb_typeof(observation) is distinct from 'object' then raise exception 'INVALID_PIPELINE_OBSERVATION'; end if;
    if not observation ?& array['lead_id','stage','reason','evidence','source_at']
      or exists(select 1 from jsonb_object_keys(observation) key
        where key not in ('lead_id','stage','reason','evidence','source_at'))
      or jsonb_typeof(observation->'lead_id') is distinct from 'string'
      or jsonb_typeof(observation->'stage') is distinct from 'string'
      or jsonb_typeof(observation->'reason') is distinct from 'string'
      or jsonb_typeof(observation->'evidence') is distinct from 'array'
      or jsonb_typeof(observation->'source_at') not in ('string','null') then
      raise exception 'INVALID_PIPELINE_OBSERVATION';
    end if;
    perform public.record_lead_commercial_stage_observation((observation->>'lead_id')::uuid,
      observation->>'stage',observation->>'reason',observation->'evidence',(observation->>'source_at')::timestamptz);
  end loop;
end $$;
revoke all on function public.record_lead_commercial_stage_observations(jsonb) from public,anon,authenticated;
grant execute on function public.record_lead_commercial_stage_observations(jsonb) to service_role;
