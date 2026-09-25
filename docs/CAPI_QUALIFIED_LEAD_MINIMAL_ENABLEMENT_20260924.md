# Habilitación mínima y aislada de un caso QualifiedLead

Preparado localmente. No aplicado. Este procedimiento no autoriza despliegues,
migraciones, cambios de flags, webhooks ni envíos a Meta.

## Barreras añadidas

- Nest acepta `META_WA_CLOUD_ALLOWED_WA_ID_SHA256`. Cuando está definido, valida
  todos los mensajes del lote antes de escribir SQLite o Supabase y devuelve 403 si
  algún WA ID no coincide. Solo guarda el hash; no registra el número.
- El receptor Kommo acepta `KOMMO_WEBHOOK_ALLOWED_CONTACT_ID`. Cuando está definido,
  devuelve 200 filtrado antes de cualquier RPC si el lote está vacío, mezclado o
  pertenece a otro contacto.
- Ninguna barrera cambia puntuaciones, temperaturas, consentimiento, bots o n8n.
  Ambas están inactivas si la variable correspondiente está vacía.

## Precondiciones obligatorias

1. Registrar conteos y huellas con las consultas de solo lectura existentes.
2. Confirmar privadamente que el WA ID de la persona de prueba corresponde de forma
   única al `test_lead_id` y al contacto autorizado. Calcular SHA-256 fuera de logs.
3. Mantener en Nest:
   `META_MODE=disabled`, `SUPABASE_DRAIN_ENABLED=false`, todos los flags CAPI en
   `false`, y configurar el hash allowlist antes de habilitar recepción Cloud.
4. Mantener respuestas automáticas bloqueadas durante toda la ventana:
   `lv_auto_config.enabled=false` o `dry_run=true`. Releerlo después del cambio.
   No basta `test_only=true`.
5. Desplegar el receptor Kommo en una instancia/Preview aislada con
   `KOMMO_WEBHOOK_ALLOWED_CONTACT_ID=<contacto de prueba>`. Solo esa instancia usa
   `AUTOMATION_MODE=live` para persistir el mensaje; no se despierta ningún worker
   mientras el gate DB anterior esté bloqueado. n8n productivo no se modifica.

Si no se pueden acreditar simultáneamente los puntos 2–5, detenerse: no hay
aislamiento suficiente para conectar webhooks productivos.

## Migraciones: aplicación explícita y sin históricos

Aplicar una por una, en transacción, sin `db push` general:

1. `20260923205830_disable_destructive_contact_resets.sql`.
2. `20260923211512_interest_evaluation_evidence.sql`.
3. `20260923174920_kommo_message_evidence.sql`.
4. `20260924213000_hot_lead_capi_signal_staging.sql`.
5. `20260924214000_enable_crm_qualified_lead_outbox.sql`.

La instalación no llama evaluadores ni recorre mensajes anteriores. La quinta
migración crea `meta_capi_signal_activation` con `enabled=false`; no modificar esa
fila durante esta prueba. El test contact queda `excluded`, por lo que se crea el
intent auditable pero nunca una fila entregable a CAPI.

## Recorrido autorizado futuro

1. Activar exclusivamente la recepción Cloud en Nest con WABA/phone comprobados,
   allowlist SHA-256 presente y reconciliador limitado a la ventana.
2. La persona de prueba pulsa un anuncio nuevo Click-to-WhatsApp y envía un mensaje
   nuevo, explícito y suficiente para una regla existente.
3. Nest conserva el CTWA original y solo lo vincula si encuentra exactamente un lead.
4. El webhook Kommo aislado acepta exclusivamente el mismo contacto y guarda el
   mensaje original con su ID y `sent_at`. No responde porque el gate DB está apagado.
5. El intérprete existente determina los eventos reconocidos. Un operador autorizado
   invoca una sola vez
   `lv_evaluate_message_interest(test_lead_id, eventos_reconocidos, source_message_id)`.
   No introducir eventos manuales que el mensaje no pruebe.
6. La función usa las reglas actuales, guarda `source_sent_at`, `evaluated_at`, score
   y temperatura resultantes. El trigger crea el primer intent tibio/caliente con:
   - `event_id DEFAULT gen_random_uuid()` al insertar el intent;
   - `event_time=floor(epoch(evaluated_at))`;
   - `idempotency_key=wa_crm_qualified:{lead_id}`;
   - CTWA de la primera atribución real del mismo contacto.
7. Leer el intent y comprobar que `status=excluded`, motivo `test_contact`, misma
   evaluación/contacto/atribución y ausencia de outbox `QualifiedLead`.

No se exige un `event_id` anterior: la identidad original nace atómicamente con el
intent. Un reintento encuentra las restricciones UNIQUE y no genera otra identidad.

## Detención

1. Deshabilitar recepción Cloud y detener la instancia Kommo aislada.
2. Mantener CAPI disabled y la activación DB en false.
3. Conservar SQLite, evidencia, evaluación e intent; no borrar para repetir.
4. Comparar conteos: exactamente un contacto, una atribución, una evaluación y un
   intent nuevos; cero respuestas, cero filas CAPI pending y cero eventos Meta.
5. Restaurar automatización solo mediante una autorización distinta, después de
   retirar ambos allowlists o mantenerlos según la decisión operativa.

## Puente controlado desde `excluded/test_contact` a Meta Test Events

El intent de prueba permanece `excluded` en Supabase y no se actualiza ni se copia a
`meta_capi_outbox`. Un operador con lectura de servicio obtiene una sola vez su
snapshot y lo entrega por `POST /v1/events` a una instancia Nest temporal. El body
conserva literalmente `event_id`, `event_time`, `idempotency_key`, `ctwa_clid`,
lead/contact/scope, temperatura y motivos del intent. La instancia usa SQLite nuevo,
`delivery_lane=test` y no tiene conexión Supabase. Así, la prueba no crea un camino
que pueda promover el contacto de prueba en producción.

La instancia temporal debe tener exclusivamente:

- `META_MODE=test`, `META_TEST_EVENT_CODE=TEST38237`, `OUTBOX_ENABLED=true` y
  `META_WA_CRM_QUALIFICATION_DELIVERY_ENABLED=true`;
- WABA, dataset y token de mensajería del activo acordado;
- Schedule, LeadSubmitted y Purchase apagados; drain Supabase, webhooks Cloud,
  reconciliador CTWA y token/dataset web ausentes o apagados;
- SQLite/volumen, secreto interno, hostname y puerto propios.

Antes de arrancarla se vuelve a abrir Events Manager para comprobar que el código
mostrado para el dataset sigue siendo `TEST38237`. No existe una comprobación local
ni una consulta Graph sin envío que pruebe la vigencia del código. Si la pantalla
muestra otro código, se detiene el procedimiento y se actualiza solo la instancia
temporal; producción no recibe `META_TEST_EVENT_CODE`.

Tras el POST se consulta `GET /v1/events/{event_id}` hasta un estado terminal. Solo
se considera recibido si Graph informa `events_received >= 1`, el GET devuelve
`delivery_outcome=meta_accepted` y Events Manager muestra el mismo `event_id`. No se
repite el POST salvo fallo de transporte sin respuesta; el retry conserva el mismo
body e identidad. Después se apaga primero el flag QualifiedLead y luego
`META_MODE`, se detiene la instancia y se conserva su SQLite.

## Webhooks paralelos sin reemplazar producción

- WhatsApp Cloud: usar una segunda app Meta temporal, con callback y verify token
  propios, y suscribir esa app adicional al mismo WABA. Antes y después se lista
  `/{WABA_ID}/subscribed_apps`; la app productiva debe seguir presente. No se edita
  su callback. Si Meta no permite mantener ambas apps en ese WABA, se cancela esta
  vía: no se reemplaza el callback actual ni se introduce un proxy productivo.
- Kommo: añadir un webhook adicional para mensajes entrantes apuntando a la Preview
  aislada. Kommo admite varios webhooks por cuenta. El existente se deja intacto y
  el nuevo aplica `KOMMO_WEBHOOK_ALLOWED_CONTACT_ID` antes de escribir. Como Kommo
  enviará también notificaciones de otros contactos, esas peticiones reciben 200
  filtrado y producción continúa recibiéndolas por su webhook actual.

## Cambios remotos futuros y reversión

1. Aplicar las cinco migraciones enumeradas arriba, una por una. Reversión operativa:
   mantener activación false; la reversión de esquema se hará solo con una migración
   posterior, nunca borrando evidencia o historia de migraciones.
2. Desplegar las dos barreras de allowlist. Reversión: retirar las instancias
   temporales; las variables vacías dejan el código inactivo.
3. Crear la app/callback Meta temporal y el webhook Kommo adicional. Reversión:
   desuscribir únicamente la app temporal y borrar únicamente el webhook Kommo por
   su ID/destination, comprobando que los callbacks productivos siguen registrados.
4. Cambiar temporalmente `lv_auto_config` a `enabled=false` o `dry_run=true` para
   impedir respuestas. Reversión: restaurar exactamente el snapshot anterior tras
   detener receptores y comprobar colas; no inferir los valores.
5. Ejecutar el único POST desde el intent excluido a la instancia Nest aislada.
   Reversión: no existe borrado ni reenvío; se apaga y conserva la SQLite como
   evidencia. Supabase y producción conservan el intent `excluded/test_contact`.

## Evidencia del servidor antes de preparar la instancia aislada

Comprobado por el operador desde la consola de DigitalOcean el 24/09/2026:

- checkout desplegado en `6b4e8c2c05bfecbfdabd2e51b16b07835bb7280d`;
- contenedor productivo saludable;
- `/data` está montado en el volumen persistente
  `lavilet-capi_lavilet_capi_data`;
- la imagen desplegada no contiene etiqueta de revisión Git;
- existen `docker-compose.override.yml` sin seguimiento y dos respaldos `.env.bak`;
  deben conservarse y quedar fuera de commits, copias o modificaciones durante la
  preparación aislada.

Detalle verificado posteriormente con inventario redactado:

- imagen productiva `sha256:e50163d218fafe76dd1182b7a621fed64906358d4ca8e68a5694522cbf4dfee3`,
  creada el 22/09/2026 22:01 UTC, sin etiqueta de revisión;
- contenedor sin reinicios, saludable y publicado solo en `127.0.0.1:3010`;
- el override contiene únicamente valores para
  `META_SCHEDULE_DELIVERY_ENABLED` y `META_SCHEDULE_RECOVER_ENABLED`;
- SQLite está activa en WAL (`.db`, `.db-wal`, `.db-shm`), por lo que cualquier
  respaldo consistente deberá hacerse con la API de backup de SQLite o tras una
  parada autorizada, nunca copiando solo el archivo `.db` en caliente;
- además del volumen productivo existe `lavilet-meta-capi_lavilet_capi_data`, cuyo
  origen y contenido deben revisarse sin montarlo en la futura instancia;
- están libres recursos suficientes en disco; la instancia aislada deberá usar un
  proyecto Compose, puerto loopback y volumen nuevos.

El operador confirmó después que la instancia candidata quedó operativa en
`127.0.0.1:3011`, con proyecto Compose, imagen y volumen SQLite independientes,
arrancada con `META_MODE=disabled`, drain/outbox/webhooks/reconciliación CTWA y todos
los consumidores apagados. No se modificó el contenedor productivo ni se enviaron
eventos a Meta.
