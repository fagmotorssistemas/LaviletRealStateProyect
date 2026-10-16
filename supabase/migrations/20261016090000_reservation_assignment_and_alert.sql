-- Reservation intake assigns an eligible owner immediately, independently of
-- general office hours. Installation does not replay old requests or send messages.
alter table public.lead_reservation_requests
  add column notification_status text not null default 'pending'
    check(notification_status in ('pending','pending_assignment','created','failed')),
  add column notification_error_code text,
  add column notified_recipient uuid references public.profiles(id),
  add column notified_at timestamptz;

create function public.lv_assign_reservation_owner(p_lead_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare customer public.leads; seller uuid; sla integer; previous_context text;
begin
  select * into customer from public.leads where id=p_lead_id for update;
  if not found or customer.project_id is null or customer.tenant_id is null then return; end if;
  perform pg_advisory_xact_lock(hashtext(customer.project_id::text));
  select ps.salesperson_id into seller from public.project_salespeople ps
    join public.profiles p on p.id=ps.salesperson_id
    where ps.project_id=customer.project_id and ps.tenant_id=customer.tenant_id
      and ps.salesperson_id=customer.assigned_to and ps.receives_leads is true and p.is_active is true and p.role in ('asesor','admin')
    limit 1 for share of ps,p;
  if seller is null then
    select ps.salesperson_id into seller from public.project_salespeople ps
      join public.profiles p on p.id=ps.salesperson_id
      where ps.project_id=customer.project_id and ps.tenant_id=customer.tenant_id
        and ps.receives_leads is true and p.is_active is true and p.role in ('asesor','admin')
      order by ps.last_lead_assigned_at asc nulls first,ps.rotation_order,ps.id
      limit 1 for update of ps;
    if seller is not null then
      update public.project_salespeople set last_lead_assigned_at=now()
        where project_id=customer.project_id and tenant_id=customer.tenant_id and salesperson_id=seller;
    end if;
  end if;
  previous_context:=current_setting('lavilet.reservation_assignment',true);
  perform set_config('lavilet.reservation_assignment','true',true);
  if seller is null then
    update public.leads set assigned_to=null,handoff_status='queued',seller_response_due_at=null
      where id=customer.id and (assigned_to is not null or handoff_status is distinct from 'queued');
    update public.bot_escalations b set assigned_to=null from public.conversations c
      where b.conversation_id=c.id and c.lead_id=customer.id and b.resolved_at is null;
    perform set_config('lavilet.reservation_assignment',coalesce(previous_context,''),true);
    return;
  end if;
  select coalesce(sla_response_minutes,120) into sla from public.project_automation_config where project_id=customer.project_id;
  update public.leads set assigned_to=seller,
    handoff_status=case when customer.assigned_to=seller and customer.handoff_status='acknowledged' then 'acknowledged' else 'assigned' end,
    handoff_assigned_at=case when customer.assigned_to=seller then coalesce(customer.handoff_assigned_at,now()) else now() end,
    seller_response_due_at=case when customer.assigned_to=seller then coalesce(customer.seller_response_due_at,public.add_business_minutes(customer.project_id,now(),coalesce(sla,120)))
      else public.add_business_minutes(customer.project_id,now(),coalesce(sla,120)) end
    where id=customer.id;
  update public.bot_escalations b set assigned_to=seller from public.conversations c
    where b.conversation_id=c.id and c.lead_id=customer.id and b.resolved_at is null;
  perform set_config('lavilet.reservation_assignment',coalesce(previous_context,''),true);
end $$;

create function public.lv_assign_new_reservation() returns trigger
language plpgsql security definer set search_path=public as $$
declare before_owner uuid; customer public.leads;
begin
  select assigned_to into before_owner from public.leads where id=new.lead_id;
  perform public.lv_assign_reservation_owner(new.lead_id);
  select * into customer from public.leads where id=new.lead_id;
  new.assigned_to:=customer.assigned_to;
  new.handoff_status:=customer.handoff_status;
  new.response_due_at:=customer.seller_response_due_at;
  new.assignment_mode:=case when customer.assigned_to is null then 'queued'
    when before_owner=customer.assigned_to then coalesce(nullif(new.assignment_mode,'queued'),'reused') else 'rotated' end;
  new.notification_status:=case when customer.assigned_to is null then 'pending_assignment' else 'pending' end;
  return new;
end $$;
create trigger assign_new_reservation before insert on public.lead_reservation_requests
for each row execute function public.lv_assign_new_reservation();

create or replace function public.lv_emit_urgent_reservation(p_lead_id uuid,p_kind text,p_event_key text,p_at timestamptz,p_units jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare customer public.leads; unit_labels text; request_id uuid;
begin
  if p_kind not in ('reservation_requested','reservation_confirmed') then raise exception 'INVALID_RESERVATION_NOTIFICATION_KIND'; end if;
  if p_kind='reservation_requested' then request_id:=substring(p_event_key from 9)::uuid; end if;
  select * into customer from public.leads where id=p_lead_id;
  if not found then return; end if;
  if customer.assigned_to is null then
    update public.lead_reservation_requests set notification_status='pending_assignment',notification_error_code=null
      where id=request_id and lead_id=p_lead_id;
    return;
  end if;
  if not exists(select 1 from public.project_salespeople ps join public.profiles p on p.id=ps.salesperson_id
    where ps.project_id=customer.project_id and ps.tenant_id=customer.tenant_id
      and ps.salesperson_id=customer.assigned_to and p.is_active is true and p.role in ('asesor','admin')
      and (p_kind='reservation_confirmed' or ps.receives_leads is true)) then
    update public.lead_reservation_requests set notification_status='pending_assignment',notification_error_code='NO_ELIGIBLE_OWNER'
      where id=request_id and lead_id=p_lead_id;
    return;
  end if;
  begin
    select string_agg(u.unit_number,', ' order by u.unit_number) into unit_labels from public.units u
      where u.id::text in (select jsonb_array_elements_text(coalesce(p_units,'[]'::jsonb)))
        and u.project_id=customer.project_id and u.tenant_id=customer.tenant_id;
    insert into public.advisor_notifications(tenant_id,project_id,recipient_id,lead_id,kind,title,body,assignment_at,metadata,reservation_request_id)
    values(customer.tenant_id,customer.project_id,customer.assigned_to,customer.id,p_kind,
      case when p_kind='reservation_confirmed' then 'Reserva registrada — atención urgente' else 'Solicitud de reserva — atención urgente' end,
      coalesce(nullif(trim(customer.name),''),'Un cliente') || case when p_kind='reservation_confirmed' then ' tiene una reserva registrada.' else ' solicitó iniciar una reserva.' end
        ||case when unit_labels is null then '' else ' Unidad: '||unit_labels||'.' end||' Revise el caso y contacte al cliente.',
      p_at,jsonb_build_object('kommo_id',customer.kommo_id,'reservation_event_key',p_event_key,'unit_ids',coalesce(p_units,'[]'::jsonb),'urgency','high'),request_id)
    on conflict do nothing;
    update public.lead_reservation_requests set notification_status='created',notification_error_code=null,
      notified_recipient=customer.assigned_to,notified_at=now() where id=request_id and lead_id=p_lead_id;
  exception when others then
    if request_id is null then raise; end if;
    -- Preserve the valid request and record a retryable alert failure.
    update public.lead_reservation_requests set notification_status='failed',notification_error_code=sqlstate
      where id=request_id and lead_id=p_lead_id;
  end;
end $$;

create function public.lv_retry_reservation_alerts(p_project_id uuid,p_lead_ids uuid[] default null) returns integer
language plpgsql security definer set search_path=public as $$
declare item record; processed integer:=0;
begin
  for item in select r.* from public.lead_reservation_requests r join public.leads l on l.id=r.lead_id
    where l.project_id=p_project_id and (p_lead_ids is null or l.id=any(p_lead_ids))
      and l.handoff_status in ('queued','assigned','acknowledged')
      and l.status is distinct from 'reservado'
      and r.notification_status in ('pending','pending_assignment','failed')
      and not exists(select 1 from public.lead_reservation_requests newer where newer.lead_id=r.lead_id and newer.created_at>r.created_at)
    order by r.created_at limit 50
  loop
    perform public.lv_assign_reservation_owner(item.lead_id);
    perform public.lv_emit_urgent_reservation(item.lead_id,'reservation_requested','request:'||item.id::text,item.created_at,item.unit_ids);
    processed:=processed+1;
  end loop;
  return processed;
end $$;
revoke all on function public.lv_assign_reservation_owner(uuid),public.lv_assign_new_reservation(),public.lv_retry_reservation_alerts(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.lv_retry_reservation_alerts(uuid,uuid[]) to service_role;

-- Current intake uses only the reservation assignment policy. Evidence and idempotency are preserved.
create or replace function public.lv_request_reservation_handoff(
  p_lead_id uuid,
  p_source_message_id text,
  p_unit_ids jsonb,
  p_evidence text,
  p_evidence_message_ids jsonb default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  customer public.leads;
  receipt public.lead_reservation_requests;
  source_content text;
  source_at timestamptz;
  source_conversation uuid;
  evidence_ids jsonb;
  evidence_count integer;
  seller uuid;
  before_owner uuid;
  mode text;
  state public.leads.handoff_status%type;
  due_at timestamptz;
  sla integer:=120;
  assignment_at timestamptz;
  reason text:='Solicitó iniciar una reserva; requiere atención de un asesor';
  replayed boolean:=false;
begin
  select * into customer from public.leads
    where id=p_lead_id
      and tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
      and project_id='b1b2c3d4-0001-4000-8000-000000000001'
    for update;
  if not found then raise exception 'RESERVATION_SCOPE_MISMATCH'; end if;

  select m.content,m.sent_at,c.id into source_content,source_at,source_conversation
    from public.messages m join public.conversations c on c.id=m.conversation_id
    where c.lead_id=p_lead_id
      and m.external_message_id=p_source_message_id
      and m.role='cliente' and nullif(trim(m.content),'') is not null;
  if not found then raise exception 'RESERVATION_CUSTOMER_EVIDENCE_REQUIRED'; end if;

  if p_evidence_message_ids is not null
    and jsonb_typeof(p_evidence_message_ids) is distinct from 'array' then
    raise exception 'RESERVATION_EVIDENCE_MESSAGES_INVALID';
  end if;
  evidence_ids:=case when p_evidence_message_ids is null or jsonb_array_length(p_evidence_message_ids)=0
    then jsonb_build_array(p_source_message_id) else p_evidence_message_ids end;
  if exists (select 1 from jsonb_array_elements(evidence_ids) e
    where jsonb_typeof(e)<>'string' or nullif(trim(e#>>'{}'),'') is null)
    or (select count(distinct id) from jsonb_array_elements_text(evidence_ids) id)<>jsonb_array_length(evidence_ids)
    or evidence_ids->>-1 is distinct from p_source_message_id then
    raise exception 'RESERVATION_EVIDENCE_MESSAGES_INVALID';
  end if;

  -- A split request is proven by the actual messages, not by a caller-created
  -- combined sentence. The final participating message anchors idempotency.
  select count(*)::integer,string_agg(m.content,E'\n' order by proof.ordinal)
    into evidence_count,source_content
    from jsonb_array_elements_text(evidence_ids) with ordinality proof(external_id,ordinal)
    join public.messages m on m.external_message_id=proof.external_id
    where m.conversation_id=source_conversation and m.role='cliente'
      and m.sent_at is not null and nullif(trim(m.content),'') is not null;
  if evidence_count<>jsonb_array_length(evidence_ids) then
    raise exception 'RESERVATION_CUSTOMER_EVIDENCE_REQUIRED';
  end if;
  if exists (
    select 1 from (
      select m.sent_at,lag(m.sent_at) over(order by proof.ordinal) previous_sent_at
      from jsonb_array_elements_text(evidence_ids) with ordinality proof(external_id,ordinal)
      join public.messages m on m.external_message_id=proof.external_id and m.conversation_id=source_conversation
    ) ordered where sent_at<previous_sent_at
  ) then raise exception 'RESERVATION_EVIDENCE_MESSAGES_OUT_OF_ORDER'; end if;

  if nullif(trim(p_evidence),'') is null or strpos(
    regexp_replace(lower(source_content),'\s+',' ','g'),
    regexp_replace(lower(trim(p_evidence)),'\s+',' ','g')
  )=0 then raise exception 'RESERVATION_EVIDENCE_MISMATCH'; end if;

  select * into receipt from public.lead_reservation_requests
    where lead_id=p_lead_id and source_message_id=p_source_message_id;
  replayed:=found;
  if not replayed then
    if jsonb_typeof(p_unit_ids) is distinct from 'array' then
      raise exception 'INVALID_RESERVATION_UNITS';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_unit_ids) e
      where jsonb_typeof(e)<>'string'
        or trim(both '"' from e::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then raise exception 'INVALID_RESERVATION_UNITS'; end if;
    if exists (
      select 1 from jsonb_array_elements_text(p_unit_ids) requested
      where not exists (
        select 1 from public.units u
        where u.id=requested::uuid
          and u.tenant_id=customer.tenant_id
          and u.project_id=customer.project_id
          and u.is_published is true
      )
    ) then raise exception 'RESERVATION_UNIT_SCOPE_MISMATCH'; end if;

    before_owner:=customer.assigned_to;
    update public.leads set handoff_reason=reason,
      handoff_requested_at=case when customer.handoff_status in ('queued','assigned','acknowledged')
        then coalesce(customer.handoff_requested_at,now()) else now() end,updated_at=now()
      where id=p_lead_id;
    perform public.lv_assign_reservation_owner(p_lead_id);
    select * into customer from public.leads where id=p_lead_id;
    seller:=customer.assigned_to;
    state:=customer.handoff_status;
    due_at:=customer.seller_response_due_at;
    mode:=case when seller is null then 'queued' when before_owner=seller then 'reused' else 'rotated' end;

    update public.conversations set status='escalada' where id=source_conversation;
    if not exists (select 1 from public.bot_escalations
      where conversation_id=source_conversation and resolved_at is null) then
      insert into public.bot_escalations(conversation_id,assigned_to,reason)
        values(source_conversation,seller,reason);
    else
      update public.bot_escalations set assigned_to=seller
        where conversation_id=source_conversation and resolved_at is null;
    end if;

    insert into public.lead_reservation_requests(
      lead_id,source_message_id,source_sent_at,conversation_id,unit_ids,evidence_message_ids,evidence,
      assignment_mode,assigned_to,handoff_status,response_due_at
    ) values (
      p_lead_id,p_source_message_id,source_at,source_conversation,
      (select coalesce(jsonb_agg(distinct value),'[]'::jsonb) from jsonb_array_elements(p_unit_ids)),
      evidence_ids,p_evidence,mode,seller,state,due_at
    ) returning * into receipt;
  end if;

  -- A replay reports current persisted ownership, not a stale assigned advisor.
  select * into customer from public.leads where id=p_lead_id;
  return jsonb_build_object(
    'request_id',receipt.id,'lead_id',receipt.lead_id,
    'source_message_id',receipt.source_message_id,'unit_ids',receipt.unit_ids,'evidence_message_ids',receipt.evidence_message_ids,
    'request_status',receipt.request_status,'assignment_mode',receipt.assignment_mode,
    'assigned_to',customer.assigned_to,'handoff_status',customer.handoff_status,
    'response_due_at',customer.seller_response_due_at,'replayed',replayed
  );
end $$;

revoke all on function public.lv_request_reservation_handoff(uuid,text,jsonb,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.lv_request_reservation_handoff(uuid,text,jsonb,text,jsonb) to service_role;


CREATE OR REPLACE FUNCTION public.lv_notify_lead_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_assignment_at timestamptz;
  v_changed boolean := false;
  v_reason text;
BEGIN
  -- Specialized reservation alerts are tracked separately and must not be blocked by the generic alert.
  IF current_setting('lavilet.reservation_assignment',true)='true' THEN RETURN NEW; END IF;
  IF NEW.assigned_to IS NULL OR NEW.tenant_id IS NULL OR NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_changed := true;
  ELSE
    v_changed := OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
      OR OLD.handoff_assigned_at IS DISTINCT FROM NEW.handoff_assigned_at;
  END IF;

  IF NOT v_changed THEN RETURN NEW; END IF;

  v_assignment_at := coalesce(NEW.handoff_assigned_at, NEW.updated_at, now());
  v_reason := nullif(trim(coalesce(NEW.handoff_reason, '')), '');

  INSERT INTO public.advisor_notifications(
    tenant_id, project_id, recipient_id, lead_id, kind, title, body,
    assignment_at, metadata
  ) VALUES (
    NEW.tenant_id,
    NEW.project_id,
    NEW.assigned_to,
    NEW.id,
    'lead_assigned',
    'Lead asignado',
    coalesce(nullif(trim(NEW.name), ''), 'Un nuevo lead') ||
      CASE WHEN v_reason IS NULL THEN ' fue asignado a ti.' ELSE ' fue asignado a ti. Motivo: ' || v_reason || '.' END,
    v_assignment_at,
    jsonb_build_object(
      'kommo_id', NEW.kommo_id,
      'handoff_reason', NEW.handoff_reason,
      'lead_status', NEW.status
    )
  )
  ON CONFLICT(lead_id, recipient_id, assignment_at) DO NOTHING;

  RETURN NEW;
END;
$function$;
