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

export function projectIntroductionSettings(policies: unknown): { configured: boolean; value: ProjectIntroduction; error?: string } {
  const saved = row(row(policies).project_introduction).current
  if (!saved) return { configured: false, value: emptyProjectIntroduction() }
  try { return { configured: true, value: validateProjectIntroduction(saved) } }
  catch { return { configured: false, value: emptyProjectIntroduction(), error: 'La presentación guardada no es válida. Revise los datos y guarde nuevamente.' } }
}

export function changeProjectIntroduction(policies: unknown, value: unknown, actor: string, now: string) {
  const current = validateProjectIntroduction(value), original = row(policies), saved = row(original.project_introduction)
  return { ...original, project_introduction: { current, updatedAt: now, updatedBy: actor,
    history: [{ previous: saved.current || null, current, at: now, by: actor }, ...(Array.isArray(saved.history) ? saved.history : [])].slice(0, 20) } }
}

export function projectIntroductionContext(policies: unknown) {
  const settings = projectIntroductionSettings(policies), value = settings.value
  return settings.configured && value.enabled
    ? { available: true, summary: value.summary, source: value.source, content_kind: 'approved_business_summary' }
    : { available: false, status: settings.error ? 'invalid' : !settings.configured ? 'unconfigured' : 'disabled' }
}
