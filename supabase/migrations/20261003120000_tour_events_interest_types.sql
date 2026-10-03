-- tour_events ya acepta estos tipos en Supabase. El archivo deja el mismo
-- cambio en el repo: interés comercial y permanencia en un ambiente.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tour_events'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%event_type%'
  loop
    execute format('alter table public.tour_events drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.tour_events
  add constraint tour_events_event_type_check
  check (event_type in (
    'entrada',
    'salida',
    'ambiente',
    'cambio_acabado',
    'cambio_luz',
    'hotspot',
    'minimapa',
    'fullscreen',
    'vr',
    'gate_mostrado',
    'gate_cerrado',
    'lead_identificado',
    'consultar_unidad',
    'guardar_unidad',
    'whatsapp_interest',
    'room_dwell'
  ));
