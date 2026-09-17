-- Parámetros editables de automatización (horario, SLA, cortes de temperatura).
-- Punto de restauración del código: no toca vw_lead_automation_dashboard.
-- Reversión SQL: 20260905140000_automation_rules_down.sql

ALTER TABLE public.project_automation_config
  ADD COLUMN IF NOT EXISTS sla_response_minutes integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS temperature_warm_min integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS temperature_hot_min integer NOT NULL DEFAULT 60;

ALTER TABLE public.project_automation_config
  DROP CONSTRAINT IF EXISTS project_automation_config_sla_minutes_check;
ALTER TABLE public.project_automation_config
  ADD CONSTRAINT project_automation_config_sla_minutes_check
  CHECK (sla_response_minutes > 0 AND sla_response_minutes <= 10080);

ALTER TABLE public.project_automation_config
  DROP CONSTRAINT IF EXISTS project_automation_config_temperature_cuts_check;
ALTER TABLE public.project_automation_config
  ADD CONSTRAINT project_automation_config_temperature_cuts_check
  CHECK (
    temperature_warm_min > 0
    AND temperature_hot_min > temperature_warm_min
  );

COMMENT ON COLUMN public.project_automation_config.sla_response_minutes IS
  'Minutos hábiles para que el asesor responda tras un traspaso. Lo usa handoff_lead.';
COMMENT ON COLUMN public.project_automation_config.temperature_warm_min IS
  'Puntaje mínimo para tibio. Lo usa apply_lead_events.';
COMMENT ON COLUMN public.project_automation_config.temperature_hot_min IS
  'Puntaje mínimo para caliente / traspaso. Lo usa apply_lead_events.';

DROP POLICY IF EXISTS "Authenticated read project_automation_config" ON public.project_automation_config;
CREATE POLICY "Authenticated read project_automation_config"
  ON public.project_automation_config FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read nutrition_steps" ON public.nutrition_steps;
CREATE POLICY "Authenticated read nutrition_steps"
  ON public.nutrition_steps FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.apply_lead_events(
  p_lead_id uuid,
  p_events jsonb,
  p_source_message_id text DEFAULT NULL
)
RETURNS TABLE(temperature text, temperature_score integer, handoff_required boolean, handoff_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
declare
  v_event text;
  v_rule public.lead_scoring_rules;
  v_key text;
  v_old_temp text;
  v_new_temp text;
  v_score integer;
  v_handoff_reason text;
  v_project uuid;
  v_warm integer := 25;
  v_hot integer := 60;
begin
  select l.temperature, l.project_id
  into v_old_temp, v_project
  from public.leads l
  where l.id = p_lead_id
  for update;
  if not found then raise exception 'Lead no encontrado'; end if;

  if v_project is not null then
    select
      coalesce(c.temperature_warm_min, 25),
      coalesce(c.temperature_hot_min, 60)
    into v_warm, v_hot
    from public.project_automation_config c
    where c.project_id = v_project;
    if not found then
      v_warm := 25;
      v_hot := 60;
    end if;
  end if;

  for v_event in select jsonb_array_elements_text(coalesce(p_events, '[]'::jsonb)) loop
    select * into v_rule from public.lead_scoring_rules r where r.event_type = v_event and r.active;
    if found then
      v_key := case when v_rule.repeatable
        then coalesce(p_source_message_id, gen_random_uuid()::text) || ':' || v_event
        else 'milestone:' || v_event end;
      insert into public.lead_score_events(lead_id, event_type, points, reason, source_message_id, idempotency_key)
      values (p_lead_id, v_event, v_rule.points, v_rule.reason, p_source_message_id, v_key)
      on conflict (lead_id, idempotency_key) do nothing;
    end if;
  end loop;

  select greatest(0, coalesce(sum(e.points), 0))::integer into v_score
  from public.lead_score_events e where e.lead_id = p_lead_id;
  v_new_temp := case
    when v_score >= v_hot then 'caliente'
    when v_score >= v_warm then 'tibio'
    else 'frio'
  end;

  update public.leads set
    temperature = v_new_temp,
    temperature_score = v_score,
    temperature_updated_at = now(),
    updated_at = now()
  where id = p_lead_id;

  if v_old_temp is distinct from v_new_temp then
    insert into public.lead_temperature_history(lead_id, from_temperature, to_temperature, score, reason, created_at)
    values (
      p_lead_id, v_old_temp, v_new_temp, v_score,
      coalesce((
        select string_agg(r.reason, ', ')
        from public.lead_scoring_rules r
        where r.event_type in (select jsonb_array_elements_text(coalesce(p_events, '[]'::jsonb)))
      ), 'recalculo por eventos'),
      now()
    );
  end if;

  if coalesce(p_events, '[]'::jsonb) ? 'asked_reservation' then
    perform public.set_lead_stage(p_lead_id, 'reserva_venta', 'pregunto como reservar');
  elsif coalesce(p_events, '[]'::jsonb) ?| array['asked_price', 'asked_financing', 'requested_visit']
     or v_new_temp = 'caliente' then
    perform public.set_lead_stage(p_lead_id, 'preventa', 'mostro intencion comercial de preventa');
  elsif coalesce(p_events, '[]'::jsonb) ?| array['declared_unit_type', 'declared_purchase_purpose'] then
    perform public.set_lead_stage(p_lead_id, 'precalificacion', 'declaro preferencias de compra');
  end if;

  select case
    when coalesce(p_events, '[]'::jsonb) ? 'requested_visit' then 'solicito una visita'
    when coalesce(p_events, '[]'::jsonb) ? 'asked_reservation' then 'pregunto como reservar'
    when v_new_temp = 'caliente' then 'alcanzo ' || v_hot || ' puntos o mas'
    else null
  end into v_handoff_reason;

  return query select v_new_temp, v_score, (v_handoff_reason is not null), v_handoff_reason;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handoff_lead(p_lead_id uuid, p_reason text)
RETURNS TABLE(
  lead_id uuid,
  assigned_to uuid,
  handoff_status text,
  reason text,
  response_due_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
declare
  v_project uuid;
  v_tenant uuid;
  v_seller uuid;
  v_conv uuid;
  v_open boolean;
  v_due timestamptz;
  v_sla integer := 120;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Motivo obligatorio';
  end if;

  select l.project_id, l.tenant_id
  into v_project, v_tenant
  from public.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead no encontrado';
  end if;

  select coalesce(c.sla_response_minutes, 120)
  into v_sla
  from public.project_automation_config c
  where c.project_id = v_project;
  if not found then
    v_sla := 120;
  end if;

  v_open := public.is_project_open(v_project, now());

  if v_open then
    perform pg_advisory_xact_lock(hashtext(v_project::text));

    select ps.salesperson_id
    into v_seller
    from public.project_salespeople ps
    join public.profiles p on p.id = ps.salesperson_id
    where ps.project_id = v_project
      and ps.tenant_id = v_tenant
      and ps.receives_leads = true
      and p.is_active = true
    order by
      ps.last_lead_assigned_at asc nulls first,
      ps.rotation_order,
      ps.id
    limit 1
    for update of ps;

    if v_seller is null then
      raise exception 'No hay asesores activos configurados para el proyecto %', v_project;
    end if;

    update public.project_salespeople ps
    set last_lead_assigned_at = now()
    where ps.project_id = v_project
      and ps.salesperson_id = v_seller;

    v_due := public.add_business_minutes(v_project, now(), v_sla);

    update public.leads l
    set
      assigned_to = v_seller,
      bot_enabled = false,
      handoff_status = 'assigned',
      handoff_reason = p_reason,
      handoff_requested_at = coalesce(l.handoff_requested_at, now()),
      handoff_assigned_at = now(),
      seller_response_due_at = v_due,
      updated_at = now()
    where l.id = p_lead_id;
  else
    update public.leads l
    set
      bot_enabled = false,
      handoff_status = 'queued',
      handoff_reason = p_reason,
      handoff_requested_at = coalesce(l.handoff_requested_at, now()),
      updated_at = now()
    where l.id = p_lead_id;
  end if;

  select c.id
  into v_conv
  from public.conversations c
  where c.lead_id = p_lead_id
  order by c.started_at desc
  limit 1;

  if v_conv is not null
     and not exists (
       select 1
       from public.bot_escalations be
       where be.conversation_id = v_conv
         and be.resolved_at is null
     )
  then
    update public.conversations c
    set status = 'escalada'
    where c.id = v_conv;

    insert into public.bot_escalations (conversation_id, assigned_to, reason)
    values (v_conv, v_seller, p_reason);
  end if;

  return query
  select
    p_lead_id,
    v_seller,
    case when v_seller is not null then 'assigned' else 'queued' end,
    p_reason,
    v_due;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_project_open(
  p_project_id uuid,
  p_at timestamp with time zone DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
declare
  c public.project_automation_config;
  local_at timestamp;
  d jsonb;
begin
  select * into c from public.project_automation_config where project_id = p_project_id;
  if not found then
    raise exception 'Falta project_automation_config para el proyecto %', p_project_id;
  end if;
  if not c.is_active then
    return false;
  end if;
  local_at := p_at at time zone c.timezone;
  d := c.business_hours -> extract(isodow from local_at)::int::text;
  if d is null then
    return false;
  end if;
  return local_at::time >= (d->>'open')::time and local_at::time < (d->>'close')::time;
end;
$function$;
