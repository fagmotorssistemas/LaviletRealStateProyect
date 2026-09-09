BEGIN;
DO $$
DECLARE r record; current_bot bigint; current_field bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('visit_propose',0,18724,519824),('visit_confirm',0,18730,519824),
    ('visit_reschedule_confirm',0,18730,519824),('visit_2h',18350,18350,513120)
  ) AS mapping(kind,old_bot,new_bot,new_field) LOOP
    SELECT bot_id,detail_field_id INTO STRICT current_bot,current_field FROM public.lv_routes
    WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND kind=r.kind FOR UPDATE;
    IF current_bot=r.old_bot AND current_field=0 THEN CONTINUE; END IF;
    IF current_bot IS DISTINCT FROM r.new_bot OR current_field IS DISTINCT FROM r.new_field THEN
      RAISE EXCEPTION 'La ruta % fue editada después; no sobrescribir',r.kind;
    END IF;
    UPDATE public.lv_routes SET bot_id=r.old_bot,detail_field_id=0
    WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND kind=r.kind;
  END LOOP;
END $$;
COMMIT;
