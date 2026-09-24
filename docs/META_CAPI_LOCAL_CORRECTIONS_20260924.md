# Correcciones locales CAPI y orden de activación

Estado: preparado en `main`; sin commit, despliegue, migración remota ni envío a Meta.

## Contrato frontend → backend final

| Hecho | Condición de creación | Identidad y fecha | Pixel | Controles |
| --- | --- | --- | --- | --- |
| ViewContent | Showroom listo o ficha real visible | `view:showroom:{visitor}` / `view:{visitor}:{unit}`; UUID y fecha sobreviven al reintento | Tras recibir el UUID canónico, mismo nombre e ID | consentimiento y carril común |
| Lead | `tour_info_requests` existe y coincide en negocio/contacto | `lead:{request_id}`; fecha de `tour_info_requests.created_at` | Tras persistir outbox; reintento conserva ID | no nace durante identificación |
| LeadSubmitted | Hecho WhatsApp atribuido del contrato existente | identidad original de su vía | no aplica | captura+delivery; flush genérico también los exige |
| AddToWishlist | `tour_events.guardar_unidad` durable del mismo visitante/contacto/unidad y unidad del proyecto | `wishlist:{lead}:{unit}`; UUID/fecha estables | Tras validación y persistencia servidor | consentimiento y pertenencia |
| Schedule | Cita confirmada del contrato existente | `schedule:{appointment_id}` | no aplica | delivery+flush explícitos en toda vía |
| Purchase | Cierre real; nunca temperatura | `purchase:{sale_id}`; `sale_at` y `registered_at` pasan el corte | no aplica | delivery, corte doble, consentimiento y RLS |

El backend corregirá conservación de `sale_at`, ausencia de `registered_at`,
clasificación de errores, coherencia de LeadSubmitted y sincronización durable. El
frontend separa ahora `transport_failed`, `meta_rejected`, recepción interna y
`meta_accepted`: un 401/403/5xx al consultar resultados es fallo de consulta.

## Dependencias SQL y orden

1. `20260923205830_disable_destructive_contact_resets.sql`: protege datos reales y
   respaldos antes de restaurar cualquier consumidor.
2. `20260923211512_interest_evaluation_evidence.sql`: aporta
   `lv_evaluate_message_interest`. Su puntuación pertenece al responsable CRM; este
   cambio no la reimplementa ni la usa para producir CAPI.
3. `20260923174920_kommo_message_evidence.sql`: crea el diario y también restaura
   `lv_receive_kommo_observation`. Aunque su nombre sea anterior, debe aplicarse
   tercero: al confirmar la transacción, el webhook ya publicado puede volver a
   encolar entrantes y salientes mediante los receptores existentes.
4. `20260924183000_unit_sales_closings_scoped_authorization.sql`: elimina la política
   abierta. Lee admin/vendedor/usuario con proyecto compartido; escribe admin o
   vendedor asignado con `sold_by_id` propio; borra solo admin; anon sin permisos.
   No cambia filas ni fechas.

No ejecutar la carpeta por orden alfabético: el timestamp antiguo de la migración 3
no representa el orden seguro de activación. Aplicar únicamente los cuatro archivos
en el orden anterior y registrar explícitamente sus versiones.

Antes del despliegue: comprobar funciones, ACL y RLS en solo lectura, y probar con JWT reales admin, asesor asignado y usuario no asignado.
`service_role` conserva acceso. Si falta `lv_shares_project` o la estructura esperada
de `project_salespeople`, detener la migración 4; no relajar la política.

## Orden de activación

1. Verificar el runtime publicado y sus gates. El receptor existente solo pasa listas
   comerciales si `AUTOMATION_MODE=live`, `AUTOMATION_N8N_DISABLED=true` y el corte
   de activación es válido; la autorización de respuesta sigue limitada además por
   `lv_auto_config.test_only` y `AUTOMATION_TEST_LEAD_ID`.
2. Aplicar protección y comprobar respaldos; luego evaluación y sus dependencias.
   Ninguno de estos dos pasos reanuda el ingreso del webhook.
3. Aplicar recepción solo cuando esos controles estén confirmados. En ese commit se
   reanuda inmediatamente el webhook existente: siempre guarda evidencia; con
   `settings.live=true` también encola `lv_app_receive` y
   `lv_app_receive_advisor_outbound`. El worker puede consumir lo encolado según sus
   propios cron/locks; no esperar al observador nuevo para considerar el receptor activo.
4. Registrar el observador independiente después de verificar `lv_record_message_evidence`.
   Este consumidor solo escribe el diario y puede reanudarse sin bots/CAPI.
5. Aplicar la RLS de cierres en una ventana separada y validarla funcionalmente antes
   de reanudar escrituras de cierres/Purchase.
6. Publicar frontend/backend CAPI compatibles con flags apagados y verificar en test:
   guardado, duplicado, fecha original y resultado durable. Un
   fallo parcial debe reintentar con la misma clave, ID y fecha.
7. Activar por evento. Schedule exige delivery+flush; LeadSubmitted enabled+delivery;
   Purchase delivery+corte ISO y ambas fechas válidas.
8. Confirmar respuesta Meta con `events_received` o `fbtrace_id`; aceptación interna
   del backend no equivale a aceptación Meta.
9. Habilitar live. No liberar `review_hold` mediante flush genérico ni promover
   históricos en masa.

Se conserva la política de consentimiento. No se añadió señal por temperatura ni se
cambió clasificación comercial. Purchase sigue representando una venta real.
