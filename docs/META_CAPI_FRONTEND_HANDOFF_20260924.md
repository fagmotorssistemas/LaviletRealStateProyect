# CAPI — anexo de auditoría del contrato frontend

Primera fase, 24/09/2026. **Revisión y propuestas; ninguna activación autorizada.**

- Repositorio: `D:\FrontLaVilet`, rama `main`, commit `2910779028f4237d6ce785c2a621dadaac4289ac`. Árbol limpio al iniciar. Solo se añaden el contrato compacto, este anexo y una consulta de verificación; no se cambia código ejecutable.
- Supabase: `xhjnyntywqhczdtecgim`, consultas reales de solo lectura entre **17:15 y 17:24 UTC**. No se ejecutaron RPC comerciales, recuperaciones, páginas con sincronización automática ni envíos.
- No se verificó el commit desplegado de Vercel, sus variables efectivas, ni el código/runtime del otro VS Code. Los resultados de base de datos son evidencia persistida, no una certificación de la configuración actual de Nest.
- Sin cambios de puntuaciones, temperatura, clasificación comercial, bots, n8n, vistas, secretos o permisos. Se conserva el paquete Kommo y la restricción existente a Carlos Fabián; esta revisión no los activa.
- Este documento describe el código actual. `META_CAPI_FRONTEND_CONTRACT.md` contiene afirmaciones anteriores que ya no reflejan todo el recorrido de Purchase y favoritos; se conserva como antecedente, no como contrato operativo de esta fase.

## 1. Frontera común frontend → backend

`src/lib/meta/capiServer.ts:enqueueMetaEvent` envía **POST `{base}/api/v1/events`**, JSON, cabecera privada `X-Internal-Secret`. Base: `META_CAPI_BACKEND_URL`, alternativa `LA_VILET_CAPI_URL`; secreto: `META_CAPI_INTERNAL_SECRET`. Nunca se llama a Graph directamente desde este adaptador. Timeout: 8 segundos.

El JSON es **plano**; el frontend no construye `user_data`/`custom_data` de Graph ni hashea aquí los identificadores. Backend debe confirmar normalización, hashing, dataset, validación y mapeo final.

| Grupo | Campos realmente serializados por el adaptador |
| --- | --- |
| Identidad del hecho | `event_name`, `idempotency_key`, `event_id`, `event_time` (Unix segundos), `action_source`, `delivery_lane` (`test`/`live`) |
| Persona/visita | `lead_id`, `visitor_key`, `external_id`, `phone`, `email`, `first_name`, `last_name`, `full_name`, `city`, `country` |
| Atribución web | `event_source_url`, `fbp`, `fbc`, `fbclid`, `client_ip_address`, `client_user_agent` |
| Contenido/negocio | `content_ids`, `content_name`, `content_category`, `lv_internal_subtype`, `unit_id`, `sale_id`, `tenant_id`, `project_id`, `registered_at`, `sale_at`, `value`, `currency` |
| WhatsApp | `messaging_channel`, `ctwa_clid`, `whatsapp_business_account_id`, `messaging_dataset_id` |
| Control | `ads_consent: true` cuando el adaptador admite la entrega; **no demuestra por sí solo un consentimiento explícito del usuario**: ver reglas distintas por evento abajo |

Los campos opcionales no disponibles se omiten. El vaciado actual no rellena `first_name`/`last_name`, aunque el adaptador los admite. `contact_id`, `appointment_id`, `channel_kind`, `unit_number`, `typology_code`, `content_type`, `details` y `block_reason` pueden existir en `outbox.payload`, pero **no cruzan este POST**. Si Nest consume Supabase directamente recibe una estructura distinta: acordar un único normalizador y el mismo criterio de deduplicación.

Con `META_CORE_SETUP_CONSERVATIVE` o su alternativa `NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE` (default conservador), las URL enviadas se reducen al origen y se omiten los `content_*` publicitarios de los productores web/Purchase. Sin modo conservador se eliminan query/hash; `/simulador` se excluye. Los subtipos `lv_*` son diagnóstico interno; backend debe confirmar que no los convierte en datos publicitarios arbitrarios.

**Respuesta actual:** el frontend considera cualquier HTTP 2xx como aceptación del backend y marca `forwarded`; no lee el cuerpo. No significa aceptación Meta. Contrato propuesto para backend: responder 2xx solo tras guardar duraderamente o reconocer una repetición de la misma identidad; mantener `event_id`, fecha y clave original. Un timeout después del commit puede provocar otro POST idéntico.

## 2. Productores existentes

### ViewContent — showroom listo o ficha visible

- Hecho: `MetaViewContentShowroom` cuando el visor está listo; `MetaViewContentUnit` cuando la ficha está visible, también en `/tour/unidad/[id]`. No es contacto ni venta.
- Recorrido: componentes → `POST /api/meta/enqueue` → `persistMetaConversion` → `meta_capi_outbox` → POST común. El endpoint solo admite `ViewContent`; valida cookie `lv_vid`, UUID, clave de visita, unidad del tenant y límite por visitante/IP. No comprueba proyecto/publicación de la unidad.
- Entrada browser: `event_name`, `visit_key`, `event_id`, `unit_id` para detalle, `lv_internal_subtype`, URL y click IDs. El servidor obtiene IP/UA, resuelve opcionalmente el contacto y construye el payload.
- Identidad: UUID del navegador en `sessionStorage`; claves `view:{visitor_key}:{unit_id}` o `view:showroom:{visitor_key}`. **La clave no contiene session_id**: deduplica durante la vida de `lv_vid`, no una vez por cada sesión como indica un comentario. Fecha: primer guardado servidor, no el instante original browser.
- Payload backend: base común, `action_source=website`, subtipo `detalle_unidad` o `showroom_general`, visita, unidad si procede, click IDs/IP/UA y `content_*` solo fuera del modo conservador.
- Consentimiento: cookie ads `full` y sin revocación vigente en ledger; la casilla de contacto no basta. Un error de lectura del ledger se trata como ausencia, no como bloqueo. Pixel comprueba cookie y ruta pública, no el ledger.
- Pixel: dispara **antes** del POST con el UUID propuesto; el servidor puede devolver un UUID canónico anterior. Hay riesgo de desalineación en otra pestaña/sesión; guardar después el UUID canónico no corrige el Pixel ya emitido.
- Persistencia/resultado: `pending`, flush dirigido y luego `after()` global; API 202 con identidad canónica. Error antes de persistir: no hay reintento duradero browser. El showroom general tampoco escucha `lv-consent-changed`; la ficha sí.

### Lead — solicitud explícita de información

- Hecho previsto: formulario `request_kind=info_request`; identificar un visitante o guardar un favorito usa `p_emit_lead=false` y no genera Lead.
- Recorrido: `identifyTourLead` → `POST /api/tour/lead` → RPC `identify_tour_lead_with_meta_outbox(p_tenant_id,p_visitor_key,p_name,p_email,p_phone,p_project_id,p_ads_consent,p_event_id,p_event_time,p_delivery_lane,p_payload,p_emit_lead)` → enrich de unidad y `register_tour_info_request` → flush en `after()`.
- Identidad: UUID y fecha de primer registro generados/conservados por SQL en `leads.meta_lead_event_*`; clave **`lead:{lead_id}`**, una conversión por ficha, no una por cada solicitud/unidad. `client_request_id` deduplica la solicitud comercial, no sustituye esta clave CAPI.
- Payload backend: `website`, subtipo `solicitud` añadido por SQL, `external_id=lead_id`, visita, teléfono/email/nombre reales, ciudad/país, URL/click IDs/IP/UA; contenido opcional fuera de modo conservador.
- Consentimiento: control web anterior y segunda comprobación de ledger en SQL; la función conserva consentimiento y vincula ViewContent previos del visitante. Sin ads no crea Lead publicitario.
- Pixel: solo después de HTTP exitoso, `emit_meta_lead=true` y `meta_event_id` canónico, con nombre `Lead`. No emite en una repetición que devuelve `emit_meta_lead=false`.
- Persistencia/resultado: identidad+outbox son atómicos en SQL, **pero la solicitud y su unidad se guardan después**. Un error posterior puede devolver 422 dejando un Lead `pending` sin solicitud completada; un reintento puede perder el Pixel inicial. Este defecto debe corregirse sin alterar la regla comercial.

### LeadSubmitted — interés comercial verificable en WhatsApp

- Hecho: evaluación del turno entrante actual por `evaluateWaLeadSubmittedForCurrentTurn`/`maybeRegisterWaLeadSubmitted`; interés explícito por propiedad, precio, financiación, visita, reserva, tipo/propósito, o selección con oferta reciente. No basta saludo ni primera respuesta. Puede reutilizar interés sellado de hasta 48 h cuando llega aceptación posterior; aceptación sola no es interés. **No depende de pasar a caliente/tibio**.
- Productores: `automation/conversation.ts` y `generation-recovery.ts`, también fuera de la ficha autorizada para el bot; esto no autoriza respuestas automáticas a esas personas. Receptor → cola → procesamiento son dependencias previas.
- Recorrido: lectura del contacto/consentimiento → `lv_whatsapp_ctwa_attribution` por tenant+proyecto+contacto → RPC `lv_register_wa_lead_submitted_intent(p_lead_id,p_event_id,p_event_time,p_lane,p_payload,p_status)` → outbox; bitácora por `lv_log_meta_conversion`. Si RPC falla, existe fallback de INSERT outbox y actualización separada de lead. No se ejecutó ninguno.
- Identidad: **`wa_lead_submitted:{lead_id}`**, UUID conservado en `meta_wa_lead_submitted_event_id`. Fecha nueva = `Date.now()` al evaluar; el productor no recibe `sent_at` ni ID de mensaje fuente: falta la fecha original verificable. El RPC real bloquea la ficha para registrar una vez.
- Payload backend: `business_messaging`, `messaging_channel=whatsapp`, teléfono/email/nombre si existen, `external_id=lead_id`, tenant/proyecto, `ctwa_clid`, `whatsapp_business_account_id`, `messaging_dataset_id`. Sin Pixel equivalente. `contact_id` se guarda localmente, pero lo descarta el adaptador HTTP.
- Consentimiento vigente implementado: rechazo explícito `meta_ads_consent=false` cancela; `null`/ausente permite. Un fallo de consulta o ámbito inconsistente bloquea. **Se documenta la regla existente; no se cambia ni se interpreta como aceptación expresa.**
- Atribución: CTWA debe existir en la tabla de atribución; WABA y dataset requeridos y distintos. WABA no es el destino dataset. No se inventa CTWA a partir de teléfono o ad_id.
- Flags: `META_WA_LEAD_SUBMITTED_ENABLED` y `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED`, default false; `META_WABA_ID`, `META_MESSAGING_DATASET_ID`. El plan **sí deja pending con entrega OFF**, confiando en el drain Nest. El flush genérico frontend no comprueba esos flags: contrato aún no seguro solo con esta barrera.
- Carril: el RPC usa `META_CAPI_DELIVERY_LANE=test ? test : live`, sin `VERCEL_ENV`/`META_MODE`. Difiere del resolver común que fuerza test fuera de producción. El fallback sí usa el resolver común.
- Resultado: `skipped`, `blocked`, `enqueued` o `duplicate` y bitácora; no es evidencia de aceptación Graph. Un turno futuro elegible puede promover un hold de esa ficha con el mismo ID/fecha; no se autorizó ninguna promoción o recuperación.

### AddToWishlist — guardar una unidad como favorita

- Hecho previsto: `TourSaveUnitModal`/`TourFavoritesPanel` guardan favorito local y registran `guardar_unidad`, después llaman `captureWishlistAfterSave`. **La escritura local silencia errores y el evento servidor no se espera**: el nombre “after save” no garantiza confirmación durable.
- Recorrido: `POST /api/meta/wishlist` → `persistAddToWishlist` → outbox `pending` → flush dirigido y `after()` global.
- Identidad: UUID browser por intento; clave **`wishlist:{lead_id}:{unit_id}`**, fecha de primer INSERT servidor. Eliminar y volver a añadir mantiene una conversión por ese par.
- Payload backend: `website`, subtipo `favorito`, `unit_id`, persona/visita, URL/click IDs/IP/UA; `content_*` opcional. El endpoint comprueba unidad del tenant, pero no prueba un favorito persistido. Si no resuelve la visita, acepta `body.lead_id`; esa alternativa no verifica pertenencia del contacto al visitante.
- Consentimiento: controles web. Sin exclusión persistente de internos. Carril común test/live.
- Pixel: se emite antes del POST. El cliente ignora el `event_id` canónico e `inserted` de la respuesta: nueva sesión/reintento puede enviar otro Pixel para el mismo favorito, mientras CAPI conserva el antiguo.
- Resultado: API 202 con `event_id`/`inserted`; estado de negocio “guardado” no acredita CAPI. Holds históricos no se liberan por un nuevo intento.

### Schedule — cita confirmada por el cliente

- Hecho: acciones de agenda tras confirmación/solicitud confirmada → `afterAppointmentConfirmedForSchedule`. Exige `status=aceptado|reprogramado`, `confirmed_by_client=true`, contacto, consentimiento explícito true y canal comprobado. `crm`/vacío no equivale a website. No se genera por proponer fecha o pedir una visita.
- Recorrido: `prepareScheduleDeliveryAfterConfirmation` → RPC `lv_register_meta_schedule_intent(p_appointment_id,p_event_id,p_event_time,p_lane,p_channel,p_payload)` → `persistMetaConversion`, hasta tres intentos de persistencia → promoción específica web y flush según flags. Intención inmutable en columnas `appointments.meta_schedule_*`; no hay tabla independiente de intents.
- Identidad: **`schedule:{appointment_id}`**, UUID de intención y `confirmed_at` original; el código cae a ahora si falta fecha. Reprogramar el mismo appointment no crea una segunda conversión. SQL devuelve ID/fecha existentes.
- Payload web: `website`, teléfono/email/nombre, `external_id=lead_id`, tenant/proyecto. El productor actual no carga click IDs/IP/UA/URL aunque el plan admita algunos. `appointment_id` queda en outbox y se pierde en POST común. No hay disparador Pixel Schedule en los productores encontrados.
- WhatsApp: payload de revisión BM con CTWA/WABA/dataset; siempre `needs_review`, no se promueve como web. La compatibilidad del nombre Schedule en BM sigue pendiente; no se afirma compatible ni se modifica.
- Flags default false: `META_SCHEDULE_LOCAL_PERSIST`, `META_SCHEDULE_DELIVERY_ENABLED`, `META_SCHEDULE_FLUSH`, `META_SCHEDULE_RECOVER_ENABLED`. Web se guarda `review_hold`; solo se promueve con entrega habilitada y revalidación de la cita. Recuperación por `lv_recover_missing_meta_schedule_outbox`, **no ejecutada**.
- Resultado: motivo de preparación, hold/pending y bitácora de entrega si alcanza Nest; la cita permanece aunque falle la captura. El flush genérico solo mira pending/carril y no revalida flags Schedule, canal o cancelación de cita.

### Purchase — venta real registrada, nunca temperatura

- Hecho: `recordUnitClosingAction` → `recordUnitClosing` inserta `unit_sales_closings`, con permiso de escritura CRM; después `persistPurchasePrepared`. Solo con cierre y contacto. No hay productor conectado a puntuaciones o temperatura.
- Identidad: **`purchase:{sale_id}`**, UUID outbox, `event_time=floor(sale_at/1000)`, `registered_at=closing.created_at`. Corte dual: ambas fechas deben ser posteriores/iguales a `META_PURCHASE_ACTIVATED_AT` y `META_PURCHASE_DELIVERY_ENABLED=true`.
- Payload backend: **`action_source=system_generated`**, subtipo `compra`, `sale_id`, `unit_id`, `lead_id`/`external_id`, tenant/proyecto, `sale_at`, `registered_at`, precio final `value>0`, moneda explícita en mayúsculas. La validación actual solo exige tres letras, no un catálogo ISO. No carga teléfono/email/nombre del comprador en este productor; backend debe confirmar si resuelve esos datos antes de Graph. No Pixel Purchase.
- Persistencia: `review_hold` si entrega OFF, anterior al corte o moneda ausente; `pending` si elegible. No promoción masiva. Fallo de captura se registra sin revertir venta; **cierre y outbox no son atómicos** y no hay recuperador Purchase en el código inspeccionado. Flush inmediato usa una promesa no esperada.
- Consentimiento: marca `ads_consent_required=true`, pero captura no exige consentimiento positivo. Flush solo cancela ante false; null/error continúa. Es la implementación encontrada, no una nueva regla aprobada.
- Anulación: la interfaz llama una acción separada que cancela outbox pending/holds por contrato. No revierte un evento ya enviado, no es transacción con la anulación y no se revalida el contrato en el flush.
- Resultado: la venta guardada no prueba evento enviado. Bitácora puede indicar pendiente de soporte/hold, recibido por Nest o aceptado por Meta con evidencia.

## 3. Persistencia, consentimiento, pruebas y resultados comunes

- Outbox real: `UNIQUE(idempotency_key)`, **sin UNIQUE(event_id)**; estados `pending`, `forwarded`, `cancelled`, `dead`, `needs_review`, `review_hold`. INSERT con recuperación de conflicto; ID/fecha originales conservados al encontrar la clave.
- `flushLocalMetaOutbox` lee los pending del carril actual sin claim/lease. Dos ejecutores pueden POSTear lo mismo: backend debe deduplicar tanto ingestión HTTP como drain Supabase. No confundir “sin dos filas” con “sin dos envíos”.
- Fallo HTTP/red deja pending+last_error. El frontend no tiene backoff/contador/cron propio de flush en los recorridos encontrados; depende de otra actividad o del drain backend. Errores al actualizar forwarded no se comprueban. `forwarded` solo significa aceptación HTTP, no aceptación Meta.
- Resolver común: fuera de `VERCEL_ENV=production`, test; en producción, `META_CAPI_DELIVERY_LANE` explícito gana, luego `META_MODE=test`, si no live. **Pixel no usa ese carril**: depende de `NEXT_PUBLIC_META_PIXEL_ID`, consentimiento/ruta y `NEXT_PUBLIC_META_PIXEL_SIMULATE`. Simular Pixel no bloquea automáticamente CAPI, y carril test no simula Pixel.
- Web: cookie `lv_ads_consent=full` (o legacy válido) y ledger sin revocación; contacto/privacidad es distinto. Flush solo relee consentimiento por lead y solo bloquea false: no consulta ledger de visitante anónimo, ni distingue error de consulta de null. Backend debe mantener su control de revocaciones al consumir.
- `POST /api/meta/consent` registra ledger por `lv_record_meta_ads_consent`; revocación cancela pending/holds. Propagación a backend: `POST /api/v1/consent/grant|revoke`, mismo secreto, `{lead_id?,visitor_key?,consent_version}`; reintenta ledger pending/failed en orden de versión. Backend debe impedir que una versión anterior revierta la última decisión. No se cambió el consentimiento.
- Internos: productores/flush revisados no consultan una clasificación persistente de internos; `crm_contact_classifications` aún no existe en producción. La etiqueta `internal_activity` del lector no es una barrera de envío. No usar nombres o teléfonos adivinados para excluir, ni la restricción del bot como filtro CAPI.
- Visibilidad: `/inmobiliaria/marketing/capi` distingue pendiente, recibido Nest, aceptado Meta, bloqueado, fallido y desconocido. `meta_accepted` requiere evidencia (`events_received>=1` o fbtrace) o lookup con `api_accepted=true`. Aceptación no prueba atribución a campaña ni venta.
- Lookup esperado: `GET /api/v1/events/:eventId`, secreto interno, `{ok,found,event_id,status,api_accepted,acceptance_tier,meta_response:{http_status,events_received,fbtrace_id,error_code,error_type},attempt_count,delivery_lane,dataset_id,sent_at,last_error}`. Los GET frontend `/api/meta/sync-nest-results` y `/api/meta/nest-lookup-sync` **escriben bitácora**; no se ejecutaron. La consulta de la pantalla también puede sincronizar y escribir.

## 4. Contraste real Supabase

Consultas de catálogo y agregados sobre todas las filas del proyecto (sin límites de paginación, sin exportar datos personales). El MCP directo falló al refrescar OAuth; el conector Supabase autorizado sí permitió SELECT sobre el proyecto explícito. Evidencia disponible a 17:18–17:19 UTC:

| Dependencia | Resultado real |
| --- | --- |
| `lv_receive_kommo_observation`, `lv_record_message_evidence`, `lv_evaluate_message_interest` | **Ausentes** en public. No se pueden atribuir permisos efectivos a una función inexistente. Las tres tablas nuevas de evidencia/clasificación/evaluación también están ausentes. |
| RPC Lead, intención Schedule, intención LeadSubmitted, ledger/revocación y bitácora | Existen; SECURITY DEFINER, EXECUTE service_role, sin EXECUTE anon/authenticated. Se leyeron definiciones de las tres RPC de creación/intención. |
| `meta_capi_outbox`, `meta_capi_conversion_log`, `meta_ads_consent_ledger` | Existen, RLS activo, sin SELECT/INSERT anon/authenticated; service_role sí. Se comprobó allowlist de los seis eventos y estados de holds. |
| Intenciones | Columnas `leads.meta_lead_*`, `leads.meta_wa_lead_submitted_*`, `appointments.meta_schedule_*` presentes. |
| Venta | `unit_sales_closings.currency` y CHECK de tres letras presentes; UNIQUE(unit_id). **RLS permite ALL a authenticated con USING/WITH CHECK true**, sin aislamiento por tenant en esa política. anon tiene ACL pero sin política habilitante observada. |
| Triggers | No hay triggers de usuario en outbox ni cierres; no existe atomicidad automática de captura Purchase en esas tablas. |
| Migraciones | Registro remoto de `meta_measurement_wishlist_purchase_capture` y de consentimiento/intents presente. No aparecen los nombres de las tres migraciones pendientes del paquete Kommo. Las versiones remotas de varias migraciones difieren de nombres locales: no inferir ausencia solo por timestamp ni ejecutar toda la carpeta. Moneda existe aunque su migración local no figure con ese nombre. |

| Evento | Outbox live | Evidencia persistida de aceptación live | Outbox test |
| --- | --- | --- | --- |
| ViewContent | 31 forwarded | 31 eventos distintos, cada uno con events_received positivo y fbtrace; último 24/09 17:04:12 UTC | 6 forwarded, 18 pending; 4 aceptaciones documentadas |
| Lead | 1 forwarded | 1 con evidencia; 18/09 23:37:58 UTC | 3 forwarded, 3 aceptaciones documentadas |
| LeadSubmitted | 2 forwarded | 2 con evidencia; último 22/09 19:03:03 UTC | Sin filas |
| AddToWishlist / Schedule / Purchase | Sin filas | Sin evidencia en esta bitácora | Sin filas |

61 filas outbox; no se encontraron IDs de evento duplicados ni pending con lead explícitamente revocado. Ledger: 38 filas marcadas delivered. Estas observaciones **no prueban entrega futura**, no validan todos los consumidores ni autorizan reenviar los 18 pendientes test o convertirlos a live. No se consultó Graph ni Nest en vivo.

Las funciones Kommo ausentes bloquean el recorrido actual que las invoca: el receptor intenta `lv_receive_kommo_observation` antes de aceptar y responde 503 si falla; `lv_evaluate_message_interest` se espera antes de continuar ciertos turnos. Esto es comprobado en código local + ausencia real de DB, **no un nuevo registro de un 503 de producción**. Las dependencias web CAPI existentes no dependen de ese receptor.

## 5. Defectos comprobados y correcciones propuestas — no aplicadas

| Prioridad | Evidencia comprobada | Propuesta acotada |
| --- | --- | --- |
| Alta | `wishlist/route.ts` acepta lead_id del body cuando no resuelve visitante y no comprueba un guardado real. | Exigir vínculo servidor visitante→lead y hecho durable favorito antes de outbox; datos de unidad desde inventario publicado/proyecto correcto. No fabricar enlaces históricos. |
| Alta | Pixel ViewContent/favorito precede al ID canónico; favoritos ignora respuesta; clave de vista abarca cookie, ID browser solo sesión. | Resolver/reutilizar identidad canónica antes del Pixel, mismo nombre+ID en ambas vías; pactar unidad de deduplicación de visita sin cambiar claves de históricos. Reintento durable con misma identidad, nunca nuevo UUID por retry. |
| Alta | Lead outbox se guarda antes de solicitud/unidad; Purchase queda fuera de transacción del cierre. | Captura atómica ligada al hecho exitoso o intención durable reconciliable y verificable; no generar Lead por solicitud fallida ni perder Purchase tras venta guardada. Separar esta corrección de las reglas comerciales. |
| Alta | LeadSubmitted puede ir live en Preview por su cálculo de carril; flush genérico ignora flags LS/Schedule. | Usar resolver único y controlar evento/carril/flags tanto en frontend como backend. No pausar ni activar flags durante la revisión. Verificar Pixel test por separado. |
| Alta | No hay barrera persistente de internos en productores/flush; test_only del bot no limita CAPI. | Acordar con el dueño de clasificación una consulta de exclusión auditable; aplicar antes de capturar/enviar, sin modificar su clasificación ni inferirla. |
| Alta | RLS real de cierres permite ALL a authenticated sin ámbito. | Proponer endurecimiento por tenant/proyecto y verificación de venta/unidad/contacto al consumidor. Cambio remoto de permisos separado, no incluido ni ejecutado en esta fase. |
| Media | LeadSubmitted usa hora de evaluación; ViewContent/favorito usan hora de persistencia; Schedule/Purchase tienen fallback a ahora. | Conservar ID fuente y fecha real del hecho en intención; si la fecha no se verifica, retener con motivo. No reescribir fechas históricas. |
| Media | Flush sin claim, sin backoff y sin comprobar UPDATE; consentimiento de lectura fallida continúa; pendiente anónimo sin relectura ledger. | Reintentos coordinados con backend, resultado durable, control de versión de consentimiento y error separado de null. Mantener reglas distintas por evento, sin cambiar el consentimiento vigente. |
| Media | Anular contrato dispara cancelación CAPI separada, no esperada desde UI; flush no revalida venta/contrato. | Cancelación durable servidor junto al hecho comercial y revalidación al consumir. Nunca “desenviar” ni reenviar automáticamente compras existentes. |
| Media | Metadata de correlación se pierde en POST (`contact_id`, `appointment_id`); Purchase no carga identidad de comprador; moneda solo regex. | Acordar campos internos permitidos y resolución autorizada de comprador en backend; validar moneda real. Evitar enviar IDs internos como atributos publicitarios innecesarios. |
| Media | Showroom general no escucha cambio de consentimiento; errores de POST quedan silenciados. | Capturar la visita actual tras aceptación sin duplicar, y conservar retry con ID original. No cambiar vistas. |

No se ejecutaron pruebas simuladas ni se repitieron suites anteriores: es una revisión estática más consultas reales de solo lectura. No se atribuye una duplicación/envío indebido real a estos defectos sin evidencia de producción. Las propuestas requieren coordinación; no se implementaron por adelantado en lógica compartida.

## 6. Respuesta necesaria del otro VS Code

1. Confirmar repo/rama/commit del backend y versión publicada. El frontend usa la base configurable anterior; no asumir que el nombre histórico `lavilet-meta-capi` identifica el despliegue de `backend-La-Vilet`.
2. Confirmar DTO de los seis eventos, action_source por canal, metadata interna, normalización/hashing y resolución de identidad Purchase; Purchase continúa siendo **venta real**.
3. Documentar si consume por POST, drain Supabase o ambos; misma identidad durable en ambos, lease/reintentos y conducta tras timeout. Confirmar que solo consume pending del carril permitido, que respeta flags por evento, holds, revocaciones e internos. No tocar los pendientes existentes para probar.
4. Confirmar GET de estado con evidencia Graph y el protocolo/versionado de consentimiento; precisar si escribe `meta_capi_conversion_log` y cómo evita confundir recibido con aceptado.
5. Compartir valores no secretos de flags/carriles y presencia de secretos en su runtime; falta también configuración efectiva de Vercel. No pegar claves, tokens ni payloads personales.

La nueva señal de clasificación permanece **sin productor ni nombre de evento acordados**: falta decidir solo calientes o tibios+calientes y verificar compatibilidad Meta del evento/canal. No sustituye Purchase, no altera puntos y no bloquea la corrección de los seis eventos existentes. La activación, migraciones y prueba real se acordarán en otra fase.
