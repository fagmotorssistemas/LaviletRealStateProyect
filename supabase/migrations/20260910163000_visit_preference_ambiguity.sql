-- Acciones rápidas de Agenda. Solo añade funciones; no confirma ni modifica citas al instalar.
CREATE OR REPLACE FUNCTION public.lv_parse_visit_preference(p_text text,p_reference timestamptz,p_timezone text DEFAULT 'America/Guayaquil')
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE
  v text := lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
  date_text text; base date; chosen date; matches text[]; clock_parts text[];
  hour_value integer; minute_value integer; meridiem text; day_index integer; delta integer;
  start_value timestamptz; certainty text := 'unknown'; month_index integer;
BEGIN
  IF p_reference IS NULL OR v='' THEN RETURN jsonb_build_object('confidence','unknown'); END IF;
  base := (p_reference AT TIME ZONE p_timezone)::date;
  v := regexp_replace(v,'([ap])\.?\s*m\.?','\1m','g');
  -- Una alternativa, negación o condición no demuestra aceptación de un intervalo único.
  IF v ~ '\m(o|entre|quizas|cancelar|cancelacion)\M|\mno\M|tal vez|proxima semana|\msi\M' THEN
    RETURN jsonb_build_object('confidence','ambiguous');
  END IF;
  date_text := replace(replace(v,'de la manana',''),'por la manana','');
  IF (SELECT count(*) FROM regexp_matches(date_text,'\m(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}/[0-9]{1,2}|[0-9]{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\M','g'))>1
    OR (SELECT count(*) FROM regexp_matches(v,'\m[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm|de la manana|de la tarde|de la noche|horas?)\M','g'))>1
    OR (SELECT count(*) FROM regexp_matches(v,'(?:a las?|alas?|desde las?)\s+[0-9]{1,2}','g'))>1 THEN
    RETURN jsonb_build_object('confidence','ambiguous');
  END IF;
  matches := regexp_match(date_text,'\m([0-9]{4})-([0-9]{2})-([0-9]{2})\M');
  IF matches IS NOT NULL THEN
    chosen := make_date(matches[1]::integer,matches[2]::integer,matches[3]::integer);
  ELSE
    matches := regexp_match(date_text,'\m([0-9]{1,2})/([0-9]{1,2})(?:/([0-9]{4}))?\M');
    IF matches IS NOT NULL THEN
      chosen := make_date(coalesce(matches[3]::integer,extract(year FROM base)::integer),matches[2]::integer,matches[1]::integer);
    ELSE
      matches := regexp_match(date_text,'\m([0-9]{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?: de ([0-9]{4}))?\M');
      IF matches IS NOT NULL THEN
        month_index := array_position(ARRAY['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],matches[2]);
        chosen := make_date(coalesce(matches[3]::integer,extract(year FROM base)::integer),month_index,matches[1]::integer);
      ELSIF date_text ~ 'pasado manana' THEN chosen := base+2;
      ELSIF date_text ~ '\mmanana\M' THEN chosen := base+1;
      ELSIF date_text ~ '\mhoy\M' THEN chosen := base;
      ELSE
        matches := regexp_match(date_text,'\m(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\M');
        IF matches IS NOT NULL THEN
          day_index := array_position(ARRAY['lunes','martes','miercoles','jueves','viernes','sabado','domingo'],matches[1]);
          delta := (day_index-extract(isodow FROM base)::integer+7)%7;
          IF delta=0 AND date_text ~ '\mproximo\M' THEN delta := 7; END IF;
          chosen := base+delta;
        END IF;
      END IF;
    END IF;
  END IF;
  IF chosen IS NULL THEN RETURN jsonb_build_object('confidence','unknown'); END IF;
  clock_parts := regexp_match(v,'(?:a las?|alas?|desde las?)\s+([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm|de la manana|de la tarde|de la noche|h(?:oras?)?)?');
  IF clock_parts IS NULL THEN
    clock_parts := regexp_match(v,'\m([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm|de la manana|de la tarde|de la noche|h(?:oras?)?)\M');
  END IF;
  IF clock_parts IS NULL THEN RETURN jsonb_build_object('confidence','date_only','requested_date',chosen); END IF;
  hour_value := clock_parts[1]::integer; minute_value := coalesce(clock_parts[2]::integer,0);
  meridiem := coalesce(clock_parts[3],'');
  IF minute_value>59 OR hour_value>23 THEN RETURN jsonb_build_object('confidence','ambiguous','requested_date',chosen); END IF;
  IF meridiem IN ('am','pm','de la manana','de la tarde','de la noche') THEN
    IF hour_value<1 OR hour_value>12 THEN RETURN jsonb_build_object('confidence','ambiguous','requested_date',chosen); END IF;
    hour_value := hour_value%12 + CASE WHEN meridiem IN ('pm','de la tarde','de la noche') THEN 12 ELSE 0 END;
  ELSIF clock_parts[2] IS NULL AND meridiem='' AND hour_value BETWEEN 1 AND 12 THEN
    RETURN jsonb_build_object('confidence','ambiguous','requested_date',chosen);
  END IF;
  start_value := (chosen+make_time(hour_value,minute_value,0)) AT TIME ZONE p_timezone;
  RETURN jsonb_build_object('confidence','exact','requested_date',chosen,'start_time',start_value,'end_time',start_value+interval '1 hour');
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR invalid_parameter_value THEN
  RETURN jsonb_build_object('confidence','ambiguous');
END;
$fn$;
REVOKE ALL ON FUNCTION public.lv_parse_visit_preference(text,timestamptz,text) FROM PUBLIC,anon,authenticated;
