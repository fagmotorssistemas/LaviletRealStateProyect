'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

type AuthFormState = { error: string } | null

function registerErrorMessage(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return 'Este correo ya está registrado'
  }
  if (lower.includes('is invalid') || lower.includes('email_address_invalid')) {
    return 'Supabase no pudo verificar este correo. Usa un email real que reciba mensajes.'
  }
  if (lower.includes('not authorized') || lower.includes('email_address_not_authorized')) {
    return 'Este proyecto aún no puede enviar correos a ese email. Configura un SMTP propio o desactiva la confirmación de email.'
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
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, role: 'visitante' },
    },
  })

  if (error) {
    return { error: registerErrorMessage(error.message) }
  }

  const userId = data.user?.id
  if (userId) {
    const admin = createAdminClient()
    await admin.from('profiles').upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        role: 'visitante',
        is_active: true,
      },
      { onConflict: 'id' },
    )
  }

  redirect('/login?registered=1')
}
