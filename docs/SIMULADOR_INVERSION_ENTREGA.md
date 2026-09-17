# Simulador de inversión unificado — notas de entrega

Rama: `feature/simulador-inversion-unificado`.

## Entorno de verificación (solo local)

| Pieza | Valor |
|-------|-------|
| Next.js | `http://127.0.0.1:3000` (`npm run dev`) |
| Supabase local | `supabase-local/` → API `http://127.0.0.1:54331`, DB `54332` |
| Proyecto Docker | `lavilet-local-financing` |
| Identidades E2E | flujo real `lv_vid` + lead (script `scripts/financing-local-e2e.cjs`) |

**No** se aplicaron migraciones remotas ni se publicó/mergeó.

## Persistencia real (Supabase local)

`node scripts/financing-local-e2e.cjs` → **OK**

- POST/GET/DELETE contado, financiado y tasa manual
- Guardar y reabrir reproduce supuestos y resultados
- Dos visitantes con cookies distintas: cada uno solo ve los suyos
- Sin cookie / cookie inventada / lead_id o teléfono del otro → rechazado
- Identidades generadas por el flujo real de la app (no mocks de auth)

PGlite cubre migración SQL en unit tests; **no** sustituye este E2E contra rutas Next + Kong local.

## Tour real Next (drawer integrado)

Verificado en el tour `/tour` (no HTML de preview):

| Check | Resultado |
|-------|-----------|
| Acceso «Simular inversión» | OK |
| Acceso «Financiamiento» | OK (mismo drawer) |
| Contado / financiado / tasa manual | OK |
| Cambio de unidad (Cambiar → 101/202) | OK (picker con `allUnits`) |
| Guardar → Guardados → Reabrir | OK (modo manual 9.5 %, flujo −6.62 %) |
| Cierre drawer | OK |
| Preferencias de cookies ocultas con drawer abierto; reaparecen al cerrar | OK |
| Escritorio (1280×800) y móvil (390×812) | OK |

### Capturas del tour real

- `docs/capture-tour-real-cash.png`
- `docs/capture-tour-real-financed.png`
- `docs/capture-tour-real-desktop-financed.png`
- `docs/capture-tour-real-mobile.png`
- `docs/capture-tour-real-mobile-financed.png`
- `docs/capture-tour-real-reopen-manual.png`
- `docs/capture-tour-real-unit-change-101.png`

Previews HTML independientes quedan solo como referencia histórica; la aceptación es el tour real.

## Correcciones en esta verificación

1. `TourViewer`: catálogo/unidades aunque no haya panoramas; picker del simulador usa `allUnits`.
2. `useFinancingCalculator`: bootstrap no deja alquiler/gastos en 0 tras placeholder vacío.
3. `TourSimulatorDrawer`: reabrir no remontaba el configurador al limpiar el escenario (se perdía modo/tasa).

## Orden migración / despliegue / reversión

Ver `docs/SIMULADOR_MIGRACION_ORDEN.md`.

Resumen: local = baseline `supabase-local` + assumptions; remoto (cuando se autorice) = solo `supabase/migrations/20260917120000_investment_simulator_assumptions.sql`; rollback = `supabase/rollbacks/20260917120000_investment_simulator_assumptions_down.sql` (DROP columnas v2; filas legacy se conservan).

## Pruebas de lógica

```bash
npm run test:financing
```
