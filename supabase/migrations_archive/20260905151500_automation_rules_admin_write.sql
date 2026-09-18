-- Permite que un admin edite reglas con su sesión (sin service_role).
-- Reversión: 20260905151500_automation_rules_admin_write_down.sql

DROP POLICY IF EXISTS "Admin write project_automation_config" ON public.project_automation_config;
CREATE POLICY "Admin write project_automation_config"
  ON public.project_automation_config
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin write lead_scoring_rules" ON public.lead_scoring_rules;
CREATE POLICY "Admin write lead_scoring_rules"
  ON public.lead_scoring_rules
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin write nutrition_steps" ON public.nutrition_steps;
CREATE POLICY "Admin write nutrition_steps"
  ON public.nutrition_steps
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
