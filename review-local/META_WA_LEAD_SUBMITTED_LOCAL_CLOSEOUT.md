# WA LeadSubmitted — cierre preparación local

Fecha: 2026-09-18

## SHAs (working trees locales; sin push)

| Repo | Remote | Branch | HEAD |
| --- | --- | --- | --- |
| frontend | LaviletRealStateProyect | main | f88bea49bea5bb51bd05b154da51d1b89b8a0ced |
| Nest | backend-La-Vilet | main | ea39deef734f1cd51f686617d5e0ddc51060c2d3 |

Nota: ambos trees tienen cambios locales no pusheados (tests Nest, docs FE, local-only migration move). HEAD arriba = último commit; ver `git status`.

## Flags al cerrar (OFF)

FE `.env.local`: `META_WA_LEAD_SUBMITTED_ENABLED=false`, `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED=false`  
Nest `.env`: mismas + `META_API_VERSION=v21.0`

## Destino BM

- WABA `1410020224338488`
- Dataset `4419657838288963`
- Credencial `META_WA_CAPI_ACCESS_TOKEN` (sin fallback al token web)

## Pruebas Nest (Graph simulado — no Meta real)

```
npx jest --testPathPatterns="outbox-wa-lead-submitted-flow|wa-messaging-credential|events.bm-gates|wa-lead-submitted-consent|outbox-wa-lead-submitted-delivery"
→ 5 suites / 26 tests passed
```

Cubre: enqueue BM+CTWA, claim/send/resultado, consent true/false, tenant/project hold, delivery OFF sin perder pending, duplicados idempotency_key, retry 500→sent, lane WA v21, DTO rechaza TestEvent.

## No presentado como validación Meta real

- Sonda independiente TestEvent/v26.0
- Preview HTML bitácora
- Mocks de fetch en Jest

## Pendientes

1. Despliegue pendiente (push/deploy/migración remota `20260918120000`)
2. Validación CTWA real pendiente (Kommo no evidenciado)
3. Activación conversiones pendiente (flags OFF)

Procedimiento: `docs/META_WA_LEAD_SUBMITTED_ACTIVATION.md`
