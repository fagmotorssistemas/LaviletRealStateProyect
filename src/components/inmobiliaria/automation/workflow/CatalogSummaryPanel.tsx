import type { WorkflowExecutionStep } from './executionWorkflow'
import { catalogNumber, catalogSummaries, CATALOG_SUMMARY_FIELDS } from './catalogSummary'
import styles from './CatalogSummaryPanel.module.css'

const number = (value: number) => value.toLocaleString('es-EC', { maximumFractionDigits: 6 })
const range = (min: number | null, max: number | null, unit: string) => min === null || max === null
  ? 'Rango no registrado' : `${number(min)}${min === max ? '' : ` – ${number(max)}`}${unit ? ` ${unit}` : ''}`
const unitValue = (value: unknown) => { const numeric = catalogNumber(value); return numeric === null ? 'Sin dato' : number(numeric) }
const operators: Record<string, string> = { eq: 'igual a', gt: 'mayor que', gte: 'al menos', lt: 'menor que', lte: 'como máximo', between: 'entre', contains: 'incluye', not_contains: 'no incluye' }

export function CatalogSummaryPanel({ steps, onStep }: { steps: WorkflowExecutionStep[]; onStep?: (order: number) => void }) {
  const summaries = catalogSummaries(steps)
  return <section className={styles.panel} aria-label="Resumen del catálogo enviado al redactor">
    <p>Datos calculados por el código y conservados en la entrada del redactor. Cada llamada muestra su propio resumen.</p>
    {!summaries.length && <p>No se conservó un resumen de catálogo en las llamadas del redactor de este mensaje. No se reconstruye con el catálogo actual.</p>}
    {summaries.map(summary => <details key={summary.step} className={styles.call} open={summaries.length === 1}>
      <summary>Redactor · paso {summary.step} · {summary.units.length} fichas conservadas</summary>
      <div className={styles.scope} data-partial={summary.completeness !== 'complete' || summary.limited}>
        <strong>{summary.optimized ? 'Resumen de todas las coincidencias confirmadas' : summary.completeness === 'partial' ? 'Selección parcial' : summary.completeness === 'complete' ? 'Consulta declarada completa en su alcance' : 'Alcance completo sin confirmar'}</strong>
        <p>{summary.optimized ? 'El resumen se calculó antes de elegir las fichas. Las unidades con datos faltantes permanecen pendientes de comprobar; no se cuentan como descartadas.'
          : summary.completeness === 'partial' ? 'Los rangos describen las unidades incluidas. No representan los extremos ni el total de opciones del proyecto.'
          : summary.completeness === 'complete' ? 'La cobertura se limita a la consulta registrada; no implica que incluya todo el proyecto.'
            : 'El registro no permite afirmar que estas fichas cubran todas las opciones.'}</p>
        {typeof summary.scope.note === 'string' && <p>{summary.scope.note}</p>}
        {summary.limited && <p><strong>Captura abreviada:</strong> pueden faltar fichas, grupos o campos que sí recibió el redactor.</p>}
        {summary.privacyFiltered && <p>El registro conserva filtros de privacidad.</p>}
      </div>
      <p><strong>Fichas conservadas:</strong> {summary.units.length}{summary.candidateCount !== null && <> · <strong>Candidatas registradas en la búsqueda:</strong> {number(summary.candidateCount)}. Esta cantidad no acredita que todas cumplan los requisitos.</>}</p>
      {summary.optimized && <div className={styles.group}>
        <h4>Resultado completo de la consulta</h4>
        {!!summary.requirements.length && <ul>{summary.requirements.map((requirement, index) => <li key={index}>
          {requirement.strength === 'preferred' ? 'Preferencia' : 'Requisito'}: {CATALOG_SUMMARY_FIELDS.find(([key]) => key === requirement.field)?.[1] || (requirement.field === 'spaces' ? 'Espacios' : 'Característica por confirmar')} {operators[String(requirement.operator)] || String(requirement.operator)} {String(requirement.value ?? 'Sin dato')}{requirement.operator === 'between' ? ` y ${requirement.upper_value}` : ''}.
        </li>)}</ul>}
        <p><strong>Coincidencias confirmadas:</strong> {unitValue(summary.aggregate.matching_count)} · <strong>Pendientes por falta de datos:</strong> {unitValue(summary.aggregate.unknown_count)} · <strong>No cumplen:</strong> {unitValue(summary.aggregate.excluded_count)}</p>
        <p>{summary.aggregate.exact_count === true ? 'Conteo exacto dentro de esta consulta.' : 'Hay información pendiente: el conteo confirmado no es un total definitivo.'}</p>
        <dl>{summary.statistics.map(stat => <div key={stat.field}><dt>{stat.label}</dt><dd>{range(stat.min, stat.max, stat.unit)}{stat.known !== null && <> · {stat.known} con dato; {stat.unknown} sin dato</>}</dd></div>)}</dl>
        {!!summary.unknownUnits.length && <p><strong>Pendientes de comprobar:</strong> {summary.unknownUnits.map(unit => `${unit.unit_number || unit.unit_id}: ${Array.isArray(unit.fields) ? unit.fields.map(field => CATALOG_SUMMARY_FIELDS.find(([key]) => key === field)?.[1] || String(field)).join(', ') : 'Sin dato'}`).join('; ')}.</p>}
      </div>}
      <h4>Rangos calculados y enviados</h4>
      <p>“Rango no registrado” significa que no se guardó esa agregación. No significa cero ni ausencia de esa característica.</p>
      {!summary.groups.length && <p>No se conservaron grupos con rangos calculados.</p>}
      {summary.groups.map((group, index) => <article className={styles.group} key={`${group.id}-${index}`}>
        <h5>{group.title}</h5>
        <p><strong>Unidades del grupo:</strong> {group.members === null ? 'Referencia no disponible en esta captura' : group.members.join(', ') || 'Sin miembros registrados'}</p>
        <dl>{group.ranges.map(item => <div key={item.field}><dt>{item.label}</dt><dd>{range(item.min, item.max, item.unit)}</dd></div>)}</dl>
        <small>Referencia: {group.id || 'Sin identificador'}</small>
      </article>)}
      <details className={styles.units}><summary>Ver fichas de las unidades incluidas ({summary.units.length})</summary>
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`Fichas del catálogo del paso ${summary.step}`}>
          <table><caption>Valores conservados en la entrada del redactor</caption><thead><tr><th scope="col">Unidad</th><th scope="col">Categoría</th>
            {CATALOG_SUMMARY_FIELDS.map(([field, label, unit]) => <th scope="col" key={field}>{label}{unit ? ` (${unit})` : ''}</th>)}</tr></thead>
            <tbody>{summary.units.map((unit, index) => <tr key={index}><th scope="row">{String(unit.unit_number || unit.id || 'Sin identificación')}</th><td>{String(unit.category || 'Sin dato')}</td>
              {CATALOG_SUMMARY_FIELDS.map(([field]) => <td key={field}>{unitValue(unit[field])}</td>)}</tr>)}</tbody></table>
        </div>
      </details>
      {!!summary.conflicts.length && <p className={styles.scope}>El registro contiene {summary.conflicts.length} conflictos de evidencia. Consulte los datos originales de esta llamada.</p>}
      <details className={styles.units}><summary>Ver consulta y alcance originales</summary><pre>{JSON.stringify({ consulta: summary.query ?? null, alcance: summary.scope, ...(summary.optimized ? { requisitos: summary.aggregate.request } : {}) }, null, 2)}</pre></details>
      {onStep && <button type="button" onClick={() => onStep(summary.step)}>Ver entrada completa del redactor · paso {summary.step}</button>}
    </details>)}
  </section>
}

export function CatalogSummarySection(props: { steps: WorkflowExecutionStep[]; onStep?: (order: number) => void }) {
  return <details className={styles.section}><summary>Resumen del catálogo enviado al redactor</summary><CatalogSummaryPanel {...props} /></details>
}
