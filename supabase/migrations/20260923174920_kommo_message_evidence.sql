-- PREPARED ONLY. No replay of lv_integration_events or commercial RPCs.
create table public.kommo_message_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id),
  account_id bigint not null,
  lead_id uuid references public.leads(id),
  external_message_id text not null,
  contact_id text not null,
  kommo_lead_id bigint,
  chat_id text,
  talk_id text,
  direction text not null check(direction in ('incoming','outgoing')),
  author_type text not null,
  author_id text,
  user_id text,
  content text,
  media_type text,
  media_url text,
  origin text,
  sent_at timestamptz not null,
  observed_at timestamptz not null default clock_timestamp(),
  delivery_status text not null,
  source text not null check(source in ('webhook','history')),
  unique(account_id,external_message_id,direction,source,delivery_status)
);
create index kommo_evidence_lead_time on public.kommo_message_evidence(tenant_id,lead_id,sent_at);
create index kommo_evidence_contact on public.kommo_message_evidence(tenant_id,contact_id);
alter table public.kommo_message_evidence enable row level security;
revoke all on public.kommo_message_evidence from public,anon,authenticated,service_role;
grant select,insert on public.kommo_message_evidence to service_role;

create table public.crm_contact_classifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  lead_id uuid not null references public.leads(id),
  classification text not null check(classification in ('internal','commercial')),
  reason text not null check(length(trim(reason))>0),
  confirmed_by text not null check(length(trim(confirmed_by))>0),
  recorded_at timestamptz not null default clock_timestamp()
);
create index crm_contact_classifications_latest on public.crm_contact_classifications(tenant_id,lead_id,recorded_at desc,id desc);
alter table public.crm_contact_classifications enable row level security;
revoke all on public.crm_contact_classifications from public,anon,authenticated,service_role;
grant select on public.crm_contact_classifications to service_role;

create function public.classify_crm_contact(p_tenant uuid,p_lead uuid,p_classification text,p_reason text,p_confirmed_by text)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
  perform 1 from public.leads where id=p_lead and tenant_id=p_tenant for update;
  if not found then raise exception 'CONTACT_SCOPE_MISMATCH'; end if;
  if nullif(trim(p_confirmed_by),'') is null or nullif(trim(p_reason),'') is null then raise exception 'AUDIT_REQUIRED'; end if;
  select id into result from public.crm_contact_classifications where tenant_id=p_tenant and lead_id=p_lead
    order by recorded_at desc,id desc limit 1;
  if exists(select 1 from public.crm_contact_classifications where id=result and classification=p_classification) then return result; end if;
  insert into public.crm_contact_classifications(tenant_id,lead_id,classification,reason,confirmed_by)
    values(p_tenant,p_lead,p_classification,p_reason,p_confirmed_by) returning id into result;
  return result;
end $$;
revoke all on function public.classify_crm_contact(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.classify_crm_contact(uuid,uuid,text,text,text) to service_role;

create function public.lv_record_message_evidence(p_events jsonb)
returns integer language plpgsql security invoker set search_path=public as $$
declare
  e jsonb; matched uuid; ids uuid[]; inserted integer; total integer:=0;
  tenant uuid:='a1b2c3d4-0001-4000-8000-000000000001';
  project uuid:='b1b2c3d4-0001-4000-8000-000000000001';
begin
  if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>200 then raise exception 'INVALID_EVIDENCE_BATCH'; end if;
  for e in select value from jsonb_array_elements(p_events) loop
    if nullif(e->>'externalId','') is null or length(e->>'externalId')>200
      or coalesce(e->>'contactId','') !~ '^[1-9][0-9]*$'
      or coalesce(e->>'source','') not in ('webhook','history')
      or coalesce(e->>'direction','') not in ('incoming','outgoing')
      or (e->>'sentAt')::timestamptz>now()+interval '1 minute' then raise exception 'INVALID_EVIDENCE'; end if;
    -- A shared contact may own multiple commercial files. Never OR/LIMIT 1:
    -- require both supplied identities and leave conflicts explicitly unlinked.
    select array_agg(l.id) into ids from public.leads l
    where l.tenant_id=tenant and l.contact_id=e->>'contactId'
      and (coalesce((e->>'kommoId')::bigint,0)=0 or l.kommo_id=(e->>'kommoId')::bigint);
    matched:=case when cardinality(ids)=1 then ids[1] else null end;
    insert into public.kommo_message_evidence(tenant_id,project_id,account_id,lead_id,external_message_id,contact_id,kommo_lead_id,chat_id,talk_id,direction,author_type,author_id,user_id,content,media_type,media_url,origin,sent_at,delivery_status,source)
    values(tenant,project,36919007,matched,e->>'externalId',e->>'contactId',nullif((e->>'kommoId')::bigint,0),e->>'chatId',e->>'talkId',e->>'direction',coalesce(e->>'authorType','unknown'),e->>'authorId',e->>'userId',e->>'text',e->>'mediaType',e->>'mediaUrl',e->>'origin',(e->>'sentAt')::timestamptz,coalesce(e->>'deliveryStatus','unknown'),e->>'source')
    on conflict do nothing;
    get diagnostics inserted=row_count;
    total:=total+inserted;
  end loop;
  return total;
end $$;
revoke all on function public.lv_record_message_evidence(jsonb) from public,anon,authenticated;
grant execute on function public.lv_record_message_evidence(jsonb) to service_role;

-- One transaction prevents a journal-only/partially enqueued request.
-- Existing inbox keys deduplicate retries, including a lost commit response.
create function public.lv_receive_kommo_observation(p_evidence jsonb,p_inbound jsonb,p_advisor jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare observed integer; incoming integer:=0; outgoing integer:=0;
begin
  if p_evidence is null or p_inbound is null or p_advisor is null
    or jsonb_typeof(p_evidence)<>'array' or jsonb_typeof(p_inbound)<>'array' or jsonb_typeof(p_advisor)<>'array'
    then raise exception 'INVALID_OBSERVATION_BATCH'; end if;
  observed:=public.lv_record_message_evidence(p_evidence);
  if jsonb_array_length(p_inbound)>0 then incoming:=public.lv_app_receive(p_inbound); end if;
  if jsonb_array_length(p_advisor)>0 then outgoing:=public.lv_app_receive_advisor_outbound(p_advisor); end if;
  return jsonb_build_object('evidence_inserted',observed,'inbound_inserted',incoming,'advisor_inserted',outgoing);
end $$;
revoke all on function public.lv_receive_kommo_observation(jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.lv_receive_kommo_observation(jsonb,jsonb,jsonb) to service_role;
