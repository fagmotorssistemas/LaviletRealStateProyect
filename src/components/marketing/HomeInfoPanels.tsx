import Image from 'next/image'
import { ArrowRight, Building2, CalendarDays, Landmark, MapPin } from 'lucide-react'
import { FEATURED_SPACES, PILLARS, SITE, STEPS } from '@/lib/marketing/site'
import { ContactForm } from './ContactForm'

const STORY_LINES = [
  'El hormigón se curva para no interrumpir el paisaje.',
  'La madera guarda la luz que entra por la tarde.',
  'Cada planta orientada a la luz del Tomebamba.',
  'Y cada balcón se abre hacia el verde, como quien no tiene prisa.',
]

export function ProyectosPanel() {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Proyectos</p>
      <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Espacios para vivir, invertir o emprender</h2>
      <p className="mt-4 max-w-2xl text-[#2B1A18]/65">
        Tipologías vigentes y el momento de cada desarrollo. En el showroom virtual recorres unidades y
        acabados; si quieres, agendamos la visita presencial.
      </p>
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {FEATURED_SPACES.map((space) => (
          <article
            key={space.title}
            className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#2B1A18]/8 transition hover:shadow-xl hover:ring-[#BDA27E]/40"
          >
            <div className="relative h-52 overflow-hidden">
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
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export function NosotrosPanel() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
      <div>
        <p className="text-[11px] font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Nosotros</p>
        <h2 className="mt-3 text-3xl font-bold lowercase leading-tight text-[#C45C3E] sm:text-5xl">
          un lugar donde el tiempo se detiene
        </h2>
        <div className="mt-6 max-w-xl space-y-1.5 text-[15px] leading-relaxed text-[#2B1A18]/80">
          {STORY_LINES.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <blockquote className="mt-8 max-w-2xl border-l-[3px] border-[#C45C3E] pl-5">
          <p className="text-base leading-relaxed text-[#2B1A18]/80">
            La Vilet nace de una idea simple: que ganar altura no debería alejarte de la ciudad, sino
            devolvértela entera. En Puertas del Sol, el proyecto ordena su vida alrededor de lo que ya
            está ahí — el Tomebamba a pocos pasos y una terraza que reúne lo que un departamento no
            alcanza a contener solo.
          </p>
          <footer className="mt-4 text-[11px] font-medium tracking-[0.16em] text-[#2B1A18]/45 uppercase">
            Lavilet · Historia
          </footer>
        </blockquote>
      </div>
      <ul className="space-y-4">
        {PILLARS.map((pillar) => (
          <li key={pillar.title} className="rounded-2xl bg-white p-5 ring-1 ring-[#2B1A18]/8">
            <h3 className="text-sm font-semibold tracking-[0.06em] uppercase">{pillar.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[#2B1A18]/65">{pillar.body}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ProcesoPanel({ onAgendar }: { onAgendar?: () => void }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Proceso</p>
      <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Tres pasos, sin prisa</h2>
      <div className="mt-10 grid gap-8 md:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.n}>
            <p className="text-5xl font-bold text-[#BDA27E]/25">{step.n}</p>
            <h3 className="mt-3 text-xl font-semibold">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[#2B1A18]/65">{step.body}</p>
          </div>
        ))}
      </div>
      {onAgendar && (
        <button
          type="button"
          onClick={onAgendar}
          className="mt-10 inline-flex items-center text-sm font-semibold text-[#BDA27E] hover:text-[#2B1A18]"
        >
          Agendar una visita
          <ArrowRight size={16} className="ml-1.5" />
        </button>
      )}
    </div>
  )
}

export function ContactoPanel() {
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_minmax(0,28rem)]">
      <div>
        <p className="text-[11px] font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Contacto</p>
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
              <span className="block font-medium">Showroom</span>
              <span className="text-[#2B1A18]/60">Recorre primero en 360° y luego agenda tu visita</span>
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
  )
}
