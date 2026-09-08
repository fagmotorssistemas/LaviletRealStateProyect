-- Diagnóstico de solapes. Solo lectura. No cancela, no reasigna, no cambia horarios.
-- La restricción appointments_responsible_no_overlap (EXCLUDE gist sobre
-- tstzrange(start_time, end_time, '[)') WHERE status IN pendiente|aceptado|reprogramado)
-- falla mientras existan estas filas.

SELECT a.id AS appointment_id_a,
       b.id AS appointment_id_b,
       a.responsible_id,
       a.status AS status_a,
       b.status AS status_b,
       a.start_time AS start_a,
       a.end_time AS end_a,
       b.start_time AS start_b,
       b.end_time AS end_b,
       a.start_time AT TIME ZONE 'America/Guayaquil' AS start_a_gye,
       b.start_time AT TIME ZONE 'America/Guayaquil' AS start_b_gye
FROM public.appointments a
JOIN public.appointments b
  ON a.responsible_id = b.responsible_id
 AND a.id < b.id
 AND a.responsible_id IS NOT NULL
 AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
 AND b.start_time IS NOT NULL AND b.end_time IS NOT NULL
 AND a.status IN ('pendiente', 'aceptado', 'reprogramado')
 AND b.status IN ('pendiente', 'aceptado', 'reprogramado')
 AND tstzrange(a.start_time, a.end_time, '[)') && tstzrange(b.start_time, b.end_time, '[)')
ORDER BY a.responsible_id, a.start_time;

-- Tras aplicar 20260907210000:
-- SELECT * FROM public.lv_appointment_overlap_blockers();
