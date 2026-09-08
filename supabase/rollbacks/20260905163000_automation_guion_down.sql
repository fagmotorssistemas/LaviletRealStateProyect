DROP FUNCTION IF EXISTS public.get_active_script_questions(uuid, uuid, text);
DROP POLICY IF EXISTS "Admin all agent_script_questions" ON public.agent_script_questions;
DROP POLICY IF EXISTS "Admin read agent_prompts" ON public.agent_prompts;
DROP POLICY IF EXISTS "Admin write agent_prompts" ON public.agent_prompts;
DROP TABLE IF EXISTS public.agent_script_questions;
