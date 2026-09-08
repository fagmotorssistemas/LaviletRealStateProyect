-- Reversión de 20260907220000. No toca citas.

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_responsible_no_overlap;
