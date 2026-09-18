# Consolidación remota parcial — 2026-09-18

## Borrados remotos ejecutados (puntas en origin/main)

| Repo | Rama | Tip verificado | Contención | Resultado |
| --- | --- | --- | --- | --- |
| LaviletRealStateProyect | review/meta-capi | be7932a… | `merge-base --is-ancestor` → origin/main | **deleted** |
| backend-La-Vilet | fix/meta-emq-name-split | c3d1f4c… | en origin/main | **deleted** |
| backend-La-Vilet | fix/supabase-drain-exclude-review-hold | ce707c7… | en origin/main | **deleted** |

Ninguna quedó solo en main local: las tres ya estaban en `origin/main`.

## Push de main: no ejecutado

| Repo | HEAD local | origin/main |
| --- | --- | --- |
| FE | 207ce37ecff05d0b6c1f48e45876dc77c9256d62 | 4958d4e… (ahead 7) |
| Nest | 6482ccf58a5a8854fd8e08ed888065754f52952f | e65ac41… (ahead 4) |

## Ramas que quedan en GitHub (`git ls-remote --heads`)

### FE LaviletRealStateProyect
- main
- feat/kommo-ctwa-clid-preserve
- feat/meta-schedule-aceptar-cita
- feature/simulador-inversion-unificado
- fix/meta-emq-matching
- fix/meta-pixel-consent-autoconfig

(Esas feat/fix **no** se tocaron: fuera del pedido; tips ya estaban en historial local consolidado, pero siguen publicadas en GitHub.)

### Backend backend-La-Vilet
- **solo main**

## Builds / pruebas (SHAs consolidados locales)

| Check | Resultado |
| --- | --- |
| Nest `npm run build` | OK |
| Nest WA specs (26) | OK |
| FE `test:meta-wa-lead-submitted` (26) | OK |
| FE `test:meta-capi-bitacora` (17) | OK |
| FE `test:ctwa-kommo` (18) | OK |
| FE `npm run build` | OK |
| Flags OFF → `maybeRegisterWaLeadSubmitted` | `skipped` / `wa_lead_submitted_inactive` (sin admin/DB) |

## Alcance CAPI
- Outbox bitácora: `accessibleTenantIds` + filtro por `leads.tenant_id` (teléfono CRM solo si tenant autorizado).
- Conversion log Nest: `.in('tenant_id', tenantIds)` + exclude null; is_probe no bypasea.
- Consent LS: gate tenant/proyecto/contacto (tests OK).

## Flags OFF sin migración WA
Short-circuit antes de SELECT/UPDATE de columnas `meta_wa_*` / RPC bitácora LS. Desplegar código con flags false es seguro sin `20260918120000`.

## Orden deploy (sin ejecutar)
1. Nest DO manual (flags delivery false + token WA)
2. Push FE → Vercel auto
3. Más tarde: migración `20260918120000` solo si se activa evaluación
4. CTWA real → luego flags
