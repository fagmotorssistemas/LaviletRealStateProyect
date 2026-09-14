-- Primero instalar supabase/migrations/20260914170000_manual_test_contacts_reset.sql.
-- Ejecutar en SQL Editor de Supabase con rol postgres.
-- Solo Nataly Caballero, Kommo 3928256, en La Vilet.
-- Limpia el contexto del bot, mensajes, citas de prueba y seguimientos pendientes.
-- Conserva su identidad y un respaldo privado; no borra el chat de Kommo/WhatsApp.
-- Si el ejecutor está ocupado, esperar unos segundos y repetir esta consulta.
SELECT public.lv_reset_lavilet_nataly_lead();
