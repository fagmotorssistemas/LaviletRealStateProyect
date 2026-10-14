import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpRight, Mail, MapPin, Clock3 } from 'lucide-react'
import { WhatsAppIcon } from '@/components/tour/WhatsAppIcon'
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
        'relative z-20 overflow-hidden bg-lv-bg mkt-dark:bg-[#0a0a0a]',
        embedded ? 'py-24 lg:py-32' : 'pt-28 pb-24 sm:pt-32 lg:pb-32',
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50 mix-blend-multiply"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent 0 4px, rgba(63,66,49,0.032) 4px 5px), repeating-linear-gradient(90deg, transparent 0 5px, rgba(63,66,49,0.026) 5px 6px)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-7rem] h-[28rem] w-[28rem] rounded-full border border-lv-line"
      />

      <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] lg:items-end lg:gap-20">
          <div>
            <p className="lv-eyebrow text-[11px] font-medium tracking-[0.22em] text-lv-ink-soft uppercase">Contacto</p>
            <Title className="mt-4 max-w-4xl font-serif text-[clamp(3rem,6.4vw,6rem)] leading-[0.88] font-normal tracking-[-0.045em] text-lv-ink-soft">
            Hablemos de tu próximo espacio
          </Title>
          </div>
          <p className="max-w-lg border-l-2 border-lv-line pl-5 text-[15px] leading-relaxed text-lv-ink-soft sm:text-[17px]">
            Agenda una visita al showroom, escribe por WhatsApp o deja tus datos. Te contactamos para
            coordinar horario o enviarte disponibilidad.
          </p>
        </div>

        <div className="mt-16 grid gap-14 lg:mt-20 lg:grid-cols-12 lg:gap-20 lg:items-start">
          <div className="lg:col-span-5 lg:sticky lg:top-28">
            <div className="lv-corners lv-corners--bronze relative overflow-hidden bg-lv-bg p-7 text-lv-ink ring-1 ring-lv-line sm:p-9 lg:p-10">
              <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-lv-bg" />
              <p className="text-[11px] font-medium tracking-[0.22em] text-lv-ink-soft uppercase">
                Solicita una visita
              </p>
              <p className="mt-2 text-sm leading-relaxed text-lv-ink-soft">
                Respondemos a la brevedad. Si prefieres, también puedes escribirnos directo.
              </p>
              <div className="mt-8">
                <ContactForm />
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-lv-ink-soft lg:text-left">
              ¿Eres del equipo?{' '}
              <Link
                href="/login"
                className="underline decoration-lv-bronze underline-offset-2 hover:text-lv-ink"
              >
                Acceso al panel
              </Link>
            </p>
          </div>

          <div className="flex flex-col gap-12 lg:col-span-7">
            <div className="lv-frame relative overflow-hidden ring-1 ring-lv-line">
              <div className="relative h-[320px] w-full sm:h-[380px] lg:h-[430px]">
                <Image
                  src="/CUENCA4.webp"
                  alt="El río Tomebamba en Cuenca"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 55vw"
                  priority={!embedded}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-lv-bg/70 via-lv-bg/15 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                  <p className="text-[11px] font-medium tracking-[0.2em] text-lv-ink-soft uppercase">
                    Showroom · Cuenca
                  </p>
                  <p className="mt-1.5 max-w-md text-base leading-snug text-lv-ink sm:text-lg">
                    Te recibimos con cita junto al Tomebamba.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-medium tracking-[0.28em] text-lv-ink-soft uppercase">
                Cómo suele ir una visita
              </p>
              <div className="mt-7 grid border-y border-lv-line sm:grid-cols-3">
                {VISIT_BEATS.map((beat, index) => (
                  <div
                    key={beat.title}
                    className="border-b border-lv-line px-1 py-7 last:border-b-0 sm:border-r sm:border-b-0 sm:px-6 sm:first:pl-0 sm:last:border-r-0 sm:last:pr-0"
                  >
                    <p className="text-[11px] font-semibold tracking-[0.14em] text-lv-ink-soft">
                      {String(index + 1).padStart(2, '0')}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-lv-ink">{beat.title}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-lv-ink-soft">{beat.body}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        <div className="mt-16 grid border-y border-lv-line sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
              <div className="border-b border-lv-line p-6 sm:border-r lg:border-b-0">
                <div className="flex gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-lv-ink-soft" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-lv-ink-soft uppercase">
                      Ubicación
                    </p>
                    <p className="mt-1 text-sm font-medium text-lv-ink">
                      {SITE.location.label} · {SITE.city}
                    </p>
                    <Link
                      href="/ubicanos"
                      className="mt-2 inline-flex items-center gap-1 text-sm text-lv-ink-soft hover:text-lv-ink-soft"
                    >
                      Ver mapa
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                </div>
              </div>

              <div className="border-b border-lv-line p-6 lg:border-r lg:border-b-0">
                <div className="flex gap-3">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-lv-ink-soft" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-lv-ink-soft uppercase">
                      Visitas
                    </p>
                    <p className="mt-1 text-sm font-medium text-lv-ink">Con cita en showroom</p>
                    <Link
                      href="/tour"
                      className="mt-2 inline-flex items-center gap-1 text-sm text-lv-ink-soft hover:text-lv-ink-soft"
                    >
                      Tour 360°
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                </div>
              </div>

              <div className="border-b border-lv-line p-6 sm:border-r sm:border-b-0">
                <div className="flex gap-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-lv-ink-soft" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-lv-ink-soft uppercase">
                      Correo
                    </p>
                    <a
                      href={`mailto:${SITE.email}`}
                      className="mt-1 block text-sm font-medium text-lv-ink hover:text-lv-ink-soft"
                    >
                      {SITE.email}
                    </a>
                  </div>
                </div>
              </div>

              <div className="p-6">
                <div className="flex gap-3">
                  <span className="mt-0.5 h-4 w-4 shrink-0 text-lv-ink-soft"><WhatsAppIcon size={16} /></span>
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.16em] text-lv-ink-soft uppercase">
                      WhatsApp
                    </p>
                    {wa ? (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-lv-ink hover:text-lv-ink-soft"
                      >
                        Escribir al equipo
                        <ArrowUpRight size={14} />
                      </a>
                    ) : (
                      <p className="mt-1 text-sm text-lv-ink-soft">Usa el formulario o el correo</p>
                    )}
                  </div>
                </div>
              </div>
        </div>
      </div>
    </section>
  )
}
