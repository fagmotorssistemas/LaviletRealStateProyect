-- Investment simulator RLS: public read partners/config; admin write; scenarios/log admin-only via client.
-- Lead save/list goes through Next.js API with service_role.

CREATE OR REPLACE FUNCTION public.is_crm_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role::text = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_crm_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_crm_admin() TO anon, authenticated;

ALTER TABLE public.financing_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financing_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financing_calculations_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lectura_partners ON public.financing_partners;
DROP POLICY IF EXISTS editar_partners ON public.financing_partners;
DROP POLICY IF EXISTS insertar_partners ON public.financing_partners;
DROP POLICY IF EXISTS borrar_partners ON public.financing_partners;

CREATE POLICY lectura_partners ON public.financing_partners
  FOR SELECT USING (true);

CREATE POLICY editar_partners ON public.financing_partners
  FOR UPDATE USING (public.is_crm_admin())
  WITH CHECK (public.is_crm_admin());

CREATE POLICY insertar_partners ON public.financing_partners
  FOR INSERT WITH CHECK (public.is_crm_admin());

CREATE POLICY borrar_partners ON public.financing_partners
  FOR DELETE USING (public.is_crm_admin());

DROP POLICY IF EXISTS lectura_config ON public.financing_config;
DROP POLICY IF EXISTS editar_config ON public.financing_config;
DROP POLICY IF EXISTS insertar_config ON public.financing_config;

CREATE POLICY lectura_config ON public.financing_config
  FOR SELECT USING (true);

CREATE POLICY editar_config ON public.financing_config
  FOR UPDATE USING (public.is_crm_admin())
  WITH CHECK (public.is_crm_admin());

CREATE POLICY insertar_config ON public.financing_config
  FOR INSERT WITH CHECK (public.is_crm_admin());

DROP POLICY IF EXISTS lectura_scenarios_admin ON public.financing_scenarios;
DROP POLICY IF EXISTS editar_scenarios_admin ON public.financing_scenarios;
DROP POLICY IF EXISTS insertar_scenarios_admin ON public.financing_scenarios;
DROP POLICY IF EXISTS eliminar_scenarios_admin ON public.financing_scenarios;

CREATE POLICY lectura_scenarios_admin ON public.financing_scenarios
  FOR SELECT USING (public.is_crm_admin());

CREATE POLICY editar_scenarios_admin ON public.financing_scenarios
  FOR UPDATE USING (public.is_crm_admin())
  WITH CHECK (public.is_crm_admin());

CREATE POLICY insertar_scenarios_admin ON public.financing_scenarios
  FOR INSERT WITH CHECK (public.is_crm_admin());

CREATE POLICY eliminar_scenarios_admin ON public.financing_scenarios
  FOR DELETE USING (public.is_crm_admin());

DROP POLICY IF EXISTS lectura_log_admin ON public.financing_calculations_log;

CREATE POLICY lectura_log_admin ON public.financing_calculations_log
  FOR SELECT USING (public.is_crm_admin());
