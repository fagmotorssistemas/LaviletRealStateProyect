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

1. **Reopen / precio:** fuente de precio explícita (`useCurrentPublishedPrice` + `scenarioUnitPrice`), **independiente** de `initSource`. Editar alquiler/gastos/entrada/tasa **no** salta al publicado. Tras guardar se conserva el snapshot (`useCurrentPublishedPrice:false`). Solo el botón «Actualizar al precio publicado» cambia a precio actual.
2. **Ceros / init:** `initSource` (`empty` \| `bootstrap` \| `scenario` \| `user`) reemplaza heurística placeholder por ceros; `finiteOrNull` conserva alquiler/gastos/tasa 0. `initSource` ya no gobierna el precio.
3. **Legacy:** `assessScenarioFidelity` + UI (badge/aviso); resultados guardados se conservan; no se presenta reconstrucción exacta si falta versión v2.
4. **Contrato API:** `scenarioValidate` — mode/rate_type listas cerradas → 400; números finitos/límites; breakdown vs `annual_expenses` coherentes; `calculation_version`/`assumptions_json` solo servidor; `project_id` del body ignorado.
5. **Auth privada / aislamiento visitante:** columna `created_by_visitor_key`; GET/DELETE filtran por cookie `lv_vid`. Deduplicar lead por teléfono/email **no** concede ni reasigna escenarios ajenos (no hay claim histórico por coincidencia de contacto).
   - Escenarios **sin** `created_by_visitor_key` quedan **fuera** del listado público del visitante.
   - Cambiar o perder la cookie `lv_vid` impide recuperar escenarios anteriores de esa sesión/dispositivo.
6. **Cálculo:** `breakeven_month` alineado con horizonte de recuperación; etiquetas de flujo antes de IR.

## Caso de referencia

| Modo | Esperado | Evidencia |
|------|----------|-----------|
| Contado | flujo 9400, retorno 3.03% | unit tests + E2E local |
| Financiado | cuota ≈1562.12, flujo ≈−9345.44, retorno ≈−10.05% | unit tests + E2E local |
| Precio histórico | save 310k → publicado 350k → reopen/editar/guardar = 310k; solo «Actualizar…» = 350k | `calculatorUnitPrice.test.ts` |

## Comandos

```bash
npx tsc --noEmit
npm run build
npm run test:financing   # 28 tests
node scripts/financing-local-e2e.cjs
```

## Migraciones (orden)

Local / remoto autorizado:

1. `20260917120000_investment_simulator_assumptions.sql`
2. `20260917180000_financing_scenario_visitor_scope.sql`

Reversión operativa = rollback de **app** al SHA de Production registrado; **no** DROP de columnas. Ver `docs/SIMULADOR_MIGRACION_ORDEN.md`.

## Capturas tour real

- `docs/capture-tour-real-*.png` (cash, financed, desktop, mobile, reopen-manual, unit-change)
