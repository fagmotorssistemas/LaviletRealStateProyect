-- Guion comercial editable por admin.
-- Reversión: 20260905163000_automation_guion_down.sql

CREATE TABLE IF NOT EXISTS public.agent_script_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  project_id uuid REFERENCES public.projects(id),
  stage text NOT NULL DEFAULT 'lanzamiento',
  sort_order integer NOT NULL DEFAULT 100,
  question_text text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_script_questions_stage_check CHECK (stage IN ('lanzamiento', 'precalificacion', 'nutricion', 'preventa')),
  CONSTRAINT agent_script_questions_text_check CHECK (char_length(btrim(question_text)) >= 4)
);

CREATE INDEX IF NOT EXISTS agent_script_questions_project_idx
  ON public.agent_script_questions (project_id, stage, sort_order);

COMMENT ON TABLE public.agent_script_questions IS
  'Preguntas de captura que el admin edita en /inmobiliaria/automatizacion/guion.';

ALTER TABLE public.agent_script_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin all agent_script_questions" ON public.agent_script_questions;
CREATE POLICY "Admin all agent_script_questions"
  ON public.agent_script_questions
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_script_questions TO authenticated;

DROP POLICY IF EXISTS "Admin read agent_prompts" ON public.agent_prompts;
CREATE POLICY "Admin read agent_prompts"
  ON public.agent_prompts
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admin write agent_prompts" ON public.agent_prompts;
CREATE POLICY "Admin write agent_prompts"
  ON public.agent_prompts
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.get_active_script_questions(
  p_tenant_id uuid,
  p_project_id uuid,
  p_stage text DEFAULT 'lanzamiento'
)
RETURNS TABLE(sort_order integer, question_text text, stage text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
  select q.sort_order, q.question_text, q.stage
  from public.agent_script_questions q
  where q.is_active
    and q.stage = p_stage
    and (q.tenant_id = p_tenant_id or q.tenant_id is null)
    and (q.project_id = p_project_id or q.project_id is null)
  order by (q.project_id is not null) desc, q.sort_order, q.created_at;
$function$;

GRANT EXECUTE ON FUNCTION public.get_active_script_questions(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_script_questions(uuid, uuid, text) TO service_role;
