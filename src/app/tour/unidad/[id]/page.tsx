import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { loadPublicUnitReference, unitReferenceSpecs } from '@/lib/tour/unitReference'
import { unitModelUrl, UNIT_MODEL_PATH } from '@/lib/tour/unitModels'
import styles from './unit-reference.module.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Su vivienda en La Vilet',
  description: 'Revise los detalles de la vivienda que le interesa y explore las referencias interactivas de La Vilet.',
  robots: { index: false, follow: false },
}

export default async function UnitReferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const client = tryCreateAdminClient()
  let unit
  try {
    if (!client) throw new Error('UNAVAILABLE')
    unit = await loadPublicUnitReference(client, id)
  } catch {
    return <main className={styles.page}><div className={styles.unavailable}>
      <p className={styles.eyebrow}>LA VILET</p>
      <h1>La ficha no se pudo cargar en este momento</h1>
      <p>Puede intentar abrir el enlace nuevamente o consultar el brochure del proyecto mientras tanto.</p>
      <a className={styles.primary} href="/materiales/brochure-la-vilet-v5.pdf">Ver brochure</a>
    </div></main>
  }
  if (!unit) notFound()
  const title = `${unit.category === 'suite' ? 'Suite' : 'Departamento'} ${unit.unit_number}`
  const ofUnit = `${unit.category === 'suite' ? 'de la suite' : 'del departamento'} ${unit.unit_number}`
  const modelUrl = unitModelUrl(unit)
  const specs = unitReferenceSpecs(unit)
  const spaces = [...new Set((Array.isArray(unit.spaces) ? unit.spaces : []).filter(s => typeof s === 'string' && s.trim()))]

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/inicio" className={styles.brand} aria-label="La Vilet, inicio">LA VILET</Link>
      <span>Puertas del Sol · Cuenca</span>
    </header>
    <div className={styles.content}>
      <section className={styles.intro} aria-labelledby="unit-title">
        <p className={styles.eyebrow}>LA VIVIENDA QUE LE INTERESA</p>
        <h1 id="unit-title">{title}</h1>
        <p>Conozca sus espacios y guarde esta referencia para revisarla a su ritmo.</p>
      </section>

      <section className={styles.card} aria-labelledby="details-title">
        <div className={styles.cardHeading}><h2 id="details-title">Cada espacio cuenta</h2><span>Unidad {unit.unit_number}</span></div>
        <dl className={styles.specs}>{specs.map(spec => <div key={spec.label}><dt>{spec.label}</dt><dd>{spec.value}</dd></div>)}</dl>
        {spaces.length > 0 && <details className={styles.spaces} open>
          <summary>Ambientes de esta vivienda</summary>
          <ul>{spaces.map(space => <li key={space}>{space}</li>)}</ul>
        </details>}
      </section>

      {modelUrl ? <section className={styles.card} aria-labelledby="model-title">
        <div className={styles.cardHeading}><h2 id="model-title">Explore {title.toLocaleLowerCase('es')}</h2><span>Modelo 3D</span></div>
        <p>Puede girar el modelo, acercarse y revisar la distribución.</p>
        <iframe className={styles.viewer} src={modelUrl} title={`Modelo 3D de ${title}`} loading="lazy" />
      </section> : <section className={styles.card} aria-labelledby="reference-title">
        <div className={styles.cardHeading}><h2 id="reference-title">Una primera mirada a La Vilet</h2><span>Referencia del proyecto</span></div>
        <p className={styles.notice}>El modelo 3D {ofUnit} aún está pendiente. Los detalles de arriba sí corresponden a esta unidad.</p>
        <details className={styles.example}>
          <summary>Explorar un ejemplo 3D del proyecto</summary>
          <p>Este ejemplo corresponde a la <strong>suite 210, en la segunda planta</strong>. Su distribución y sus dimensiones son distintas a las {ofUnit}.</p>
          <iframe className={styles.viewer} src={`${UNIT_MODEL_PATH}?unidad=210`} title="Ejemplo del proyecto: modelo 3D de la suite 210" loading="lazy" />
        </details>
      </section>}

      <section className={styles.next}>
        <div><h2>El proyecto, con más detalle</h2><p>También puede conocer la propuesta de La Vilet en nuestro brochure.</p></div>
        <a className={styles.primary} href="/materiales/brochure-la-vilet-v5.pdf">Abrir brochure <span aria-hidden="true">↗</span></a>
      </section>
      <p className={styles.footer}>Puede volver a su conversación de WhatsApp y contarnos qué le interesa de la unidad {unit.unit_number}.</p>
    </div>
  </main>
}
