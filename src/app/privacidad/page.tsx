import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/marketing/SiteHeader'

export const metadata: Metadata = {
  title: 'Política de privacidad',
  description: 'Cómo La Vilet trata datos personales, cookies del showroom 360° y señales de pauta.',
  robots: { index: false, follow: false },
}

function Field({ children }: { children: string }) {
  return (
    <span className="rounded-sm bg-[#BDA27E]/18 px-1 font-medium text-[#2B1A18]">{children}</span>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#2B1A18]/10 bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[#2B1A18]/8 bg-[#2B1A18]/3">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium text-[#2B1A18]">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-b border-[#2B1A18]/6 last:border-0">
              {row.map((cell) => (
                <td key={cell} className="px-3 py-2 align-top text-[#2B1A18]/75">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PrivacidadPage() {
  return (
    <div className="min-h-screen bg-[#f7f3ee] text-[#2B1A18]">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Legal</p>
        <h1 className="mt-3 font-serif text-3xl font-semibold sm:text-4xl">Política de privacidad</h1>
        <p className="mt-3 text-sm text-[#2B1A18]/55">
          Borrador para revisión legal. No publicar sin validación profesional.
        </p>

        <div className="mt-10 space-y-10 text-sm leading-relaxed text-[#2B1A18]/75">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">1. Quién trata tus datos</h2>
            <p>
              <Field>[RAZÓN SOCIAL COMPLETA]</Field>, RUC <Field>[NÚMERO]</Field>, con domicilio en{' '}
              <Field>[DIRECCIÓN]</Field>, Cuenca, Ecuador, es responsable del tratamiento de los datos
              personales recogidos en este sitio.
            </p>
            <p>
              Para cualquier consulta sobre tus datos: <Field>[CORREO DE CONTACTO]</Field>.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">2. Qué información recogemos</h2>
            <p className="font-medium text-[#2B1A18]">Cuando navegas el recorrido virtual, sin identificarte</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Un identificador aleatorio guardado en tu navegador (cookie lv_vid), que no contiene tu
                nombre ni ningún dato personal
              </li>
              <li>Qué tipologías y ambientes visitas, y cuánto tiempo permaneces en cada uno</li>
              <li>Los acabados y opciones de iluminación que consultas</li>
              <li>Tipo de dispositivo, sistema operativo y ancho de pantalla</li>
              <li>Ciudad y país aproximados</li>
              <li>La página o campaña desde la que llegaste</li>
            </ul>
            <p>No guardamos tu dirección IP.</p>
            <p className="font-medium text-[#2B1A18]">Cuando nos dejas tus datos</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Nombre</li>
              <li>Correo electrónico</li>
              <li>Número de WhatsApp</li>
            </ul>
            <p>
              En ese momento, la información de navegación descrita arriba queda asociada a tu
              contacto, incluida la de visitas anteriores realizadas desde ese mismo navegador.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">3. Para qué la usamos y con qué base legal</h2>
            <Table
              headers={['Finalidad', 'Base legal']}
              rows={[
                [
                  'Que el recorrido virtual funcione',
                  'Necesario para prestar el servicio que solicitas',
                ],
                [
                  'Medir qué tipologías y ambientes interesan más, para mejorar el proyecto y el sitio',
                  'Interés legítimo: es información agregada que no te identifica',
                ],
                [
                  'Contactarte para darte información comercial del proyecto',
                  'Tu consentimiento, otorgado al enviar el formulario',
                ],
                [
                  'Medir el rendimiento de nuestra publicidad y mostrarte anuncios relevantes',
                  'Tu consentimiento, otorgado en el banner de cookies',
                ],
              ]}
            />
            <p>
              Puedes retirar tu consentimiento en cualquier momento. Retirarlo no afecta la licitud
              del tratamiento previo.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">4. Con quién la compartimos</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>Supabase — alojamiento de la base de datos</li>
              <li>Vercel — alojamiento del sitio</li>
              <li>
                Meta Platforms — medición publicitaria, únicamente si aceptaste las cookies
                correspondientes
              </li>
              <li>
                <Field>[CRM / Kommo]</Field> — gestión del contacto comercial
              </li>
            </ul>
            <p>
              Estos proveedores tratan los datos por cuenta nuestra y bajo instrucciones nuestras.
              Algunos alojan información fuera de Ecuador; en esos casos se aplican las garantías
              previstas en la LOPDP para transferencias internacionales.
            </p>
            <p>No vendemos tus datos ni los cedemos a terceros para sus propios fines.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">5. Cuánto tiempo la conservamos</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>Datos de navegación asociados a un contacto: 24 meses desde la última interacción</li>
              <li>Datos de navegación anónimos: 24 meses</li>
              <li>
                Datos de contacto: mientras exista relación comercial y, después, el plazo que exija
                la normativa aplicable
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">6. Tus derechos</h2>
            <p>Puedes solicitar en cualquier momento:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Acceso — saber qué información tenemos sobre ti</li>
              <li>Rectificación — corregir datos inexactos</li>
              <li>Eliminación — que borremos tus datos</li>
              <li>Oposición — oponerte a determinados tratamientos</li>
              <li>Portabilidad — recibir tus datos en formato estructurado</li>
              <li>Suspensión — pedir que se detenga el tratamiento</li>
            </ul>
            <p>
              Escribe a <Field>[CORREO DE CONTACTO]</Field>. Responderemos en los plazos previstos
              por la ley.
            </p>
            <p>
              Si consideras que no atendimos tu solicitud correctamente, puedes presentar un reclamo
              ante la Superintendencia de Protección de Datos Personales.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">7. Cookies que utilizamos</h2>
            <Table
              headers={['Cookie', 'Para qué sirve', 'Duración']}
              rows={[
                [
                  'lv_vid',
                  'Reconocer tu navegador entre visitas y asociar tu recorrido',
                  '400 días',
                ],
                ['lv_consent', 'Recordar tu elección sobre cookies', '6 meses'],
                [
                  '_fbp, _fbc',
                  'Medición publicitaria de Meta. Solo si las aceptaste',
                  'Según Meta',
                ],
              ]}
            />
            <p>
              Puedes borrar las cookies desde la configuración de tu navegador. Si borras lv_vid, tu
              próxima visita será tratada como nueva.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">8. Menores de edad</h2>
            <p>
              Este sitio no está dirigido a menores de 18 años y no recogemos deliberadamente su
              información.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">9. Cambios</h2>
            <p>
              Podemos actualizar esta política. Publicaremos la fecha de la última modificación al
              pie y, si el cambio es relevante, te lo comunicaremos.
            </p>
            <p>
              Última actualización: <Field>[FECHA]</Field>
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
