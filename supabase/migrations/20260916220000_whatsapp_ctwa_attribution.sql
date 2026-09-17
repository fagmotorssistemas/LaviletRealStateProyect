-- Preparada para revisión. NO aplicar a Production en este cambio.
-- First-touch de ctwa_clid cuando el webhook CRM de Kommo lo reenvíe.
-- Sin atribución automática ads/orgánico; solo conserva el valor y su origen.
-- Unicidad: (project_id, contact_id) y (project_id, external_message_id) resueltas
-- atómicamente; siempre se conserva la primera captura (ORDER BY captured_at, id).

BEGIN;

CREATE TABLE IF NOT EXISTS public.lv_whatsapp_ctwa_attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  contact_id text NOT NULL,
  kommo_id bigint NOT NULL,
  ctwa_clid text NOT NULL CHECK (char_length(ctwa_clid) BETWEEN 1 AND 512),
  field_path text NOT NULL CHECK (char_length(field_path) BETWEEN 1 AND 300),
  source_id text,
  source_url text,
  referral_source_type text,
  external_message_id text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lv_whatsapp_ctwa_attribution_contact_uq UNIQUE (project_id, contact_id),
  CONSTRAINT lv_whatsapp_ctwa_attribution_message_uq UNIQUE (project_id, external_message_id)
);

COMMENT ON TABLE public.lv_whatsapp_ctwa_attribution IS
  'First-touch ctwa_clid desde WhatsApp vía Kommo. No implica atribución CAPI ni Pixel.';

ALTER TABLE public.lv_whatsapp_ctwa_attribution ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lv_whatsapp_ctwa_attribution FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lv_whatsapp_ctwa_attribution TO service_role;

-- Inserta first-touch. Ante cualquier unique_violation (contacto o mensaje),
-- relee y devuelve la captura más antigua. Una sola transacción de función.
CREATE OR REPLACE FUNCTION public.lv_app_preserve_ctwa(
  p_tenant_id uuid,
  p_project_id uuid,
  p_contact_id text,
  p_kommo_id bigint,
  p_ctwa_clid text,
  p_field_path text,
  p_source_id text,
  p_source_url text,
  p_referral_source_type text,
  p_external_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing public.lv_whatsapp_ctwa_attribution%ROWTYPE;
  inserted boolean := false;
BEGIN
  IF p_ctwa_clid IS NULL OR length(trim(p_ctwa_clid)) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'action', 'noop_empty');
  END IF;

  BEGIN
    INSERT INTO public.lv_whatsapp_ctwa_attribution (
      tenant_id, project_id, contact_id, kommo_id, ctwa_clid, field_path,
      source_id, source_url, referral_source_type, external_message_id
    ) VALUES (
      p_tenant_id, p_project_id, p_contact_id, p_kommo_id, trim(p_ctwa_clid), p_field_path,
      NULLIF(trim(COALESCE(p_source_id, '')), ''),
      NULLIF(trim(COALESCE(p_source_url, '')), ''),
      NULLIF(trim(COALESCE(p_referral_source_type, '')), ''),
      p_external_message_id
    );
    inserted := true;
  EXCEPTION
    WHEN unique_violation THEN
      inserted := false;
  END;

  SELECT * INTO existing
  FROM public.lv_whatsapp_ctwa_attribution
  WHERE project_id = p_project_id
    AND (contact_id = p_contact_id OR external_message_id = p_external_message_id)
  ORDER BY captured_at ASC, id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'action', 'missing_after_conflict');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'action', CASE
      WHEN inserted THEN 'inserted'
      WHEN existing.external_message_id = p_external_message_id THEN 'duplicate_retry'
      ELSE 'preserved_existing'
    END,
    'ctwa_clid', existing.ctwa_clid,
    'field_path', existing.field_path,
    'external_message_id', existing.external_message_id,
    'captured_at', existing.captured_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.lv_app_get_ctwa(p_project_id uuid, p_contact_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE row public.lv_whatsapp_ctwa_attribution%ROWTYPE;
BEGIN
  SELECT * INTO row
  FROM public.lv_whatsapp_ctwa_attribution
  WHERE project_id = p_project_id AND contact_id = p_contact_id
  ORDER BY captured_at ASC, id ASC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'found', false);
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'found', true,
    'ctwa_clid', row.ctwa_clid,
    'field_path', row.field_path,
    'source_id', row.source_id,
    'source_url', row.source_url,
    'referral_source_type', row.referral_source_type,
    'external_message_id', row.external_message_id,
    'captured_at', row.captured_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lv_app_preserve_ctwa(uuid,uuid,text,bigint,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_app_get_ctwa(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lv_app_preserve_ctwa(uuid,uuid,text,bigint,text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lv_app_get_ctwa(uuid,text) TO service_role;

COMMIT;
