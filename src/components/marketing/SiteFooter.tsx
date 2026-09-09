import Image from 'next/image'
import Link from 'next/link'
import { CookiePreferencesLink } from './CookiePreferencesLink'

export function SiteFooter() {
  return (
    <footer className="relative z-20 border-t border-[#2B1A18]/10 bg-white py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 sm:flex-row sm:px-6 lg:px-8">
        <Image
          src="/LogoHorizontal.png"
          alt="Lavilet"
          width={140}
          height={42}
          className="h-10 w-auto object-contain"
        />
        <p className="text-xs text-[#2B1A18]/45">
          © {new Date().getFullYear()} Lavilet. Todos los derechos reservados.
        </p>
        <div className="flex items-center gap-4">
          <CookiePreferencesLink />
          <Link href="/login" className="text-xs font-medium text-[#BDA27E] hover:text-[#2B1A18]">
            Acceso equipo
          </Link>
        </div>
      </div>
    </footer>
  )
}
