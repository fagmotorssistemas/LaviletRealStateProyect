-- One registration; subsequent edits require a reason and the version the advisor saw.
-- Keep versions distinct even when multiple writes happen in one transaction.
CREATE OR REPLACE FUNCTION public.lv_appointment_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN
 NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.lv_appointment_updated_at() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS update_appointments_updated_at ON public.appointments;
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON public.appointments
 FOR EACH ROW EXECUTE FUNCTION public.lv_appointment_updated_at();

CREATE OR REPLACE FUNCTION public.lv_record_appointment_attendance(
 p_appointment_id uuid,p_attended boolean,p_expected_updated_at timestamptz,
 p_notes text DEFAULT NULL,p_visited_unit_ids uuid[] DEFAULT '{}',p_edit_reason text DEFAULT NULL
) RETURNS public.appointments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE a public.appointments; previous public.appointments; before_units uuid[]; after_units uuid[]; actor_name text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
 SELECT tenant_id,project_id INTO a.tenant_id,a.project_id FROM public.appointments WHERE id=p_appointment_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cita no encontrada'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.tenant_id::text||':'||coalesce(a.project_id::text,''),0));
 SELECT * INTO a FROM public.appointments WHERE id=p_appointment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cita no encontrada'; END IF;
 IF NOT public.agenda_can_manage_appointment(a) THEN RAISE EXCEPTION 'No puedes registrar la asistencia'; END IF;
 IF p_attended IS NULL OR a.status NOT IN ('aceptado','reprogramado','atendido') THEN RAISE EXCEPTION 'Solo se registra asistencia de citas confirmadas'; END IF;
 SELECT coalesce(array_agg(unit_id ORDER BY unit_id),'{}') INTO before_units FROM public.appointment_units WHERE appointment_id=a.id AND visited;
 SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO after_units FROM unnest(coalesce(p_visited_unit_ids,'{}')) x WHERE p_attended;
 IF EXISTS(SELECT 1 FROM unnest(after_units) x WHERE NOT EXISTS(SELECT 1 FROM public.appointment_units WHERE appointment_id=a.id AND unit_id=x)) THEN RAISE EXCEPTION 'Una unidad no pertenece a esta cita'; END IF;
 -- Repeated identical submission is harmless and produces no second audit event.
 IF a.status='atendido' AND a.no_show=NOT p_attended AND coalesce(a.result_notes,'')=coalesce(trim(p_notes),'') AND before_units=after_units THEN RETURN a; END IF;
 IF p_expected_updated_at IS NULL OR a.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'La cita cambió. Actualiza el detalle antes de guardar'; END IF;
 IF a.status='atendido' AND nullif(trim(p_edit_reason),'') IS NULL THEN RAISE EXCEPTION 'Indica el motivo de la edición'; END IF;
 previous:=a;
 SELECT full_name INTO actor_name FROM public.profiles WHERE id=auth.uid();
 UPDATE public.appointments SET status='atendido',no_show=NOT p_attended,result_notes=nullif(trim(p_notes),''),updated_at=greatest(clock_timestamp(),a.updated_at+interval '1 microsecond') WHERE id=a.id RETURNING * INTO a;
 UPDATE public.appointment_units SET visited=(unit_id=ANY(after_units)) WHERE appointment_id=a.id;
 INSERT INTO public.appointment_change_log(appointment_id,actor_id,action,detail)
 VALUES(a.id,auth.uid(),CASE WHEN previous.status='atendido' THEN 'asistencia_editada' WHEN p_attended THEN 'asistio' ELSE 'no_asistio' END,
 jsonb_build_object('previous_status',previous.status,'previous_no_show',previous.no_show,'previous_notes',previous.result_notes,
 'previous_visited_unit_ids',before_units,'status',a.status,'no_show',a.no_show,'notes',a.result_notes,'visited_unit_ids',after_units,
 'edit_reason',nullif(trim(p_edit_reason),''),'actor_name',actor_name));
 RETURN a;
END $fn$;
REVOKE ALL ON FUNCTION public.lv_record_appointment_attendance(uuid,boolean,timestamptz,text,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lv_record_appointment_attendance(uuid,boolean,timestamptz,text,uuid[],text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_appointment_attendance(uuid,boolean,text,uuid[]) FROM authenticated;
NOTIFY pgrst,'reload schema';
