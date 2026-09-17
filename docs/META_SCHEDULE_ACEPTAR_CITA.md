# Schedule Meta ↔ «Aceptar cita»

## Estado (preparación — no desplegado / no verificado en Production)

| Capa | Estado |
| --- | --- |
| Elegibilidad | Cerrada (`confirmed_by_client` + consent + canal evidente) |
| Intent durable | RPC atómico inmutable; recover también cubre **hueco pre-intent** |
| Persistencia | Solo **service_role** |
| Pipeline web → Nest | Flags **OFF**; delivery unifica FE flush + Nest drain |
| BM WhatsApp Schedule | **Bloqueado** (`needs_review` / Nest reject); no remap a website |
| Envío real | **OFF** |

## Controles (default off → cero escrituras Schedule)

| Variable | Efecto |
| --- | --- |
| `META_SCHEDULE_LOCAL_PERSIST` | Intent + `review_hold` post-confirm |
| `META_SCHEDULE_RECOVER_ENABLED` | Nest/cron: recover (con o sin intent previo) |
| `META_SCHEDULE_DELIVERY_ENABLED` | Promote cita actual + drain Nest de Schedule |
| `META_SCHEDULE_FLUSH` | Flush FE (exige delivery) |

## Recuperación (incluye caída confirm→intent)

Firma **única**: `lv_recover_missing_meta_schedule_outbox(p_limit DEFAULT 50, p_lookback_days DEFAULT 7)` (máx. lookback 30d). Sin sobrecarga `(integer)` — evita ambigüedad PostgREST.

Nest llama solo `{ "p_limit": 50 }` (lookback = default 7).

- Citas `confirmed_by_client` + consent + `confirmed_at` dentro de lookback.
- **Sin intent:** crea intent inmutable (`event_time` = epoch de `confirmed_at`) y outbox.
- **Con intent sin outbox:** reinserta outbox con mismos ids.
- Canal web → `review_hold`; WhatsApp → `needs_review` + `whatsapp_schedule_delivery_blocked`; sin evidencia → `needs_review` + `channel_pending_evidence`.
- **Nunca** asume `website` ni crea `pending`. No revierte la cita.
- No recupera históricos fuera del lookback.

## WhatsApp Schedule (bloqueado y documentado)

- Recover: `needs_review` / `whatsapp_schedule_delivery_blocked`.
- Nest enqueue: `business_messaging_schedule_unverified`.
- No se renombra el evento ni se convierte en conversión web.

## Migraciones (orden exacto, solo cuando se autorice)

1. `20260917152000_meta_capi_outbox_review_hold.sql` (`needs_review` + `review_hold`)
2. `20260917160000_meta_schedule_recovery.sql` (intent RPC + recover base)
3. `20260917170000_meta_schedule_recover_pre_intent.sql` (hueco pre-intent + lookback; **una** firma)

## Reversión predeterminada (conserva esquema y datos)

1. Apagar flags: `META_SCHEDULE_LOCAL_PERSIST`, `META_SCHEDULE_RECOVER_ENABLED`, `META_SCHEDULE_DELIVERY_ENABLED`, `META_SCHEDULE_FLUSH` → `false`.
2. Restaurar código FE/Nest a la revisión previa (sin merge inverso destructivo de datos).
3. **No** ejecutar automáticamente `supabase/rollbacks/*_down.sql`.

Los `down.sql` son emergencia manual. En particular `20260917160000_…_down.sql` **elimina columnas/datos del intent** (`DROP COLUMN meta_schedule_*`). No usarlos como rollback operativo.

## Pruebas

```bash
# Unitarias (simuladas)
npm run test:meta-schedule
npm run build

# DB aislada real (Docker Postgres) — migraciones + RPC + concurrencia 2 conexiones
powershell -File scripts/meta-schedule-recover-isolated/run.ps1

# Nest
npx jest src/drain/supabase-drain.service.spec.ts src/meta/schedule-graph.payload.spec.ts src/events/events.bm-gates.spec.ts --runInBand
npm run build
```

## Despliegue (cuando se autorice — no ahora)

1. Aplicar migraciones 1→2→3 en el entorno de revisión.
2. Deploy FE + Nest; **todos** los flags Schedule en `false`.
3. Activar solo `META_SCHEDULE_RECOVER_ENABLED` en test si se valida el hueco.
4. Luego `META_SCHEDULE_LOCAL_PERSIST` en test.
5. Delivery/flush solo con runbook; WhatsApp Schedule sigue bloqueado.
6. Verificación: filas `review_hold` / `needs_review`; Events Manager web solo tras delivery.

Sin merge a Production, sin eventos reales Meta, sin campañas en este alcance.
