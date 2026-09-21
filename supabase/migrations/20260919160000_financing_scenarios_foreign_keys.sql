-- Foreign keys for financing_scenarios / financing_calculations_log
-- Habilita embeds de PostgREST (financing_partners, units, leads, …) en el cliente.

-- Limpieza preventiva de huérfanos (idempotente; solo nulos si no hay match).
UPDATE public.financing_scenarios s
SET financing_partner_id = NULL
WHERE financing_partner_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.financing_partners p WHERE p.id = s.financing_partner_id);

UPDATE public.financing_scenarios s
SET unit_id = NULL
WHERE unit_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.units u WHERE u.id = s.unit_id);

UPDATE public.financing_scenarios s
SET lead_id = NULL
WHERE lead_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = s.lead_id);

UPDATE public.financing_scenarios s
SET project_id = NULL
WHERE project_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = s.project_id);

UPDATE public.financing_scenarios s
SET tenant_id = NULL
WHERE tenant_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = s.tenant_id);

UPDATE public.financing_calculations_log lg
SET scenario_id = NULL
WHERE scenario_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.financing_scenarios s WHERE s.id = lg.scenario_id);

UPDATE public.financing_calculations_log lg
SET tenant_id = NULL
WHERE tenant_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = lg.tenant_id);

-- Índices para las FKs (mejora joins y ON DELETE SET NULL).
CREATE INDEX IF NOT EXISTS financing_scenarios_partner_id_idx
  ON public.financing_scenarios (financing_partner_id);
CREATE INDEX IF NOT EXISTS financing_scenarios_unit_id_idx
  ON public.financing_scenarios (unit_id);
CREATE INDEX IF NOT EXISTS financing_scenarios_lead_id_idx
  ON public.financing_scenarios (lead_id);
CREATE INDEX IF NOT EXISTS financing_scenarios_project_id_idx
  ON public.financing_scenarios (project_id);
CREATE INDEX IF NOT EXISTS financing_scenarios_tenant_id_idx
  ON public.financing_scenarios (tenant_id);
CREATE INDEX IF NOT EXISTS financing_calculations_log_scenario_id_idx
  ON public.financing_calculations_log (scenario_id);
CREATE INDEX IF NOT EXISTS financing_calculations_log_tenant_id_idx
  ON public.financing_calculations_log (tenant_id);

-- Constraints (IF NOT EXISTS vía DROP + ADD para re-aplicación segura).
ALTER TABLE public.financing_scenarios
  DROP CONSTRAINT IF EXISTS financing_scenarios_financing_partner_id_fkey,
  DROP CONSTRAINT IF EXISTS financing_scenarios_unit_id_fkey,
  DROP CONSTRAINT IF EXISTS financing_scenarios_lead_id_fkey,
  DROP CONSTRAINT IF EXISTS financing_scenarios_project_id_fkey,
  DROP CONSTRAINT IF EXISTS financing_scenarios_tenant_id_fkey;

ALTER TABLE public.financing_scenarios
  ADD CONSTRAINT financing_scenarios_financing_partner_id_fkey
    FOREIGN KEY (financing_partner_id)
    REFERENCES public.financing_partners (id)
    ON DELETE SET NULL,
  ADD CONSTRAINT financing_scenarios_unit_id_fkey
    FOREIGN KEY (unit_id)
    REFERENCES public.units (id)
    ON DELETE SET NULL,
  ADD CONSTRAINT financing_scenarios_lead_id_fkey
    FOREIGN KEY (lead_id)
    REFERENCES public.leads (id)
    ON DELETE SET NULL,
  ADD CONSTRAINT financing_scenarios_project_id_fkey
    FOREIGN KEY (project_id)
    REFERENCES public.projects (id)
    ON DELETE SET NULL,
  ADD CONSTRAINT financing_scenarios_tenant_id_fkey
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants (id)
    ON DELETE SET NULL;

ALTER TABLE public.financing_calculations_log
  DROP CONSTRAINT IF EXISTS financing_calculations_log_scenario_id_fkey,
  DROP CONSTRAINT IF EXISTS financing_calculations_log_tenant_id_fkey;

ALTER TABLE public.financing_calculations_log
  ADD CONSTRAINT financing_calculations_log_scenario_id_fkey
    FOREIGN KEY (scenario_id)
    REFERENCES public.financing_scenarios (id)
    ON DELETE SET NULL,
  ADD CONSTRAINT financing_calculations_log_tenant_id_fkey
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants (id)
    ON DELETE SET NULL;

COMMENT ON CONSTRAINT financing_scenarios_financing_partner_id_fkey ON public.financing_scenarios IS
  'Embed PostgREST: financing_partners(partner_name, annual_interest_rate)';
COMMENT ON CONSTRAINT financing_scenarios_unit_id_fkey ON public.financing_scenarios IS
  'Embed PostgREST: units(unit_number)';
COMMENT ON CONSTRAINT financing_scenarios_lead_id_fkey ON public.financing_scenarios IS
  'Embed PostgREST: leads(phone, name)';
