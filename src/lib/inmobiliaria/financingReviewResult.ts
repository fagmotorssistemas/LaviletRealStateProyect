export type FinancingReviewInput = { result: 'pending' | 'favorable' | 'unfavorable'; ownFunds: number; financingAmount: number; note: string }

export function validateFinancingReview(input: FinancingReviewInput, price: number) {
  if (!['pending', 'favorable', 'unfavorable'].includes(input.result)) throw Error('Seleccione un resultado válido.')
  if (![input.ownFunds, input.financingAmount].every(n => Number.isFinite(n) && n >= 0 && n <= 1e9)) throw Error('Revise los importes.')
  if (input.note.trim().length < 10 || input.note.length > 1000) throw Error('Describa el resultado y su respaldo (entre 10 y 1000 caracteres).')
  if (input.result === 'favorable' && (!(price > 0) || input.financingAmount <= 0 || Math.round((input.ownFunds + input.financingAmount) * 100) < Math.round(price * 100)))
    throw Error('El aporte y el financiamiento revisados deben cubrir el precio de la unidad para habilitar la oferta de reserva.')
}
