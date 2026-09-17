# Schedule Meta ↔ «Aceptar cita»

## Estado

| Capa | Estado |
| --- | --- |
| Elegibilidad (PR #5) | **Cerrada** |
| Persistencia de revisión | `meta_capi_outbox.status = review_hold` (fuera de cola activa) |
| Flush local / drain Nest | Solo `pending`; `review_hold` excluido (query + defensa) |
| Contrato Nest→Meta WhatsApp BM | **Incompleto** (ver abajo) |
| Envío real Nest→Meta | **OFF** |

Migración preparada (**no** aplicar a Production): `20260917152000_meta_capi_outbox_review_hold.sql` (+ rollback).

## Elegibilidad (cerrada)

- `aceptado`/`reprogramado` + `confirmed_by_client === true`
- `meta_ads_consent === true`
- Canal solo `web`/`website` o `whatsapp`/`waba` (`crm`/vacío → pendiente)

## Payloads verificados (Nest / Meta)

### Nest hoy — `enqueueMetaEvent` → `POST /api/v1/events`

Body aceptado (frontend `capiServer.ts`):

`event_name`, `idempotency_key`, `event_id`, `event_time`, `action_source`, `event_source_url`, `phone`, `email`, `first_name`, `last_name`, `full_name`, `city`, `country`, `external_id`, `visitor_key`, `lead_id`, `fbp`, `fbc`, `fbclid`, `client_ip_address`, `client_user_agent`, `content_*`, `delivery_lane`, `ads_consent`.

**No** reenvía: `ctwa_clid`, `messaging_channel`, `whatsapp_business_account_id`, `messaging_dataset_id`.  
Bloqueo: `nest_payload_missing_messaging_fields`.

`action_source` tipado incluye `business_messaging`, pero sin campos BM el contrato Nest→Meta WhatsApp **no está completo**.

### Web — Meta CAPI website

Shape de revisión alineado con Nest: `event_name: Schedule`, `action_source: website`, phone/PII + cookies (`fbp`/`fbc`/`fbclid`).  
Flush Nest sigue **desactivado** (`flush_nest_inactive`).

### WhatsApp — Meta CAPI Business Messaging ([docs Meta](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/))

1. Crear/obtener **dataset** desde el WABA (`POST …/{WABA_ID}/dataset`) → respuesta = `dataset_id`.
2. Enviar a Graph: `POST /{DATASET_ID}/events` — **dataset ≠ WABA**.
3. Payload documentado (ejemplo oficial Purchase):

```json
{
  "data": [{
    "event_name": "Purchase",
    "event_time": 1675999999,
    "action_source": "business_messaging",
    "messaging_channel": "whatsapp",
    "user_data": {
      "whatsapp_business_account_id": "<WABA_ID>",
      "ctwa_clid": "<CLICK_TO_WHATSAPP_CLICK_ID>"
    }
  }]
}
```

- `ctwa_clid`: Meta lo describe como **required** para CAPI BM WhatsApp. Sin él **no** hay envío atribuible al clic CTWA (no es “atribución floja” opcional). Bloqueo: `whatsapp_ctwa_clid_required`.
- `whatsapp_business_account_id` y `messaging_dataset_id` son IDs distintos. Bloqueos: `whatsapp_waba_id_missing` / `whatsapp_dataset_id_missing`.
- `event_name: Schedule` **no** aparece en el ejemplo oficial BM; reportes de Graph (p. ej. subcode 2804066) rechazan `Schedule` en `business_messaging`. Bloqueo: `whatsapp_schedule_event_name_unverified`. **Contrato WhatsApp Schedule no declarado completo.**

## Persistencia revisión vs cola activa

| Status | Consumidores |
| --- | --- |
| `pending` | Flush local (`.eq('status','pending')`) → Nest drain |
| `review_hold` | **Ninguno** — `isOutboxStatusFlushable` + skip en bucle flush |

Schedule de revisión, si se persiste (`META_SCHEDULE_LOCAL_PERSIST=true`), usa **solo** `review_hold`. Por defecto persistencia y flush **off**.

## CTWA lectura

`loadCtwaClidForAppointmentScope`: filtra `tenant_id` + `project_id` + `contact_id` de la cita/lead.

Tabla `lv_whatsapp_ctwa_attribution`: RLS + `REVOKE` a `anon`/`authenticated`; solo `service_role`.  
`prepareScheduleDeliveryAfterConfirmation` usa `tryCreateAdminClient()` (no la sesión CRM) para esa lectura.

## Pruebas

```bash
npm run test:meta-schedule
```

Incluye `scheduleFlushExclusion.test.ts`: aunque el result set mezcle `review_hold`+`pending`, solo `pending` llama a `enqueueMetaEvent` (Nest no recibe revisión).

## Bloqueos concretos que quedan

1. Flush Nest/Meta OFF; no activar envíos.
2. Nest sin campos messaging/CTWA/dataset.
3. `Schedule` como nombre BM no verificado / rechazado en reportes Graph.
4. CTWA real Kommo no verificado (sin clid no hay CAPI BM).
5. Migración `review_hold` no aplicada a Production.
6. Pixel Schedule no cableado.

## Fuera de alcance ahora

Production, citas/mensajes ficticios, Test Events Meta, activar `META_SCHEDULE_LOCAL_PERSIST` / flush.
