# Aclaraciones — WhatsApp BM Schedule y promote Nest de recuperados

Documento local (commits sin push). Complementa `META_SCHEDULE_FINAL_DELIVERY.md`.

---

## A) WhatsApp / `Schedule` en Business Messaging

### Lista oficial (FAQ Meta CAPI BM)

Fuente consultada (texto FAQ de la guía oficial):  
https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/  
sección *Frequently Asked Questions* → *What type of messaging events does the Conversions API for Business Messaging support?*

Eventos admitidos listados ahí:

1. Purchase  
2. LeadSubmitted  
3. InitiateCheckout  
4. AddToCart  
5. ViewContent  
6. OrderCreated  
7. OrderShipped  
8. OrderDelivered  
9. OrderCanceled  
10. OrderReturned  
11. CartAbandoned  
12. QualifiedLead  
13. RatingProvided  
14. ReviewProvided  

**`Schedule` no aparece** en esa lista oficial.  
**`AppointmentBooked` tampoco** aparece en esa lista FAQ actual.

Por tanto:

| Afirmación | Estado |
| --- | --- |
| Enviar `event_name=Schedule` + `action_source=business_messaging` | **Bloqueado** — compatibilidad **no confirmada** / no listado en FAQ oficial |
| Usar otro nombre (p. ej. AppointmentBooked) como sustituto de la cita | **No propuesto** aquí: no está en la FAQ oficial citada; significado distinto de Schedule; **compatibilidad no confirmada** |
| Remapear la cita WA a `website` | **Prohibido** (cambia canal) |

Envío WhatsApp Schedule permanece bloqueado en FE (`needs_review`), recover SQL y Nest.

### Subcódigo Graph `2804066` — procedencia

- **Origen documentado:** hilo del foro de desarrolladores Meta  
  https://developers.facebook.com/community/threads/1076478633997788/  
  Respuesta Graph real reportada al enviar un `event_name` BM inválido (`LeadQualified`):

  - `error.code`: 100  
  - `error_subcode`: **2804066**  
  - `error_user_title`: *Invalid event type for messaging event*  
  - `error_user_msg`: el nombre no es válido para `business_messaging`; sugiere valores válidos como `Purchase` o `LeadSubmitted`.

- **Qué implica para Schedule:** el subcódigo prueba el mecanismo de rechazo Meta ante nombres BM no admitidos.  
  **No** hemos reproducido en esta entrega un POST Graph real con `Schedule` (prohibido por política de no eventos reales).  
  El bloqueo de Schedule se basa en: (1) ausencia en la lista FAQ oficial arriba, (2) patrón de rechazo 2804066 para nombres fuera de allowlist reportado por Meta/comunidad.

- **Custom conversions** con tipo `SCHEDULE` en Marketing API (pixel/custom conversion) **no** equivalen a un `event_name` CAPI BM admitido.

### Acción externa (si negocio quiere medición WA)

1. Confirmar por escrito con Meta / Events Manager qué `event_name` BM aplica al hito “cita confirmada”, si alguno.  
2. Solo entonces implementar ese nombre (sin llamarlo Schedule ni enviarlo como website).  
3. Hasta entonces: bloqueo; CTWA/WABA/dataset no bloquean atender ni confirmar la cita.

---

## B) Nest: promote automático de `review_hold` recuperados

### Cambio de comportamiento

Cuando **ambos** están activos:

- `META_SCHEDULE_RECOVER_ENABLED=true`  
- `META_SCHEDULE_DELIVERY_ENABLED=true`  

tras `lv_recover_missing_meta_schedule_outbox`, Nest ejecuta `promoteRecoveredWebScheduleHolds`: puede pasar filas `review_hold` → `pending`.

Esto **no** existía cuando recover solo dejaba `review_hold` sin promote.

### Límites (qué no hace)

| Límite | Detalle |
| --- | --- |
| Solo recuperados marcados | `last_error ∈ {recovered_pre_intent_gap, recovered_missing_schedule_outbox}` |
| Solo Schedule | `event_name=Schedule` |
| Solo website | `payload.action_source=website`; BM/WhatsApp no se promueven |
| Cap por tick | máx. 50 filas |
| Lookback | `confirmed_at` dentro de N días (default 7, env `META_SCHEDULE_RECOVER_LOOKBACK_DAYS`, máx. 30) |
| No es lote histórico genérico | Exige marca recovered_* + lookback de confirmación |
| Promote ≠ envío Graph | Solo cambia status a `pending`. El drain exige de nuevo delivery ON, consent, y `META_MODE` permitido antes de HTTP |

### Revalidación antes de promote (y por tanto antes de poder enviar)

Sobre la cita real (`appointments` vía `appointment_id` / `schedule:{uuid}`):

1. **Consent:** `leads.meta_ads_consent === true` (si false/missing → cancel / no promote).  
2. **Confirmación cliente:** `confirmed_by_client === true`.  
3. **Estado:** `aceptado` \| `reprogramado`.  
4. **Canal:** `web` \| `website` (WhatsApp/crm → no promote; cancela si canal incorrecto).  
5. **Antigüedad:** `confirmed_at` presente y dentro del lookback.

Pruebas locales (sin Meta): `src/drain/promote-recovered-schedule.spec.ts`.

### Activación / reversión de este comportamiento

- Apagar `META_SCHEDULE_DELIVERY_ENABLED` → recover puede escribir `review_hold` pero **no** promueve.  
- Apagar `META_SCHEDULE_RECOVER_ENABLED` → no recover ni promote recuperados.  
- Reversión operativa: flags OFF; conservar filas; no `down.sql` destructivo.
