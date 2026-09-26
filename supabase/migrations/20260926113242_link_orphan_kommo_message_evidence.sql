-- Link orphan Kommo journal rows to the unique matching CRM lead.
-- Evidence can arrive before register_inbound creates the lead; leave
-- lead_id null only when 0 or many matches (same rule as lv_record_message_evidence).

create or replace function public.lv_link_kommo_message_evidence_for_lead(p_lead_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_contact text;
  v_kommo bigint;
  updated integer := 0;
begin
  if p_lead_id is null then
    return 0;
  end if;

  select l.tenant_id, l.contact_id, l.kommo_id
    into v_tenant, v_contact, v_kommo
  from public.leads l
  where l.id = p_lead_id;

  if v_tenant is null or nullif(trim(coalesce(v_contact, '')), '') is null then
    return 0;
  end if;

  -- Exact identity: contact + kommo lead id when both known.
  if coalesce(v_kommo, 0) > 0 then
    update public.kommo_message_evidence e
       set lead_id = p_lead_id
     where e.tenant_id = v_tenant
       and e.lead_id is null
       and e.contact_id = v_contact
       and e.kommo_lead_id = v_kommo
       and (
         select count(*)::int
         from public.leads l2
         where l2.tenant_id = v_tenant
           and l2.contact_id = v_contact
           and l2.kommo_id = v_kommo
       ) = 1;
    get diagnostics updated = row_count;
    return updated;
  end if;

  -- Contact-only: only when exactly one CRM lead owns that contact.
  update public.kommo_message_evidence e
     set lead_id = p_lead_id
   where e.tenant_id = v_tenant
     and e.lead_id is null
     and e.contact_id = v_contact
     and (
       select count(*)::int
       from public.leads l2
       where l2.tenant_id = v_tenant
         and l2.contact_id = v_contact
     ) = 1;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function public.lv_link_kommo_message_evidence_for_lead(uuid)
  from public, anon, authenticated;
grant execute on function public.lv_link_kommo_message_evidence_for_lead(uuid)
  to service_role;

create or replace function public.lv_backfill_orphan_kommo_message_evidence()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  total integer := 0;
  n integer;
begin
  for r in
    select l.id
    from public.leads l
    where nullif(trim(coalesce(l.contact_id, '')), '') is not null
      and exists (
        select 1
        from public.kommo_message_evidence e
        where e.tenant_id = l.tenant_id
          and e.lead_id is null
          and e.contact_id = l.contact_id
          and (
            (coalesce(l.kommo_id, 0) > 0 and e.kommo_lead_id = l.kommo_id)
            or coalesce(l.kommo_id, 0) = 0
          )
      )
  loop
    n := public.lv_link_kommo_message_evidence_for_lead(r.id);
    total := total + n;
  end loop;
  return total;
end;
$$;

revoke all on function public.lv_backfill_orphan_kommo_message_evidence()
  from public, anon, authenticated;
grant execute on function public.lv_backfill_orphan_kommo_message_evidence()
  to service_role;

-- After inbound can create the CRM lead, re-link orphans from this observation batch.
create or replace function public.lv_receive_kommo_observation(
  p_evidence jsonb,
  p_inbound jsonb,
  p_advisor jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  observed integer;
  incoming integer := 0;
  outgoing integer := 0;
  linked integer := 0;
  contact_ids text[];
  lead_row record;
begin
  if p_evidence is null or p_inbound is null or p_advisor is null
    or jsonb_typeof(p_evidence) <> 'array'
    or jsonb_typeof(p_inbound) <> 'array'
    or jsonb_typeof(p_advisor) <> 'array'
  then
    raise exception 'INVALID_OBSERVATION_BATCH';
  end if;

  observed := public.lv_record_message_evidence(p_evidence);
  if jsonb_array_length(p_inbound) > 0 then
    incoming := public.lv_app_receive(p_inbound);
  end if;
  if jsonb_array_length(p_advisor) > 0 then
    outgoing := public.lv_app_receive_advisor_outbound(p_advisor);
  end if;

  select coalesce(array_agg(distinct x), '{}')
    into contact_ids
  from (
    select nullif(value->>'contactId', '') as x
    from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb))
    union
    select nullif(value->>'contactId', '') as x
    from jsonb_array_elements(coalesce(p_inbound, '[]'::jsonb))
  ) s
  where x is not null;

  if contact_ids is not null and cardinality(contact_ids) > 0 then
    for lead_row in
      select l.id
      from public.leads l
      where l.tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'::uuid
        and l.contact_id = any (contact_ids)
    loop
      linked := linked + public.lv_link_kommo_message_evidence_for_lead(lead_row.id);
    end loop;
  end if;

  return jsonb_build_object(
    'evidence_inserted', observed,
    'inbound_inserted', incoming,
    'advisor_inserted', outgoing,
    'evidence_linked', linked
  );
end;
$$;

revoke all on function public.lv_receive_kommo_observation(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.lv_receive_kommo_observation(jsonb, jsonb, jsonb)
  to service_role;

-- One-shot historical repair (idempotent).
select public.lv_backfill_orphan_kommo_message_evidence();
