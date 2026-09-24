# Contrato CAPI frontend → backend-La-Vilet · primera fase

**Para el otro VS Code.** Frontend `main`, commit `2910779028f4237d6ce785c2a621dadaac4289ac`, árbol limpio al iniciar. Se añaden únicamente documentos y SQL SELECT. Sin activación, cambios comerciales, bots/n8n, vistas, migraciones ni envíos. [Detalle y evidencia por productor](META_CAPI_FRONTEND_HANDOFF_20260924.md).

## Transporte y garantía que debe confirmar backend

Outbox Supabase → **POST `/api/v1/events`**, cabecera privada `X-Internal-Secret`, timeout 8 s. Base `META_CAPI_BACKEND_URL` o `LA_VILET_CAPI_URL`. El frontend envía JSON plano, no payload Graph ni hashes.

Siempre: `event_name`, `event_id`, `idempotency_key`, `event_time` (Unix segundos), `action_source`, `delivery_lane`, `ads_consent`. Opcionales por evento: `lead_id`, `visitor_key`, `external_id`, identidad personal, URL/click IDs/IP/UA, contenido y datos de venta/WhatsApp indicados abajo. No copiar secretos ni payloads personales al chat.

**2xx significa guardado durable o duplicado reconocido, no aceptación Meta.** El frontend marca forwarded por HTTP sin leer el cuerpo. Backend debe conservar ID/fecha/clave y deduplicar conjuntamente POST y drain Supabase si usa ambos. Falta confirmar DTO, normalización/hashing, consumidor activo y versión publicada.

## Los seis hechos y sus productores

| Evento / hecho | Ruta o RPC frontend | Identidad y fecha actuales | Payload específico a backend / Pixel |
| --- | --- | --- | --- |
| **ViewContent**: visor listo o ficha visible | `/api/meta/enqueue` → `persistMetaConversion` | UUID browser; `view:{visitor}:{unit}` o `view:showroom:{visitor}`; fecha primer INSERT. Clave por cookie, no por sesión. | `website`, subtipo showroom_general/detalle_unidad, unidad, visita, click IDs/IP/UA/URL. Pixel antes de POST: riesgo de no coincidir con UUID canónico. |
| **Lead**: solicitud explícita de información; no identificación/favorito | `/api/tour/lead` → `identify_tour_lead_with_meta_outbox(...p_emit_lead=true)` → `register_tour_info_request` | UUID/fecha SQL inmutables; `lead:{lead_id}`, una vez por ficha | `website`, subtipo solicitud, teléfono/email/nombre/ciudad/país, visita/click IDs/IP/UA/URL. Pixel con ID canónico solo si respuesta exitosa `emit_meta_lead=true`. Outbox precede a solicitud: falta atomicidad completa. |
| **LeadSubmitted**: interés comercial del turno WhatsApp con atribución CTWA verificada, no temperatura | conversación/recuperación de generación → `lv_register_wa_lead_submitted_intent` → outbox | UUID conservado; `wa_lead_submitted:{lead_id}`; hoy usa hora de evaluación, falta fecha/ID original del mensaje | `business_messaging`, `messaging_channel=whatsapp`, identidad, lead/tenant/proyecto, `ctwa_clid`, `whatsapp_business_account_id`, `messaging_dataset_id`. Sin Pixel. |
| **AddToWishlist**: guardar unidad favorita | guardado local/evento tour → `/api/meta/wishlist` → `persistAddToWishlist` | UUID browser por intento; `wishlist:{lead}:{unit}`; fecha primer INSERT | `website`, subtipo favorito, unidad, lead/visita, click IDs/IP/UA/URL. Pixel previo al POST; cliente no consume ID canónico. Endpoint no verifica el guardado durable. |
| **Schedule**: cita aceptada/reprogramada y confirmada por cliente | acciones agenda → `lv_register_meta_schedule_intent` → persistencia outbox | `schedule:{appointment_id}`, UUID inmutable, `confirmed_at`; fallback a ahora si falta | Web: `website`, teléfono/email/nombre, lead/tenant/proyecto; hoy no carga atribución web. Sin Pixel productor. WhatsApp permanece needs_review, compatibilidad del evento/canal no confirmada. |
| **Purchase**: cierre de venta real | `recordUnitClosingAction` → `unit_sales_closings` → `persistPurchasePrepared` | `purchase:{sale_id}`, UUID outbox, fecha `sale_at`, registro `created_at` | **`system_generated`**, subtipo compra, sale/unit/lead/tenant/project, `sale_at`, `registered_at`, `value` final positivo y `currency` explícita. Sin Pixel. No carga teléfono/email: confirmar resolución autorizada en backend. |

Contenido `content_ids/name/category` solo donde existe y fuera del modo conservador. `contact_id`, `appointment_id`, `details`, `content_type` y otra metadata guardada en outbox **se pierden en el POST actual**; pactar qué debe conservar el DTO interno. Dataset WhatsApp y WABA son identificadores diferentes. No atribuir campañas por aceptación CAPI.

## Controles y persistencia

| Recorrido | Regla actual que debe preservarse/verificarse |
| --- | --- |
| Web: ViewContent/Lead/favorito | Cookie ads full, ledger sin revocación; casilla de contacto no equivale a ads. Error al leer ledger se trata como null: defecto propuesto a corregir. |
| LeadSubmitted | Rechazo explícito false bloquea; null permite según implementación vigente. Exige CTWA por tenant/proyecto/contacto + WABA/dataset. No cambiar consentimiento. |
| Schedule | Consentimiento true, confirmación cliente y canal probado. Flags `META_SCHEDULE_LOCAL_PERSIST`, `META_SCHEDULE_DELIVERY_ENABLED`, `META_SCHEDULE_FLUSH`, `META_SCHEDULE_RECOVER_ENABLED` default OFF. Web review_hold→pending tras revalidación; WhatsApp no se promueve. |
| Purchase | `META_PURCHASE_DELIVERY_ENABLED=true` + `META_PURCHASE_ACTIVATED_AT`, ambas fechas de venta/registro posteriores al corte y moneda. Si no, review_hold. Sin promoción masiva. Flush cancela solo consentimiento false; nulidad no demuestra aceptación. |
| Pruebas | Resolver común fuerza test fuera de Vercel production; producción usa `META_CAPI_DELIVERY_LANE`, luego `META_MODE`, default live. **LeadSubmitted RPC no usa ese resolver y puede marcar live fuera de producción. Pixel se controla aparte** con ID público/simulación, no con delivery_lane. |
| Internos | No hay filtro persistente de internos en productores/flush revisados. test_only del bot no excluye CAPI. Coordinar lectura de clasificación con su responsable, sin modificarla. |

Outbox: UNIQUE(idempotency_key), estados pending/forwarded/cancelled/dead/review_hold/needs_review; solo pending se vacía. Fallos de red permanecen pending. Flush frontend sin claim/backoff; repeticiones posibles. Los hooks web hacen flush dirigido/general; Purchase usa promesa no esperada; Schedule tiene hasta 3 intentos de persistencia. Falta acreditar reintentos del drain backend.

**Defecto de flags:** LeadSubmitted con entrega OFF puede persistir pending y el flush genérico frontend no revisa flags LS/Schedule. Backend debe confirmar su bloqueo final; no se puede garantizar con el flag frontend actual. Anulación de contrato cancela Purchase local pendiente mediante acción separada; no revierte enviado ni revalida contrato al consumir.

Consentimiento backend: POST `/api/v1/consent/grant|revoke`, `{lead_id?,visitor_key?,consent_version}`; aceptar solo versión vigente. Resultado visible en bitácora: pending ≠ forwarded/Nest recibido ≠ Meta aceptado. GET backend `/api/v1/events/:eventId` debe devolver estado/carril, intentos y evidencia `api_accepted`, `meta_response.{http_status,events_received,fbtrace_id}`, `sent_at` y error sanitizado. Los endpoints frontend de sincronización escriben bitácora: no usados en esta revisión.

## Datos reales y defectos que impiden darlo por cerrado

Supabase `xhjnyntywqhczdtecgim`, SELECT del **24/09/2026 17:15–17:24 UTC**:

- **Ausentes:** `lv_receive_kommo_observation`, `lv_record_message_evidence`, `lv_evaluate_message_interest` y tablas nuevas de evidencia/clasificación/evaluación. Dependencia Kommo bloqueada; no demuestra que la vía web esté caída.
- RPC de Lead, Schedule, LeadSubmitted, ledger y bitácora presentes, ejecutables solo por service_role entre anon/authenticated/service_role. Outbox/ledger/log con RLS y sin SELECT/INSERT anon/authenticated. Moneda e intenciones presentes.
- **RLS de cierres demasiado amplia:** unit_sales_closings permite ALL a authenticated con true, sin aislamiento tenant en esa política. Proponer corrección separada, no aplicada.
- Evidencia live persistida de aceptación, con events_received positivo y fbtrace: **31 ViewContent, 1 Lead, 2 LeadSubmitted**. No hay filas de AddToWishlist, Schedule o Purchase. Outbox total del proyecto: 61 filas, 18 pending **test**, sin IDs duplicados. No se reenviaron.

Correcciones locales propuestas, todavía sin implementar: (1) identidad canónica antes de Pixel y retry estable; (2) favorito vinculado y confirmado desde servidor, sin aceptar lead arbitrario; (3) Lead/outbox después del hecho completo y captura durable de venta; (4) unificar carril/flags/controles de consumo y exclusión de internos; (5) preservar fecha/ID fuente y metadata; (6) validar consentimiento, anulación y resultado durable al reintentar. Detalles, puntos de código y límites en el anexo.

**Respuesta requerida de backend:** commit/runtime publicado, DTO de los seis eventos, consumidor POST/drain, idempotencia/lease/reintentos, flags efectivos no secretos, tratamiento de internos/consentimiento, resolución de comprador y evidencia Graph. No hubo acceso a variables Vercel ni runtime Nest; no se ejecutaron pruebas simuladas ni envíos reales en esta fase.

**Purchase permanece venta real.** La nueva señal comercial queda separada: decidir calientes o tibios+calientes y confirmar evento/canal compatible con Meta antes de implementarla. No bloquea los seis eventos existentes ni autoriza cambiar puntuaciones o clasificaciones.
