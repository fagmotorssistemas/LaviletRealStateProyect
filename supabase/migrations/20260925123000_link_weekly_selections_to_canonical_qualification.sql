-- Enlaza cada selección con la única calificación canónica del lead.
-- No crea evaluaciones, intents, outbox ni conversiones.
begin;

alter table public.crm_weekly_objective_selections
  add column qualification_intent_id uuid references public.meta_crm_qualification_intents(id),
  add column qualification_event_id uuid;

create index crm_weekly_objective_selections_qualification_intent_idx
  on public.crm_weekly_objective_selections(qualification_intent_id)
  where qualification_intent_id is not null;

create or replace function public.lv_link_weekly_selection_qualification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select i.id, i.event_id into new.qualification_intent_id, new.qualification_event_id
  from public.meta_crm_qualification_intents i
  where i.lead_id = new.lead_id and i.signal_kind = 'crm_qualification'
  order by i.created_at asc, i.id asc limit 1;
  return new;
end;
$$;
revoke all on function public.lv_link_weekly_selection_qualification()
  from public, anon, authenticated, service_role;
create trigger link_weekly_selection_qualification
before insert or update of lead_id on public.crm_weekly_objective_selections
for each row execute function public.lv_link_weekly_selection_qualification();

create or replace function public.lv_link_qualification_to_weekly_selections()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.crm_weekly_objective_selections s
  set qualification_intent_id = new.id, qualification_event_id = new.event_id
  where s.lead_id = new.lead_id and s.qualification_intent_id is null;
  return new;
end;
$$;
revoke all on function public.lv_link_qualification_to_weekly_selections()
  from public, anon, authenticated, service_role;
create trigger link_qualification_to_weekly_selections
after insert on public.meta_crm_qualification_intents
for each row execute function public.lv_link_qualification_to_weekly_selections();

comment on column public.crm_weekly_objective_selections.qualification_event_id is
  'Mismo event_id canónico para todos los objetivos del lead; la selección no lo genera.';
commit;
