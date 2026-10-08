export const LAVILET_APPROVED_INTRODUCTION = {
  enabled: true,
  summary: 'La Vilet es un proyecto de uso mixto ubicado en Puertas del Sol, Cuenca, que combina áreas comerciales dinámicas con modernas unidades residenciales. Cuenta con 49 unidades de vivienda, incluyendo suites, departamentos de 2 y 3 dormitorios, distribuidas en varios niveles junto a espacios comerciales.',
  source: 'Resumen aprobado por el administrador del proyecto en la revisión de la conversación.',
}

/** A dedicated project default, never a fallback for an unrelated project or an invalid saved configuration. */
export function approvedProjectIntroduction(projectName: string): ProjectIntroduction | null {
  const name = projectName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
  return ['la vilet', 'lavilet', 'edificio la vilet', 'edificio lavilet'].includes(name)
    ? { ...LAVILET_APPROVED_INTRODUCTION } : null
}

export type ProjectIntroduction = { enabled: boolean; summary: string; source: string }
const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function emptyProjectIntroduction(): ProjectIntroduction {
  return { enabled: false, summary: '', source: '' }
}

/** This is approved business information, not an instruction or a reply template. */
export function validateProjectIntroduction(value: unknown): ProjectIntroduction {
  const v = row(value)
  if (typeof v.enabled !== 'boolean' || typeof v.summary !== 'string' || typeof v.source !== 'string'
    || v.summary.length > 1200 || v.source.length > 600)
    throw Error('Revise la presentación: el resumen admite hasta 1200 caracteres y la fuente hasta 600.')
  const current = { enabled: v.enabled, summary: v.summary.trim(), source: v.source.trim() }
  if (current.enabled && (!current.summary || !current.source))
    throw Error('Para utilizar la presentación, complete el resumen autorizado y su fuente o responsable.')
  return current
}

export function projectIntroductionSettings(policies: unknown, projectName = ''): { configured: boolean; value: ProjectIntroduction; defaulted?: boolean; error?: string } {
  const configuration = row(row(policies).project_introduction), saved = configuration.current
  if (!Object.hasOwn(configuration, 'current')) {
    const approved = approvedProjectIntroduction(projectName)
    return { configured: false, value: approved || emptyProjectIntroduction(), ...(approved ? { defaulted: true } : {}) }
  }
  try { return { configured: true, value: validateProjectIntroduction(saved) } }
  catch { return { configured: false, value: emptyProjectIntroduction(), error: 'La presentación guardada no es válida. Revise los datos y guarde nuevamente.' } }
}

export function changeProjectIntroduction(policies: unknown, value: unknown, actor: string, now: string) {
  const current = validateProjectIntroduction(value), original = row(policies), saved = row(original.project_introduction)
  return { ...original, project_introduction: { current, updatedAt: now, updatedBy: actor,
    history: [{ previous: saved.current || null, current, at: now, by: actor }, ...(Array.isArray(saved.history) ? saved.history : [])].slice(0, 20) } }
}

export function projectIntroductionContext(policies: unknown, projectName = '') {
  const settings = projectIntroductionSettings(policies, projectName), value = settings.value
  return (settings.configured || settings.defaulted) && value.enabled
    ? { available: true, summary: value.summary, source: value.source, content_kind: 'approved_business_summary', ...(settings.defaulted ? { defaulted: true } : {}) }
    : { available: false, status: settings.error ? 'invalid' : !settings.configured ? 'unconfigured' : 'disabled' }
}
