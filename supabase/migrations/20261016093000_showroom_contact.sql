create table public.lv_showroom_unit_dwell (
  session_id uuid not null references public.tour_sessions(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  seconds integer not null default 0 check(seconds>=0),
  last_seen_at timestamptz not null default now(),
  primary key(session_id,unit_id)
);
alter table public.lv_showroom_unit_dwell enable row level security;
revoke all on public.lv_showroom_unit_dwell from public,anon,authenticated;
grant all on public.lv_showroom_unit_dwell to service_role;

create table public.lv_showroom_contacts (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,project_id uuid not null,
 lead_id uuid not null references public.leads(id),session_id uuid not null references public.tour_sessions(id),
 unit_id uuid references public.units(id),unit_label text,
 form_name text,consent_at timestamptz not null,consent_source text not null,
 status text not null default 'scheduled' check(status in ('scheduled','processing','accepted','responded','cancelled','uncertain','failed')),
 available_at timestamptz not null default now()+interval '5 minutes',
 created_at timestamptz not null default now(),attempted_at timestamptz,accepted_at timestamptz,
 response_kind text,reason text,attempts integer not null default 0,
 unique(project_id,lead_id)
);
alter table public.lv_showroom_contacts enable row level security;
revoke all on public.lv_showroom_contacts from public,anon,authenticated;
grant all on public.lv_showroom_contacts to service_role;

create function public.lv_record_showroom_dwell(p_session_id uuid,p_unit_id uuid,p_seconds integer) returns void
language plpgsql security definer set search_path=public as $$
begin
  -- Server validates visitor ownership before calling; clamp and serialize
  -- across tabs so replayed requests cannot add more than elapsed wall time.
  perform 1 from public.tour_sessions where id=p_session_id for update;
  if not found then return; end if;
  insert into public.lv_showroom_unit_dwell(session_id,unit_id,seconds) values(p_session_id,p_unit_id,0)
    on conflict do nothing;
  update public.lv_showroom_unit_dwell set seconds=seconds+least(greatest(p_seconds,0),15,
    greatest(0,floor(extract(epoch from now()-last_seen_at))::integer)),last_seen_at=now()
    where session_id=p_session_id and unit_id=p_unit_id;
end $$;
revoke all on function public.lv_record_showroom_dwell(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.lv_record_showroom_dwell(uuid,uuid,integer) to service_role;
