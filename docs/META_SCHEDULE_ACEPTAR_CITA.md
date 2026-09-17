# Schedule Meta ↔ «Aceptar cita»

## Estado

| Capa | Estado |
| --- | --- |
| Elegibilidad (PR #5) | **Cerrada** |
| Preparación de entrega | **En curso** (web vs WhatsApp, persist local gated) |
| Flush Nest → Meta | **OFF** — no publicar ni activar envíos reales |
| `queueable` / `canFlushNest` | **false** |

## Elegibilidad (cerrada)

- Confirmación definitiva: `aceptado`/`reprogramado` + `confirmed_by_client === true`.
- Consent ads: `leads.meta_ads_consent === true` (aceptar cita ≠ consent).
- Canal: solo `web`/`website` o `whatsapp`/`waba`. **`crm`/vacío → pendiente** (no website).
- Gancho en `agenda/actions.ts` tras save confirmado; propuestas y fallos RPC excluidos.

## Contrato frontend → Nest → Meta

Cliente Nest actual (`enqueueMetaEvent` → `POST /api/v1/events`):

- Envía: `event_name`, `idempotency_key`, `event_id`, `action_source`, PII de matching (`phone`, …), `fbp`/`fbc`/`fbclid`, `ads_consent`.
- **No** envía: `ctwa_clid`, `messaging_channel`, `waba_id`.

### Web (`action_source: website`)

| Requerido para armar payload | Opcional | Bloqueo actual |
| --- | --- | --- |
| Teléfono del lead, consent vigente, confirmación cliente | `fbp`/`fbc`/`fbclid` | `flush_nest_inactive` |

### WhatsApp (`action_source: business_messaging`)

| Identificador | Si falta |
| --- | --- |
| `phone` | No se arma payload (`whatsapp_phone_missing`) |
| `messaging_channel: whatsapp` | Previsto en payload local; Nest no lo reenvía |
| `ctwa_clid` | `whatsapp_ctwa_clid_missing` — atribución CTWA floja; el CRM/cita **siguen**; no se inventa clid |
| `waba_id` | `whatsapp_waba_id_missing` |
| Contrato Nest messaging | `whatsapp_delivery_pending_nest_contract` + `nest_payload_missing_messaging_fields` |

Sin CTWA: se puede preparar fila local de revisión con teléfono, pero **no** hay optimización CTWA ni flush.

## Persistencia y dedupe

- Clave: `schedule:{appointmentId}` (doble clic / reintento → `duplicate_local`).
- Consent re-leído al preparar; `ads_consent_required: true` en outbox.
- Persistencia local solo con `META_SCHEDULE_LOCAL_PERSIST=true` (o flag de test). **Por defecto off.**
- Flush Nest: `isScheduleFlushEnabled()` → siempre `false` en esta preparación.

Código: `scheduleContract.ts`, `scheduleDelivery.ts`, `scheduleEligibility.ts`, gancho en `scheduleIntegration.ts` / `agenda/actions.ts`.

## Pruebas

```bash
npm run test:meta-schedule
```

## Bloqueos concretos que quedan

1. **Flush Nest/Meta OFF** — no activar envíos.
2. **Nest sin campos messaging/CTWA** — extender `enqueueMetaEvent` + Nest antes de WhatsApp live.
3. **CTWA real no verificado** en webhook Kommo — sin captura real, `ctwa_clid` suele faltar.
4. **WABA id** de entorno (`META_WABA_ID`) no cableado a producción.
5. **Pixel Schedule** no disparado (solo CAPI outbox local, y gated).

## Fuera de alcance ahora

- Publicar, `META_SCHEDULE_FLUSH`, Test Events Meta, mensajes/citas ficticias en Production.
