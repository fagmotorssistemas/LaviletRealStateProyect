import Link from 'next/link'
import styles from './unit-reference.module.css'

export default function UnitReferenceNotFound() {
  return <main className={styles.page}><div className={styles.unavailable}>
    <p className={styles.eyebrow}>LA VILET</p>
    <h1>Esta ficha ya no está disponible</h1>
    <p>Puede escribirnos en su conversación de WhatsApp para revisar esta vivienda o conocer otras opciones.</p>
    <Link className={styles.primary} href="/inicio">Conocer La Vilet</Link>
  </div></main>
}
