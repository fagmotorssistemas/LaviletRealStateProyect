# Schedule Meta ↔ «Aceptar cita»

## Estado (preparación — no desplegado / no verificado en Production)

| Capa | Estado |
| --- | --- |
| Elegibilidad | Cerrada (`confirmed_by_client` + consent + canal evidente) |
| Intent durable | Columnas `meta_schedule_*` en appointments + RPC recover → `review_hold` |
| Persistencia | Solo **service_role** (sesión asesor no tiene GRANT outbox) |
| Pipeline web → Nest | Implementado; flags **OFF** por defecto |
| Promote `review_hold`→`pending` | Solo cita actual + revalidación; **nunca** lote histórico |
| BM WhatsApp Schedule | **Rechazado** en Nest; sin fallback a dataset web |
| Envío real | **OFF** |

Migraciones (no aplicar a Production aún):

1. `20260917152000_meta_capi_outbox_review_hold.sql`
2. `20260917160000_meta_schedule_recovery.sql`

Reversiones en `supabase/rollbacks/…_down.sql` (conservan datos outbox/CTWA).

## Controles (todos desactivados por defecto)

Con **todos** off: **cero** escrituras Schedule (ni intent ni outbox).

| Variable | Efecto |
| --- | --- |
| `META_SCHEDULE_LOCAL_PERSIST=true` | Intent atómico + `review_hold` |
| `META_SCHEDULE_DELIVERY_ENABLED=true` | Promote cita actual + drain Nest de Schedule |
| `META_SCHEDULE_FLUSH=true` | Flush FE→Nest (exige delivery) |
| `META_SCHEDULE_RECOVER_ENABLED=true` | RPC recover → `review_hold` o `needs_review` |

Intent (`lv_register_meta_schedule_intent`): una sola vez; `event_id`/`event_time` inmutables. Fallo Meta no revierte la cita.

Recover revalida canal; sin evidencia → `needs_review` + motivo (`channel_pending_evidence`, etc.); **nunca** asume `website`.

Migraciones en secuencia: `17152000` (review_hold **+** needs_review) → `17160000` (intent/recover).

## Recuperación durable

Tras confirmación del cliente se guarda intent (`meta_schedule_event_id`, `event_time` desde `confirmed_at`, payload).  
Si falla outbox, el recover automático (flag) reinserta **`review_hold`** con el mismo `event_id`/`event_time` y clave `schedule:{appointmentId}` (dedupe). **No** crea `pending`.

## WhatsApp BM

- Nest rechaza `Schedule` + `business_messaging` (`business_messaging_schedule_unverified`).
- Nest rechaza BM sin `messaging_dataset_id` + `ctwa_clid` + WABA (`business_messaging_identifiers_required`).
- **Nunca** usa `META_DATASET_ID` / pixel web como fallback.
- No se renombra la cita a otro `event_name`.

## Pixel Schedule

No es requisito para cerrar CAPI web Server.

## Pruebas simuladas

```bash
npm run test:meta-schedule
npm run build
# Nest:
npx jest src/drain/supabase-drain.service.spec.ts src/meta/schedule-graph.payload.spec.ts src/events/events.bm-gates.spec.ts --runInBand
npm run build
```

## Despliegue (cuando se autorice)

1. Migraciones review_hold → schedule_recovery  
2. Deploy FE + Nest con todos los flags Schedule en false  
3. Test: `META_SCHEDULE_LOCAL_PERSIST=true` → filas hold + intents  
4. Recover flag en Nest test  
5. Delivery+flush solo con runbook; Events Manager dataset **web**  

Reversión: apagar flags; no borrar outbox/CTWA; rollbacks de CHECK/columnas sin DELETE masivo.
