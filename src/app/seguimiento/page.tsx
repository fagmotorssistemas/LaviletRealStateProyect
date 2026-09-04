import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/marketing/SiteHeader'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function SeguimientoPage() {
  return (
    <div className="min-h-screen bg-[#f7f3ee] text-[#2B1A18]">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Visor 360°</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Cómo quedó el seguimiento</h1>
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-[#2B1A18]/75">
          <p>
            El visor no calcula atribución ni adopta eventos. Avisa tres cosas a Postgres y guarda una
            cookie.
          </p>
          <section>
            <h2 className="text-lg font-semibold text-[#2B1A18]">Qué guarda cada tabla</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>tour_visitors</strong>: el navegador. La cookie `lv_vid` es la llave. RLS activo,
                solo escribe la service role.
              </li>
              <li>
                <strong>tour_sessions</strong>: una visita. Ahí quedan UTM, `?b=` del asesor, referrer,
                ciudad y país. La base decide cuál origen cuenta.
              </li>
              <li>
                <strong>tour_events</strong>: el recorrido. Tipos fijos: entrada, salida, ambiente,
                cambios, gate y lead identificado. El tiempo lo acumula la base.
              </li>
              <li>
                <strong>leads</strong>: la persona, cuando envía el formulario. Una sola función cuelga el
                navegador del lead y adopta los eventos anónimos previos.
              </li>
            </ul>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-[#2B1A18]">Varios dispositivos, una persona</h2>
            <p className="mt-3">
              Cada celular o computador tiene su propia cookie, o sea su propio visitante. No se fusionan
              por dispositivo. Si la misma persona deja el mismo correo o WhatsApp en otro aparato,
              `identify_tour_lead` encuentra el lead ya existente y cuelga ese segundo navegador. El
              historial de ambos queda en la misma persona. Si nunca se identifica, son dos anónimos.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-[#2B1A18]">Al enviar el formulario</h2>
            <p className="mt-3">
              El visor llama solo `identify_tour_lead`. Postgres busca por correo o teléfono normalizado,
              crea el lead si no existe, cuelga este `lv_vid`, adopta los eventos anónimos de esa cookie y
              congela la atribución del primer origen. El front no busca, no crea y no actualiza leads por
              su cuenta.
            </p>
          </section>
        </div>
        <Link href="/" className="mt-10 inline-block text-sm font-medium text-[#BDA27E] hover:text-[#2B1A18]">
          Volver al inicio
        </Link>
      </main>
    </div>
  )
}
