import type { Metadata } from 'next'
import Link from 'next/link'
import { AccessPendingClient } from '@/components/auth/AccessPendingClient'

export const metadata: Metadata = {
  title: 'Acceso pendiente',
  description: 'Tu cuenta está en revisión',
}

export default function AccesoPendientePage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f7f3ee] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-[#2B1A18]/8 bg-white px-6 py-8 text-center shadow-[0_16px_40px_rgba(43,26,24,0.08)] sm:px-8">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[#BDA27E] uppercase">Lavilet</p>
        <h1 className="mt-3 font-display text-2xl font-semibold text-[#2B1A18] sm:text-3xl">
          Cuenta en revisión
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[#555850]">
          El administrador ya fue informado de tu registro. En breve revisará tu información, te asignará
          las funciones necesarias y podrás acceder al sistema.
        </p>
        <p className="mt-4 text-xs text-[#8a8d87]">
          Si acabás de registrarte, no hace falta hacer nada más. Cuando te habiliten, iniciá sesión de
          nuevo.
        </p>
        <AccessPendingClient />
        <div className="mt-6">
          <Link
            href="/login"
            className="text-sm font-semibold text-[#BDA27E] transition-colors hover:text-[#2B1A18]"
          >
            Volver al login
          </Link>
        </div>
      </div>
    </div>
  )
}
