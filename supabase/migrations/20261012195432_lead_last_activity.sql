-- Actividad comercial para ordenar el CRM. last_interaction_at permanece intacto:
-- el bot lo usa para decay y nutrición.
ALTER TABLE public.leads
  ADD COLUMN last_activity_at timestamptz DEFAULT now(),
  ADD COLUMN last_activity_source text DEFAULT 'crm'
    CONSTRAINT leads_last_activity_source_check
    CHECK (last_activity_source IN ('showroom', 'whatsapp', 'solicitud', 'crm'));

CREATE INDEX leads_tenant_last_activity_idx
  ON public.leads (tenant_id, last_activity_at DESC NULLS LAST);

-- El backfill y los futuros toques de actividad no deben alterar updated_at:
-- Ventas lo utiliza como fecha de venta inferida.
DROP TRIGGER IF EXISTS update_leads_updated_at ON public.leads;
CREATE TRIGGER update_leads_updated_at
BEFORE UPDATE ON public.leads
FOR EACH ROW
WHEN ((to_jsonb(OLD) - 'last_activity_at' - 'last_activity_source' - 'updated_at')
  IS DISTINCT FROM
  (to_jsonb(NEW) - 'last_activity_at' - 'last_activity_source' - 'updated_at'))
EXECUTE FUNCTION public.update_updated_at();

-- Elegir el evento más reciente; en empates, la solicitud prevalece sobre
-- showroom, WhatsApp y la creación del lead.
WITH activity AS (
  SELECT l.id, l.created_at, l.last_interaction_at,
    (
      SELECT max(s.last_seen_at)
      FROM public.tour_visitors v
      JOIN public.tour_sessions s
        ON s.visitor_id = v.id AND s.tenant_id = v.tenant_id
      WHERE v.lead_id = l.id AND v.tenant_id = l.tenant_id
    ) AS showroom_at,
    (
      SELECT max(r.created_at)
      FROM public.tour_info_requests r
      WHERE r.lead_id = l.id AND r.tenant_id = l.tenant_id
    ) AS solicitud_at
  FROM public.leads l
), latest AS (
  SELECT a.id,
    greatest(a.created_at, a.last_interaction_at, a.showroom_at, a.solicitud_at) AS activity_at,
    (
      SELECT candidate.source
      FROM (VALUES
        (a.solicitud_at, 'solicitud', 4),
        (a.showroom_at, 'showroom', 3),
        (a.last_interaction_at, 'whatsapp', 2),
        (a.created_at, 'crm', 1)
      ) AS candidate(at, source, priority)
      WHERE candidate.at IS NOT NULL
      ORDER BY candidate.at DESC, candidate.priority DESC
      LIMIT 1
    ) AS activity_source
  FROM activity a
)
UPDATE public.leads l
SET last_activity_at = latest.activity_at,
    last_activity_source = latest.activity_source
FROM latest
WHERE l.id = latest.id;

-- Las funciones de trigger son privadas: solo los triggers pueden invocarlas.
CREATE SCHEMA IF NOT EXISTS lead_activity_internal;
REVOKE ALL ON SCHEMA lead_activity_internal FROM PUBLIC, anon, authenticated;

CREATE FUNCTION lead_activity_internal.touch_lead(
  p_tenant_id uuid, p_lead_id uuid, p_at timestamptz, p_source text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_lead_id IS NULL OR p_at IS NULL THEN RETURN; END IF;
  UPDATE public.leads
  SET last_activity_at = p_at, last_activity_source = p_source
  WHERE id = p_lead_id AND tenant_id = p_tenant_id
    AND (last_activity_at IS NULL
      OR (p_source = 'showroom' AND p_at > last_activity_at
        AND p_at >= last_activity_at + interval '5 minutes')
      OR (p_source = 'solicitud' AND p_at >= last_activity_at));
END;
$$;

CREATE FUNCTION lead_activity_internal.session_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_lead_id uuid;
BEGIN
  SELECT v.lead_id INTO v_lead_id
  FROM public.tour_visitors v
  WHERE v.id = NEW.visitor_id AND v.tenant_id = NEW.tenant_id;
  PERFORM lead_activity_internal.touch_lead(
    NEW.tenant_id, v_lead_id, NEW.last_seen_at, 'showroom'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER tour_sessions_lead_activity
AFTER INSERT OR UPDATE OF last_seen_at ON public.tour_sessions
FOR EACH ROW EXECUTE FUNCTION lead_activity_internal.session_activity();

CREATE FUNCTION lead_activity_internal.request_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM lead_activity_internal.touch_lead(
    NEW.tenant_id, NEW.lead_id, NEW.created_at, 'solicitud'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER tour_info_requests_lead_activity
AFTER INSERT ON public.tour_info_requests
FOR EACH ROW EXECUTE FUNCTION lead_activity_internal.request_activity();

CREATE FUNCTION lead_activity_internal.whatsapp_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.last_interaction_at IS NOT NULL
    AND (OLD.last_interaction_at IS NULL
      OR NEW.last_interaction_at > OLD.last_interaction_at)
    AND (OLD.last_activity_at IS NULL
      OR NEW.last_interaction_at > OLD.last_activity_at) THEN
    NEW.last_activity_at := NEW.last_interaction_at;
    NEW.last_activity_source := CASE WHEN EXISTS (
      SELECT 1
      FROM public.tour_visitors v
      JOIN public.tour_sessions s
        ON s.visitor_id = v.id AND s.tenant_id = v.tenant_id
      WHERE v.lead_id = NEW.id AND v.tenant_id = NEW.tenant_id
        AND s.last_seen_at BETWEEN NEW.last_interaction_at - interval '10 minutes'
          AND NEW.last_interaction_at
    ) THEN 'showroom' ELSE 'whatsapp' END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_whatsapp_activity
BEFORE UPDATE OF last_interaction_at ON public.leads
FOR EACH ROW EXECUTE FUNCTION lead_activity_internal.whatsapp_activity();

CREATE FUNCTION lead_activity_internal.new_lead_activity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_origin text := lower(concat_ws(' ', NEW.source, NEW.channel_origin));
BEGIN
  NEW.last_activity_at := coalesce(NEW.last_interaction_at, NEW.created_at, now());
  NEW.last_activity_source := CASE
    WHEN v_origin LIKE '%whatsapp%' THEN 'whatsapp'
    WHEN v_origin LIKE '%showroom%' THEN 'showroom'
    ELSE 'crm'
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_new_activity
BEFORE INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION lead_activity_internal.new_lead_activity();

CREATE FUNCTION lead_activity_internal.visitor_link_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session_at timestamptz;
BEGIN
  SELECT max(s.last_seen_at) INTO v_session_at
  FROM public.tour_sessions s
  WHERE s.visitor_id = NEW.id AND s.tenant_id = NEW.tenant_id;
  PERFORM lead_activity_internal.touch_lead(
    NEW.tenant_id, NEW.lead_id,
    greatest(now(), NEW.last_seen_at, v_session_at), 'showroom'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER tour_visitors_lead_link_activity
AFTER UPDATE OF lead_id ON public.tour_visitors
FOR EACH ROW
WHEN (NEW.lead_id IS NOT NULL AND NEW.lead_id IS DISTINCT FROM OLD.lead_id)
EXECUTE FUNCTION lead_activity_internal.visitor_link_activity();

REVOKE ALL ON FUNCTION lead_activity_internal.touch_lead(uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lead_activity_internal.session_activity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lead_activity_internal.request_activity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lead_activity_internal.whatsapp_activity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lead_activity_internal.new_lead_activity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lead_activity_internal.visitor_link_activity() FROM PUBLIC, anon, authenticated;
