# WhatsApp → Kommo → CRM y `ctwa_clid`

Estado: cambios preparados para revisión. Migración **no** aplicada a Production. Pixel y CAPI intactos.

## Conclusión

| Pregunta | Respuesta |
| --- | --- |
| ¿El normalizador CRM exige `ctwa_clid`? | **No.** Un mensaje sin CTWA se guarda y sigue el flujo habitual. |
| ¿Se atribuye solo a ads u orgánico si falta? | **No.** No se inventa atribución. |
| ¿Kommo CRM entrega `ctwa_clid`? | **No en la forma documentada / de referencia** del webhook `message[add]` usado por La Vilet. Meta Cloud API sí lo envía en `messages[].referral` del **primer** mensaje. |
| ¿Qué hacemos si Kommo algún día lo reenvía? | Se captura, se guarda first-touch con `field_path` (origen), no se borra en mensajes posteriores, reintentos no duplican. |

## Payload de referencia (anonimizado)

### Kommo CRM (`message[add]`) — lo que usa el receptor

Campos típicos: `account.id`, `message.add[]` con `id`, `entity_id` / `element_id`, `contact_id`, `chat_id`, `text`, `created_at`, `origin` (`waba`/`whatsapp`), `author.type=external`, adjuntos opcionales.

**No incluye** `referral` ni `ctwa_clid` en la referencia de integración. Ver `KOMMO_CRM_INBOUND_REFERENCE_ANON` en `src/lib/integrations/automation/ctwa-from-kommo.ts`.

### Meta Cloud API — dónde sí está el clid

`entry[].changes[].value.messages[].referral.ctwa_clid` (+ `source_id`, `source_type`, etc.). Ver `META_CLOUD_CTWA_REFERRAL_REFERENCE_ANON` en el mismo archivo.

Limitación textual: `KOMMO_CTWA_LIMITATION`.

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

`npm run test:ctwa-kommo` incluye:

1. **RPC ausente / schema cache**: `preserveCtwaForContact` captura el error, devuelve `rpc_unavailable` y **no lanza** → el caller CRM sigue.
2. **Orden**: `register_inbound_message` antes que `lv_app_preserve_ctwa` → el mensaje ya está persistido aunque falle la atribución.
3. **Duplicados**: `is_duplicate === true` sigue cortando la respuesta del bot; el soft-fail de CTWA no añade un segundo envío.
4. **Sin CTWA**: `ctwa: null` → `noop_no_clid` **sin llamar RPC** → no puede borrar una atribución previa; `preserveCtwaCapture(existing, null)` conserva el first-touch.

Migración: preparada, **no** aplicada a Production en este PR.
