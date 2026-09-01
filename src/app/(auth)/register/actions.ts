'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type AuthFormState = { error: string } | null

function registerErrorMessage(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return 'Este correo ya está registrado'
  }
  if (lower.includes('password')) return 'La contraseña debe tener al menos 6 caracteres'
  return message
}

export async function register(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const fullName = String(formData.get('fullName') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!fullName || !email || !password) {
    return { error: 'Completa todos los campos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  })

  if (error) {
    return { error: registerErrorMessage(error.message) }
  }

  redirect('/login?registered=1')
}
