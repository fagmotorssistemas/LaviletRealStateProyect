-- Future requests/confirmed reservations only. Installing never replays messages
-- or claims that a request reserves inventory. Existing private inbox RLS remains.
alter table public.advisor_notifications drop constraint advisor_notifications_kind_check;
alter table public.advisor_notifications add constraint advisor_notifications_kind_check
  check (kind in ('lead_assigned','reservation_requested','reservation_confirmed'));
alter table public.advisor_notifications add column reservation_request_id uuid
  references public.lead_reservation_requests(id) on delete cascade;
alter table public.advisor_notifications drop constraint advisor_notifications_assignment_uq;
alter table public.advisor_notifications add constraint advisor_notifications_assignment_uq
  unique(lead_id,recipient_id,assignment_at,kind);
create unique index advisor_notifications_reservation_event_uq
  on public.advisor_notifications(recipient_id,kind,(metadata->>'reservation_event_key'))
  where kind in ('reservation_requested','reservation_confirmed');

create or replace function public.lv_notify_lead_assignment() returns trigger
language plpgsql security definer set search_path=public as $$
declare changed boolean; at_time timestamptz; reason text;
begin
  if new.assigned_to is null or new.tenant_id is null or new.project_id is null then return new; end if;
  if tg_op='INSERT' then changed:=true;
  else changed:=old.assigned_to is distinct from new.assigned_to or old.handoff_assigned_at is distinct from new.handoff_assigned_at; end if;
  if not changed then return new; end if;
  at_time:=coalesce(new.handoff_assigned_at,new.updated_at,now());
  reason:=nullif(trim(coalesce(new.handoff_reason,'')),'');
  insert into public.advisor_notifications(tenant_id,project_id,recipient_id,lead_id,kind,title,body,assignment_at,metadata)
  values(new.tenant_id,new.project_id,new.assigned_to,new.id,'lead_assigned','Lead asignado',
    coalesce(nullif(trim(new.name),''),'Un nuevo lead') || case when reason is null then ' fue asignado a ti.' else ' fue asignado a ti. Motivo: '||reason||'.' end,
    at_time,jsonb_build_object('kommo_id',new.kommo_id,'handoff_reason',new.handoff_reason,'lead_status',new.status))
  on conflict(lead_id,recipient_id,assignment_at,kind) do nothing;
  return new;
end $$;

create function public.lv_emit_urgent_reservation(p_lead_id uuid,p_kind text,p_event_key text,p_at timestamptz,p_units jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare customer public.leads; unit_labels text;
begin
  select * into customer from public.leads where id=p_lead_id;
  if not found or customer.assigned_to is null then return; end if;
  if not exists(select 1 from public.project_salespeople ps join public.profiles p on p.id=ps.salesperson_id
    where ps.project_id=customer.project_id and ps.tenant_id=customer.tenant_id
      and ps.salesperson_id=customer.assigned_to and p.is_active is true) then return; end if;
  select string_agg(u.unit_number,', ' order by u.unit_number) into unit_labels from public.units u
    where u.id::text in (select jsonb_array_elements_text(coalesce(p_units,'[]'::jsonb)))
      and u.project_id=customer.project_id and u.tenant_id=customer.tenant_id;
  insert into public.advisor_notifications(tenant_id,project_id,recipient_id,lead_id,kind,title,body,assignment_at,metadata,reservation_request_id)
  values(customer.tenant_id,customer.project_id,customer.assigned_to,customer.id,p_kind,
    case when p_kind='reservation_confirmed' then 'Reserva registrada — atención urgente' else 'Solicitud de reserva — atención urgente' end,
    coalesce(nullif(trim(customer.name),''),'Un cliente') || case when p_kind='reservation_confirmed' then ' tiene una reserva registrada.' else ' solicitó iniciar una reserva.' end
      ||case when unit_labels is null then '' else ' Unidad: '||unit_labels||'.' end||' Revise el caso y contacte al cliente.',
    p_at,jsonb_build_object('kommo_id',customer.kommo_id,'reservation_event_key',p_event_key,'unit_ids',coalesce(p_units,'[]'::jsonb),'urgency','high'),
    case when p_kind='reservation_requested' then substring(p_event_key from 9)::uuid else null end)
  on conflict do nothing;
end $$;
revoke all on function public.lv_emit_urgent_reservation(uuid,text,text,timestamptz,jsonb) from public,anon,authenticated;

create function public.lv_notify_reservation_request() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform public.lv_emit_urgent_reservation(new.lead_id,'reservation_requested','request:'||new.id::text,new.created_at,new.unit_ids);
  return new;
end $$;
create trigger notify_urgent_reservation_request after insert on public.lead_reservation_requests
for each row execute function public.lv_notify_reservation_request();

create function public.lv_notify_reservation_lead_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare receipt public.lead_reservation_requests;
begin
  if old.status='reservado' and new.status is distinct from old.status then
    update public.advisor_notifications set read_at=coalesce(read_at,now())
      where lead_id=new.id and kind='reservation_confirmed';
  end if;
  if new.status='reservado' and old.status is distinct from new.status then
    perform public.lv_emit_urgent_reservation(new.id,'reservation_confirmed','confirmed:'||new.id::text||':'||coalesce(new.updated_at,now())::text,
      coalesce(new.updated_at,now()),'[]'::jsonb);
  elsif old.assigned_to is distinct from new.assigned_to and new.assigned_to is not null then
    -- A queued request alerts its real owner when assignment eventually occurs.
    select * into receipt from public.lead_reservation_requests where lead_id=new.id order by created_at desc limit 1;
    if found and new.status is distinct from 'reservado' then
      perform public.lv_emit_urgent_reservation(new.id,'reservation_requested','request:'||receipt.id::text,receipt.created_at,receipt.unit_ids);
    end if;
  end if;
  return new;
end $$;
create trigger notify_urgent_reservation_lead_change after update of assigned_to,status on public.leads
for each row execute function public.lv_notify_reservation_lead_change();
revoke all on function public.lv_notify_reservation_request(), public.lv_notify_reservation_lead_change() from public,anon,authenticated;
