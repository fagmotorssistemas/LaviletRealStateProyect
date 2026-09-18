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

const PRIOR_VERSION_MESSAGES: Record<string, string> = {
  'investment-v4':
    'Escenario investment-v4: se muestran los resultados guardados. Al recalcular se usarán los gastos vigentes de la propiedad (predial + alícuota) y se excluirán seguro y otros gastos de ese bloque.',
  'investment-v3':
    'Escenario histórico (v3): se muestran los resultados guardados. Al recalcular se aplicarán las fórmulas y gastos de propiedad actuales.',
  'investment-v2':
    'Escenario histórico (v2): se muestran los resultados guardados. Al recalcular se aplicarán las fórmulas y gastos de propiedad actuales.',
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
  const priorMessage = version ? PRIOR_VERSION_MESSAGES[version] : null
  return {
    kind,
    version,
    missingAssumptions: missing,
    message:
      priorMessage ??
      (kind === 'legacy'
        ? 'Escenario histórico: se muestran los resultados guardados. Los supuestos incompletos no se reinterpretan con las fórmulas actuales. Al recalcular se usarán los gastos vigentes (predial + alícuota), sin seguro ni otros del bloque de propiedad.'
        : `Versión de cálculo (${version}). Se muestran los resultados guardados sin reconstrucción exacta. Al recalcular se usarán los gastos vigentes (predial + alícuota).`),
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
