-- Ejecutar en SQL Editor de Supabase (rol postgres).
-- Reinicia únicamente el contacto de prueba 0987110032 / Kommo 2710090 en La Vilet.
-- Limpia conversación, contexto, preferencias, calificación, citas y colas del sistema.
-- Conserva la identidad del lead y un respaldo privado. No elimina el chat de Kommo/WhatsApp.
-- Si el ejecutor está trabajando, esperar unos segundos y repetir el mismo comando.
SELECT public.lv_reset_lavilet_test_lead();
