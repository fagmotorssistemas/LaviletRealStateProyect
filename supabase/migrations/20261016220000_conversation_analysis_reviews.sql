-- Analytical observations never mutate lead stages, bot permissions or messages.
-- Required predecessor: 20261015210000_lead_commercial_pipeline.sql.
-- Check before changing anything and allow a safe retry after a partial manual run.
begin;
do $prerequisites$
begin
  if to_regprocedure('public.lv_can_manage_lead_commercial_profile(uuid)') is null then
    raise exception 'Falta aplicar 20261015210000_lead_commercial_pipeline.sql: no existe lv_can_manage_lead_commercial_profile(uuid). Ejecute primero esa migración completa y después vuelva a ejecutar este archivo.';
  end if;
end
$prerequisites$;

create table if not exists public.lead_conversation_analysis_reviews (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id), lead_id uuid not null references public.leads(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  status text not null check(status in ('reviewing','actioned','resolved','dismissed')),
  note text not null check(length(trim(note)) between 10 and 1500),
  issue_signature text not null check(issue_signature ~ '^[a-f0-9]{64}$'),
  baseline jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists conversation_analysis_reviews_lead on public.lead_conversation_analysis_reviews(lead_id,created_at desc);
alter table public.lead_conversation_analysis_reviews enable row level security;
revoke all on public.lead_conversation_analysis_reviews from public,anon,authenticated;
grant select,insert on public.lead_conversation_analysis_reviews to authenticated;
grant all on public.lead_conversation_analysis_reviews to service_role;
drop policy if exists analysis_reviews_read on public.lead_conversation_analysis_reviews;
create policy analysis_reviews_read on public.lead_conversation_analysis_reviews for select to authenticated using (
  public.lv_can_manage_lead_commercial_profile(lead_id) and exists (
    select 1 from public.leads l where l.id=lead_id and l.tenant_id=lead_conversation_analysis_reviews.tenant_id
      and l.project_id=lead_conversation_analysis_reviews.project_id
  )
);
drop policy if exists analysis_reviews_insert on public.lead_conversation_analysis_reviews;
create policy analysis_reviews_insert on public.lead_conversation_analysis_reviews for insert to authenticated with check (
  actor_id=auth.uid() and public.lv_can_manage_lead_commercial_profile(lead_id) and exists (
    select 1 from public.leads l join public.profiles p on p.id=auth.uid()
    where l.id=lead_id and l.tenant_id=lead_conversation_analysis_reviews.tenant_id
      and l.project_id=lead_conversation_analysis_reviews.project_id and p.is_active is true
      and (p.role::text='admin' or p.role::text='asesor' and (l.assigned_to is null or l.assigned_to=auth.uid()))
  )
);
commit;
