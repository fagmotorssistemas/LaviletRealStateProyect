# Opciones de interés, cambios de preferencia y continuación del recorrido

Fecha: 28/09/2026. Estado: **local pendiente de despliegue**. Estas pruebas usan catálogo y servicios simulados; no acreditan una ejecución nueva en WhatsApp.

## Comportamiento acordado

El bot conserva los requisitos y las opciones que interesan al cliente. Presentar opciones, compararlas y elegir una unidad son estados distintos. Un «sí» a conocer detalles de varias unidades no selecciona ninguna ni autoriza una cita o revisión financiera.

| Situación | Respuesta y siguiente paso |
| --- | --- |
| Precio de las opciones ya filtradas | Explicar categoría y dormitorios, ubicación común si está verificada y precios autorizados. Preguntar si desea más detalles. |
| «Sí, ¿cuál es la diferencia?» | Comparar las opciones ofrecidas con sus datos reales; preguntar cuál desea conocer mejor. |
| «Sí» a los detalles de varias opciones | Mostrar esas opciones y pedir elección, sin escoger por el cliente. |
| Identifica una unidad | Mostrar esa unidad y su enlace 360 individual. |
| «Algo más económico», sin cantidad de dormitorios | Confirmar si conserva la cantidad conocida. Si la rechaza, preguntar la cantidad que desea. |
| «Más económico de 3 dormitorios» | Buscar opciones disponibles de tres dormitorios con precio autorizado menor al de las opciones de referencia. Presentar categorías antes de detallar unidades. |
| «Menos dormitorios» | Cambiar el requisito y ofrecer las categorías disponibles con menos dormitorios; no exigir que también mencione el precio. |
| «De 2 dormitorios» | Aplicar dos dormitorios exactos. No añadir suites de uno. |
| Menos dormitorios y menor precio juntos | Aplicar ambos requisitos; menos dormitorios por sí solo no demuestra menor precio. |
| Elige una categoría alternativa | Preguntar planta si hay varias; después mostrar las unidades de esa planta y pedir elección. |

Los números 602 y 605 no están codificados como condiciones del flujo. Las pruebas incluyen unidades 801, 802, 803, departamentos y suites con otros números. El conjunto depende del inventario disponible y los requisitos vigentes.

La búsqueda de menor precio utiliza la unidad seleccionada o, si no existe, el conjunto ofrecido como referencia. Para llamar «más económicas» a las nuevas opciones, sus precios deben ser menores al mínimo de ese conjunto, estar publicados y estar autorizados. Si no hay precios comparables, el bot explica la limitación sin afirmar un ahorro. Los filtros expresos de planta o superficie se conservan; que dos penthouses estén en la misma planta no convierte esa ubicación en una preferencia del cliente.

## Después del 360

Las rutas comerciales de unidad individual comparten `tourContinuation`:

- Presupuesto no indicado: preguntar el presupuesto aproximado para la compra.
- Monto conocido, pero significado ambiguo: confirmar si corresponde al total o a la entrada, sin pedir otra vez el monto.
- Presupuesto conocido: avanzar sobre la misma unidad. Si procede y existen entidades habilitadas, ofrecer información de financiamiento; no iniciar una revisión por esa sola oferta.
- Presupuesto desconocido o que el cliente no quiere compartir: respetarlo y preguntar qué desea revisar de esa opción.
- Solicitud actual de visita o financiamiento: respetar esa solicitud y sus controles operativos.

La pregunta de perfil inicial conserva su prioridad cuando corresponde. No se añaden a la vez una pregunta de perfil y otra de presupuesto.

## Contrato compartido y controles

`preference_transition` conserva el motivo del cambio y las unidades de referencia. Explorar otra categoría no reemplaza la selección anterior; elegir una nueva unidad sí lo hace. `pending_question` conserva la acción, los candidatos y, cuando corresponde, la consulta propuesta. Confirmar dormitorios (`accepted_bedroom_confirmation`) y aceptar la categoría (`accepted_alternative_query`) son transiciones distintas: evita volver a ofrecer la misma categoría al responder «sí».

`progressive_selection` comunica al redactor y al revisor el propósito, candidatos, criterios y siguiente pregunta. Permite reformularla, pero comprueba su presencia y evita sustituir la elección por presupuesto, financiamiento o una visita. Los controles existentes de catálogo, precios, cobertura y evidencia siguen activos. `post_tour_continuation` comunica la decisión posterior al recorrido y el estado del presupuesto.

La cotización también comprueba conjuntos expresados en plural: un precio real no permite atribuirlo a una unidad distinta. Se contrastan los integrantes del conjunto, dormitorios, planta y precios de expresiones como «ambos», «cada uno» y «respectivamente». La continuación después del recorrido comprueba que exista una pregunta; el signo `?` de la URL del tour no cuenta como tal.

La vista **Por mensaje**, en revisión de respuesta, muestra «Opciones de interés y siguiente paso» y «Continuación después del recorrido 360» cuando la ejecución guardó esos datos. Muestra criterios, candidatos, pregunta y motivo. La aprobación de ese paso no se presenta como prueba de entrega: esta sigue comprobándose en Envío a Kommo. Los registros antiguos sin estos campos no se reconstruyen.

## Mapa del cambio

Las líneas son referencias del espacio de trabajo al redactar este documento; pueden moverse con cambios posteriores. Los cambios previos de perfil/residencia se documentan por separado y se conservaron.

| Archivo | Punto del cambio | Función |
| --- | --- | --- |
| `src/lib/integrations/automation/turn-semantics.ts` | `propertyPreferenceChange`, línea 113 | Reconocer menor precio y reducción de dormitorios; normalizar acciones pendientes. |
| `src/lib/integrations/automation/property-context.ts` | Resolución de preferencias, línea 261; aceptación, línea 378; memoria de respuesta | Mantener requisitos, candidatos, selección y las transiciones de confirmación/categoría/planta/unidad. |
| `src/lib/integrations/automation/progressive-options.ts` | Archivo nuevo | Preparar alternativas verificadas y contrato de continuación; conservar acción e IDs tras una paráfrasis válida. |
| `src/lib/integrations/automation/price-reply.ts` | `focusedPriceDescription`, línea 205; `unitPriceQuote`, línea 237; `quotedGroupIssues`, línea 372 | Explicar filtros y pregunta; contrastar unidades y datos compartidos de las cotizaciones plurales. |
| `src/lib/integrations/automation/sdr.ts` | Línea 105; cierre y evidencia, líneas 184–205 | Atender el cambio solicitado y evitar que el cierre elimine la pregunta de la cotización. |
| `src/lib/integrations/automation/catalog-dialogue.ts` | Comparación, línea 363; detalles y búsqueda, líneas 388–439 | Comparación seguida de elección; categoría alternativa seguida de planta y unidad. |
| `src/lib/integrations/automation/turn-intent.ts` | `inheritedPrice`, línea 23 | La aceptación de detalles no vuelve a interpretarse como otra consulta de precio. |
| `src/lib/integrations/automation/tour-continuation.ts` | Archivo nuevo | Decidir una sola continuación posterior al recorrido según el presupuesto y la intención actual. |
| `src/lib/integrations/automation/property-selection.ts` | `selectedUnitReply`, línea 289 | Utilizar la continuación común al mostrar la unidad. |
| `src/lib/integrations/automation/unit-alternatives.ts` | `nextUnitQuestion`, línea 45 | Utilizar la misma continuación desde la ruta de alternativas. |
| `src/lib/integrations/automation/conversation.ts` | Líneas 1063, 1179 y 1273 | Unificar continuación, registrar evidencia y guardar la pregunta efectivamente conservada. |
| `src/lib/integrations/automation/turn-completeness.ts` | Líneas 192, 376 y 438 | Dar las mismas reglas al redactor/revisor y comprobar la pregunta sin exigir texto literal. |
| `src/components/inmobiliaria/automation/workflow/messageExplanation.ts` | Línea 319 | Explicación visible de criterios, siguiente paso y presupuesto. |
| `src/components/inmobiliaria/automation/workflow/reviewDecision.ts` | Líneas 12–13 | Motivos comprensibles de pregunta omitida o desviada. |
| `package.json` | `test:progressive-options` | Comando reproducible para las nuevas pruebas de preferencias y continuación. |

Pruebas: `scripts/property-context.test.cjs`, `scripts/turn-semantics.test.cjs`, `scripts/comparison-price.test.cjs`, `scripts/turn-completeness.test.cjs`, `scripts/integrations.test.cjs`, `src/lib/integrations/automation/progressive-options.test.ts`, `tour-continuation.test.ts`, `property-selection.test.ts`, `unit-tour-link.test.ts` y `src/components/inmobiliaria/automation/workflow/messageExplanation.test.ts`.

## Validación local

Los replays ejercitan el redactor y revisor simulados con los controles reales de ejecución: precio → aceptación sin selección → comparación → unidad → 360; menos dormitorios → categoría → planta → unidad; menor precio → confirmación de dormitorios → categoría → planta. También verifican presupuesto ausente, total conocido y monto ambiguo después del recorrido.

| Verificación | Resultado |
| --- | --- |
| `npm run test:integrations` | 233/233 aprobadas. |
| `npm run test:progressive-options` | 22/22 aprobadas. |
| `npm run test:message-trace` | 42/42 aprobadas. |
| `npm run test:lead-introduction` | 112/112 aprobadas; conserva el trabajo previo de perfil/residencia. |
| Pruebas de `property-selection.test.ts` y `unit-tour-link.test.ts` con `scripts/test-typescript.cjs` | 27/27 aprobadas. |
| `npm run test:conversation` | 280/282 aprobadas. Persisten dos fallos anteriores en `scripts/visit-date-context.test.cjs:232` y `:273`: sus fechas de prueba ya se interpretan como pasadas. No se modificó la lógica de agenda. |
| `npx tsc --noEmit` | Sin errores. |

No se ejecutó una prueba nueva contra un lead real ni se desplegaron estos cambios. La validación de WhatsApp debe hacerse después del despliegue, comprobando el texto final registrado en Envío a Kommo y los estados de entrega correspondientes.
