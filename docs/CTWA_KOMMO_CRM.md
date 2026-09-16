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

1. **Códigos**: `CTWA_RPC_MISSING` vs `CTWA_TIMEOUT` vs `CTWA_DB_ERROR` (sin lanzar al CRM).
2. **Log seguro**: fallos en JSON con `code`/`reason`; sin clid, teléfono ni contactId.
3. **`processConversation` simulado**: RPC ausente, error DB, timeout → `bot_paused` tras registrar; duplicado → `action: duplicate` sin contexto de respuesta.
4. **SQL (PGlite)**: dos mensajes distintos del mismo contacto → una sola fila, clid de la primera captura; reintento del mismo `external_message_id` → `duplicate_retry`.
5. **Sin CTWA**: `CTWA_NOOP` sin llamar RPC; `preserveCtwaCapture(existing, null)` conserva first-touch.

Migración: preparada, **no** aplicada a Production. Unicidad atómica vía `EXCEPTION WHEN unique_violation` + `ORDER BY captured_at, id`.
