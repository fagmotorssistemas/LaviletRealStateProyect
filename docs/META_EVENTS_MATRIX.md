# Matriz eventos Meta — La Vilet (auditoría, sin envíos)

| Hecho comercial | Evento admitido | Canal | Dataset | Parámetros clave | Disparador actual | Dedup |
| --- | --- | --- | --- | --- | --- | --- |
| Vista ficha / tour unidad | `ViewContent` | `website` | Pixel/web `923439043758658` | `content_ids`, consent ads web | `MetaViewContentUnit` → `/api/meta/enqueue` | visit key / idempotency |
| Lead web identificado | `Lead` | `website` | web | hashed PII, consent | identify + outbox | `lead:{lead_id}` |
| Cita confirmada (web) | `Schedule` | `website` | web | appointment scope | post-confirm + flags Schedule | `schedule:{appointment_id}` |
| Interés lead en hilo WA CTWA | `LeadSubmitted` | `business_messaging` | `4419657838288963` | `ctwa_clid`, WABA, consent WA | `maybeRegisterWaLeadSubmitted` | `wa_lead_submitted:{lead_id}` |
| Cita por WhatsApp BM | `Schedule` BM | — | — | — | **Rechazado** Nest (`business_messaging_schedule_not_supported_by_meta`) | — |
| Venta / cierre | `Purchase` BM o web | — | — | value/currency | **No implementado** en Nest tipado | Propuesta: `purchase:{sale_id}` |

### Categorías (no mezclar)
1. **Temperatura lead** (`frio|tibio|caliente|sin_clasificar`) — CRM scoring.
2. **Categoría inmueble** (`units.category`) — suite/depto.
3. **Categoría publicitaria** — Meta Ads; **no disponible** sin Insights.

### Purchase (propuesta, no enviar ahora)
- `value` = `unit_sales_closings.sale_price_final` (importe final).
- `currency` = documentar USD cuando el negocio lo confirme (hoy columna ausente → no inventar).
- Dedup por `sale_id` / `unit_id` único de cierre; no repetir por cuotas de `contracts.anticipo`.
- Anulación: contrato `anulado` / política de reopen — definir antes de cablear CAPI.

### “sent” ≠ aceptación Meta
En Nest, outbox `sent` exige evidencia Graph `api_accepted`. En bitácora FE, `stage=meta_accepted` es el correlato. Agregados oficiales Events Manager son capa aparte (`metaOfficialMetrics`).
