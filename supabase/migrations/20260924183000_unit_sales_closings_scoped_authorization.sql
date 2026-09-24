-- Restringe cierres de venta a usuarios con acceso real al proyecto.
-- Purchase sigue derivando exclusivamente de un cierre real; no toca temperaturas.

ALTER TABLE public.unit_sales_closings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS unit_sales_closings_unit_id_idx
  ON public.unit_sales_closings(unit_id);
CREATE INDEX IF NOT EXISTS unit_sales_closings_tenant_id_idx
  ON public.unit_sales_closings(tenant_id);
CREATE INDEX IF NOT EXISTS unit_sales_closings_sold_by_id_idx
  ON public.unit_sales_closings(sold_by_id);
CREATE INDEX IF NOT EXISTS project_salespeople_salesperson_project_tenant_idx
  ON public.project_salespeople(salesperson_id, project_id, tenant_id);

CREATE OR REPLACE FUNCTION public.lv_can_write_unit_sale(
  p_unit_id uuid,
  p_tenant_id uuid,
  p_sold_by_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR (
      p_sold_by_id = (SELECT auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.units u
        JOIN public.project_salespeople ps
          ON ps.project_id = u.project_id
         AND ps.tenant_id = u.tenant_id
         AND ps.salesperson_id = (SELECT auth.uid())
        WHERE u.id = p_unit_id
          AND u.tenant_id = p_tenant_id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.lv_can_write_unit_sale(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lv_can_write_unit_sale(uuid, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated all unit_sales_closings" ON public.unit_sales_closings;
DROP POLICY IF EXISTS unit_sales_closings_authenticated_all ON public.unit_sales_closings;
DROP POLICY IF EXISTS unit_sales_closings_select_scoped ON public.unit_sales_closings;
DROP POLICY IF EXISTS unit_sales_closings_insert_scoped ON public.unit_sales_closings;
DROP POLICY IF EXISTS unit_sales_closings_update_scoped ON public.unit_sales_closings;
DROP POLICY IF EXISTS unit_sales_closings_delete_admin ON public.unit_sales_closings;
DROP POLICY IF EXISTS unit_sales_closings_insert_guard ON public.unit_sales_closings;
DROP POLICY IF EXISTS unit_sales_closings_update_guard ON public.unit_sales_closings;

CREATE POLICY unit_sales_closings_select_scoped ON public.unit_sales_closings
FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR sold_by_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.id = unit_sales_closings.unit_id
      AND u.tenant_id = unit_sales_closings.tenant_id
      AND public.lv_shares_project(u.project_id, u.tenant_id)
  )
);

CREATE POLICY unit_sales_closings_insert_scoped ON public.unit_sales_closings
FOR INSERT TO authenticated
WITH CHECK (
  public.lv_can_write_unit_sale(unit_id, tenant_id, sold_by_id)
);

-- Las políticas restrictivas impiden que una política permisiva agregada en el
-- futuro vuelva a abrir escrituras fuera del proyecto o con otro sold_by_id.
CREATE POLICY unit_sales_closings_insert_guard ON public.unit_sales_closings
AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  public.lv_can_write_unit_sale(unit_id, tenant_id, sold_by_id)
);

CREATE POLICY unit_sales_closings_update_scoped ON public.unit_sales_closings
FOR UPDATE TO authenticated
USING (public.is_admin() OR sold_by_id = (SELECT auth.uid()))
WITH CHECK (
  public.lv_can_write_unit_sale(unit_id, tenant_id, sold_by_id)
);

CREATE POLICY unit_sales_closings_update_guard ON public.unit_sales_closings
AS RESTRICTIVE FOR UPDATE TO authenticated
USING (public.is_admin() OR sold_by_id = (SELECT auth.uid()))
WITH CHECK (
  public.lv_can_write_unit_sale(unit_id, tenant_id, sold_by_id)
);

CREATE POLICY unit_sales_closings_delete_admin ON public.unit_sales_closings
FOR DELETE TO authenticated USING (public.is_admin());

REVOKE ALL ON TABLE public.unit_sales_closings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.unit_sales_closings TO authenticated;
GRANT ALL ON TABLE public.unit_sales_closings TO service_role;

COMMENT ON TABLE public.unit_sales_closings IS
  'Cierres reales de venta. Escritura RLS: admin o asesor asignado al proyecto y sold_by_id propio.';
