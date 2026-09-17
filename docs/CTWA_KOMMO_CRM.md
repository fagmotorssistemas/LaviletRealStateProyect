# WhatsApp → Kommo → CRM y `ctwa_clid`

Estado: cambios preparados para revisión. Migración **no** aplicada a Production. Pixel y CAPI intactos.

## Conclusión

| Pregunta | Respuesta |
| --- | --- |
| ¿El normalizador CRM exige `ctwa_clid`? | **No.** Un mensaje sin CTWA se guarda y sigue el flujo habitual. |
| ¿Se atribuye solo a ads u orgánico si falta? | **No.** No se inventa atribución. |
| ¿Kommo CRM entrega `ctwa_clid`? | **No en la forma documentada / de referencia** del webhook `message[add]` usado por La Vilet. Meta Cloud API sí lo envía en `messages[].referral` del **primer** mensaje. |
| ¿Qué hacemos si Kommo algún día lo reenvía? | Se captura, se guarda first-touch con `field_path` (origen), no se borra en mensajes posteriores, reintentos no duplican. |

## Payload de referencia

### Fixture CRM (**sintético**)

`KOMMO_CRM_INBOUND_SYNTHETIC_FIXTURE` — forma `message[add]` alineada con la integración/tests. **No es captura del webhook real de Kommo** y **no demuestra** qué campos entrega Kommo en producción. Marcado con `_fixture_kind: synthetic_kommo_crm_shape`.

### Fixture Meta Cloud API (**sintético**)

`META_CLOUD_CTWA_REFERRAL_SYNTHETIC_FIXTURE` — dónde Meta documenta `referral.ctwa_clid`. No es webhook Kommo.

Limitación: `KOMMO_CTWA_LIMITATION`.

## Cambios de código (revisión)

1. `ctwa-from-kommo.ts` — extracción opcional + preservación first-touch + fixtures de referencia.
2. `webhook.ts` — `Inbound.ctwa` opcional; no rechaza mensajes sin clid.
3. `ctwa-lead-store.ts` — RPC `lv_app_preserve_ctwa` / `lv_app_get_ctwa` (si la migración está aplicada); si no, el flujo CRM continúa.
4. `conversation.ts` — tras `register_inbound_message`, preserva clid si vino en el evento (también en reintentos duplicados del mensaje).
5. Migración preparada: `supabase/migrations/20260916220000_whatsapp_ctwa_attribution.sql` (+ rollback).

**No** modifica Pixel, CAPI, Nest attribution, ni Production env.

## Pruebas aisladas

```bash
npm run test:ctwa-kommo
```

Cubre: sin CTWA → flujo OK; captura si hay referral; first-touch; reintento idempotente; contraste Meta vs Kommo.

## Evidencia de resiliencia (tests)

`npm run test:ctwa-kommo`:

1. **Códigos**: `CTWA_RPC_MISSING` vs `CTWA_TIMEOUT` vs `CTWA_DB_ERROR` / `CTWA_UNEXPECTED` (sin lanzar al CRM).
2. **Contrato RPC preserve**: exige `ok === true` y acción reconocida (`inserted` | `preserved_existing` | `duplicate_retry` | `noop_empty`). Vacío, desconocido o `missing_after_conflict` → fallo controlado + log sin PII.
3. **`getStoredCtwaClid`**: solo ausencia real (PGRST202 / 42883 / 42P01 / does not exist) → `CTWA_RPC_MISSING`; permisos (`42501`, `permission denied`) y otros errores → `CTWA_DB_ERROR`.
4. **Log seguro**: JSON con `code`/`reason`; sin clid, teléfono ni contactId.
5. **`processConversation` simulado**: RPC ausente, error DB, timeout → `bot_paused` tras registrar; duplicado → `action: duplicate`.
6. **SQL (PGlite)**: dos mensajes distintos del mismo contacto → una sola fila, clid de la primera captura; reintento → `duplicate_retry`.
7. **Sin CTWA**: `CTWA_NOOP` sin llamar RPC; `preserveCtwaCapture(existing, null)` conserva first-touch.

Migración: preparada, **no** aplicada a Production. Unicidad atómica vía `EXCEPTION WHEN unique_violation` + `ORDER BY captured_at, id`.

## Límites actuales de las pruebas

- **SQL**: ejercita `lv_app_preserve_ctwa` en **secuencia** (llamadas una tras otra en PGlite). No cubre carrera concurrente real entre dos writers sobre el mismo contacto/mensaje.
- **Conversación**: el flujo simulado usa lead con **bot pausado** (`bot_enabled: false` → `action: bot_paused`) para verificar que el registro inbound y el soft-fail CTWA no cortan la atención. No ejercita una respuesta comercial completa ni envío a Kommo/WhatsApp.
- Sin migración en Production, sin publicación y sin mensajes reales.
