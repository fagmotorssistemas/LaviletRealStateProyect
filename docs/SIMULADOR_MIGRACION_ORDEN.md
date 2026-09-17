# Orden de migración / despliegue (solo local por ahora)

## Entorno verificado
- Supabase local: `supabase-local/` → API `http://127.0.0.1:54331`, DB `54332`
- Next.js: `.env.local` apuntando a ese API + service_role demo
- Proyecto Docker: `lavilet-local-financing`

## Orden exacto (local)

1. Arrancar Docker Desktop.
2. `npx supabase start --workdir supabase-local`
   - Aplica en orden:
     1. `supabase-local/supabase/migrations/20260101000000_local_financing_baseline.sql`
     2. `supabase-local/supabase/migrations/20260917120000_investment_simulator_assumptions.sql` (copia de la del repo)
3. Completar tablas de catálogo tour si hace falta (unit_types, typology_assets, finish_packages) — ya incluidas en el baseline actualizado si se regenera.
4. Crear `.env.local` (no commitear) con URL/keys de `supabase status --workdir supabase-local`.
5. `npm run dev`
6. `node scripts/financing-local-e2e.cjs`

## Remoto (cuando se autorice — no ahora)

1. Backup de `financing_scenarios`.
2. Aplicar **solo** `supabase/migrations/20260917120000_investment_simulator_assumptions.sql` (ADD COLUMN IF NOT EXISTS; no borra datos).
3. Desplegar app con investment-v2.
4. Smoke POST/GET/DELETE.

## Reversión que preserva escenarios

1. Ejecutar `supabase/rollbacks/20260917120000_investment_simulator_assumptions_down.sql` (DROP columnas v2).
2. Las filas y columnas legacy (precio, tasa aplicada, gastos, flujo, roi, etc.) **permanecen**.
3. Rollback de app a versión pre-v2 **o** mantener API que rechace guardados incompletos hasta reaplicar migración.

## Notas
- El historial en `supabase/migrations/` del monorepo NO es un bootstrap completo; el stack local aislado está en `supabase-local/`.
- RPC remoto `calculate_investment_analysis` no se invoca desde el API v2 (evita overwrite).
