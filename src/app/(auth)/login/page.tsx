'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { AuthBrandPanel } from '@/components/auth/AuthBrandPanel'
import { toast } from 'sonner'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }

    router.push('/inmobiliaria/inventario')
  }

  return (
    <div className="flex min-h-[100dvh]">
      {/* Left - Form */}
      <div className="flex flex-1 flex-col justify-center bg-[#e8e9e3] px-4 py-8 sm:px-12 lg:px-20">
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

          <h1 className="text-center font-display text-3xl font-semibold text-[#3a3d36] sm:text-4xl">Bienvenido</h1>
          <p className="mt-2 text-center text-sm tracking-wide text-[#7a7e70]">
            Acceso al sistema de gestión inmobiliaria
          </p>

          <div className="mt-2 mb-8 h-px bg-gradient-to-r from-transparent via-[#8b917c]/40 to-transparent" />

          <form onSubmit={handleLogin} className="space-y-5">
            <Input
              id="email"
              label="Correo electrónico"
              type="email"
              placeholder="correo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              id="password"
              label="Contraseña"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? 'Ingresando...' : 'Iniciar sesión'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            ¿No tienes cuenta?{' '}
            <Link href="/register" className="font-semibold text-[#8b917c] hover:text-[#3a3d36] transition-colors">
              Regístrate
            </Link>
          </p>
        </div>
      </div>

      {/* Right - Brand Panel */}
      <AuthBrandPanel />
    </div>
  )
}
