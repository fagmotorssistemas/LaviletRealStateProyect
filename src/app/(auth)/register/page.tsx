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

export default function RegisterPage() {
  const router = useRouter()
  const supabase = createClient()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    })

    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }

    toast.success('Cuenta creada. Revisa tu correo para confirmar.')
    router.push('/login')
  }

  return (
    <div className="flex min-h-screen">
      {/* Left - Brand Panel */}
      <AuthBrandPanel />

      {/* Right - Form */}
      <div className="flex flex-1 flex-col justify-center px-6 sm:px-12 lg:px-20 bg-white">
        <div className="mx-auto w-full max-w-sm">
          <div className="flex flex-col items-center mb-8 lg:hidden">
            <Image
              src="/LogoVertical.png"
              alt="Lavilet"
              width={120}
              height={120}
              className="h-24 w-auto"
              preload
            />
          </div>

          <h1 className="text-2xl font-bold text-[#2B1A18] text-center">Crear cuenta</h1>
          <p className="mt-1 text-sm text-[#BDA27E] text-center">
            Regístrate en Lavilet
          </p>

          <div className="mt-2 mb-8 h-px bg-gradient-to-r from-transparent via-[#BDA27E]/40 to-transparent" />

          <form onSubmit={handleRegister} className="space-y-5">
            <Input
              id="fullName"
              label="Nombre completo"
              type="text"
              placeholder="Juan Pérez"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
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
              minLength={6}
            />
            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? 'Creando cuenta...' : 'Registrarse'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="font-semibold text-[#BDA27E] hover:text-[#2B1A18] transition-colors">
              Inicia sesión
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
