'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { AuthBrandPanel } from '@/components/auth/AuthBrandPanel'
import { register } from './actions'

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(register, null)

  return (
    <div className="flex min-h-[100dvh]">
      <AuthBrandPanel />

      <div className="flex flex-1 flex-col justify-center bg-[#e8e9e3] px-4 py-8 sm:px-12 lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          <div className="flex flex-col items-center mb-8 lg:hidden">
            <Image
              src="/LogoVertical.png"
              alt="Lavilet"
              width={120}
              height={120}
              className="h-24 w-auto"
              unoptimized
              preload
            />
          </div>

          <h1 className="text-center font-display text-3xl font-semibold text-[#3a3d36] sm:text-4xl">Crear cuenta</h1>
          <p className="mt-2 text-center text-sm tracking-wide text-[#7a7e70]">
            Registro en Lavilet
          </p>

          <div className="mt-2 mb-8 h-px bg-gradient-to-r from-transparent via-[#8b917c]/40 to-transparent" />

          <form action={formAction} className="space-y-5">
            <Input
              id="fullName"
              name="fullName"
              label="Nombre completo"
              type="text"
              placeholder="Juan Pérez"
              autoComplete="name"
              required
            />
            <Input
              id="email"
              name="email"
              label="Correo electrónico"
              type="email"
              placeholder="correo@ejemplo.com"
              autoComplete="email"
              required
            />
            <Input
              id="password"
              name="password"
              label="Contraseña"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              required
              minLength={6}
            />
            {state?.error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {state.error}
              </p>
            )}
            <Button type="submit" className="w-full h-11" disabled={pending}>
              {pending ? 'Creando cuenta...' : 'Registrarse'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="font-semibold text-[#8b917c] hover:text-[#3a3d36] transition-colors">
              Inicia sesión
            </Link>
          </p>
          <p className="mt-3 text-center">
            <Link href="/" className="text-sm text-gray-400 hover:text-[#2B1A18] transition-colors">
              Volver al inicio
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
