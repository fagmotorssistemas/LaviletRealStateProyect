/**
 * Fuente de precio del simulador: independiente de initSource / estado de edición.
 * - useCurrentPublishedPrice=false + scenarioUnitPrice → snapshot histórico
 * - useCurrentPublishedPrice=true → publicado actual o hipotético
 */

export type CalculatorUnitPriceInput = {
  useCurrentPublishedPrice: boolean
  scenarioUnitPrice: number | null
  publishedPrice: number | null | undefined
  hypotheticalPrice: number | null
}

export function resolveCalculatorUnitPrice(input: CalculatorUnitPriceInput): number {
  if (
    !input.useCurrentPublishedPrice &&
    input.scenarioUnitPrice != null &&
    input.scenarioUnitPrice > 0
  ) {
    return input.scenarioUnitPrice
  }
  const published = Number(input.publishedPrice)
  if (Number.isFinite(published) && published > 0) return published
  if (input.hypotheticalPrice != null && input.hypotheticalPrice > 0) {
    return input.hypotheticalPrice
  }
  return 0
}

/** Tras guardar: bloquear el precio persistido; no seguir al publicado. */
export function priceFlagsAfterScenarioSave(savedUnitPrice: number) {
  return {
    scenarioUnitPrice: savedUnitPrice,
    useCurrentPublishedPrice: false as const,
  }
}
