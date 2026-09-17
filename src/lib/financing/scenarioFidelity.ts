import { CALCULATION_VERSION } from '@/lib/financing/calculator'
import type { FinancingScenario } from '@/types/financingSimulator'

export type ScenarioFidelity =
  | { kind: 'exact'; version: string }
  | {
      kind: 'legacy' | 'unknown'
      version: string | null
      missingAssumptions: string[]
      message: string
    }

export function assessScenarioFidelity(
  row: Pick<
    FinancingScenario,
    | 'calculation_version'
    | 'simulation_mode'
    | 'vacancy_rate_snapshot'
    | 'expense_breakdown'
    | 'rate_type'
    | 'assumptions_json'
    | 'annual_net_cash_flow'
    | 'roi_percent'
    | 'monthly_payment'
    | 'unit_price'
  >,
): ScenarioFidelity {
  const version = row.calculation_version?.trim() || null
  if (version === CALCULATION_VERSION) {
    return { kind: 'exact', version }
  }

  const missing: string[] = []
  if (row.simulation_mode == null) missing.push('simulation_mode')
  if (row.vacancy_rate_snapshot == null) missing.push('vacancy_rate_snapshot')
  if (row.expense_breakdown == null) missing.push('expense_breakdown')
  if (row.rate_type == null) missing.push('rate_type')
  if (row.assumptions_json == null) missing.push('assumptions_json')
  if (version == null) missing.push('calculation_version')

  const kind = version == null || version === '' ? 'legacy' : 'unknown'
  return {
    kind,
    version,
    missingAssumptions: missing,
    message:
      kind === 'legacy'
        ? 'Escenario histórico: se muestran los resultados guardados. Los supuestos incompletos no se reinterpretan con las fórmulas actuales.'
        : `Versión de cálculo desconocida (${version}). Se muestran los resultados guardados sin reconstrucción exacta.`,
  }
}

/** Números finitos o null; no usa || para no perder ceros. */
export function finiteOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function finiteOr(value: unknown, fallback: number): number {
  const n = finiteOrNull(value)
  return n == null ? fallback : n
}
