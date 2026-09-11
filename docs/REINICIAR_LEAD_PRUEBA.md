# Reiniciar la conversación del lead de prueba

En SQL Editor de Supabase, con el rol postgres:

```sql
SELECT public.lv_reset_lavilet_test_lead();
```

La función ya está instalada. Solo afecta a 0987110032 (+593987110032), ID de Kommo 2710090, en La Vilet. No admite otro lead por parámetro.

Elimina mensajes y resumen de conversación, datos de calificación y financiamiento de prueba, solicitudes/citas, reservas temporales de agenda, avisos y estados de automatización. Restablece el lead a nuevo/frío, puntuación cero, sin preferencias ni asignación, con el bot habilitado. Mantiene su identidad y conexión con Kommo.

Guarda primero una copia privada en `lv_manual_test_reset_backups`. Los eventos de entrada anteriores se cancelan y pierden su texto, conservando los identificadores necesarios para evitar reprocesarlos si Kommo los reintenta. No cambia el chat ni el contacto de Kommo/WhatsApp, los prompts, el mapa, los asesores ni la configuración global de automatización.

Si el ejecutor está ocupado, espera unos segundos y repite el comando. Si hay un envío incierto, contrato, reserva comercial o venta, la función se detiene sin modificar los datos.

Después, actualiza la interfaz y envía un mensaje nuevo desde el número de prueba. No hace falta desplegar en Vercel para ejecutar este reinicio.

Implementación: `supabase/migrations/20260910193000_manual_test_lead_reset.sql`. Operación lista para copiar: `supabase/operations/reset_test_lead.sql`.
