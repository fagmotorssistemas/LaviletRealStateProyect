import Link from 'next/link'
import { SITE } from '@/lib/marketing/site'
import { CookiePreferencesLink } from './CookiePreferencesLink'
import { FooterWordmark } from './FooterWordmark'

const FOOTER_NAV = [
  { href: '/inicio', label: 'Inicio' },
  { href: '/nosotros', label: 'Nosotros' },
  { href: '/tour', label: 'Showroom 360' },
  { href: '/proyectos', label: 'Proyectos' },
  { href: '/proceso', label: 'Proceso' },
  { href: '/ubicanos', label: 'Ubícanos' },
  { href: '/contacto', label: 'Contacto' },
] as const

function formatWhatsApp(digits: string) {
  if (!digits) return null
  if (digits.startsWith('593') && digits.length >= 11) {
    return `+593 ${digits.slice(3, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }
  return `+${digits}`
}

export function SiteFooter() {
  const year = new Date().getFullYear()
  const phone = formatWhatsApp(SITE.whatsapp)
  const wa = SITE.whatsapp
    ? `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent('Hola, me interesa conocer La Vilēt.')}`
    : null

  return (
    <footer className="relative z-20 bg-[#EDEAE2] text-[#2B1A18] mkt-dark:bg-[#5a5b48] mkt-dark:text-[#F2F2F2]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] mix-blend-multiply mkt-dark:opacity-[0.12] mkt-dark:mix-blend-overlay"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent 0 3px, rgba(114,115,90,0.07) 3px 4px), repeating-linear-gradient(90deg, transparent 0 3px, rgba(114,115,90,0.05) 3px 4px)',
        }}
      />

      <div className="relative mx-auto grid max-w-[1400px] gap-12 px-5 py-14 sm:px-8 lg:grid-cols-[1fr_minmax(0,1.15fr)_minmax(13rem,0.72fr)] lg:items-start lg:gap-10 lg:py-16">
        <div className="max-w-xs space-y-6 text-[13px] leading-relaxed">
          <div>
            <p className="text-[10px] font-medium tracking-[0.28em] text-[#8B8C74] uppercase">
              Visítanos
            </p>
            <p className="mt-2 font-medium">
              La Vilēt
              <br />
              Puertas del Sol
              <br />
              {SITE.city}
            </p>
            <Link
              href="/ubicanos"
              className="mt-2 inline-block text-[#72735A] underline decoration-[#72735A]/30 underline-offset-4 hover:text-[#C45C3E] mkt-dark:text-[#F2F2F2]"
            >
              Cómo llegar
            </Link>
          </div>

          <div>
            <p className="text-[10px] font-medium tracking-[0.28em] text-[#8B8C74] uppercase">
              Horario
            </p>
            <p className="mt-2">
              Visitas con cita en showroom
              <br />
              Tour 360° · disponible siempre
            </p>
          </div>

          <div>
            <p className="text-[10px] font-medium tracking-[0.28em] text-[#8B8C74] uppercase">
              Escríbenos
            </p>
            <a
              href={`mailto:${SITE.email}`}
              className="mt-2 block font-medium hover:text-[#C45C3E]"
            >
              {SITE.email}
            </a>
            {phone && wa ? (
              <a href={wa} target="_blank" rel="noreferrer" className="mt-1 block font-serif text-xl tracking-[-0.03em] hover:text-[#C45C3E] sm:text-2xl">
                {phone}
              </a>
            ) : null}
          </div>

          <p className="font-serif text-[1.35rem] tracking-[-0.03em]">
            lavilet.com
          </p>
        </div>

        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-7 lg:justify-center">
          <FooterWordmark />
          <p className="max-w-[10.5rem] font-serif text-[1.65rem] leading-[1.05] tracking-[-0.03em] text-[#8B8C74] sm:text-[1.9rem] mkt-dark:text-[#F2F2F2]/55">
            Si vives aquí,
            <br />
            ya estás.
          </p>
        </div>

        <nav aria-label="Pie de página" className="border-t border-[#72735A]/15 lg:border-t-0">
          {FOOTER_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-end border-b border-[#72735A]/15 py-3.5 text-sm tracking-[0.04em] transition-colors hover:text-[#C45C3E] mkt-dark:border-[#F2F2F2]/15"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="flex items-center justify-end border-b border-[#72735A]/15 py-3.5 text-sm tracking-[0.04em] transition-colors hover:text-[#C45C3E] mkt-dark:border-[#F2F2F2]/15"
          >
            Acceso equipo
          </Link>
        </nav>
      </div>

      <div className="relative border-t border-[#72735A]/15 mkt-dark:border-[#F2F2F2]/12">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-5 py-4 text-[11px] tracking-[0.04em] text-[#72735A]/70 sm:flex-row sm:items-center sm:justify-between sm:px-8 mkt-dark:text-[#F2F2F2]/50">
          <p>© {year} Lavilet. Todos los derechos reservados.</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>Imágenes referenciales del proyecto.</span>
            <CookiePreferencesLink />
          </div>
        </div>
      </div>
    </footer>
  )
}
