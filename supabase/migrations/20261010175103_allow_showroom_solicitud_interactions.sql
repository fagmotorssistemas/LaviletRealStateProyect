-- Already applied to production; record the constraint for fresh environments.
ALTER TABLE public.lead_interactions DROP CONSTRAINT lead_interactions_type_check;
ALTER TABLE public.lead_interactions ADD CONSTRAINT lead_interactions_type_check
  CHECK (type = ANY (ARRAY['llamada'::text, 'whatsapp'::text, 'visita'::text,
    'propuesta'::text, 'seguimiento'::text, 'email'::text, 'otro'::text,
    'showroom_solicitud'::text]));
