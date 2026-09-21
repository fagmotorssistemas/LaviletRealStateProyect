import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/marketing/SiteHeader'

export const metadata: Metadata = {
  title: 'Política de privacidad',
  description:
    'Cómo CONSTRUCTORA AGMMEN S.A.S. (La Vilet) trata datos personales, cookies del showroom 360° y señales de pauta.',
}

const PRIVACY_EMAIL = 'lavilet.admin@gmail.com'
const UPDATED_AT = '21 de septiembre de 2026'

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
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="border-b border-[#2B1A18]/6 last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={`${index}-${cellIndex}`} className="px-3 py-2 align-top text-[#2B1A18]/75">
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
          Sitio y showroom virtual de La Vilet. Última actualización: {UPDATED_AT}.
        </p>

        <div className="mt-10 space-y-10 text-sm leading-relaxed text-[#2B1A18]/75">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">1. Quién trata tus datos</h2>
            <p>
              CONSTRUCTORA AGMMEN S.A.S., RUC 0195168741001, con domicilio en Av. España y Sevilla,
              junto al Banco de Guayaquil, Cuenca, Azuay, Ecuador, es responsable del tratamiento de
              los datos personales recogidos en este sitio y en el showroom virtual de La Vilet.
            </p>
            <p>
              Para consultas sobre privacidad o para solicitar la eliminación de tus datos:{' '}
              <a
                href={`mailto:${PRIVACY_EMAIL}`}
                className="font-medium text-[#2B1A18] underline decoration-[#BDA27E]/50 underline-offset-2 hover:text-[#BDA27E]"
              >
                {PRIVACY_EMAIL}
              </a>
              . Instrucciones en la{' '}
              <a
                href="#eliminacion"
                className="font-medium text-[#2B1A18] underline decoration-[#BDA27E]/50 underline-offset-2 hover:text-[#BDA27E]"
              >
                sección 6
              </a>
              .
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">2. Qué información recogemos</h2>
            <p className="font-medium text-[#2B1A18]">Cuando navegas el recorrido virtual, sin identificarte</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Un identificador aleatorio en tu navegador (cookie <code className="text-[13px]">lv_vid</code>
                ), que no contiene tu nombre ni tu teléfono
              </li>
              <li>Tipologías y ambientes que visitas, y el tiempo aproximado en cada uno</li>
              <li>Acabados e iluminación que consultas</li>
              <li>Tipo de dispositivo, user-agent y ancho de pantalla</li>
              <li>Ciudad y país aproximados (cuando el alojamiento los aporta)</li>
              <li>Página de llegada, referrer y parámetros de campaña (por ejemplo UTM), si existen</li>
            </ul>
            <p>
              Un recorrido anónimo no crea un lead comercial. La actividad anónima puede alimentar
              métricas agregadas del showroom.
            </p>

            <p className="font-medium text-[#2B1A18]">Cuando dejas tus datos en formularios del sitio o del showroom</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Nombre (cuando el formulario lo pide)</li>
              <li>Correo electrónico (cuando el formulario lo pide; en algunos flujos es opcional)</li>
              <li>Número de WhatsApp / teléfono (requerido para identificarte en el showroom)</li>
              <li>
                Contenido de la solicitud, si la envías: motivo, mensaje y, si aplica, unidad o tipología
                de interés
              </li>
              <li>Unidades guardadas o marcadas como favoritas, si usas esa función</li>
            </ul>
            <p>
              Al identificarte desde el mismo navegador, el historial de recorrido previo de ese
              visitante puede vincularse a tu contacto. No relacionamos automáticamente actividad
              anónima de otros dispositivos.
            </p>

            <p className="font-medium text-[#2B1A18]">Cuando escribes por WhatsApp</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Mensajes, metadatos técnicos del canal y datos de contacto que aporta la integración
                con Kommo (CRM), asociados a la conversación comercial
              </li>
            </ul>

            <p className="font-medium text-[#2B1A18]">Medición publicitaria (solo con tu consentimiento de cookies de pauta)</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Identificadores y cookies de Meta (por ejemplo <code className="text-[13px]">_fbp</code> /{' '}
                <code className="text-[13px]">_fbc</code>), eventos del sitio y, cuando corresponde,
                señales enviadas por servidor (CAPI) para medir anuncios
              </li>
              <li>
                En ese contexto técnico pueden usarse dirección IP y user-agent. El consentimiento de
                contacto comercial (casilla del formulario) es distinto del consentimiento de
                cookies/pauta
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">3. Para qué la usamos</h2>
            <Table
              headers={['Finalidad', 'Cómo se activa']}
              rows={[
                [
                  'Operar el showroom 360° y recordar tu sesión de visitante',
                  'Necesario para el servicio que estás usando',
                ],
                [
                  'Entender el interés por tipologías y ambientes (mapa / métricas del recorrido)',
                  'Uso del showroom; puede incluir visitas anónimas e identificadas',
                ],
                [
                  'Contactarte con información del proyecto (correo, WhatsApp u otros canales de atención)',
                  'Cuando envías un formulario y aceptas la casilla de contacto / privacidad',
                ],
                [
                  'Gestionar tu solicitud, favoritos y seguimiento comercial en CRM',
                  'Cuando dejas datos o escribes por WhatsApp',
                ],
                [
                  'Medir el rendimiento de la publicidad digital (Meta Pixel / CAPI)',
                  'Solo si aceptas cookies de medición en el aviso de cookies',
                ],
              ]}
            />
            <p>
              Puedes retirar el consentimiento de cookies de pauta desde «Preferencias de cookies» en
              el pie del sitio (cuando el aviso está activo). Retirarlo no afecta tratamientos ya
              realizados con una base válida.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">4. Con quién la compartimos</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>Supabase — alojamiento de la base de datos del sitio</li>
              <li>Vercel — alojamiento y entrega del sitio</li>
              <li>
                Meta Platforms — medición publicitaria (Pixel / CAPI), únicamente si aceptaste las
                cookies de medición
              </li>
              <li>Kommo — CRM y canal de mensajes de WhatsApp vinculados a la atención comercial</li>
            </ul>
            <p>
              Estos proveedores tratan datos para prestarnos el servicio. Algunos pueden procesar
              información fuera de Ecuador. No vendemos tus datos ni los cedemos a terceros para sus
              propios fines de marketing independientes de La Vilet.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">5. Cuánto tiempo la conservamos</h2>
            <p>
              Conservamos la información mientras sea necesaria para las finalidades descritas arriba
              y mientras existan obligaciones legales o de atención comercial aplicables. Hoy no
              aplicamos un borrado automático por un plazo fijo predefinido en el sistema.
            </p>
            <p>
              Las cookies del sitio tienen la duración indicada en la sección 7; puedes borrarlas
              desde tu navegador.
            </p>
          </section>

          <section id="eliminacion" className="scroll-mt-24 space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">6. Tus derechos y eliminación de datos</h2>
            <p>Puedes solicitar, entre otras gestiones previstas por la normativa aplicable:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Acceso a la información que tenemos sobre ti</li>
              <li>Rectificación de datos inexactos</li>
              <li>Eliminación de tus datos</li>
              <li>Oposición a determinados tratamientos</li>
            </ul>
            <p className="font-medium text-[#2B1A18]">Cómo pedir la eliminación de tus datos</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Escribe a{' '}
                <a
                  href={`mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent('Solicitud de eliminación de datos — La Vilet')}`}
                  className="font-medium text-[#2B1A18] underline decoration-[#BDA27E]/50 underline-offset-2 hover:text-[#BDA27E]"
                >
                  {PRIVACY_EMAIL}
                </a>
                .
              </li>
              <li>
                Usa un asunto claro, por ejemplo: «Solicitud de eliminación de datos — La Vilet».
              </li>
              <li>
                Incluye el nombre con el que te registraste (si aplica), el número de WhatsApp/teléfono
                y el correo que usaste en el sitio, para poder localizar tu registro.
              </li>
              <li>
                Si escribes desde otra cuenta, indica de forma inequívoca a qué contacto te refieres.
              </li>
            </ol>
            <p>
              Atenderemos la solicitud por el mismo correo. Algunas copias pueden permanecer en
              sistemas de respaldo o en proveedores (por ejemplo historial de WhatsApp/CRM) el tiempo
              que exija su operación o la ley; no prometemos un plazo fijo de borrado total en todos
              los sistemas.
            </p>
            <p>
              Si consideras que no atendimos tu solicitud correctamente, puedes presentar un reclamo
              ante la autoridad de protección de datos competente en Ecuador.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">7. Cookies que utilizamos</h2>
            <Table
              headers={['Cookie', 'Para qué sirve', 'Duración']}
              rows={[
                [
                  'lv_vid',
                  'Reconocer el navegador entre visitas del showroom y asociar el recorrido',
                  '400 días',
                ],
                [
                  'lv_ads_consent / lv_consent',
                  'Recordar tu elección sobre cookies de medición (aceptar, solo necesarias o rechazar)',
                  '180 días',
                ],
                [
                  'lv_contact_consent',
                  'Recordar que aceptaste contacto comercial en un formulario',
                  '180 días',
                ],
                [
                  'lv_city / lv_country',
                  'Ciudad y país aproximados asociados a la visita',
                  '400 días',
                ],
                [
                  '_fbp, _fbc (y relacionadas de Meta)',
                  'Medición publicitaria de Meta. Solo si aceptaste cookies de medición',
                  'Según configuración de Meta',
                ],
              ]}
            />
            <p>
              Puedes borrar las cookies desde la configuración de tu navegador. Si borras{' '}
              <code className="text-[13px]">lv_vid</code>, la próxima visita al showroom se tratará
              como un visitante nuevo.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">8. Menores de edad</h2>
            <p>
              Este sitio y el showroom no están dirigidos a menores de 18 años. No buscamos recoger
              deliberadamente su información.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#2B1A18]">9. Cambios</h2>
            <p>
              Podemos actualizar esta política cuando cambie el sitio o el tratamiento. La fecha de
              la última actualización aparece al inicio de esta página.
            </p>
            <p>Última actualización: {UPDATED_AT}.</p>
          </section>
        </div>

        <div className="mt-10 flex flex-wrap gap-4 text-sm font-medium">
          <Link href="/" className="text-[#BDA27E] hover:text-[#2B1A18]">
            Volver al inicio
          </Link>
          <a
            href={`mailto:${PRIVACY_EMAIL}`}
            className="text-[#BDA27E] hover:text-[#2B1A18]"
          >
            Escribir a privacidad
          </a>
        </div>
      </main>
    </div>
  )
}
