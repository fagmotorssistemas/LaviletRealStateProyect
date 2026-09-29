-- A requested reservation is a human handoff, never an inventory reservation.
-- No messages are replayed and no existing lead is reassigned by installation.
create table public.lead_reservation_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id),
  source_message_id text not null,
  source_sent_at timestamptz not null,
  conversation_id uuid not null references public.conversations(id),
  unit_ids jsonb not null check (jsonb_typeof(unit_ids)='array'),
  evidence_message_ids jsonb not null check (jsonb_typeof(evidence_message_ids)='array'),
  evidence text not null check (length(trim(evidence))>0),
  request_status text not null default 'requested' check (request_status='requested'),
  assignment_mode text not null check (assignment_mode in ('reused','rotated','queued')),
  assigned_to uuid,
  handoff_status text not null,
  response_due_at timestamptz,
  created_at timestamptz not null default now(),
  unique(lead_id,source_message_id)
);
alter table public.lead_reservation_requests enable row level security;
revoke all on public.lead_reservation_requests from public,anon,authenticated,service_role;
grant select on public.lead_reservation_requests to service_role;

create function public.lv_request_reservation_handoff(
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

    select coalesce(c.sla_response_minutes,120) into sla
      from public.project_automation_config c where c.project_id=customer.project_id;
    if not found then sla:=120; end if;

    -- New-lead rotation preferences do not remove an existing active owner.
    select ps.salesperson_id into seller
      from public.project_salespeople ps
      join public.profiles p on p.id=ps.salesperson_id
      where ps.salesperson_id=customer.assigned_to
        and ps.project_id=customer.project_id and ps.tenant_id=customer.tenant_id
        and p.is_active is true
      limit 1 for share of ps,p;
    if seller is not null then
      mode:='reused';
    elsif public.is_project_open(customer.project_id,now()) then
      perform pg_advisory_xact_lock(hashtext(customer.project_id::text));
      select ps.salesperson_id into seller
        from public.project_salespeople ps
        join public.profiles p on p.id=ps.salesperson_id
        where ps.project_id=customer.project_id and ps.tenant_id=customer.tenant_id
          and ps.receives_leads is true and p.is_active is true
        order by ps.last_lead_assigned_at asc nulls first,ps.rotation_order,ps.id
        limit 1 for update of ps;
      if seller is not null then
        mode:='rotated';
        update public.project_salespeople set last_lead_assigned_at=now()
          where project_id=customer.project_id and tenant_id=customer.tenant_id
            and salesperson_id=seller;
      end if;
    end if;

    if seller is null then
      mode:='queued';
      state:='queued';
      due_at:=null;
      assignment_at:=null;
    else
      state:=case when mode='reused' and customer.handoff_status='acknowledged'
        then 'acknowledged' else 'assigned' end;
      assignment_at:=case when mode='reused'
        then coalesce(customer.handoff_assigned_at,now()) else now() end;
      due_at:=case when mode='reused' and customer.handoff_status in ('assigned','acknowledged')
        then coalesce(customer.seller_response_due_at,public.add_business_minutes(customer.project_id,now(),sla))
        else public.add_business_minutes(customer.project_id,now(),sla) end;
    end if;

    -- Deliberately leave bot_enabled, opt-out, commercial status and units intact.
    update public.leads set assigned_to=seller,handoff_status=state,handoff_reason=reason,
      handoff_requested_at=case when customer.handoff_status in ('queued','assigned','acknowledged')
        then coalesce(customer.handoff_requested_at,now()) else now() end,
      handoff_assigned_at=assignment_at,seller_response_due_at=due_at,updated_at=now()
      where id=p_lead_id;
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
