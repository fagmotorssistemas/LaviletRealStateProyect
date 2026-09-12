export const MARKETING_NAV = [
  { href: '/tour', label: 'Showroom 360' },
  /** Solo visible tras ingresar celular en el showroom. */
  { href: '/simulador', label: 'Calcular cuota', requiresPhone: true },
  { href: '/proyectos', label: 'Proyectos' },
  { href: '/proceso', label: 'Proceso' },
  { href: '/ubicanos', label: 'Ubícanos' },
  { href: '/contacto', label: 'Contacto' },
] as const
