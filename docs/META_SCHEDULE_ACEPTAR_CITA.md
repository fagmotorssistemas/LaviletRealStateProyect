# Schedule Meta ↔ «Aceptar cita»

## Estado (preparación técnica — no desplegado / no verificado en Production)

| Capa | Estado |
| --- | --- |
| Elegibilidad | **Cerrada** (`confirmed_by_client` + consent + canal evidente) |
| Persistencia revisión | `review_hold` + reintentos + dedupe `schedule:{appointmentId}` |
| Flush local / drain Nest | Solo `pending`; `review_hold` excluido (query + defensa) |
| Nest Graph website Schedule | Shape simulado OK (test Nest) |
| Nest Graph BM | `ctwa_clid` + WABA en `user_data`; dataset messaging tipado |
| Envío real Nest→Meta | **OFF** |
| WhatsApp `event_name: Schedule` | **Bloqueado** (no renombrar a otro evento) |

Migración (no aplicar a Production aún): `20260917152000_meta_capi_outbox_review_hold.sql`  
Reversión (conserva datos si no hay filas hold, o falla si las hay): `supabase/rollbacks/20260917152000_meta_capi_outbox_review_hold_down.sql`

## Trigger de negocio

Dispara Schedule solo con **confirmación definitiva del cliente** (`confirmed_by_client === true`), p. ej. `acceptClientVisitTime` / request `status=confirmed`.  
**No** dispara solo porque el asesor acepte/manual `confirm_appointment` (`confirmed_by_client=false` → `client_confirmation_missing`).

Consentimiento publicitario (`meta_ads_consent`) es independiente de aceptar la cita. PII del **lead**, nunca del asesor.

## Web — flujo preparado (persist/flush gated)

1. Cliente confirma horario → gancho `notifyScheduleIfRequestConfirmed` / `afterAppointmentConfirmedForSchedule`
2. Relee `meta_ads_consent`
3. Plan `action_source=website` + phone/PII lead
4. Si `META_SCHEDULE_LOCAL_PERSIST=true` → inserta `review_hold` con hasta 3 reintentos (`persist_failed` si agota)
5. Dedupe: segunda confirmación / doble clic → `duplicate_review_hold`
6. Flush Nest **hard-off** (`isScheduleFlushEnabled` → false)
7. Nest `buildGraphPayload` website: `event_name=Schedule`, `user_data` hasheado, cookies, IP/UA, URL origen (conservador)

Revocación consent: `cancelPendingMetaOutbox` cancela **pending y review_hold**.

## WhatsApp — docs Meta BM (oficial)

Fuente: [Conversions API for Business Messaging](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/)

- Destino: `POST /{DATASET_ID}/events` — dataset creado desde WABA; **WABA ≠ dataset**
- `action_source=business_messaging`, `messaging_channel=whatsapp`
- `user_data.whatsapp_business_account_id` + `user_data.ctwa_clid` (required para atribución CTWA)
- Ejemplo oficial usa `Purchase`; **no** se renombra la cita a otro `event_name` para “hacerla pasar”
- Bloqueo: `whatsapp_schedule_event_name_unverified` — `Schedule` bajo BM no confirmado en allowlist Meta
- Bloqueo: `whatsapp_ctwa_clid_required` si falta CTWA (no es “atribución floja”)
- Sin remapear canal WhatsApp → website

## Pruebas (simuladas — no recepción Meta real)

```bash
# Frontend
npm run test:meta-schedule

# Backend (lavilet-meta-capi)
npx jest src/drain/supabase-drain.service.spec.ts src/meta/schedule-graph.payload.spec.ts --runInBand
```

## Orden de despliegue (cuando se autorice — no ejecutar ahora)

1. Migración CTWA (si no aplicada): `20260916220000_whatsapp_ctwa_attribution.sql`
2. Migración `review_hold`: `20260917152000_meta_capi_outbox_review_hold.sql`
3. Deploy frontend (PR #5) con `META_SCHEDULE_LOCAL_PERSIST` **false** y flush off
4. Deploy Nest (rama drain + Graph BM user_data) con `SUPABASE_DRAIN_ENABLED` según entorno; **no** activar envío Schedule aún
5. Variables: `META_WABA_ID`, `META_MESSAGING_DATASET_ID` (solo cuando BM verificado); mantener `META_CORE_SETUP_CONSERVATIVE` y modos actuales
6. Activación gradual: primero `META_SCHEDULE_LOCAL_PERSIST=true` en test → verificar filas `review_hold` → promover a `pending` solo con runbook → flush/drain
7. Verificación: Events Manager del dataset **web** para Schedule website; BM solo tras allowlist/`ctwa_clid` reales

## Reversión (conserva datos / atribuciones)

1. Desactivar `META_SCHEDULE_LOCAL_PERSIST` y cualquier flush Schedule
2. No borrar `meta_capi_outbox` ni `lv_whatsapp_ctwa_attribution`
3. Rollback CHECK `review_hold` solo si no quedan filas hold (script en `rollbacks/…_down.sql` falla si hay filas)
4. Rollback código frontend/Nest a SHA previo
5. CTWA first-touch: no revertir capturas

## Bloqueos externos concretos

1. `Schedule` como `event_name` en business_messaging no verificado frente a Meta
2. CTWA real Kommo no verificado sin anuncio/click real
3. Persist/flush Schedule **apagados** por diseño hasta runbook
4. Migración `review_hold` no aplicada a Production
5. Pixel Schedule browser no cableado en este alcance
6. Campañas/publicaciones publicitarias fuera de alcance
