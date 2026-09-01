'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { AuthBrandPanel } from '@/components/auth/AuthBrandPanel'
import { login } from './actions'

export function LoginForm({ registered }: { registered: boolean }) {
  const [state, formAction, pending] = useActionState(login, null)

  return (
    <div className="flex min-h-screen">
      <div className="flex flex-1 flex-col justify-center px-6 sm:px-12 lg:px-20 bg-white">
        <div className="mx-auto w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <Image
              src="/LogoVertical.png"
              alt="Lavilet"
              width={120}
              height={120}
              className="h-24 w-auto"
              preload
            />
          </div>

          <h1 className="text-2xl font-bold text-[#2B1A18] text-center">Bienvenido</h1>
          <p className="mt-1 text-sm text-[#BDA27E] text-center">
            Ingresa a tu cuenta de Lavilet
          </p>

          <div className="mt-2 mb-8 h-px bg-gradient-to-r from-transparent via-[#BDA27E]/40 to-transparent" />

          {registered && (
            <p className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Cuenta creada. Revisa tu correo para confirmar e inicia sesión.
            </p>
          )}

          <form action={formAction} className="space-y-5">
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
              autoComplete="current-password"
              required
            />
            {state?.error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {state.error}
              </p>
            )}
            <Button type="submit" className="w-full h-11" disabled={pending}>
              {pending ? 'Ingresando...' : 'Iniciar sesión'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            ¿No tienes cuenta?{' '}
            <Link href="/register" className="font-semibold text-[#BDA27E] hover:text-[#2B1A18] transition-colors">
              Regístrate
            </Link>
          </p>
          <p className="mt-3 text-center">
            <Link href="/" className="text-sm text-gray-400 hover:text-[#2B1A18] transition-colors">
              Volver al inicio
            </Link>
          </p>
        </div>
      </div>

      <AuthBrandPanel />
    </div>
  )
}
