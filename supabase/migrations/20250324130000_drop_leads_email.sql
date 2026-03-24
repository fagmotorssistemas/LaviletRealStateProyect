-- El equipo no almacena correo en leads.
ALTER TABLE public.leads
  DROP COLUMN IF EXISTS email;
