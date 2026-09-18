# WhatsApp → CAPI `LeadSubmitted` (business messaging)

## Fuente oficial Meta (evento admitido)

**No reutilizar `Lead` web** (`action_source=website`). Para mensajería, la FAQ oficial de Conversions API for Business Messaging lista:

- Purchase, **LeadSubmitted**, InitiateCheckout, AddToCart, ViewContent, Order*, CartAbandoned, QualifiedLead, RatingProvided, ReviewProvided

Fuente: [Conversions API for Business Messaging: Onboarding Guide](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/) (actualizado May 5, 2026).

### Significado de `LeadSubmitted`

Evento de **conversión en el hilo de mensajería** que representa un lead / contacto potencial atribuible al anuncio click-to-WhatsApp. Debe ocurrir **en el chat**, no en el sitio web.

### Identificadores: dataset ≠ WABA

| Variable | Rol | Dónde vive |
| --- | --- | --- |
| `META_MESSAGING_DATASET_ID` | Destino Graph `{id}/events` | Outbox Nest `dataset_id` / URL Graph |
| `META_WABA_ID` | Cuenta WhatsApp Business | Solo `user_data.whatsapp_business_account_id` |
| Pixel / `META_DATASET_ID` / `META_PIXEL_ID` | CAPI **web** | **Nunca** fallback para BM |
| `META_WA_CAPI_ACCESS_TOKEN` (Nest) | Bearer Graph para BM | **Distinto** de `META_CAPI_ACCESS_TOKEN` (web) |

No usar el WABA como dataset. No sustituir el dataset de mensajería por el dataset web si falta. El envío BM no reutiliza el token del CAPI web.

### Requisitos actuales (WhatsApp)

| Campo | Valor / regla |
| --- | --- |
| `event_name` | `LeadSubmitted` |
| `action_source` | `business_messaging` |
| `messaging_channel` | `whatsapp` |
| Destino Graph | `{MESSAGING_DATASET_ID}/events` |
| `user_data.whatsapp_business_account_id` | `META_WABA_ID` |
| `user_data.ctwa_clid` | Click ID del referral; **requerido** |
| Sin CTWA | **No admite envío CAPI BM**; atención CRM + bloqueo en bitácora |

`Schedule` **no** está en la allowlist BM. Pixel y CAPI web (`Lead` / `ViewContent`) no cambian.

---

## Disparador (acción real del cliente)

No cada mensaje ni un “Hola”. **Engagement histórico solo no convierte.**

Elegible solo si en **este turno** hay interés comercial verificable:

- `explicitPropertyInterest(currentMessage)`, **o**
- eventos de scoring del turno: `asked_price`, `asked_financing`, `requested_visit`, `asked_reservation`, `declared_unit_type`, `declared_purchase_purpose`

Respuestas ambiguas (`ok`, `sí`, `gracias`) sin evidencia del turno → bloqueo `commercial_interest_required`.

## Consentimiento publicidad

- **No** se concede al iniciar la conversación.
- Distinto de `tracking_consent` (novedades / nutrición).
- Exige `leads.meta_ads_consent === true` vía afirmación explícita; se guarda **evidencia** (mensaje del cliente, fecha, alcance `whatsapp_ads`).
- Nunca concede: “no acepto publicidad”, citas (`>` / comillas), texto del bot / atribuciones a terceros.
- Revocación cancela outbox `pending` / `needs_review` / `review_hold`; revalidación en DB antes de persistir.

## Controles (default OFF)

| Variable | Efecto |
| --- | --- |
| `META_WA_LEAD_SUBMITTED_ENABLED` | Evalúa + persiste (blocked/pending). Default off. |
| `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED` | Promote/`pending` + drain Nest **y** claim SQLite. Default off. |
| `META_WABA_ID` | Solo `user_data.whatsapp_business_account_id` |
| `META_MESSAGING_DATASET_ID` | Solo destino Graph BM |

## Idempotencia y entrega

`wa_lead_submitted:{lead_id}` — distinto de `lead:{lead_id}` (web). RPC atómico conserva el mismo `event_id` en reintentos/duplicados concurrentes. Apagar `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED` detiene drain Supabase **y** claim Nest de filas ya encoladas (Lead/VC siguen).

## Bitácora (Marketing → CAPI)

Tabla `meta_capi_conversion_log` visible en `/inmobiliaria/marketing/capi`.

| Stage | ¿Cuenta como enviada? |
| --- | --- |
| `evaluated` / `blocked` | **No** |
| `enqueued` / `backend_accepted` | En tránsito (no aceptación Meta) |
| `meta_accepted` | Sí — respuesta Graph correlacionada (`event_id`, `fbtrace_id`, `events_received`) |
| `meta_rejected` | Fallo correlacionado |

## CTWA (bloqueo externo)

La integración Kommo actual **no tiene evidencia** de entregar `ctwa_clid` en `message[add]`. Ver `docs/CTWA_KOMMO_CRM.md`. Desplegar este código **no** resuelve CTWA.

## Estado local

Código + migración locales. **No** Production / push / Vercel en esta entrega.

Procedimiento único de despliegue/activación (flags OFF por defecto; no auto-activa):  
[`docs/META_WA_LEAD_SUBMITTED_ACTIVATION.md`](./META_WA_LEAD_SUBMITTED_ACTIVATION.md).

Migración demo auth/profiles: `supabase/local-only/` (**fuera** de `supabase/migrations`).  
Migración LS productiva pendiente de autorización: `20260918120000_meta_wa_lead_submitted.sql`.
