# Contrato único Nest — medición Meta (Cursor backend)

**Repos:** `FrontLaVilet` (productor) → Nest `lavilet-meta-capi` (worker/drain).  
**Alcance:** payloads, allowlist, idempotencia, estados. No es validación legal.

---

## 1. Pendiente operativo ya comprometido (LeadSubmitted)

En FE, `meta_ads_consent` **ausente/`null` permite** encolar/enviar LeadSubmitted WA; solo `=== false` cancela.

**Nest en Droplet aún debe desplegar** el commit del gate alineado (`ads_consent_absent_allowed`). Sin ese deploy, el worker viejo hace hold con null.

```bash
cd /opt/lavilet-meta-capi
git pull origin main
docker compose -p lavilet-capi up -d --build
```

**No declarar el flujo WA LeadSubmitted “completo” mientras Nest no esté en esa revisión.**

---

## 2. Allowlist Nest tipada hoy (envío Graph)

| `event_name` | Canal | Envío Nest | Notas |
|---|---|---|---|
| `ViewContent` | website | Sí | Subtipo interno en payload `lv_internal_subtype` (`showroom_general` \| `detalle_unidad`). **No** exige cambiar custom_data publicitario. |
| `Lead` | website | Sí | Idempotency `lead:{lead_id}`. FE emite solo en `info_request` (`p_emit_lead`). |
| `Schedule` | website | Sí (flags Schedule) | `schedule:{appointment_id}`. BM Schedule **sigue rechazado**. |
| `LeadSubmitted` | business_messaging | Sí (flags WA) | `wa_lead_submitted:{lead_id}` + CTWA + dataset mensajería. Consent: solo false cancela. |

Endpoint productor → Nest: `POST /api/v1/events` + `X-Internal-Secret`.  
Consulta: `GET /api/v1/events/:eventId`.

---

## 3. Tipos nuevos — captura FE, envío Nest **deshabilitado**

| `event_name` | Idempotency | FE status | Nest debe |
|---|---|---|---|
| `AddToWishlist` | `wishlist:{lead_id}:{unit_id}` | `review_hold` + `last_error=nest_backend_pending` | Tipar DTO/allowlist; aceptar payload website; no exigir content_* si conservative |
| `Purchase` | `purchase:{sale_id}` | igual | Tipar; `value`=`sale_price_final`; **no inventar** currency; anulación vía contrato `anulado` antes de activar |

FE **nunca** hace flush de estos nombres aunque `status=pending`.  
Pixel browser puede emitir `AddToWishlist` con el mismo `event_id` que la fila outbox.

Activación futura: Nest tipado + flag FE explícito (`META_PURCHASE_DELIVERY_ENABLED` / equivalente wishlist). Default off.

---

## 4. Payload ViewContent (subtipos internos)

```json
{
  "event_name": "ViewContent",
  "action_source": "website",
  "event_id": "<uuid compartido Pixel>",
  "lv_internal_subtype": "showroom_general | detalle_unidad",
  "unit_id": "<solo detalle_unidad>",
  "event_source_url": "https://…",
  "fbp": "…",
  "fbc": "…"
}
```

Idempotency CRM:
- Showroom: `view:showroom:{visitor_key}` (1× sesión)
- Ficha: `view:{visitor_key}:{unit_id}`

---

## 5. Payload AddToWishlist (captura)

```json
{
  "event_name": "AddToWishlist",
  "action_source": "website",
  "lv_internal_subtype": "favorito",
  "unit_id": "<uuid>",
  "unit_number": "…",
  "visitor_key": "…",
  "lead_id": "<uuid>"
}
```

Guardar favorito **no** genera Lead. Solo `info_request` genera Lead.

---

## 6. Payload Purchase (preparado)

Fuente: `unit_sales_closings` (`id` = sale_id, `sale_price_final`, `sale_at`, `unit_id`, `lead_id`).

```json
{
  "event_name": "Purchase",
  "action_source": "website",
  "lv_internal_subtype": "compra",
  "sale_id": "<uuid>",
  "lead_id": "<uuid>",
  "unit_id": "<uuid>",
  "value": 123456.78
}
```

- Sin columna currency en CRM → **omitir** `currency` (no inventar USD).
- No emitir por temperatura, favorito, cita, reserva ni anticipo/cuotas.
- Anulaciones: contrato `anulado` — Nest debe cancelar/no reenviar antes de activar.

---

## 7. WhatsApp — actividad interna (no Meta sin validación)

Búsquedas / detalle / preferencias explícitas en WA: solo bitácora/CRM interna cuando haya evidencia.  
**No** enviar `Search`, `ViewContent` ni `AddToWishlist` a Meta desde WA hasta canal + Nest validados.

`Search` web: **sin disparador** (no hay búsqueda real).

Reserva: **fuera** de la matriz CAPI.

---

## 8. Estados panel ↔ evidencia

| Outcome panel | Evidencia |
|---|---|
| `pending` | outbox pending |
| `nest_received` | outbox forwarded |
| `meta_accepted` | conversion_log `meta_accepted` con events_received/fbtrace **o** Nest `api_accepted` |
| `blocked` | cancelled / review / not_configured |
| `failed_retrying` | dead / meta_rejected |
| `pending_backend_support` | AddToWishlist/Purchase + nest_backend_pending |
| `internal_activity` | stage conversion_log interna (no enviada) |

---

## 9. Pruebas Nest requeridas (backend)

1. LeadSubmitted: consent null → allow Graph; false → cancel; dedupe por lead.
2. ViewContent: accept payload con `lv_internal_subtype` sin romper conservative.
3. Reject / hold `AddToWishlist` y `Purchase` hasta tipado; luego claim + Graph simulado.
4. Schedule BM sigue rechazado.
5. No mezclar dataset web y messaging.

---

## 10. Qué no hacer

- No reenviar históricos para “probar”.
- No fabricar consentimiento ni moneda.
- No usar tokens Ads/CAPI/WA cruzados.
- No tratar `forwarded` / `sent` sin evidencia Graph como “Aceptado por Meta”.
