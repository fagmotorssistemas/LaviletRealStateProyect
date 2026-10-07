'use client'

import styles from './KnowledgeCenter.module.css'
import { SettingsHelp } from './SettingsHelp'

export function CatalogSearchControl({ enabled, busy, error, notice, onToggle }: {
  enabled: boolean; busy: boolean; error: string; notice: string; onToggle: () => void
}) {
  return <section className={`${styles.card} ${styles.searchControl}`} aria-label="Búsqueda de unidades">
    <div><h2>Búsqueda por embeddings<SettingsHelp title="Búsqueda por embeddings" configures="Activa la ordenación semántica de búsquedas descriptivas del catálogo." usedByBot="Primero aplica filtros y calcula rangos completos; usa embeddings solo cuando la consulta requiere ordenar por similitud. Reducir contexto y usar embeddings son operaciones distintas." applies="Consultas descriptivas compatibles. Si falla la ordenación, conserva la consulta estructurada; no fuerza una llamada a embeddings en cada mensaje." saving="El control guarda su estado al pulsarlo y afecta a las próximas consultas. Desactivarlo no elimina los embeddings almacenados." example="Pedir opciones de tres dormitorios permite filtros estructurados; describir preferencias de amplitud o distribución puede necesitar similitud." /></h2>
      <p>En consultas sencillas, comprueba los requisitos y calcula cantidades y rangos sobre todas las coincidencias. Envía las fichas que caben en el contexto y utiliza embeddings para ordenar búsquedas descriptivas. Conserva el tono, los datos pendientes del lead y las restricciones generales.</p>
      <p>Los conteos y rangos se calculan con datos completos. Las consultas de presupuesto, recomendaciones y financiamiento reciben el contexto pertinente aunque no utilicen embeddings. El registro distingue la búsqueda vectorial del contexto reducido por consulta. Si falla la ordenación por similitud, se mantiene la consulta estructurada.</p>
      <p>Al desactivarla se usa la búsqueda estructurada. El contexto sigue seleccionándose según la consulta para evitar información repetida. Los embeddings guardados se conservan.</p>
    </div>
    <div className={styles.buttons}>
      <button type="button" role="switch" aria-checked={enabled} aria-label="Búsqueda por embeddings" disabled={busy}
        className={enabled ? styles.primary : undefined} onClick={onToggle}>
        {busy ? 'Guardando…' : enabled ? 'Activada · Desactivar' : 'Desactivada · Activar'}
      </button>
      <span>{enabled ? 'Búsqueda por características activada' : 'Búsqueda actual'}</span>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
  </section>
}
