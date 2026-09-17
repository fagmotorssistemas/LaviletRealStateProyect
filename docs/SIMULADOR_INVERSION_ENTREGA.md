# Simulador de inversión unificado — notas de entrega (cierre PR #6)

Rama: `feature/simulador-inversion-unificado`.

## Entorno de verificación (solo local)

| Pieza | Valor |
|-------|-------|
| Next.js | `http://127.0.0.1:3000` (`npm run dev`) |
| Supabase local | `supabase-local/` → API `http://127.0.0.1:54331`, DB `54332` |
| Proyecto Docker | `lavilet-local-financing` |
| Identidades E2E | flujo real `lv_vid` + lead (`scripts/financing-local-e2e.cjs`) |

**No** migraciones remotas, **no** merge, **no** Production. Preview Vercel comparte Supabase de Production: **sin** pruebas de escritura allí.

## Correcciones de cierre

1. **Reopen / precio:** `loadFromScenario` restaura `unit_price` guardado; el precio publicado no lo pisa. Botón explícito «Actualizar al precio publicado».
2. **Ceros / init:** `initSource` (`empty` \| `bootstrap` \| `scenario` \| `user`) reemplaza heurística placeholder por ceros; `finiteOrNull` conserva alquiler/gastos/tasa 0.
3. **Legacy:** `assessScenarioFidelity` + UI (badge/aviso); resultados guardados se conservan; no se presenta reconstrucción exacta si falta versión v2.
4. **Contrato API:** `scenarioValidate` — mode/rate_type listas cerradas → 400; números finitos/límites; breakdown vs `annual_expenses` coherentes; `calculation_version`/`assumptions_json` solo servidor; `project_id` del body ignorado.
5. **Auth privada:** columna `created_by_visitor_key`; GET/DELETE filtran por visitante. Deduplicar lead por teléfono **no** concede escenarios ajenos.
6. **Cálculo:** `breakeven_month` alineado con horizonte de recuperación; etiquetas de flujo antes de IR.

## Caso de referencia

| Modo | Esperado | Evidencia |
|------|----------|-----------|
| Contado | flujo 9400, retorno 3.03% | unit tests + E2E local |
| Financiado | cuota ≈1562.12, flujo ≈−9345.44, retorno ≈−10.05% | unit tests + E2E local |

## Comandos

```bash
npx tsc --noEmit
npm run build
npm run test:financing   # 25 tests
node scripts/financing-local-e2e.cjs
```

## Migraciones (orden)

Local / remoto autorizado:

1. `20260917120000_investment_simulator_assumptions.sql`
2. `20260917180000_financing_scenario_visitor_scope.sql`

Reversión operativa = rollback de **app** al SHA de Production registrado; **no** DROP de columnas. Ver `docs/SIMULADOR_MIGRACION_ORDEN.md`.

## Capturas tour real

- `docs/capture-tour-real-*.png` (cash, financed, desktop, mobile, reopen-manual, unit-change)
