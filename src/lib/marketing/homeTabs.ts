export const HOME_TABS = [
  { id: 'proyectos', label: 'Proyectos' },
  { id: 'nosotros', label: 'Nosotros' },
  { id: 'proceso', label: 'Proceso' },
  { id: 'contacto', label: 'Agendar visita' },
] as const

export type HomeTabId = (typeof HOME_TABS)[number]['id']

export function isHomeTab(value: string | null | undefined): value is HomeTabId {
  return HOME_TABS.some((tab) => tab.id === value)
}
