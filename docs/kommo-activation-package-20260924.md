# Paquete único de activación Kommo — pendiente de aprobación

Preparado el 24/09/2026 en main. No aplicado. Ningún webhook, secreto, bot,
histórico, consentimiento ni envío CAPI fue modificado. No requiere cambios visuales.
Reemplaza el orden de la propuesta anterior: evaluación ANTES de restaurar recepción.

## Alcance y condición de aprobación

Producción identificada en la auditoría previa: commit
`65546d5f62ab9bd460bdb91f7b9a94db69c9867b`, despliegue
`dpl_4oFCGqXRS6ucrywynkeVZp7BPwNd`, dominio `www.lavilett.com`.
Base: `xhjnyntywqhczdtecgim`; Kommo: `36919007`, `lavilet.kommo.com`.

La aprobación debe distinguir dos recorridos:

1. **Observador nuevo:** POST `/api/integrations/kommo/observe` autentica,
   normaliza y llama exclusivamente `lv_record_message_evidence`. No crea fichas,
   mensajes en `messages`, trabajo en `lv_integration_events`, seguimientos ni eventos Meta.
   Guarda entrantes y salientes en un diario compartido con el receptor actual.
2. **Receptor existente:** al recuperar `lv_receive_kommo_observation`, vuelve a
   guardar evidencia y, si `automationSettings().live` es verdadero, encola el
   procesamiento existente. Este puede crear/actualizar fichas, mensajes y atribución;
   para la persona de pruebas puede responder. Fuera de esa persona, aunque no
   responda, el código existente puede modificar el campo de parada de Kommo y
   evaluar/encolar/remitir LeadSubmitted conforme a sus reglas actuales.

Por tanto **restaurar el receptor actual no equivale a activar solo observación**.
No se cambia CAPI en este paquete, pero tampoco se garantiza ausencia de sus efectos
preexistentes al reanudar el procesamiento. Si se exige cero efectos comerciales
durante la primera fase, detener antes de la tercera migración: hace falta aprobar
una pausa de los ejecutores actuales y comprobarla en su alojamiento. No se cambia
AUTOMATION_MODE ni la configuración por iniciativa del agente. Apagar solo una
función Vercel no acredita que no haya otro worker activo. n8n permanece intacto.

## Restricción real del CRM (independiente de n8n)

Lectura SQL de esta revisión: `enabled=true`, `dry_run=false`, `test_only=true`,
`cooling_enabled=false`, `test_lead_id=52fa6e93-4bd4-42ad-963a-666e9c7902a7`.
Corresponde a **Carlos Fabián**, ficha **4454162**, contacto **9432278**,
`bot_enabled=true`. No es Pablo. Esto no certifica que Carlos sea interno ni
identifica la persona admitida por n8n.

- `data.ts/permitted` exige mismo negocio/proyecto y la ficha de `test_lead_id`.
  Un AUTOMATION_TEST_LEAD_ID adicional solo restringe más: no anula test_only.
- `conversation.ts` registra el entrante antes del filtro y retorna para otras fichas.
  Relee lead/config y comprueba `permitted` inmediatamente antes del envío.
- Recuperación de generación, visitas y nutrición usan también esa barrera;
  las semanas posteriores reutilizan el contexto validado de semana uno.
- `worker.ts` exige modo live y la condición de propiedad de la automatización;
  mantenimiento global tiene además barreras de modo de prueba.
- Las tres migraciones NO modifican `lv_auto_config`, `bot_enabled`, rutas de bots,
  cron, activación ni el filtro de n8n.

Se confirma la restricción en datos y código del CRM; queda por verificar la
configuración efectiva del ejecutor desplegado. No se afirma control de todos los
bots de Kommo/n8n desde la base del CRM.

## Tres migraciones completas revisadas y orden obligatorio

No ejecutar `db push` ni toda la carpeta: hay migraciones históricas con versiones
distintas. Aplicar solo estos archivos y detenerse ante cualquier error.
No ejecutar funciones de ingreso, evaluación o recuperación para probar producción.

| Orden | Archivo en supabase/migrations | Efecto y dependencias |
| --- | --- | --- |
| 1 | `20260923205830_disable_destructive_contact_resets.sql` | Sustituye los cinco reinicios por rechazo y revoca EXECUTE. Crea `lv_preserve_reset_backups` y triggers que impiden UPDATE/DELETE/TRUNCATE en ambas tablas de respaldos. No borra filas. Incluye transacción explícita. |
| 2 | `20260923211512_interest_evaluation_evidence.sql` | Crea `lead_interest_evaluations`, `lv_evaluate_message_interest(uuid,jsonb,text)` y bloquea el escritor antiguo `lv3_store_cooling(jsonb)`. Depende de leads/messages/conversations, reglas, configuración del proyecto, `apply_lead_events` y su dependencia `set_lead_stage`. Instalar no evalúa históricos. |
| 3 | `20260923174920_kommo_message_evidence.sql` | Crea `kommo_message_evidence`, `crm_contact_classifications`, `classify_crm_contact`, `lv_record_message_evidence` y `lv_receive_kommo_observation`. Depende de tenants/projects/leads y los receptores existentes `lv_app_receive(jsonb)` / `lv_app_receive_advisor_outbound(jsonb)`. Su finalización puede restaurar el receptor publicado inmediatamente. |

Usar ejecución transaccional por migración y registrar cada una en el historial.
Las migraciones 2 y 3 no llevan BEGIN/COMMIT propios: no ejecutar sus sentencias
sueltas en autocommit. No abrir tráfico nuevo entre creación de objetos y revocaciones.
Si el ejecutor elegido no garantiza atomicidad, envolver cada una en una transacción.
La primera ya contiene BEGIN/COMMIT; no concatenar las tres bajo otro BEGIN.

Dependencias comprobadas por SELECT en producción: las once tablas base requeridas,
ambos receptores, `apply_lead_events`, `set_lead_stage`, `lv3_store_cooling` y
`register_inbound_message` existen; service_role puede ejecutar las funciones revisadas.
Los receptores se limitan a insertar eventos con `ON CONFLICT(project_id,event_key)`.
No hay triggers de usuario en messages/conversations/lv_integration_events;
leads tiene actualización de fecha y notificación de asignación preexistentes.

La evaluación conserva reglas y puntuaciones. Al ejecutarse con señales válidas,
`apply_lead_events` también puede actualizar etapa comercial: es comportamiento
existente, no una acción del observador. Sin texto/transcripción verificable no se
evalúa el audio. Instalar estas funciones no completa evaluaciones de otras personas:
el flujo comercial conserva su gate de prueba. Los ocho de Tarqui no pasan a
“Frío evaluado” ni a “Sin responder” por instalar el paquete.

## Permisos previstos y verificación posterior

Ejecutar `operations/verify_kommo_activation_readonly.sql` antes y después.
Antes son esperables objetos nuevos ausentes; después todos los controles `ok`
deben ser verdaderos y las consultas esperadas deben devolver sus filas.

| Objeto | anon / authenticated | service_role |
| --- | --- | --- |
| kommo_message_evidence, RLS activo | Sin permisos | SELECT, INSERT |
| crm_contact_classifications, RLS activo | Sin permisos | SELECT; altas solo por RPC auditada |
| lead_interest_evaluations, RLS activo | Sin permisos | SELECT; altas/evaluación solo por RPC |
| Cuatro funciones nuevas | Sin EXECUTE | EXECUTE |
| Cinco reinicios y lv3_store_cooling | Sin EXECUTE | Sin EXECUTE |

`lv_record_message_evidence` y el receptor transaccional son SECURITY INVOKER.
Clasificación y evaluación son SECURITY DEFINER, con revocación de acceso público
y validación de ámbito. No instalar triggers en las tres tablas nuevas.
Los índices únicos del diario y la evaluación deben existir.

Base de conservación de `lv_manual_test_reset_backups`:
**116 filas**, última captura `2026-09-23T20:41:25.120176Z`, huella
`11903d4f433afecc120a4deaaa8fef23` (ID y hash de snapshot, consulta incluida).
Capturar también conteo/huella de `lv_test_backups` inmediatamente antes y comparar
después. Si hay diferencia, detener y explicar; no borrar nuevas filas para forzar
una coincidencia. Verificar ambas protecciones sin probar DELETE ni un reinicio remoto.
La revisión del 24/09 a las 14:11:59 UTC confirmó otra vez los 116 y la misma huella;
`lv_test_backups` está vacía (0 filas, huella NULL). Las once consultas del archivo
de verificación se ejecutaron correctamente en modo lectura; los controles de
objetos nuevos y protecciones siguen negativos, como corresponde a migraciones no aplicadas.

## Pantallas exactas de Vercel que falta revisar

1. Abrir https://vercel.com/ksinuevos-projects/lavilet/4oFCGqXRS6ucrywynkeVZp7BPwNd .
   Confirmar Production, Ready, dominio www.lavilett.com y commit 65546d5.
2. Proyecto **lavilet → Settings → Environment Variables** (o Environment Variables
   en el menú lateral), filtro **Production**. Comprobar privadamente:
   - NEXT_PUBLIC_SUPABASE_URL apunta al proyecto indicado.
   - SUPABASE_SERVICE_ROLE_KEY presente, de ese mismo proyecto, solo servidor.
   - KOMMO_WEBHOOK_SECRET presente, no vacío, longitud >=32, correspondiente al
     secreto del receptor existente. No cambiarlo ni copiar su valor al chat.
   - AUTOMATION_MODE; AUTOMATION_N8N_DISABLED; AUTOMATION_ACTIVATED_AT;
     AUTOMATION_TEST_LEAD_ID; AUTOMATION_GLOBAL_MAINTENANCE. Comunicar solo estos
     ajustes no secretos. Si testLeadId está definido, debe coincidir con la ficha
     autorizada; si no coincide, detener y resolver la discrepancia, no ampliarlo.
   - No poner AUTOMATION_N8N_DISABLED=true para superar un bloqueo: n8n está activo.
     Ese indicador y la propiedad real de los envíos requieren aclaración si discrepan.
3. La lista de variables actuales NO prueba qué recibió un despliegue anterior.
   Confirmar que estaban configuradas al publicarlo; si se cambiaron después,
   comunicar fechas. Cambiarlas requiere otro despliegue, no incluido automáticamente.
4. Proyecto **Logs**, filtrar Production, este despliegue y ruta
   `/api/integrations/kommo/webhook`, desde su publicación. Buscar
   `kommo_observation_persist_failed` y HTTP 401/503. Después de activar, revisar
   `/api/integrations/kommo/observe`: `kommo_observer_stored` y
   `kommo_observer_storage_failed`. Anotar hora, código y conteos; omitir query `key`,
   Authorization, cuerpos, URLs de adjuntos y valores de variables en capturas.

No tengo acceso a esas pantallas/logs. Supabase logs devolvió Insufficient scope en
la auditoría previa. No se necesita regenerar el token de Kommo ni repetir el
endpoint de historial que devuelve 403.

## Registro independiente (solo después de aprobación y verificaciones)

Destino previsto AHORA: producción ya publicada,
`https://www.lavilett.com/api/integrations/kommo/observe`. Ya no es el Preview aún
no creado de la propuesta anterior. No hace falta otro despliegue si las variables
efectivas son correctas y el código continúa siendo el revisado.

Con administrador de Kommo, preparar una tercera suscripción a
`POST /api/v4/webhooks`, con `settings: ["add_message","add_outgoing_message"]`.
El destino completo se construye privadamente con el parámetro `key` del secreto
existente; nunca guardarlo en este documento, historial de comandos ni logs.
No asumir que Kommo permite agregar encabezados HTTP arbitrarios desde su interfaz.
El token API administra la suscripción; no sustituye la autenticación del receptor.

Antes: GET de webhooks y comparar en memoria las dos suscripciones existentes,
incluido el destino completo sin imprimirlo. Deben permanecer:
47472151 → www.lavilett.com/api/integrations/kommo/webhook;
47464183 → n8n.ksinuevos.com/webhook/lavilet-chat; ambas add_message, habilitadas.
Si el observador ya existe, detener y revisar, no crearlo dos veces.
Después: GET, guardar solo nuevo ID, ruta sin query, settings y disabled=false;
confirmar que las dos anteriores no cambiaron. Si 401/403/422, registrar código y
error sanitizado; no reemplazar WhatsApp ni modificar permisos por otra vía.

## Recepción pasiva, deduplicación y criterios de aceptación

No generar mensajes ni llamar RPCs de ingreso. Esperar actividad real normal y
registrar una ventana de observación explícita. Si no ocurre audio o Salesbot,
marcar ese tipo como no comprobado, no como fallo ni éxito.

- Correlacionar ID original, cuenta, contacto/ficha, chat/talk, dirección, autor,
  tipo, estado, sent_at y observed_at entre Kommo y el diario. Usar logs sanitizados
  y consultas de `operations/verify_kommo_transport_readonly.sql` con alcance acordado.
- El observador no crea personas ni duplica `messages`; registra solo el diario.
  El receptor normal puede insertar el mismo entrante en su cola una vez. Ambos
  escriben el diario con la misma clave; reintentos iguales no vuelven a insertarlo.
  Estados de entrega diferentes se conservan como observaciones del mismo mensaje;
  el lector deduplica por ficha/dirección/ID externo. No exigir igual número de filas
  de observaciones y mensajes únicos.
- Una identidad conflictiva queda sin ficha vinculada. No resolverla por nombre,
  teléfono parecido ni asignación automática de históricos. Un evento anterior a
  la ficha puede vincularse en lectura solo con las relaciones originales únicas.
- Primera respuesta: envío posterior al entrante de referencia del anuncio, misma
  conversación; bot o asesor, texto o multimedia. Fallido/pendiente/generado no cuenta.
  Para adquisición, primer origen publicitario guardado y una persona única.
- Comparar diario → servicio de evidencia → detalle CRM/campaña. No afirmar éxito
  del panel por un SQL correcto. Falta de historial no demuestra ausencia de respuesta.
  `coverage.kommo=false` sigue impidiendo negativos concluyentes: este paquete no
  añade una certificación de historia completa ni rellena los ocho históricos.
- Medir sent_at→observed_at y hora de primera aparición en consulta. La consulta y
  el refresco de 60 segundos no son una sincronización. No ejecutar la página de
  métricas como prueba de lectura pura si su consulta refresca cachés remotas.
- Si hay error de ingreso, transacción completa revierte y HTTP devuelve 503.
  Un 503 no garantiza reintento; observar entregas reales, marcar huecos y no
  recuperar/reencolar antiguos sin autorización. Un commit con respuesta perdida
  puede reintentarse sin duplicar entradas; no garantiza entrega exactamente una vez
  de servicios externos del procesamiento comercial.

Después de esa observación se acuerda la prueba activa de texto y audio. Pablo
4453096/contacto 9431328 está confirmado interno, pero no es la persona de prueba
del CRM y no conocemos el filtro n8n. Elegir y clasificar persistentemente la persona
antes de enviar; crear las tablas NO registra por sí solo esa clasificación.
No enviar nada por iniciativa del agente ni inventar un anuncio para la prueba.

## Detención conservando datos

Si falla el observador: detener nuevas altas, registrar intervalo y nuevo ID;
deshabilitar solo esa tercera suscripción desde Kommo, si la interfaz lo permite,
o usar DELETE `/api/v4/webhooks` con SU destino exacto conservado privadamente.
La API elimina por destino, no por ID: verificar host/ruta `/observe` antes de la
operación. Volver a listar y confirmar que 47472151 y 47464183 siguen intactos.
Esta detención remota también requiere autorización; puede incluirse expresamente
en la aprobación del paquete. No rotar el secreto compartido ni bloquear ambos receptores.

Conservar diario, clasificaciones, evaluaciones y respaldos. No aplicar down migrations,
no restaurar reinicios destructivos ni borrar filas para reintentar. Las peticiones
ya en vuelo pueden terminar después de retirar la suscripción: registrar esa cola final.
Detener el observador NO detiene el receptor original ni sus workers/n8n/CAPI.
Una avería del receptor original exige una decisión de contención distinta.

## CAPI separado y límites de validación

No hay acceso autorizado disponible al runtime Nest ni a su configuración. No se
ejecutan `/api/meta/sync-nest-results` ni `nest-lookup-sync`: aunque parte del flujo
use GET, persisten resultados. No reenviar, promover test→live ni modificar consentimiento.
Con acceso de lectura se revisarán `/api/health` y GET `/api/v1/events/:eventId`
para eventos YA existentes, sin persistir cambios desde esta revisión. Comprobar en
Vercel presencia efectiva de META_CAPI_BACKEND_URL (o LA_VILET_CAPI_URL),
META_CAPI_INTERNAL_SECRET y CRON_SECRET, sin revelar valores; en Nest, proceso,
revisión y flags efectivos. La evidencia SQL de la auditoría anterior no certifica
que el servicio esté sano ahora.

Validación de esta preparación: 6 pruebas aisladas de migraciones/receptores y
3 pruebas simuladas de guardado fuera del test_only pasaron. Comprueban ACL,
respaldo inmutable, rollback por fallos de evidencia/cola, reintento tras commit,
observador paralelo y ausencia de respuesta fuera de la persona autorizada.
No sustituyen la prueba de entrega real de Kommo. Los archivos de migración no
se modificaron; manifest.json fija sus hashes y orden para revisión.

Fuentes oficiales para las operaciones preparadas:
- https://vercel.com/docs/environment-variables/managing-environment-variables
- https://vercel.com/docs/logs/runtime
- https://developers.kommo.com/reference/add-webhooks
- https://developers.kommo.com/reference/delete-webhook
- https://developers.kommo.com/reference/webhook-events
