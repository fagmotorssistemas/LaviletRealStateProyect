import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpRight, Mail, MapPin, MessageCircle, Clock3 } from 'lucide-react'
import { SITE } from '@/lib/marketing/site'
import { cn } from '@/lib/utils'
import { ContactForm } from './ContactForm'

const VISIT_BEATS = [
  {
    title: 'Cuéntanos qué buscas',
    body: 'Tipología, presupuesto y timing. Con eso armamos opciones reales.',
  },
  {
    title: 'Recorre con calma',
    body: 'Showroom o tour 360°. Acabados, plantas y el sitio completo.',
  },
  {
    title: 'Siguiente paso claro',
    body: 'Disponibilidad y una propuesta para reservar cuando estés listo.',
  },
] as const

function whatsappHref() {
  if (!SITE.whatsapp) return null
  const text = encodeURIComponent(
    'Hola, me interesa agendar una visita o conocer disponibilidad en Lavilet.',
  )
  return `https://wa.me/${SITE.whatsapp}?text=${text}`
}

export function ContactoView({ embedded = false }: { embedded?: boolean }) {
  const wa = whatsappHref()
  const Title = embedded ? 'h2' : 'h1'

  return (
    <section
      className={cn(
        'relative z-20 bg-[#f7f3ee]',
        embedded ? 'py-20 lg:py-28' : 'pt-24 pb-20 sm:pt-28 lg:pb-28',
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Contacto</p>
          <Title className="mt-3 font-display text-[2rem] leading-[1.12] font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem]">
            Hablemos de tu próximo espacio
          </Title>
          <p className="mt-4 text-base leading-relaxed text-[#2B1A18]/65">
            Agenda una visita al showroom, escribe por WhatsApp o deja tus datos. Te contactamos para
            coordinar horario o enviarte disponibilidad.
          </p>
        </div>

        <div className="mt-10 grid gap-10 lg:mt-12 lg:grid-cols-12 lg:gap-12 lg:items-start">
          <div className="lg:col-span-5 lg:sticky lg:top-28">
            <div className="rounded-2xl bg-white/80 p-6 ring-1 ring-[#2B1A18]/8 sm:p-8">
              <p className="text-[11px] font-medium tracking-[0.2em] text-[#BDA27E] uppercase">
                Solicita una visita
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[#2B1A18]/55">
                Respondemos a la brevedad. Si prefieres, también puedes escribirnos directo.
              </p>
              <div className="mt-6">
                <ContactForm />
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-[#2B1A18]/40 lg:text-left">
              ¿Eres del equipo?{' '}
              <Link
                href="/login"
                className="underline decoration-[#2B1A18]/25 underline-offset-2 hover:text-[#2B1A18]"
              >
                Acceso al panel
              </Link>
            </p>
          </div>

          <div className="flex flex-col gap-8 lg:col-span-7">
            <div className="relative overflow-hidden rounded-2xl">
              <div className="relative h-[280px] w-full sm:h-[320px] lg:h-[360px]">
                <Image
                  src="/CUENCA4.png"
                  alt="El río Tomebamba en Cuenca"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 55vw"
                  priority={!embedded}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#2B1A18]/70 via-[#2B1A18]/15 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                  <p className="text-[11px] font-medium tracking-[0.2em] text-[#BDA27E] uppercase">
                    Showroom · Cuenca
                  </p>
                  <p className="mt-1.5 max-w-md text-base leading-snug text-white sm:text-lg">
                    Te recibimos con cita junto al Tomebamba.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium tracking-[0.22em] text-[#BDA27E] uppercase">
                Cómo suele ir una visita
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {VISIT_BEATS.map((beat, index) => (
                  <div
                    key={beat.title}
                    className="rounded-xl bg-[#BDA27E]/10 px-4 py-4 ring-1 ring-[#BDA27E]/15"
                  >
                    <p className="text-[11px] font-semibold tracking-[0.14em] text-[#BDA27E]">
                      {String(index + 1).padStart(2, '0')}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#2B1A18]">{beat.title}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#2B1A18]/55">{beat.body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-px overflow-hidden rounded-2xl bg-[#2B1A18]/8 ring-1 ring-[#2B1A18]/8 sm:grid-cols-2">
              <div className="bg-[#f7f3ee] p-5">
                <div className="flex gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#BDA27E]" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-[#2B1A18]/45 uppercase">
                      Ubicación
                    </p>
                    <p className="mt-1 text-sm font-medium text-[#2B1A18]">
                      {SITE.location.label} · {SITE.city}
                    </p>
                    <Link
                      href="/ubicanos"
                      className="mt-2 inline-flex items-center gap-1 text-sm text-[#BDA27E] hover:text-[#2B1A18]"
                    >
                      Ver mapa
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                </div>
              </div>

              <div className="bg-[#f7f3ee] p-5">
                <div className="flex gap-3">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#BDA27E]" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-[#2B1A18]/45 uppercase">
                      Visitas
                    </p>
                    <p className="mt-1 text-sm font-medium text-[#2B1A18]">Con cita en showroom</p>
                    <Link
                      href="/"
                      className="mt-2 inline-flex items-center gap-1 text-sm text-[#BDA27E] hover:text-[#2B1A18]"
                    >
                      Tour 360°
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                </div>
              </div>

              <div className="bg-[#f7f3ee] p-5">
                <div className="flex gap-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#BDA27E]" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-[#2B1A18]/45 uppercase">
                      Correo
                    </p>
                    <a
                      href={`mailto:${SITE.email}`}
                      className="mt-1 block text-sm font-medium text-[#2B1A18] hover:text-[#BDA27E]"
                    >
                      {SITE.email}
                    </a>
                  </div>
                </div>
              </div>

              <div className="bg-[#f7f3ee] p-5">
                <div className="flex gap-3">
                  <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#BDA27E]" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-[#2B1A18]/45 uppercase">
                      WhatsApp
                    </p>
                    {wa ? (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-[#2B1A18] hover:text-[#BDA27E]"
                      >
                        Escribir al equipo
                        <ArrowUpRight size={14} />
                      </a>
                    ) : (
                      <p className="mt-1 text-sm text-[#2B1A18]/55">Usa el formulario o el correo</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
