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
    <div className="flex min-h-screen">
      {/* Left - Form */}
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
            <Link href="/register" className="font-semibold text-[#BDA27E] hover:text-[#2B1A18] transition-colors">
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
