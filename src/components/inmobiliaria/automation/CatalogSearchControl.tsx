'use client'

import styles from './KnowledgeCenter.module.css'

export function CatalogSearchControl({ enabled, busy, error, notice, onToggle }: {
  enabled: boolean; busy: boolean; error: string; notice: string; onToggle: () => void
}) {
  return <section className={`${styles.card} ${styles.searchControl}`} aria-label="Búsqueda de unidades">
    <div><h2>Búsqueda por embeddings</h2>
      <p>En consultas sencillas, comprueba los requisitos y calcula cantidades y rangos sobre todas las coincidencias. Envía las fichas que caben en el contexto y utiliza embeddings para ordenar búsquedas descriptivas. Conserva el tono, los datos pendientes del lead y las restricciones generales.</p>
      <p>Los conteos y rangos exactos se resuelven sin llamar a embeddings. Presupuesto, comparaciones y recomendaciones complejas conservan la búsqueda actual. Si falla la ordenación por similitud, se mantiene la consulta estructurada; si no puede interpretarse con certeza, se conserva el recorrido anterior.</p>
      <p>Al desactivarla se restauran la búsqueda y el contexto anteriores para los siguientes mensajes. Los embeddings guardados se conservan.</p>
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
