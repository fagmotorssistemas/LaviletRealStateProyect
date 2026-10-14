import { discountQuote, type DiscountContext, type EarlyPurchaseDiscountSettings } from './earlyPurchaseDiscounts'
export type DiscountSettingsDiagnostics = { mode: string; today: string; summary: string; rules: { id: string; message: string; unitCount: number }[] }
export function discountSettingsDiagnostics(settings: EarlyPurchaseDiscountSettings, units: Record<string, unknown>[], context: DiscountContext): DiscountSettingsDiagnostics {
  const today = context.today || new Date().toISOString().slice(0, 10)
  const rules = settings.rules.map(rule => {
    const quotes = units.map(unit => discountQuote(unit, settings, context))
      .filter(quote => quote.rule_id === rule.id && ['eligible', 'conditional'].includes(quote.status))
    const message = !settings.enabled ? 'El interruptor general está apagado.' : !rule.enabled ? 'Esta regla está desactivada.'
      : rule.mode !== 'todos' && rule.mode !== context.mode ? `Solo aplica en ${rule.mode}; el proyecto está en ${context.mode}.`
      : rule.startDate > today ? `Empieza el ${rule.startDate}; todavía no está vigente.`
      : rule.endDate && rule.endDate < today ? `Venció el ${rule.endDate}.`
      : rule.reviewBy && rule.reviewBy < today ? 'La fuente necesita una nueva revisión.'
      : !context.pricesAuthorized ? 'El proyecto no permite comunicar precios en esta etapa.'
      : !units.length ? 'No hay unidades publicadas y disponibles para comprobar su alcance.'
      : !quotes.length ? 'No coincide con unidades publicadas o sus precios, o tiene prioridad otra regla. Revise tipos, códigos y precios originales.'
      : quotes.some(quote => quote.status === 'conditional') ? `El bot puede explicar el ${rule.percent} % para ${quotes.length} unidades, indicando que requiere ${rule.condition === 'reservation_confirmed' ? 'una reserva formal confirmada' : 'una compra anticipada comprobada'}.`
      : `El bot puede explicar el ${rule.percent} % ya incluido en los precios de ${quotes.length} unidades; no volverá a restarlo.`
    return { id: rule.id, message, unitCount: quotes.length }
  })
  return { mode: context.mode, today, rules, summary: !settings.enabled ? 'Descuentos desactivados.'
    : !settings.rules.length ? 'El interruptor está activo, pero no hay reglas guardadas. Agregue una regla, actívela y guarde.'
    : !settings.rules.some(rule => rule.enabled) ? 'El interruptor está activo, pero todas las reglas están desactivadas.'
    : rules.some(rule => rule.unitCount > 0) ? 'Hay ofertas que el bot puede explicar. Revise el alcance y las condiciones de cada regla.'
    : 'Ninguna regla guardada puede comunicarse actualmente. Revise los motivos indicados.' }
}
