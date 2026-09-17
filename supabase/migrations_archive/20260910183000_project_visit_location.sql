ALTER TABLE public.project_automation_config
 ADD COLUMN IF NOT EXISTS visit_latitude double precision,
 ADD COLUMN IF NOT EXISTS visit_longitude double precision;
ALTER TABLE public.project_automation_config ADD CONSTRAINT visit_coordinates_valid CHECK (
 (visit_latitude IS NULL AND visit_longitude IS NULL) OR
 (visit_latitude IS NOT NULL AND visit_longitude IS NOT NULL AND visit_latitude BETWEEN -90 AND 90 AND visit_longitude BETWEEN -180 AND 180)
);
CREATE FUNCTION public.lv_sync_visit_location_url() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN
 IF NEW.visit_latitude IS NOT NULL AND NEW.visit_longitude IS NOT NULL THEN
  NEW.visit_location_url := 'https://www.google.com/maps/search/?api=1&query='||
   round(NEW.visit_latitude::numeric,6)::text||'%2C'||round(NEW.visit_longitude::numeric,6)::text;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.lv_sync_visit_location_url() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_visit_location_url BEFORE INSERT OR UPDATE ON public.project_automation_config
 FOR EACH ROW EXECUTE FUNCTION public.lv_sync_visit_location_url();

CREATE OR REPLACE FUNCTION public.lv_build_visit_confirm_message(p_lead_name text,p_advisor_name text,p_start timestamptz,p_location_url text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $fn$
DECLARE d timestamp:=p_start AT TIME ZONE 'America/Guayaquil'; h integer; clock_text text; when_text text;
 first_name text:=split_part(btrim(coalesce(p_lead_name,'')),' ',1);
 advisor text:=coalesce(nullif(btrim(p_advisor_name),''),''); location text; result text;
BEGIN
 IF p_start IS NULL THEN RAISE EXCEPTION 'Cita sin fecha'; END IF;
 h:=extract(hour FROM d)::integer%12; IF h=0 THEN h:=12; END IF;
 clock_text:=(CASE WHEN h=1 THEN 'a la ' ELSE 'a las ' END)||h::text||
  CASE WHEN extract(minute FROM d)=0 THEN '' ELSE ':'||to_char(d,'MI') END||
  CASE WHEN extract(hour FROM d)>=12 THEN ' p. m.' ELSE ' a. m.' END;
 when_text:='el '||(ARRAY['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[extract(isodow FROM d)::integer]||' '||
  extract(day FROM d)::integer::text||' de '||(ARRAY['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month FROM d)::integer]||' '||clock_text;
 location:=CASE WHEN nullif(btrim(p_location_url),'') IS NULL THEN '' ELSE E'\nUbicación:\n'||btrim(p_location_url) END;
 result:='Perfecto'||CASE WHEN first_name='' THEN '' ELSE ', '||first_name END||'. Confirmamos su cita '||when_text||
  CASE WHEN advisor='' THEN ' con nuestro equipo' ELSE ' con nuestro asesor '||advisor END||'. Será un gusto recibirle.'||location;
 IF char_length(result)>256 THEN result:=replace(result,when_text,'el '||to_char(d,'DD/MM/YYYY')||' '||clock_text); END IF;
 IF char_length(result)>256 AND first_name<>'' THEN result:=replace(result,'Perfecto, '||first_name||'.','Perfecto.'); END IF;
 IF char_length(result)>256 AND advisor<>'' THEN result:=replace(result,'nuestro asesor '||advisor,'nuestro equipo'); END IF;
 IF char_length(result)>256 THEN RAISE EXCEPTION 'El enlace de ubicación es demasiado largo para el mensaje de visita'; END IF;
 RETURN result;
END $fn$;
NOTIFY pgrst,'reload schema';

