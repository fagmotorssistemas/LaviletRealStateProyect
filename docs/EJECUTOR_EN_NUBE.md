# Ejecutor automático de La Vilet en la nube

Activado el 9 de septiembre de 2026, hora de Ecuador, después de una llamada de verificación desde Supabase con HTTP 200 y modo `live`. El proceso local `automation-cron.mjs --watch` (PID 48808) fue detenido. El PC, Codex y el navegador ya no disparan las ejecuciones periódicas.

## Recorrido

`Supabase Cron → petición HTTPS autenticada → Vercel /api/integrations/automation/run → cola Supabase → Kommo`.

El trabajo se llama **lavilet-automation-minute**, con horario `* * * * *` (cada minuto). Puede consultarse en **Supabase → Integrations → Cron**, según la navegación del panel, o con el SQL inferior.

La migración crea inicialmente el trabajo desactivado. El secreto se configura mediante `node scripts/configure-cloud-scheduler.mjs`, después se verifica una llamada desde Supabase y finalmente se activa el cron. Esos pasos ya se realizaron en el proyecto `xhjnyntywqhczdtecgim`; no es necesario repetirlos ni desplegar cambios de la aplicación para usar este disparador.

## Base de datos

- Extensiones `pg_cron` y `pg_net` habilitadas. Vault ya estaba instalado.
- Esquema privado `lv_automation_private`, con `scheduler_runs` para el seguimiento técnico de llamadas HTTP.
- `collect_results()` distingue respuesta correcta, HTTP de error, JSON inválido, motor apagado, resultados inciertos y timeout.
- `tick()` recoge resultados y dispara la siguiente ejecución cuando corresponde. Solo acepta como destino `https://www.lavilett.com/api/integrations/automation/run`.
- `public.lv_app_set_scheduler_secret(text)` permite provisionar/rotar exclusivamente el secreto propio, con acceso solo para `service_role`. No admite destinos ni SQL arbitrarios.
- El secreto existente del ejecutor se guarda cifrado en Vault con nombre `lavilet_automation_cron_secret`. Nunca se incluye literalmente en la definición del cron, las migraciones ni este documento.
- Se conservan siete días de los registros HTTP propios y del historial de este trabajo cron. Los eventos de conversación y datos del negocio conservan su funcionamiento anterior.

El `net` instalado por Supabase conserva permisos internos administrados por la plataforma; un `REVOKE` ejecutado como `postgres` no elimina necesariamente concesiones de `supabase_admin`. Se comprobó el aislamiento real de la Data API: consultar `net`, `vault` o `lv_automation_private` con la clave pública devuelve HTTP 406. El RPC de provisión devuelve HTTP 401 al usuario anónimo. No exponer esos esquemas en la Data API. Los administradores de la base conservan su acceso operativo.

## Concurrencia, ritmo y fallos

El disparador evita otra petición mientras la anterior sigue pendiente. Usa timeout HTTP de 240 segundos y detecta una respuesta ausente después de cinco minutos. Ante un error HTTP o de transporte espera cinco minutos antes de volver a disparar el ejecutor. No reenvía por su cuenta mensajes a clientes.

El motor existente mantiene un bloqueo por proyecto y procesa secuencialmente los lotes de conversación y después los avisos de visitas. Agrupa mensajes seguidos del mismo cliente y deduplica identificadores externos. Las llamadas de este motor a Kommo están separadas al menos 400 ms. El ritmo corresponde a solicitudes API, no a una promesa sobre el segundo exacto en que Kommo entregará cada WhatsApp.

Los estados de envío `uncertain` continúan requiriendo conciliación para evitar duplicados. Este cambio de disparador no soluciona por sí solo la recuperación de una conversación incierta ni las diferencias de pausa entre conversación y avisos de citas.

Una respuesta HTTP 200 con `processed:1` puede corresponder solo a mantenimiento. Los registros del cron y las respuestas HTTP prueban que el disparador funciona; no confirman el saldo de OpenAI ni la entrega de un mensaje al cliente. La disponibilidad continua también depende de Supabase, Vercel y los proveedores.

## Supervisión

Estas consultas no disparan mensajes:

```sql
select jobid,jobname,schedule,active
from cron.job
where jobname='lavilet-automation-minute';

select lv_automation_private.collect_results();
select request_id,requested_at,completed_at,status,http_status,
       worker_mode,processed,uncertain_count,reason
from lv_automation_private.scheduler_runs
order by requested_at desc
limit 20;

select d.start_time,d.end_time,d.status
from cron.job_run_details d
join cron.job j on j.jobid=d.jobid
where j.jobname='lavilet-automation-minute'
order by d.start_time desc
limit 20;
```

No consultar ni copiar las cabeceras de `net.http_request_queue`: contienen temporalmente la autorización. Revisar códigos y estados, no secretos.

## Pausa, cambios y reversión

- Para pausar este disparador: ejecutar `supabase/operations/20260910_pause_cloud_scheduler.sql`. Una petición ya iniciada puede terminar; pausar el cron no revierte acciones en curso.
- Para cambiar el secreto: actualizar de forma coordinada el valor del servidor de Vercel y el entorno administrativo local; ejecutar `node scripts/configure-cloud-scheduler.mjs` para actualizar Vault. El script no activa el cron ni envía mensajes.
- Para verificar desde Supabase cuando corresponda activar: `select lv_automation_private.tick();`. Esta llamada **sí ejecuta el motor y puede procesar mensajes pendientes**. Revisar su resultado HTTP antes de ejecutar `supabase/operations/20260910_enable_cloud_scheduler.sql`.
- El modo continuo local contra producción requiere ahora `--allow-production-watch` como medida contra arranques accidentales. Es una herramienta de contingencia; pausar primero el cron de Supabase si se decide usarla.
- No instalar también `docs/vercel-cron.example.json` como otro cron activo para el mismo motor.

No se modificaron el webhook, los prompts ni las tablas de negocio para este traslado. El modo de mantenimiento global continúa dependiendo de la configuración vigente del ejecutor de Vercel.

## Pruebas realizadas

- Prueba SQL transaccional con respuestas HTTP correctas, error 429, contenido inválido, motor apagado, resultados inciertos, timeout, espera ante error y exclusión de peticiones simultáneas. Los datos ficticios se deshicieron con rollback.
- Verificación de permisos de funciones privadas, Vault, RPC administrativo y esquemas no expuestos por la Data API.
- Las 25 pruebas de `npm run test:integrations` pasaron, incluyendo agrupación, duplicados y no reintentar un lanzamiento ambiguo de Kommo.
- Comprobación real Supabase → Vercel, seguida de activación cada minuto. Después de detener el proceso local se verificaron las ejecuciones de las **23:17, 23:18 y 23:19 del 9 de septiembre, hora de Ecuador**: las tres respondieron HTTP 200, modo `live`, un trabajo procesado y cero resultados inciertos. El proceso local estaba ausente y su último registro era de las 23:16:31. Es evidencia de ejecución periódica independiente del PC, no una prueba de entrega de WhatsApp.
- Los avisos de seguridad de Supabase permanecieron en ocho, sin avisos nuevos respecto a la revisión previa.

`supabase/tests/automation_cloud_scheduler.sql` solo se ejecuta con este cron desactivado y usa una transacción que se revierte. No volver a ejecutarla como una tarea periódica.

## Límites de los proveedores

Kommo documenta hasta siete solicitudes API por segundo y respuestas 429 ante exceso; infracciones repetidas pueden ocasionar restricciones. El ritmo de este ejecutor no controla otras integraciones o acciones externas de la misma cuenta: [límites oficiales](https://developers.kommo.com/docs/limitations).

Una cola y un límite de velocidad no garantizan evitar restricciones de Meta. También cuentan la autorización del destinatario, las bajas, la calidad del contenido y las reglas de plantillas. Fuera de la ventana de atención de 24 horas, la política exige plantillas aprobadas: [política oficial de WhatsApp Business](https://whatsappbusiness.com/policy/).

La recopilación financiera actual pide cédula por chat. Esa política también prohíbe solicitar identificadores personales completos por WhatsApp; ese paso necesita trasladarse a un formulario seguro en un cambio específico. No se modificó el flujo financiero en este traslado del disparador.

Referencias de infraestructura: [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [Vault](https://supabase.com/docs/guides/database/vault).
