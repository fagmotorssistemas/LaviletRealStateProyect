'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type AuthFormState = { error: string } | null

function loginErrorMessage(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('invalid login')) return 'Correo o contraseña incorrectos'
  if (lower.includes('email not confirmed')) return 'Confirma tu correo antes de ingresar'
  if (lower.includes('too many requests')) {
    return 'Demasiados intentos. Espera un momento e inténtalo de nuevo'
  }
  return message
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    return { error: 'Ingresa tu correo y contraseña' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: loginErrorMessage(error.message) }
  }

  revalidatePath('/', 'layout')
  redirect('/inmobiliaria/inventario')
}
