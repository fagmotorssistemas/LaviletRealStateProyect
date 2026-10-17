import { ACCESS_PENDING_PATH } from './accessPending'
import { canAccessPath, homePathForRole } from '@/lib/inmobiliaria/roleAccess'

export type LoginState = { error: string; destination?: never } | { destination: string; error?: never } | null

export const LOGIN_RETRY_MESSAGE = 'No pudimos completar el ingreso. Vuelve a intentarlo.'
export const LOGIN_TRANSPORT_MESSAGE = 'No pudimos conectar con el acceso. Comprueba tu conexión y vuelve a intentarlo.'

export function loginDestination(raw: FormDataEntryValue | null, role: string | null, crmPaths: string[] | null, accessPending: boolean) {
  if (accessPending) return ACCESS_PENDING_PATH
  const fallback = homePathForRole(role, crmPaths)
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback
  const target = new URL(value, 'https://login.invalid')
  if (target.origin !== 'https://login.invalid') return fallback
  // Authentication routes are not useful post-login destinations and can loop.
  if (['/login', '/register', ACCESS_PENDING_PATH].some(path => target.pathname === path || target.pathname.startsWith(`${path}/`))) return fallback
  if (!canAccessPath(role, target.pathname, crmPaths)) return fallback
  return `${target.pathname}${target.search}${target.hash}`
}

export function loginErrorMessage(error: { code?: string; status?: number; message?: string }) {
  const message = (error.message ?? '').toLowerCase()
  if (error.code === 'invalid_credentials' || message.includes('invalid login')) return 'Correo o contraseña incorrectos'
  if (error.code === 'email_not_confirmed' || message.includes('email not confirmed')) return 'Confirma tu correo antes de ingresar'
  if (error.status === 429 || message.includes('too many requests')) return 'Demasiados intentos. Espera un momento e inténtalo de nuevo'
  return LOGIN_RETRY_MESSAGE
}
