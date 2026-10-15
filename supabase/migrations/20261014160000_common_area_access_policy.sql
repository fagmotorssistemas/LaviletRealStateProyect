-- Owner-approved condition: access for residents/owners carries no additional
-- access charge. This does not define condominium/maintenance fees. Editable
-- under Conocimiento y reglas > Políticas comerciales > Acceso a áreas comunes.
do $migration$
declare
  policies jsonb;
  state jsonb;
  items jsonb;
  content jsonb;
  published jsonb;
begin
  select coalesce(policies_json, '{}'::jsonb) into policies from public.projects
  where id = 'b1b2c3d4-0001-4000-8000-000000000001'
    and tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001' for update;
  if not found then return; end if;
  state := coalesce(policies->'business_policies', '{}'::jsonb);
  items := coalesce(state->'items', '[]'::jsonb);
  if jsonb_typeof(items) <> 'array' then raise exception 'BUSINESS_POLICIES_INVALID'; end if;
  -- Never overwrite an existing version, draft, paused policy or admin edit.
  if exists (select 1 from jsonb_array_elements(items || coalesce(state->'test_items', '[]'::jsonb)) item
    where item->>'id' = 'common-area-access') then return; end if;
  content := jsonb_build_object(
    'title', 'Acceso de residentes y propietarios a las áreas comunes', 'topic', 'instalaciones',
    'content', 'Los residentes o propietarios de La Vilet tienen acceso a las áreas comunes del proyecto sin un cobro adicional por acceder a ellas. Esta condición de acceso no define ni elimina una alícuota, gastos de mantenimiento u otros servicios que se regulen por separado; sus importes y condiciones no están definidos en esta política.',
    'scope', 'Áreas comunes del proyecto destinadas a residentes o propietarios. No autoriza acceso de visitantes ni afirma disponibilidad física antes de su habilitación.',
    'source', 'Condición aprobada expresamente por el responsable de La Vilet en la revisión de conversación del 14 de octubre de 2026.',
    'mode', 'todos', 'validUntil', '');
  published := content || jsonb_build_object('version', 1,
    'publishedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'publishedBy', 'approved-common-area-policy-2026-10-14');
  state := state || jsonb_build_object('revision', coalesce((state->>'revision')::integer, 0) + 1,
    'items', items || jsonb_build_array(jsonb_build_object('id', 'common-area-access',
      'draft', content, 'published', published, 'history', jsonb_build_array(published))));
  update public.projects set policies_json = jsonb_set(policies, '{business_policies}', state), updated_at = clock_timestamp()
  where id = 'b1b2c3d4-0001-4000-8000-000000000001'
    and tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001';
end;
$migration$;
