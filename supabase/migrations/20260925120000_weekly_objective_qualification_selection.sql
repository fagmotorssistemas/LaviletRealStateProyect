-- Selección interna semanal; no crea outbox ni eventos Meta.
begin;
create table public.crm_weekly_objective_selection_activation(
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.crm_weekly_objective_selection_activation(singleton,enabled) values(true,false) on conflict do nothing;
alter table public.crm_weekly_objective_selection_activation enable row level security;
revoke all on public.crm_weekly_objective_selection_activation from public,anon,authenticated;
grant select,update on public.crm_weekly_objective_selection_activation to service_role;

create table public.crm_weekly_objective_selections(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id),
  objective_id text not null,
  lead_id uuid not null references public.leads(id),
  relation text not null check(relation in ('own','incorporated')),
  evidence_event_id uuid not null references public.lead_score_events(id),
  evidence_event_type text not null,
  evidence_occurred_at timestamptz not null,
  selected_at timestamptz not null default clock_timestamp(),
  unique(objective_id,lead_id)
);
create index crm_weekly_objective_selections_scope on public.crm_weekly_objective_selections(tenant_id,project_id,objective_id,evidence_occurred_at);
alter table public.crm_weekly_objective_selections enable row level security;
revoke all on public.crm_weekly_objective_selections from public,anon,authenticated;
grant select,insert on public.crm_weekly_objective_selections to service_role;
comment on table public.crm_weekly_objective_selections is 'Calificación interna por evidencia CRM. No representa envío, aceptación Meta, Schedule ni Purchase.';
commit;
