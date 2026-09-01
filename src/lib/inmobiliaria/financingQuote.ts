/** Cuota francesa: tasa anual en % y plazo en meses. */
export function frenchMonthlyPayment(principal: number, annualRatePct: number, months: number): number {
  if (!(principal > 0) || !(months > 0)) return 0
  const r = annualRatePct / 100 / 12
  if (r === 0) return principal / months
  const factor = (1 + r) ** months
  return (principal * r * factor) / (factor - 1)
}

export function quoteTotals(params: {
  unitPrice: number
  entryAmount: number
  annualRatePct: number
  termMonths: number
}) {
  const unitPrice = Math.max(0, params.unitPrice || 0)
  const entryAmount = Math.min(Math.max(0, params.entryAmount || 0), unitPrice)
  const financed = Math.max(0, unitPrice - entryAmount)
  const entryPct = unitPrice > 0 ? (entryAmount / unitPrice) * 100 : 0
  const monthly = frenchMonthlyPayment(financed, params.annualRatePct || 0, params.termMonths || 0)
  const totalPaid = monthly * (params.termMonths || 0)
  const totalInterest = Math.max(0, totalPaid - financed)
  return {
    unitPrice,
    entryAmount,
    entryPct,
    financed,
    monthly,
    totalPaid,
    totalInterest,
  }
}

export interface ScheduleRow {
  n: number
  payment: number
  interest: number
  principal: number
  balance: number
}

export function buildAmortizationSchedule(
  principal: number,
  annualRatePct: number,
  months: number,
): ScheduleRow[] {
  if (!(principal > 0) || !(months > 0)) return []
  const payment = frenchMonthlyPayment(principal, annualRatePct, months)
  const r = (annualRatePct || 0) / 100 / 12
  let balance = principal
  const rows: ScheduleRow[] = []
  for (let n = 1; n <= months; n++) {
    const interest = balance * r
    const amort = Math.min(balance, payment - interest)
    balance = Math.max(0, balance - amort)
    rows.push({ n, payment, interest, principal: amort, balance })
  }
  return rows
}
