# Reiniciar las conversaciones de prueba

## Nataly Caballero

**Si aparece «function does not exist»**, copiar **TODO** el contenido de
[`reset_nataly_test_lead.sql`](../supabase/operations/reset_nataly_test_lead.sql) en SQL Editor con rol postgres y pulsar Run.
Ese archivo instala las funciones y ejecuta el reinicio de Nataly en una sola transacción.
Si el ejecutor está ocupado, esperar unos segundos y volver a ejecutar el archivo completo.
No basta con copiar el SELECT cuando la función todavía no existe.

Para instalar las funciones sin reiniciar conversaciones, se puede usar la alternativa siguiente:

Primero, copiar y ejecutar una vez en SQL Editor de Supabase, con rol postgres, todo el archivo
[`20260914170000_manual_test_contacts_reset.sql`](../supabase/migrations/20260914170000_manual_test_contacts_reset.sql).
Esta instalación **está preparada, pendiente de ejecutar en Supabase**. Instalarla no reinicia ninguna conversación.

Después, para reiniciar únicamente a Nataly (Kommo **3928256**):

```sql
SELECT public.lv_reset_lavilet_nataly_lead();
```

La identidad se comprueba por UUID, teléfono, ID de Kommo, proyecto y organización. No se busca ni se borra por coincidencias de nombre.
Limpia el contexto y los mensajes de la plataforma, citas de prueba y seguimientos pendientes, incluido el mensaje de nutrición de 24 horas.
Mantiene a los demás leads. Guarda un respaldo privado antes de hacer cambios.
No elimina las burbujas del chat de Kommo ni de WhatsApp.

Nataly no tiene activado DETENER IA en la comprobación del 14 de septiembre. Si se activa más adelante,
después del reinicio se puede revisar y liberar solo ese bloqueo desde PowerShell en `frontend`:

```powershell
node scripts/resume-test-lead.cjs --lead=nataly
node scripts/resume-test-lead.cjs --lead=nataly --apply
```

La primera ejecución solo revisa; la segunda desactiva DETENER IA si hace falta. Ninguna envía mensajes.
Después del reinicio, enviar un saludo nuevo por WhatsApp. Los mensajes antiguos no se vuelven a procesar.

## Carlos

En SQL Editor de Supabase, con el rol postgres:

```sql
SELECT public.lv_reset_lavilet_test_lead();
```

La función original ya está instalada. Solo afecta a 0987110032 (+593987110032), ID de Kommo 2710090, en La Vilet. No admite otro lead por parámetro.
La nueva instalación mantiene este mismo comando y añade la limpieza de nutrición de 24 horas y de borradores de visitas.

Elimina mensajes y resumen de conversación, datos de calificación y financiamiento de prueba, solicitudes/citas, reservas temporales de agenda, avisos y estados de automatización. Restablece el lead a nuevo/frío, puntuación cero, sin preferencias ni asignación, con el bot habilitado. Mantiene su identidad y conexión con Kommo.

Guarda primero una copia privada en `lv_manual_test_reset_backups`. Los eventos de entrada anteriores se cancelan y pierden su texto, conservando los identificadores necesarios para evitar reprocesarlos si Kommo los reintenta. No cambia el chat ni el contacto de Kommo/WhatsApp, los prompts, el mapa, los asesores ni la configuración global de automatización.

Si el ejecutor está ocupado, espera unos segundos y repite el comando. Si hay un envío incierto, contrato, reserva comercial o venta, la función se detiene sin modificar los datos.

Después, actualiza la interfaz y envía un mensaje nuevo desde el número de prueba. No hace falta desplegar en Vercel para ejecutar este reinicio.

Implementación: `supabase/migrations/20260910193000_manual_test_lead_reset.sql`. Operación lista para copiar: `supabase/operations/reset_test_lead.sql`.

## Validación del script

La migración nueva se ha ejecutado en PostgreSQL aislado con pruebas de instalación sin borrado, permisos,
identidades incorrectas, envíos en curso, contratos/reservas/ventas, respaldo, aislamiento entre leads,
cancelación de seguimientos y deduplicación de mensajes antiguos:

```powershell
node --test scripts/manual-test-lead-reset.test.cjs
```

El ejecutor de pruebas utiliza la instalación local de PGlite en `tmp/integration-sql-tests`, igual que `integrations-sql.test.cjs`.
Los fixtures contienen únicamente la estructura de las tablas, sin conversaciones de clientes.
