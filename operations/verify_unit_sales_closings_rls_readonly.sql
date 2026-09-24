-- Preflight/postflight de solo lectura para la autorización de cierres.
-- No inserta, actualiza, elimina ni ejecuta funciones comerciales.

SELECT c.relrowsecurity AS rls_enabled,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
       has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
       has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_delete,
       has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS service_role_crud
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'unit_sales_closings';

SELECT c.relname AS dependency_table,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       has_table_privilege('service_role', c.oid, 'SELECT') AS service_role_select
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('units', 'project_salespeople')
ORDER BY c.relname;

SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,
       p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_admin', 'lv_shares_project', 'lv_can_write_unit_sale')
ORDER BY p.proname;

SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'unit_sales_closings'
ORDER BY policyname;

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'unit_sales_closings' AND column_name IN ('tenant_id', 'unit_id', 'sold_by_id', 'sale_at', 'registered_at'))
    OR (table_name = 'units' AND column_name IN ('id', 'tenant_id', 'project_id'))
    OR (table_name = 'project_salespeople' AND column_name IN ('tenant_id', 'project_id', 'salesperson_id'))
  )
ORDER BY table_name, ordinal_position;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('unit_sales_closings', 'units', 'project_salespeople')
ORDER BY tablename, indexname;
