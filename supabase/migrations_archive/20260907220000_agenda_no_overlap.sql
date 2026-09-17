-- Exclusión gist de solapes. NO modifica citas existentes.
-- No aplicar si lv_appointment_overlap_blockers() devuelve filas.
-- No aplicar en producción desde el agente.
-- Esta migración se DETIENE con EXCEPTION si hay bloqueadores.
-- No hay WHEN OTHERS: un fallo deja el archivo sin aplicar (transacción de supabase db push).

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
DECLARE
  n integer;
  sample text;
BEGIN
  SELECT count(*) INTO n FROM public.lv_appointment_overlap_blockers();
  IF n > 0 THEN
    SELECT string_agg(appointment_id_a::text || ' / ' || appointment_id_b::text, ', ')
      INTO sample
    FROM (
      SELECT appointment_id_a, appointment_id_b
      FROM public.lv_appointment_overlap_blockers()
      LIMIT 5
    ) s;
    RAISE EXCEPTION
      'Hay % pares de citas solapadas. No se instala appointments_responsible_no_overlap. No se modificó ninguna cita. Consulta public.lv_appointment_overlap_blockers(). Ejemplos: %',
      n, sample;
  END IF;

  ALTER TABLE public.appointments
    ADD CONSTRAINT appointments_responsible_no_overlap
    EXCLUDE USING gist (
      responsible_id WITH =,
      tstzrange(start_time, end_time, '[)') WITH &&
    )
    WHERE (
      responsible_id IS NOT NULL
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND status IN ('pendiente', 'aceptado', 'reprogramado')
    );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
