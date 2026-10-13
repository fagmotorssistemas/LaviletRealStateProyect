-- Approved by the project owner on 2026-10-13: launch prices already include
-- 10%. The editable policy is the authority; unit prices are never rewritten.
do $migration$
declare
  policies jsonb;
  discounts jsonb;
  rules jsonb;
  approved_rule jsonb;
begin
  select coalesce(policies_json, '{}'::jsonb) into policies
  from public.projects
  where id = 'b1b2c3d4-0001-4000-8000-000000000001'
    and tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'
  for update;
  if not found then return; end if;
  discounts := coalesce(policies->'early_purchase_discounts', '{}'::jsonb);
  rules := coalesce(discounts->'rules', '[]'::jsonb);
  if jsonb_typeof(rules) <> 'array' then
    raise exception 'LAUNCH_DISCOUNT_RULES_INVALID: revise la configuración de descuentos antes de migrar';
  end if;
  -- A re-run must retain administrator edits to the approved policy.
  if exists (select 1 from jsonb_array_elements(rules) r where r->>'id' = 'launch-price-included') then return; end if;
  if exists (select 1 from jsonb_array_elements(rules) r
    where r->>'enabled' = 'true' and r->>'mode' in ('todos', 'lanzamiento')
      and coalesce(r->'categories', '[]'::jsonb) = '[]'::jsonb
      and coalesce(r->'unitNumbers', '[]'::jsonb) = '[]'::jsonb) then
    raise exception 'LAUNCH_DISCOUNT_POLICY_CONFLICT: ya existe una regla general de lanzamiento; edítela en Descuentos antes de migrar';
  end if;
  approved_rule := jsonb_build_object(
    'id', 'launch-price-included', 'name', 'Descuento de lanzamiento incluido en el precio',
    'enabled', true, 'percent', 10, 'categories', '[]'::jsonb, 'unitNumbers', '[]'::jsonb,
    'mode', 'lanzamiento', 'base', 'included_in_catalog', 'condition', 'published_price',
    'conditions', 'El precio publicado de lanzamiento ya incluye el 10 %. No se aplica otra rebaja ni exige una reserva para comunicar este precio. Una negociación adicional la revisa un asesor.',
    'startDate', '2026-10-13', 'endDate', '', 'checkedOn', '2026-10-13', 'reviewBy', '',
    'source', 'Confirmación del responsable de La Vilet, 13 de octubre de 2026: descuento de lanzamiento del 10 % ya incluido en los precios publicados.',
    'referencePrices', '[]'::jsonb);
  discounts := discounts || jsonb_build_object('enabled', true, 'stacking', false,
    'rules', rules || jsonb_build_array(approved_rule),
    'updatedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedBy', 'approved-launch-policy-2026-10-13');
  update public.projects set policies_json = jsonb_set(policies, '{early_purchase_discounts}', discounts), updated_at = clock_timestamp()
  where id = 'b1b2c3d4-0001-4000-8000-000000000001'
    and tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001';
end;
$migration$;
