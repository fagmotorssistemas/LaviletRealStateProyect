/** Categories admitted by extraction, semantic normalization and interest events. */
export const PROPERTY_CATEGORIES = ['suite', 'departamento', 'penthouse', 'local'] as const
export type PropertyCategory = typeof PROPERTY_CATEGORIES[number]
