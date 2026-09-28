# Referencias, filtros y comparaciones — 28 de septiembre de 2026

## Incidente y causa

El mensaje «pero y cual es la diferencia entre estos dos?» seguía a una cotización de los penthouses 602 y 605. El extractor identificó una comparación, pero repitió tres dormitorios y planta seis como filtros. La resolución exigía que una comparación contextual no tuviera filtros actuales; por eso no recuperó los candidatos de la pregunta pendiente. Se consultó un conjunto vacío de identificadores de comparación.

El catálogo confundió ese conjunto vacío con falta de disponibilidad y preparó una presentación de alternativas. El borrador de la IA sí comparaba las unidades, pero la presentación errónea activó `alternative_unit_list_premature` y después `alternative_area_omitted`. La validación del respaldo registró `fallback_unanswered_request`; aun así, un control posterior podía restaurar la base rechazada.

## Comportamiento corregido

- El extractor aporta `property.filter_evidence` para cada restricción nueva. La evidencia debe estar en el mensaje actual. El historial identifica el referente; no declara restricciones nuevas. Las extracciones antiguas siguen siendo compatibles: las características que coinciden con el contexto o con todas las unidades referidas se clasifican como heredadas si no hay evidencia actual del campo.
- Comparaciones, detalles y clasificaciones relativas resuelven primero el conjunto referido: unidad seleccionada cuando ese es el alcance, pregunta pendiente, comparación activa u opciones ofrecidas. Después aplican las restricciones nuevas. Las preferencias anteriores compatibles se conservan en la consulta y no se presentan como declaraciones nuevas.
- Si faltan referentes o no hay suficientes unidades para comparar, se pide aclaración. No se deduce falta de disponibilidad ni se ofrecen categorías distintas por ese motivo. Una búsqueda real sin coincidencias conserva su comportamiento de alternativas.
- `alternative_unit_list_premature` y `alternative_area_omitted` solo rigen la presentación de alternativas por categoría en una búsqueda. El contrato del redactor y el validador comparten esa condición. Comparar o detallar permite identificar unidades; siguen activos los controles de unidades, categorías, cantidades, superficies y demás datos verificados.
- Un respaldo que falla cobertura o validación no puede ser restaurado por los controles posteriores ni por el formato final. Si tampoco existe una respuesta válida, se conserva una aclaración del referente o un aviso de que no se pudo verificar la respuesta; ese fallo interno no crea por sí solo un traspaso a un asesor.
- El registro muestra las restricciones actuales, las características heredadas y las unidades resueltas. La interfaz de revisión expone estos datos en «Decisiones y evidencia».

No hay excepciones por número de unidad. Los números 602 y 605 reproducen el incidente; hay regresiones con otros penthouses, departamentos, suites y locales.

## Archivos principales

| Responsabilidad | Archivo |
| --- | --- |
| Extracción y evidencia de filtros actuales | `src/lib/integrations/automation/turn-semantics.ts` |
| Referentes, alcance y preferencias heredadas | `src/lib/integrations/automation/property-context.ts` |
| Consulta y controles del catálogo | `src/lib/integrations/automation/catalog-dialogue.ts` |
| Contrato y revisión del borrador | `response-plan.ts`, `turn-completeness.ts` |
| Integridad del respaldo hasta el envío | `conversation.ts`, `delivery-integrity.ts` |
| Explicación visible | `src/components/inmobiliaria/automation/workflow/messageExplanation.ts` |

## Verificación

Las pruebas reproducen cotización → comparación con filtros repetidos → conservación del borrador y su pregunta en el envío simulado. También cubren otros códigos/categorías, detalles de la unidad elegida, clasificación por tamaño, restricciones nuevas, referentes incompletos, reglas de presentación y rechazo de datos inventados. Una prueba de integración comprueba que el respaldo inválido no reaparece en los controles posteriores.

Las pruebas sustituyen servicios externos y salidas del modelo; no envían mensajes a leads reales ni certifican una ejecución del modelo en producción. Los dos fallos ya conocidos de `visit-date-context.test.cjs` se deben a fechas de prueba que actualmente son pasadas y no forman parte de esta corrección.

Resultados: 160/160 pruebas de contexto, catálogo, extracción y revisión; 235/235 de integración; 43/43 de explicación de ejecuciones; 22/22 de opciones progresivas. La suite amplia de conversación confirmó los dos fallos previos de fechas. TypeScript sin errores y ESLint sin incidencias en los módulos modificados.
