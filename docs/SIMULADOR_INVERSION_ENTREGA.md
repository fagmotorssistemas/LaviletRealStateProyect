# Simulador de inversión unificado — notas de entrega

Rama: `feature/simulador-inversion-unificado` (desde `4270bf1`).

## Contraste vs revisión 4270bf1

| Hallazgo | Antes | Ahora |
|----------|-------|-------|
| Dos paneles | Financiamiento + Simulador separados | Una sola experiencia; ambos accesos abren el mismo drawer |
| Preview | Solo `buildCashInvestmentPreview` / `mode:'cash'` | `buildInvestmentPreview` contado / financiado / manual |
| Vacancia | Fija en config; posible doble conteo conceptual | Editable; aplicada una sola vez sobre alquiler potencial |
| Entrada | UI 10–70% vs API 10–50% | Unificado 10–70% |
| Tasa/gastos al guardar | Tasa de institución; gastos ignorados en financiado | Viajan `applied_interest_rate`, vacancia, breakdown, gestión |
| Sin partner | Caía a cash en silencio | Error o `mode:'manual'` explícito |
| Auth escenarios | `lead_id`/teléfono cliente bastaban | Requiere cookie `lv_vid` → `tour_visitors.lead_id` |
| Cookies | z-90 sobre header del drawer | Ocultas con simulador abierto; z-50 |

## Migración pendiente (no aplicada remotamente)

Archivo: `supabase/migrations/20260917120000_investment_simulator_assumptions.sql`

Impacto: columnas snapshot (`simulation_mode`, `vacancy_rate_snapshot`, `expense_breakdown`, `calculation_version`, `rate_type`, etc.). El API hace fallback a insert legacy si las columnas aún no existen. Escenarios históricos no se reinterpretan con tasas nuevas.

## Pruebas

```bash
npm run test:financing
```

Caso base (precio 310000, entrada 30%, 7.8% nominal, 30 años, alquiler 1200, vacancia 5%, gastos 4280): **8/8 OK**.

## Política de redondeo

Dinero y ratios a 2 decimales (`round2` / `Number.EPSILON`).

## Verificación (2026-09-17)

### Comandos y resultados reales

| Comando | Resultado |
|---------|-----------|
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 (Next.js 16.2.0) |
| `npm run test:financing` | **19/19 pass** |

### Clasificación de pruebas

| Tipo | Qué cubre |
|------|-----------|
| **Mock / lógica** | save→reopen contado/financiado/manual; auth cruzada; rechazo de fallback legacy |
| **Persistencia local real (PGlite)** | aplica migración SQL, insert v2, 0 triggers en tabla |
| **Remoto (solo lectura)** | `financing_scenarios` **sin** columnas v2 (`simulation_mode` count=0). RPC `calculate_investment_analysis` existe y **UPDATE** filas, pero el código TS **ya no la invoca**. Sin triggers en la tabla. |
| **Persistencia remota real** | **Bloqueada** hasta aplicar migración (no se aplica remotamente por pedido). El API rechaza guardado incompleto con mensaje explícito. |

### Dependencia explícita

Guardar escenarios investment-v2 en producción requiere aplicar localmente/staging:

`supabase/migrations/20260917120000_investment_simulator_assumptions.sql`

Sin ella el POST falla (no confirma filas incompletas).

### Capturas

- `docs/capture-simulador-ambos-modos.png`
- `docs/simulador-ui-responsive-preview.html` (móvil/escritorio)
- `docs/simulador-acceptance-preview.html`
