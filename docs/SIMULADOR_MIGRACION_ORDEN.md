# Orden de migración / despliegue / reversión

## Entorno verificado (solo local)
- Supabase local: `supabase-local/` → API `http://127.0.0.1:54331`, DB `54332`
- Next.js: `.env.local` apuntando a ese API (no commitear)
- Proyecto Docker: `lavilet-local-financing`

## Orden exacto (local)

1. Arrancar Docker Desktop.
2. `npx supabase start --workdir supabase-local`
   - Aplica en orden:
     1. `supabase-local/supabase/migrations/20260101000000_local_financing_baseline.sql`
     2. `supabase-local/supabase/migrations/20260917120000_investment_simulator_assumptions.sql`
3. Crear `.env.local` (no commitear) con URL/keys de `supabase status --workdir supabase-local`.
4. `npm run dev`
5. `node scripts/financing-local-e2e.cjs`

## Remoto (cuando se autorice — no ahora)

1. Backup de `financing_scenarios`.
2. Aplicar **solo** `supabase/migrations/20260917120000_investment_simulator_assumptions.sql` (`ADD COLUMN IF NOT EXISTS`; no borra datos).
3. Desplegar app con investment-v2 (rama/commit de este PR).
4. Smoke POST/GET/DELETE.

## Reversión operativa (preserva columnas y datos v2)

La reversión **operativa** es solo de **aplicación**. No ejecuta SQL que elimine columnas ni filas.

| Acción | Qué hace | Efecto en escenarios v2 |
|--------|----------|-------------------------|
| Restaurar app a `4270bf1` (`origin/main`, pre–simulador unificado) | Redeploy / revert del deploy de app | **Ninguno**: columnas `simulation_mode`, `vacancy_rate_snapshot`, `expense_breakdown`, etc. y sus valores **permanecen** |
| Restaurar app a un commit intermedio de esta rama (`abded29` o posterior) | Redeploy | **Ninguno**: mismos datos; la UI/API v2 sigue pudiendo leerlos |
| Dejar la migración aplicada y solo quitar el deploy nuevo | — | **Ninguno** |

### Versión de app recomendada para rollback sin tocar escenarios

- **Objetivo “volver atrás el producto” sin pérdida de snapshots:** restaurar **`4270bf1`** (o el tip de `main` previo al merge de este PR).
- Esa versión **no escribe** columnas v2, pero **tampoco las borra**. Los escenarios ya guardados con `calculation_version = investment-v2` siguen en la tabla.
- Limitación esperada tras ese rollback de app: la UI antigua **no reabre con fidelidad** todos los supuestos v2 (vacancia editable, breakdown, modo manual explícito). Eso es degradación de producto, no pérdida de datos.
- Para **volver a leer/guardar v2 con fidelidad**, redesplegar un commit ≥ `abded29` (idealmente el SHA final de este PR) **sin** reaplicar migración si las columnas ya existen.

### Qué no es reversión operativa

- Cualquier `DROP COLUMN` / borrado de filas / `TRUNCATE` sobre `financing_scenarios`.
- Reinterpretar o sobrescribir escenarios históricos con nuevas tasas.

## Limpieza destructiva (acción posterior, separada y explícita)

Solo si un humano decide **descartar** snapshots v2 a propósito (p. ej. entorno de laboratorio local). **No** forma parte del rollback operativo ni del plan de producción por defecto.

Archivo: `supabase/rollbacks/20260917120000_investment_simulator_assumptions_DESTRUCTIVE_drop_v2_columns.sql`

- Elimina columnas de snapshot v2.
- Pierde vacancia, breakdown, modo, `assumptions_json`, etc. de filas existentes.
- Debe ejecutarse solo con confirmación explícita y backup previo.
- Tras esa limpieza, el API investment-v2 rechazará guardados nuevos hasta reaplicar la migración `20260917120000_...`.

## Notas
- El historial en `supabase/migrations/` del monorepo no es un bootstrap completo; el stack local aislado está en `supabase-local/`.
- RPC remoto `calculate_investment_analysis` no se invoca desde el API v2 (evita overwrite).
