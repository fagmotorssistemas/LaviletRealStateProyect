-- Run the entire script in Supabase SQL Editor. This changes parsing only.
BEGIN;
-- Calendar corrections for explicit next-week preferences. No appointments are
-- confirmed or messages sent by applying this migration. Raw transcripts stay intact.
CREATE OR REPLACE FUNCTION public.lv_parse_visit_preference(p_text text,p_reference timestamptz,p_timezone text DEFAULT 'America/Guayaquil')
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE
  v text := lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
  date_text text; base date; chosen date; matches text[]; clock_parts text[];
  hour_value integer; minute_value integer; meridiem text; day_index integer; delta integer;
  start_value timestamptz; month_index integer; next_week boolean; this_week boolean;
BEGIN
  IF p_reference IS NULL OR v='' THEN RETURN jsonb_build_object('confidence','unknown'); END IF;
  base := (p_reference AT TIME ZONE p_timezone)::date;
  v := public.lv_normalize_visit_text(v);
  -- The final explicit correction replaces the earlier preference in this message.
  IF v ~ '\m(mejor|prefiero)\M' THEN v:=regexp_replace(v,'^.*\m(mejor|prefiero)\M\s*','','i'); END IF;
  v := regexp_replace(v,'\m([ap])\.?\s*m\.?(?![[:alpha:]])','\1m','g');
  -- Una alternativa, negación o condición no demuestra aceptación de un intervalo único.
  IF v ~ '\m(o|entre|quizas|cancelar|cancelacion)\M|\mno\M|tal vez|\msi\M' THEN
    RETURN jsonb_build_object('confidence','ambiguous');
  END IF;
  date_text := replace(replace(v,'de la manana',''),'por la manana','');
  next_week := date_text ~ '\m(?:(?:proxima|siguiente) semana|semana (?:proxima|siguiente|entrante|que (?:viene|sigue)))\M';
  this_week := date_text ~ '\m(?:esta semana|semana actual)\M';
  -- A week without its weekday is incomplete; never reuse an earlier day.
  IF (next_week OR this_week) AND date_text !~ '\m(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\M' THEN
    RETURN jsonb_build_object('confidence','ambiguous');
  END IF;
  IF date_text ~ '\msemanas?\M' AND NOT next_week AND NOT this_week THEN
    RETURN jsonb_build_object('confidence','ambiguous');
  END IF;
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
          IF next_week OR this_week THEN
            -- Weeks begin on Monday. From Monday 14, next-week Monday is 21.
            chosen := base-extract(isodow FROM base)::integer+day_index+CASE WHEN next_week THEN 7 ELSE 0 END;
          ELSE
            delta := (day_index-extract(isodow FROM base)::integer+7)%7;
            IF delta=0 AND date_text ~ '\m(?:proximo|siguiente)\M' THEN delta := 7; END IF;
            chosen := base+delta;
          END IF;
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
CREATE OR REPLACE FUNCTION public.lv_visit_preference_parts(p_text text,p_at timestamptz,p_timezone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE v text:=lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
 parsed jsonb; clock_parts text[]; h integer; mins integer; marker text; hours integer[]; token text; ix integer; negated boolean; keep_clock boolean;
BEGIN
 v:=public.lv_normalize_visit_text(v);
 v:=regexp_replace(v,'\m(malana|manana)\M','manana','g');
 v:=regexp_replace(v,'\mlass\M','las','g');
 v:=regexp_replace(v,'no (?:estoy seguro|se)(?: de)?(?: la hora| a que hora)?','', 'g');
 v:=regexp_replace(v,'^\s*si\M[, ]*','','i');
 v:=regexp_replace(v,'\m([ap])\.?\s*m\.?(?![[:alpha:]])','\1m','g');
 -- Rejecting the offered option must not retain its date/hour from the lineage.
 IF v ~ '\m(?:prefiero|quiero|mejor|deme|denme)\M.*\m(?:otra|otro|otras|otros)\M|\m(?:que|cuales) (?:otras? )?(?:opciones|horarios|alternativas)\M'
 AND (public.lv_parse_visit_preference(v,p_at,p_timezone)->>'requested_date') IS NULL
 AND v !~ '\m(?:hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}/[0-9]{1,2})\M|\m(?:a las?|las?)\s+(?:[0-9]{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\M' THEN
  RETURN jsonb_build_object('clear_time',true,'clear_date',true,'needs_help',true);
 END IF;
 IF v ~ '\m(mejor|prefiero)\M' THEN v:=regexp_replace(v,'^.*\m(mejor|prefiero)\M\s*','','i'); END IF;
 negated:=v ~ '\mno\M|\m(cancelar|cancelo|cancelacion)\M';
 IF negated THEN RETURN jsonb_build_object('clear_time',true,'clear_date',v ~ 'ese dia|esa fecha|otro dia|otra fecha|manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo'); END IF;
 IF v ~ '\m(o|entre|quizas)\M|tal vez|mas o menos|alrededor' THEN RETURN jsonb_build_object('ambiguous',true); END IF;
 -- Normalizar horas escritas con palabras, sin reemplazar números de fechas.
 FOR ix IN 1..12 LOOP
  token:=(ARRAY['una','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce'])[ix];
  IF trim(v)=token THEN v:='a las '||ix::text; END IF;
  v:=regexp_replace(v,'(\ma las?|\mlas?)\s+'||token||'\M','\1 '||ix::text,'g');
 END LOOP;
 IF trim(v) ~ '^[0-9]{1,2}$' THEN v:='a las '||trim(v); END IF;
 v:=regexp_replace(v,'([0-9]{1,2})\s+y\s+media\M','\1:30','g');
 v:=regexp_replace(v,'([0-9]{1,2})\s+y\s+cuarto\M','\1:15','g');
 IF v ~ '[0-9]{1,2}\s+(y|menos)\s+' THEN RETURN jsonb_build_object('ambiguous',true); END IF;
 parsed:=public.lv_parse_visit_preference(v,p_at,p_timezone);
 -- No reutilizar el día previo si hay dos fechas o una fecha inválida.
 IF parsed->>'confidence'='ambiguous' AND parsed->>'requested_date' IS NULL THEN
  RETURN jsonb_build_object('ambiguous',true);
 END IF;
 IF (SELECT count(*) FROM regexp_matches(v,'\m[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)\M','g'))>1
 OR (SELECT count(*) FROM regexp_matches(v,'\m(?:a las?|las?|alas?)\s+[0-9]{1,2}','g'))>1 THEN
  RETURN jsonb_build_object('ambiguous',true);
 END IF;
 clock_parts:=regexp_match(v,'\m(?:a las?|las?|alas?|para las?)\s+([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm|de la manana|de la tarde|de la noche|h(?:oras?)?)?');
 IF clock_parts IS NULL THEN
  clock_parts:=regexp_match(v,'\m([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm|de la manana|de la tarde|de la noche|h(?:oras?)?)\M');
 END IF;
 IF clock_parts IS NULL THEN clock_parts:=regexp_match(v,'\m([0-9]{1,2}):([0-9]{2})\M'); END IF;
 IF clock_parts IS NULL THEN
  keep_clock:=v ~ 'misma hora|mismo horario|^(?:de |por |en )?la (?:manana|tarde|noche)$';
  RETURN jsonb_build_object('requested_date',parsed->>'requested_date','keep_time',keep_clock,'period',CASE WHEN v ~ '^(?:de |por |en )?la manana$' THEN 'morning' WHEN v ~ '^(?:de |por |en )?la (?:tarde|noche)$' THEN 'afternoon' END,
   'clear_time',NOT keep_clock AND v ~ 'reagendar|reprogramar|cambiar|cambio|otro horario|otra hora|mas tarde|mas temprano|por la (manana|tarde|noche)|en la (manana|tarde|noche)',
   'clear_date',parsed->>'requested_date' IS NULL AND v !~ 'mismo dia' AND v ~ 'reagendar|reprogramar|otro dia|otra fecha');
 END IF;
 h:=clock_parts[1]::integer; mins:=coalesce(clock_parts[2]::integer,0); marker:=coalesce(clock_parts[3],'');
 IF h>23 OR mins>59 THEN RETURN jsonb_build_object('ambiguous',true,'requested_date',parsed->>'requested_date'); END IF;
 IF marker IN ('am','pm','de la manana','de la tarde','de la noche') THEN
  IF h NOT BETWEEN 1 AND 12 THEN RETURN jsonb_build_object('ambiguous',true); END IF;
  hours:=ARRAY[h%12+CASE WHEN marker IN ('pm','de la tarde','de la noche') THEN 12 ELSE 0 END];
 ELSIF h BETWEEN 1 AND 12 AND marker='' AND clock_parts[1] !~ '^0' THEN
  hours:=ARRAY[h%12,h%12+12];
 ELSE hours:=ARRAY[h];
 END IF;
 RETURN jsonb_build_object('requested_date',parsed->>'requested_date','hours',hours,'minute',mins);
END $fn$;
REVOKE ALL ON FUNCTION public.lv_visit_preference_parts(text,timestamptz,text) FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';

COMMIT;
