# Cierre local — WhatsApp → CAPI `LeadSubmitted`

**Sin push / merge / despliegue / migraciones remotas / eventos reales.**

## SHAs locales (tras commit en `main`)

Ver `review-local/META_WA_LEAD_SUBMITTED_SHA.txt` (se regenera al cerrar).

## Veredicto de revisión

| Área | Estado |
| --- | --- |
| Dataset ≠ WABA | Graph = `META_MESSAGING_DATASET_ID`; WABA solo en `user_data.whatsapp_business_account_id`. Sin fallback al pixel web. |
| Consentimiento | Negaciones / citas / bot no conceden; evidencia mensaje+fecha+alcance; revalidación antes de persistir. |
| Disparador | Interés del **turno** (texto o score events). Engagement histórico no convierte saludos/ambiguos. |
| Persistencia | RPC atómico; mismo `event_id` en duplicados; apagado Nest claim + drain para ya encolados. |
| Bitácora | `/inmobiliaria/marketing/capi` lee `meta_capi_conversion_log`; `evaluated` ≠ enviada; Meta accept correlacionado. |
| CTWA | **Bloqueo externo**: Kommo sin evidencia de `ctwa_clid`. Desplegar no lo resuelve. |
| Pixel / Lead / Schedule web | Conservados; flags WA default OFF. |

## Procedimiento único — activación y reversión

### Activación (cuando se autorice Production)

1. Flags **OFF** en FE y Nest: `META_WA_LEAD_SUBMITTED_ENABLED=false`, `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED=false`.
2. Aplicar migración local `20260918120000_meta_wa_lead_submitted.sql` (solo tras autorización remota).
3. Configurar **dos IDs distintos**: `META_MESSAGING_DATASET_ID` (Graph) y `META_WABA_ID` (user_data). Nunca el pixel web.
4. Desplegar Nest → Frontend (código con gates).
5. Verificar Pixel/Lead/Schedule y Marketing → CAPI (bitácora vacía o solo evaluaciones).
6. Encender `META_WA_LEAD_SUBMITTED_ENABLED=true` (persiste/bloquea; sin Graph).
7. Solo con CTWA real verificado: `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED=true` en FE **y** Nest.
8. Probar un lead genuino CTWA → Events Manager BM (`LeadSubmitted`).

### Reversión

1. Apagar `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED` (FE+Nest): pending/SQLite se conservan; Lead/VC siguen.
2. Apagar `META_WA_LEAD_SUBMITTED_ENABLED` si se desea dejar de evaluar.
3. No ejecutar `_down.sql` por defecto (borra intent/evidencia).
4. Rollback de código solo si hace falta; preferir flags.

## CTWA — bloqueo externo

Ver `docs/CTWA_KOMMO_CRM.md` y `docs/META_WA_LEAD_SUBMITTED_CONTINUATION.md`. Sin `ctwa_clid` no hay envío BM atribuible. Production: tabla lista, **0 filas** (no observado).

## Continuación (config Meta + evidencia)

Ver `docs/META_WA_LEAD_SUBMITTED_CONTINUATION.md`.

```bash
# FE
npm run test:meta-wa-lead-submitted

# Nest
npm test -- --testPathPattern="events.bm-gates|lead-submitted-bm|outbox-wa-lead-submitted"
```
