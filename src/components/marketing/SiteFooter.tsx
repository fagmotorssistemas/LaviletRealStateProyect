import Image from 'next/image'
import Link from 'next/link'
import { CookiePreferencesLink } from './CookiePreferencesLink'

export function SiteFooter() {
  return (
    <footer className="relative z-20 border-t border-[#72735A]/12 bg-[#F2F2F2] py-10 mkt-dark:border-[#F2F2F2]/12 mkt-dark:bg-[#72735A]">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 sm:flex-row sm:px-6 lg:px-8">
        <Image
          src="/LogoHorizontal.png"
          alt="Lavilet"
          width={140}
          height={42}
          className="h-10 object-contain mkt-dark:brightness-0 mkt-dark:invert"
          style={{ width: 'auto' }}
        />
        <p className="text-xs text-[#2B1A18]/45 mkt-dark:text-[#f4efe8]/45">
          © {new Date().getFullYear()} Lavilet. Todos los derechos reservados.
        </p>
        <div className="flex items-center gap-4">
          <CookiePreferencesLink />
          <Link href="/login" className="text-xs font-medium text-[#8B8C74] hover:text-[#72735A] mkt-dark:text-[#BFBFB8] mkt-dark:hover:text-[#F2F2F2]">
            Acceso equipo
          </Link>
        </div>
      </div>
    </footer>
  )
}
