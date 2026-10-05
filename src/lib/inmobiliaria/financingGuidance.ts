export type EntryRequirement = 'unconfirmed' | 'required' | 'not_required'
export type GuidanceSource = { source: string; checkedOn: string; reviewBy: string }
export type ProjectEntry = GuidanceSource & {
  enabled: boolean; requirement: EntryRequirement; kind: 'percent' | 'amount'; value: number | null
  due: string; categories: string[]; unitNumbers: string[]; mode: 'todos' | 'lanzamiento' | 'preventa'
}
export type ReservationPayment = GuidanceSource & {
  enabled: boolean; requirement: EntryRequirement; amount: number | null
  creditedToEntry: boolean | null; conditions: string
}
export type FinancingLenderTerms = GuidanceSource & {
  id: 'jep' | 'pichincha'; name: string; product: string; enabled: boolean
  advertisedPercent: number | null; purchasePercent: number | null; maxAmount: number | null
  annualRate: number | null; rateType: 'nominal_annual' | 'effective_annual' | 'unconfirmed'
  rateQualification: 'from' | 'reference'; minYears: number | null; maxYears: number | null
  exampleYears: number | null; monthlyCharges: number | null; notes: string; categories: string[]
}
export type FinancingGuidance = {
  enabled: boolean; estimatesEnabled: boolean; entry: ProjectEntry; reservation: ReservationPayment
  lenders: FinancingLenderTerms[]
}
export type FinancingGuidanceState = { settings: FinancingGuidance; version: string; saved: boolean }
export type FinancingGuidanceResult = { ok: true; state: FinancingGuidanceState } | { ok: false; error: string }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const categories = ['suite', 'departamento', 'penthouse', 'local']
const unknownSource = { source: '', checkedOn: '', reviewBy: '' }

/** Public references requested by the project owner; they never imply a project agreement or credit approval. */
export function defaultFinancingGuidance(): FinancingGuidance {
  const residential = ['suite', 'departamento', 'penthouse']
  return { enabled: true, estimatesEnabled: true,
    entry: { ...unknownSource, enabled: true, requirement: 'unconfirmed', kind: 'percent', value: null,
      due: '', categories: [...categories], unitNumbers: [], mode: 'todos' },
    reservation: { ...unknownSource, enabled: false, requirement: 'unconfirmed', amount: null, creditedToEntry: null, conditions: '' },
    lenders: [
      { id: 'jep', name: 'Cooperativa JEP', product: 'CrediMIVIVIENDA', enabled: true,
        advertisedPercent: 70, purchasePercent: 70, maxAmount: 150000, annualRate: 9.74,
        rateType: 'nominal_annual', rateQualification: 'reference', minYears: null, maxYears: null, exampleYears: null,
        monthlyCharges: null, categories: [...residential], checkedOn: '2026-10-05', reviewBy: '2026-11-05',
        source: 'https://www.jep.coop/productos-servicios/creditos/credimivivienda',
        notes: 'Producto publicado para adquisición de primera vivienda, sujeto a elegibilidad y evaluación; no asumir que aplica a inversión o segunda vivienda. La página consultada no especifica plazo ni cargos mensuales. No confirma un convenio particular con La Vilet.' },
      { id: 'pichincha', name: 'Banco Pichincha', product: 'Crédito hipotecario de vivienda', enabled: true,
        advertisedPercent: 83, purchasePercent: 80, maxAmount: null, annualRate: 7.5,
        rateType: 'unconfirmed', rateQualification: 'from', minYears: 3, maxYears: 20, exampleYears: null,
        monthlyCharges: null, categories: [...residential], checkedOn: '2026-10-05', reviewBy: '2026-11-05',
        source: 'https://www.pichincha.com/detalle-producto/personas-credito-hipotecario-de-vivienda\nhttps://www.pichincha.com/blog/meses-de-gracia-credito-ecuador',
        notes: 'El 83% anunciado incluye gastos legales y SOLCA; la guía del banco indica hasta 80% del valor del inmueble. Tasa desde 7,50%, sujeta a análisis; tipo de tasa por confirmar. Ofrece 3 meses de gracia: este cálculo básico no los aplica ni incluye gastos financiados. Monto máximo no informado en estas fuentes. No confirma un convenio particular con La Vilet.' },
    ] }
}

function fail(message: string): never { throw new Error(message) }
export function validateFinancingGuidance(value: unknown): FinancingGuidance {
  const input = record(value)
  const bool = (v: unknown) => typeof v === 'boolean' ? v : fail('Revise los interruptores de activación.')
  const str = (v: unknown, limit = 1000) => typeof v === 'string' && v.length <= limit ? v.trim() : fail('Revise la longitud de los textos.')
  const num = (v: unknown, max: number, zero = false) => v === null ? null
    : typeof v === 'number' && Number.isFinite(v) && v >= (zero ? 0 : 0.01) && v <= max ? v : fail('Revise los importes, porcentajes, tasas y plazos.')
  const choice = <T extends string>(v: unknown, allowed: T[]): T => allowed.includes(v as T) ? v as T : fail('Seleccione una opción válida.')
  const date = (v: unknown) => { const s = str(v, 10); return !s || /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : fail('Revise las fechas de las condiciones.') }
  const source = (r: Record<string, unknown>): GuidanceSource => {
    const s = { source: str(r.source, 1200), checkedOn: date(r.checkedOn), reviewBy: date(r.reviewBy) }
    if (s.reviewBy && (!s.checkedOn || s.reviewBy < s.checkedOn)) fail('La fecha de revisión debe ser posterior a la fecha de verificación.')
    if (s.checkedOn > new Date().toISOString().slice(0, 10)) fail('La fecha de verificación no puede estar en el futuro.')
    return s
  }
  const scope = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= 4 && v.every(c => categories.includes(c)) ? [...new Set(v)] as string[] : fail('Seleccione al menos un tipo de inmueble.')
  const requireSource = (s: GuidanceSource) => { if (!s.source || !s.checkedOn) fail('Indique la fuente y la fecha de verificación para usar condiciones confirmadas.') }
  const e = record(input.entry), r = record(input.reservation)
  const entry: ProjectEntry = { ...source(e), enabled: bool(e.enabled), requirement: choice(e.requirement, ['unconfirmed', 'required', 'not_required']),
    kind: choice(e.kind, ['percent', 'amount']), value: num(e.value, e.kind === 'percent' ? 100 : 1e9), due: str(e.due, 600),
    categories: scope(e.categories), mode: choice(e.mode, ['todos', 'lanzamiento', 'preventa']),
    unitNumbers: Array.isArray(e.unitNumbers) && e.unitNumbers.length <= 100 && e.unitNumbers.every(n => typeof n === 'string' && /^[\p{L}\d-]{1,20}$/u.test(n))
      ? [...new Set(e.unitNumbers)] as string[] : fail('Revise los números de unidad.') }
  if (entry.enabled && entry.requirement !== 'unconfirmed') requireSource(entry)
  if (entry.enabled && entry.requirement === 'required' && (entry.value === null || !entry.due)) fail('Complete el valor de entrada y cuándo debe pagarse.')
  const reservation: ReservationPayment = { ...source(r), enabled: bool(r.enabled), requirement: choice(r.requirement, ['unconfirmed', 'required', 'not_required']),
    amount: num(r.amount, 1e9), creditedToEntry: r.creditedToEntry === null ? null : bool(r.creditedToEntry), conditions: str(r.conditions, 1200) }
  if (reservation.enabled && reservation.requirement !== 'unconfirmed') requireSource(reservation)
  if (reservation.enabled && reservation.requirement === 'required' && (reservation.amount === null || !reservation.conditions)) fail('Complete el monto y las condiciones de reserva.')
  if (!Array.isArray(input.lenders) || input.lenders.length !== 2) fail('Se requieren las fichas de JEP y Banco Pichincha.')
  const lenders = (input.lenders as unknown[]).map(raw => {
    const l = record(raw)
    const lender: FinancingLenderTerms = { ...source(l), id: choice(l.id, ['jep', 'pichincha']), name: str(l.name, 80), product: str(l.product, 120), enabled: bool(l.enabled),
      advertisedPercent: num(l.advertisedPercent, 100), purchasePercent: num(l.purchasePercent, 100), maxAmount: num(l.maxAmount, 1e9),
      annualRate: num(l.annualRate, 100, true), rateType: choice(l.rateType, ['nominal_annual', 'effective_annual', 'unconfirmed']),
      rateQualification: choice(l.rateQualification, ['from', 'reference']), minYears: num(l.minYears, 50), maxYears: num(l.maxYears, 50),
      exampleYears: num(l.exampleYears, 50), monthlyCharges: num(l.monthlyCharges, 1e6, true), notes: str(l.notes, 2000), categories: scope(l.categories) }
    if (!lender.name || !lender.product) fail('Complete la entidad y el producto financiero.')
    if (lender.enabled) requireSource(lender)
    if (lender.purchasePercent !== null && lender.advertisedPercent !== null && lender.purchasePercent > lender.advertisedPercent) fail('El porcentaje aplicable al inmueble no puede superar el porcentaje anunciado.')
    if (lender.minYears !== null && lender.maxYears !== null && lender.minYears > lender.maxYears) fail('El plazo mínimo no puede superar el máximo.')
    if (lender.exampleYears !== null && (lender.minYears === null || lender.maxYears === null || lender.exampleYears < lender.minYears || lender.exampleYears > lender.maxYears)) fail('El plazo de referencia debe estar dentro de límites confirmados.')
    return lender
  })
  if (new Set(lenders.map(l => l.id)).size !== 2) fail('No repita la misma entidad.')
  return { enabled: bool(input.enabled), estimatesEnabled: bool(input.estimatesEnabled), entry, reservation, lenders }
}

export function financingGuidanceSettings(policies: unknown): FinancingGuidance {
  const stored = record(policies).financing_guidance
  if (stored === undefined) return defaultFinancingGuidance()
  try { return validateFinancingGuidance(stored) } catch {
    // Malformed saved data must not reactivate public defaults or a paused rule.
    return { ...defaultFinancingGuidance(), enabled: false, estimatesEnabled: false }
  }
}
export function changeFinancingGuidance(policies: unknown, settings: unknown, actor: string, now: string) {
  return { ...record(policies), financing_guidance: { ...validateFinancingGuidance(settings), updatedBy: actor, updatedAt: now } }
}
export function currentGuidanceSource(source: GuidanceSource, today = new Date().toISOString().slice(0, 10)) {
  return !!source.source && !!source.checkedOn && source.checkedOn <= today && (!source.reviewBy || source.reviewBy >= today)
}
