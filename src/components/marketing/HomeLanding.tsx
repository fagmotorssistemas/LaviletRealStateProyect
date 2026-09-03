import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Building2, CalendarDays, Landmark, MapPin } from 'lucide-react'
import { FEATURED_SPACES, SITE, STEPS } from '@/lib/marketing/site'
import { ContactForm } from './ContactForm'
import { HeroStage } from './HeroStage'
import { LaviletStory } from './LaviletStory'
import { LockupProvider } from './LaviletLockup'
import { SiteHeader } from './SiteHeader'
import { TourViewerLoader } from '@/app/tour/TourViewerLoader'

const btnDark =
  'inline-flex h-12 shrink-0 items-center justify-center rounded-lg bg-[#2B1A18] px-6 text-base font-medium text-white transition-colors hover:bg-[#3d2a24]'

export function HomeLanding() {
  return (
    <div className="min-h-screen bg-[#f7f3ee] text-[#2B1A18]">
      <SiteHeader />

      <LockupProvider>
        <HeroStage />
        <LaviletStory />
      </LockupProvider>

      <section id="proyectos" className="relative z-20 scroll-mt-24 bg-[#f7f3ee] py-20 lg:-mt-[55vh] lg:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Proyectos</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Espacios para vivir, invertir o emprender</h2>
            <p className="mt-4 text-[#2B1A18]/65">
              Te mostramos tipologías vigentes y el momento de cada desarrollo. En el showroom vemos juntos
              unidades, acabados y disponibilidad real.
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {FEATURED_SPACES.map((space) => (
              <article
                key={space.title}
                className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#2B1A18]/8 transition hover:shadow-xl hover:ring-[#BDA27E]/40"
              >
                <div className="relative h-56 overflow-hidden">
                  <Image
                    src={space.image}
                    alt={space.title}
                    fill
                    className="object-cover transition duration-700 group-hover:scale-105"
                    sizes="(max-width: 1024px) 100vw, 33vw"
                  />
                  <span className="absolute bottom-3 left-3 rounded-md bg-[#2B1A18]/80 px-2.5 py-1 text-[11px] font-medium text-[#BDA27E]">
                    {space.phase}
                  </span>
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold">{space.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#2B1A18]/65">{space.description}</p>
                  <a
                    href="#contacto"
                    className="mt-5 inline-flex items-center text-sm font-semibold text-[#BDA27E] hover:text-[#2B1A18]"
                  >
                    Consultar disponibilidad
                    <ArrowRight size={16} className="ml-1.5" />
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="tour" className="relative z-20 scroll-mt-24 bg-[#f7f3ee] py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Tour virtual</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Recorre el showroom en 360°</h2>
            <p className="mt-4 text-[#2B1A18]/65">
              Entra a las unidades, cambia acabados y recorre cada espacio. Usa pantalla completa para
              una vista más inmersiva.
            </p>
          </div>
          <div className="mt-10 h-[min(78vh,720px)] min-h-[420px] overflow-hidden rounded-2xl bg-black shadow-sm ring-1 ring-[#2B1A18]/8">
            <TourViewerLoader embedded />
          </div>
        </div>
      </section>

      <section id="proceso" className="relative z-20 scroll-mt-24 bg-[#f7f3ee] py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Proceso</p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Tres pasos, sin prisa</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} className="relative">
                <p className="font-bold text-5xl text-[#BDA27E]/25">{step.n}</p>
                <h3 className="mt-3 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#2B1A18]/65">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-20 bg-[#f7f3ee] px-4 pb-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 overflow-hidden rounded-3xl bg-[#BDA27E] px-8 py-10 sm:flex-row sm:items-center sm:px-12">
          <div>
            <p className="text-sm font-medium text-[#2B1A18]/70">Showroom Lavilet</p>
            <h2 className="mt-1 text-2xl font-bold text-[#2B1A18] sm:text-3xl">Agenda tu visita y recorre con calma</h2>
          </div>
          <a href="#contacto" className={btnDark}>
            Quiero agendar
          </a>
        </div>
      </section>

      <section id="contacto" className="relative z-20 scroll-mt-24 bg-[#f7f3ee] py-20 lg:py-28">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_minmax(0,28rem)] lg:px-8">
          <div>
            <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Contacto</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Hablemos de tu próximo espacio</h2>
            <p className="mt-4 max-w-md text-[#2B1A18]/65">
              Déjanos tus datos y un asesor te contacta para coordinar la visita o enviarte las opciones
              que mejor encajan contigo.
            </p>
            <ul className="mt-10 space-y-5 text-sm">
              <li className="flex items-start gap-3">
                <MapPin size={18} className="mt-0.5 text-[#BDA27E]" />
                <span>
                  <span className="block font-medium">Presencia</span>
                  <span className="text-[#2B1A18]/60">{SITE.city}</span>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <CalendarDays size={18} className="mt-0.5 text-[#BDA27E]" />
                <span>
                  <span className="block font-medium">Visitas</span>
                  <span className="text-[#2B1A18]/60">Con cita en showroom</span>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Landmark size={18} className="mt-0.5 text-[#BDA27E]" />
                <span>
                  <span className="block font-medium">Correo</span>
                  <a href={`mailto:${SITE.email}`} className="text-[#2B1A18]/60 hover:text-[#BDA27E]">
                    {SITE.email}
                  </a>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Building2 size={18} className="mt-0.5 text-[#BDA27E]" />
                <span>
                  <span className="block font-medium">Equipo comercial</span>
                  <Link href="/login" className="text-[#2B1A18]/60 hover:text-[#BDA27E]">
                    Acceso al panel interno
                  </Link>
                </span>
              </li>
            </ul>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-[#2B1A18]/8 sm:p-8">
            <h3 className="text-lg font-semibold">Solicita información</h3>
            <p className="mt-1 mb-6 text-sm text-[#2B1A18]/55">Respondemos a la brevedad.</p>
            <ContactForm />
          </div>
        </div>
      </section>

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
          <Link href="/login" className="text-xs font-medium text-[#BDA27E] hover:text-[#2B1A18]">
            Acceso equipo
          </Link>
        </div>
      </footer>
    </div>
  )
}
