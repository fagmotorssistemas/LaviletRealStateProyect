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
        'relative z-20 overflow-hidden bg-[#f4f1ea] mkt-dark:bg-[#0a0a0a]',
        embedded ? 'py-24 lg:py-32' : 'pt-28 pb-24 sm:pt-32 lg:pb-32',
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50 mix-blend-multiply"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent 0 4px, rgba(114,115,90,0.032) 4px 5px), repeating-linear-gradient(90deg, transparent 0 5px, rgba(114,115,90,0.026) 5px 6px)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-7rem] h-[28rem] w-[28rem] rounded-full border border-[#C45C3E]/12"
      />

      <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] lg:items-end lg:gap-20">
          <div>
            <p className="text-[11px] font-medium tracking-[0.32em] text-[#C45C3E] uppercase">Contacto</p>
            <Title className="mt-4 max-w-4xl font-serif text-[clamp(3rem,6.4vw,6rem)] leading-[0.88] font-normal tracking-[-0.045em] text-[#72735A]">
            Hablemos de tu próximo espacio
          </Title>
          </div>
          <p className="max-w-lg border-l-2 border-[#C45C3E]/55 pl-5 text-[15px] leading-relaxed text-[#2B1A18]/68 sm:text-[17px]">
            Agenda una visita al showroom, escribe por WhatsApp o deja tus datos. Te contactamos para
            coordinar horario o enviarte disponibilidad.
          </p>
        </div>

        <div className="mt-16 grid gap-14 lg:mt-20 lg:grid-cols-12 lg:gap-20 lg:items-start">
          <div className="lg:col-span-5 lg:sticky lg:top-28">
            <div className="relative overflow-hidden rounded-[2rem] bg-[#e9e1d6] p-7 text-[#2B1A18] ring-1 ring-[#72735A]/12 sm:p-9 lg:p-10">
              <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-[#C45C3E]" />
              <p className="text-[11px] font-medium tracking-[0.22em] text-[#C45C3E] uppercase">
                Solicita una visita
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[#2B1A18]/55">
                Respondemos a la brevedad. Si prefieres, también puedes escribirnos directo.
              </p>
              <div className="mt-8">
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

          <div className="flex flex-col gap-12 lg:col-span-7">
            <div className="relative overflow-hidden rounded-[2rem] ring-1 ring-[#72735A]/12">
              <div className="relative h-[320px] w-full sm:h-[380px] lg:h-[430px]">
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
              <p className="text-[11px] font-medium tracking-[0.28em] text-[#C45C3E] uppercase">
                Cómo suele ir una visita
              </p>
              <div className="mt-7 grid border-y border-[#72735A]/18 sm:grid-cols-3">
                {VISIT_BEATS.map((beat, index) => (
                  <div
                    key={beat.title}
                    className="border-b border-[#72735A]/18 px-1 py-7 last:border-b-0 sm:border-r sm:border-b-0 sm:px-6 sm:first:pl-0 sm:last:border-r-0 sm:last:pr-0"
                  >
                    <p className="text-[11px] font-semibold tracking-[0.14em] text-[#C45C3E]">
                      {String(index + 1).padStart(2, '0')}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#2B1A18]">{beat.title}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#2B1A18]/55">{beat.body}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        <div className="mt-16 grid border-y border-[#72735A]/18 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
              <div className="border-b border-[#72735A]/18 p-6 sm:border-r lg:border-b-0">
                <div className="flex gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#C45C3E]" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-[#72735A]/60 uppercase">
                      Ubicación
                    </p>
                    <p className="mt-1 text-sm font-medium text-[#2B1A18]">
                      {SITE.location.label} · {SITE.city}
                    </p>
                    <Link
                      href="/ubicanos"
                      className="mt-2 inline-flex items-center gap-1 text-sm text-[#C45C3E] hover:text-[#72735A]"
                    >
                      Ver mapa
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                </div>
              </div>

              <div className="border-b border-[#72735A]/18 p-6 lg:border-r lg:border-b-0">
                <div className="flex gap-3">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#C45C3E]" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-[#72735A]/60 uppercase">
                      Visitas
                    </p>
                    <p className="mt-1 text-sm font-medium text-[#2B1A18]">Con cita en showroom</p>
                    <Link
                      href="/tour"
                      className="mt-2 inline-flex items-center gap-1 text-sm text-[#C45C3E] hover:text-[#72735A]"
                    >
                      Tour 360°
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                </div>
              </div>

              <div className="border-b border-[#72735A]/18 p-6 sm:border-r sm:border-b-0">
                <div className="flex gap-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#C45C3E]" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-[#72735A]/60 uppercase">
                      Correo
                    </p>
                    <a
                      href={`mailto:${SITE.email}`}
                      className="mt-1 block text-sm font-medium text-[#2B1A18] hover:text-[#C45C3E]"
                    >
                      {SITE.email}
                    </a>
                  </div>
                </div>
              </div>

              <div className="p-6">
                <div className="flex gap-3">
                  <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C45C3E]" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-[#72735A]/60 uppercase">
                      WhatsApp
                    </p>
                    {wa ? (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-[#2B1A18] hover:text-[#C45C3E]"
                      >
                        Escribir al equipo
                        <ArrowUpRight size={14} />
                      </a>
                    ) : (
                      <p className="mt-1 text-sm text-[#2B1A18]/58">Usa el formulario o el correo</p>
                    )}
                  </div>
                </div>
              </div>
        </div>
      </div>
    </section>
  )
}
