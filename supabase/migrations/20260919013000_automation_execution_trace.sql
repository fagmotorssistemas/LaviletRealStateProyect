-- Trazabilidad de solo auditoría para visualizar cada ejecución como un workflow.
-- No participa en decisiones comerciales ni concede acceso directo al cliente.

CREATE TABLE IF NOT EXISTS public.lv_automation_execution_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.lv_integration_events(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  step_order smallint NOT NULL CHECK (step_order BETWEEN 1 AND 100),
  step_key text NOT NULL CHECK (length(step_key) BETWEEN 1 AND 80),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 160),
  category text NOT NULL CHECK (category IN ('input','control','context','ai','decision','action','output')),
  status text NOT NULL CHECK (status IN ('succeeded','paused','skipped','failed')),
  source_module text NOT NULL CHECK (length(source_module) BETWEEN 1 AND 240),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms BETWEEN 0 AND 600000),
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text CHECK (error_code IS NULL OR length(error_code) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, step_order)
);

CREATE INDEX IF NOT EXISTS lv_automation_execution_steps_event
  ON public.lv_automation_execution_steps(event_id, step_order);
CREATE INDEX IF NOT EXISTS lv_automation_execution_steps_lead
  ON public.lv_automation_execution_steps(project_id, lead_id, created_at DESC);

ALTER TABLE public.lv_automation_execution_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lv_automation_execution_steps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lv_automation_execution_steps TO service_role;

COMMENT ON TABLE public.lv_automation_execution_steps IS
  'Pasos sanitizados de cada ejecución de automatización. Solo auditoría; no controla el comportamiento del bot.';
