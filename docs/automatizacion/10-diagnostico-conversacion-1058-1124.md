# Diagnóstico de conversación: 22 de septiembre, 10:58–11:24

Estado: **análisis y reproducciones locales; sin correcciones de comportamiento**.
Código examinado: `c1149bb`. No se verificaron el SHA desplegado, los prompts activos en la base remota ni los registros de estas ejecuciones productivas. Se distinguen defectos reproducibles de la atribución a un turno real.

El usuario pidió explicar las respuestas deficientes y guardar la propuesta de bitácora para más adelante. Esa propuesta está en [09-propuesta-bitacora-explicable.md](./09-propuesta-bitacora-explicable.md).

## Conversación reportada

- «Quiero información»: presenta proyecto y pregunta por viviendas, suites o locales; suites queda presentada como alternativa separada de viviendas.
- «Me interesan las viviendas»: menciona suites de un dormitorio y departamentos/penthouses de dos o tres.
- «No tiene opciones de 5 cuartos?»: niega disponibilidad y ofrece informar sobre tres dormitorios.
- Primer «si esta bien»: vuelve a explicar la ausencia de cinco y vuelve a ofrecer información.
- Segundo «si esta bien»: informa máximos de departamentos y penthouses y vuelve a preguntar categoría.
- Prefiere departamentos porque considera caros los penthouses: enumera 202, 302, 304, 402, 404, 502 y 504 sin explicar diferencias.
- «Y cual es la diferencia entre cada uno?»: entrega siete fichas concatenadas por punto y coma, mezclando dos y tres dormitorios, y añade una derivación al asesor.

Los datos de las unidades se toman aquí del chat y de fixtures locales. No constituyen una comprobación de inventario o disponibilidad actual.

## Hallazgos confirmados en código

### 1. Elegir categoría puede borrar restricciones ya aceptadas

En `property-context.ts`, `resolvePropertyTurn` calcula `categoryChanged` y usa `emptyPropertyFilters()` cuando cambia la categoría. Pasar de grupo residencial con categoría nula a departamento cuenta como cambio y borra dormitorios, planta y superficies previas si no se repiten en el mensaje actual.

Reproducción aislada: memoria de búsqueda residencial con `bedrooms=3`, mensaje que elige departamentos y semántica con categoría departamento sin repetir dormitorios. El resultado tiene `bedrooms=null` y permite departamentos de dos y tres dormitorios. No requiere que el modelo interprete mal la preferencia actual.

Esto debe distinguir un refinamiento dentro de viviendas de un cambio real de búsqueda. Cambiar el prompt de redacción no modifica esa transición de memoria.

### 2. Falta una transición explícita para aceptar alternativas

En `catalog-dialogue.ts`, una búsqueda sin resultados para cinco dormitorios calcula alternativas con menos dormitorios, pero mantiene la consulta original de cinco en la auditoría. La pregunta se guarda como `property_category / choose_category` con candidatas; no almacena una propuesta de nuevos filtros que pueda aceptarse de manera determinística.

En `property-context.ts`, la aceptación explícita de una pregunta pendiente tiene tratamiento especial para `unit_choice`; no existe un equivalente completo para aceptar el conjunto alternativo de tres dormitorios.

Reproducción aislada: búsqueda de cinco → oferta de tres → afirmativo correctamente asociado a `property_category`, operación `search`. Se reutiliza cinco y vuelve a salir la oferta anterior. Con operación `none` puede avanzar por la ruta histórica de alternativas. La salida depende demasiado de cómo el modelo clasifique ese afirmativo.

La conversación reportada es compatible con este defecto. Para identificar la ruta exacta de cada «sí» deben revisarse su operación extraída, pregunta pendiente y consulta efectiva.

### 3. La comparación extensa tiene una plantilla concreta

En `catalog-dialogue.ts`, la operación `compare` con superficies distintas construye cada ficha con `details(unit)` y las concatena mediante `join('; ')`. Esa estructura reproduce la lista extensa del chat. Cuando la operación es `select` y quedan varias unidades, la rama enumera sus números y pregunta cuál desea conocer.

`commercialReply` en `sdr.ts` devuelve la respuesta del catálogo antes de cargar `respuesta_comercial` y `revisor_respuesta`. Por tanto, editar esos prompts no controla directamente esa plantilla. Las respuestas de catálogo sí pueden pasar después por `completeTurnReply`, con instrucciones propias de cobertura y la configuración de tono; no es correcto afirmar que nunca interviene otra llamada de IA.

La revisión de cobertura pide conservar contenido correcto y todas las cifras/enlaces de la base. La regla para catálogo exige preservar resultados, categorías y medidas y añadir respuestas a otras solicitudes. Los validadores y respuestas de respaldo pueden restituir la base si se rechaza la reformulación. Esto favorece conservar el listado técnico en lugar de organizar diferencias para un comprador.

La comparación útil debe calcular hechos y agrupaciones, y después explicar diferencias relevantes. Proteger hechos no obliga a repetir una ficha entera por cada unidad ni a fijar toda la prosa como contenido obligatorio.

La reproducción con siete departamentos produjo una base de 674 caracteres. Una versión agrupada por dos/tres dormitorios, con los mismos datos e identificadores, pasó los validadores locales en 341 caracteres: los controles no prohíben toda síntesis, pero las instrucciones actuales no la exigen. La rama de superficies interiores iguales solo describe las superficies y puede omitir diferencias de planta aunque la consulta pida diferencias. Un delta calculado de 11,14 m² fue rechazado por no estar incluido entre los hechos/cifras autorizados; si se quieren explicar diferencias calculadas deben producirse y verificarse como tales antes de redactar.

Una segunda reproducción mostró una brecha del validador: al intercambiar atributos entre grupos escritos como «Los departamentos 202, 302, 402 y 502...» y «Los departamentos 304, 404 y 504...», los controles aceptaron una asignación falsa. El reconocimiento de unidades de `validateCatalogReply` maneja referencias singulares, pero no conserva correctamente el vínculo de todos los números de una lista plural con sus atributos. No basta con liberar la redacción: la agrupación debe calcularse como resultado estructurado y su validación debe cubrir referencias colectivas. Este fallo es local reproducible; no se afirma que haya ocurrido en el chat reportado.

### 4. Una clasificación de dato faltante puede activar un asesor innecesariamente

La frase «He pasado su consulta a un asesor de nuestro equipo para que le ayude con ese detalle» está en `transferToAdvisor`, dentro de `conversation.ts`. En esa ruta se intenta la operación `handoff_lead`; no es únicamente una frase sugerida por el prompt comercial. La ejecución real debe comprobarse en sus registros.

La comparación de catálogo deja `coverage_complete=false`, por lo que pasa por la revisión de cobertura. `completeTurnReply` puede devolver `needsAdvisor=true` a partir de una solicitud marcada `missing_fact`. También conserva solicitudes pendientes al rechazar un borrador: `unanswered` de tipo `specific_fact` puede acabar convertido en necesidad de asesor.

Reproducción local con respuestas de revisión simuladas: comparación completa de siete departamentos → revisor marca la misma pregunta como dato faltante → `needsAdvisor=true`. Otra reproducción conserva la comparación correcta tras rechazar una reescritura de cifras, pero mantiene la necesidad de asesor de la propuesta rechazada. La rama de `conversation.ts` puede entonces derivar aunque haya datos suficientes para la comparación.

Esto demuestra un mecanismo posible. Sin la auditoría del turno de las 11:24 no se afirma qué bandera concreta lo activó en producción.

Hay otra limitación de diagnóstico: el segundo revisor puede añadir `missing_fact_fragments` que activan la derivación, pero esos fragmentos no quedan incluidos en `turn_completeness.audit`. Es posible ver estado `checked` y solicitudes `answered` y aun así tener una derivación. El motivo registrado en el paso `advisor_handoff` permite investigar esa diferencia.

## Por qué las pruebas anteriores no bastaron

La reproducción `dialogue v2 replays the reported housing conversation...`, en `scripts/integrations.test.cjs`, proporciona salidas simuladas del extractor y usa `checkedBaseCoverage` para la revisión. En los pasos «sí» y elección de departamentos comprueba principalmente que no se pida el número de unidad; no exige que se avance sin repetir ni que se conserve la alternativa de tres dormitorios.

Las pruebas son útiles para contratos, filtros y operaciones, pero sus expectativas no cubrían todas las cualidades relevantes de esa conversación. Pasar compilación y cientos de pruebas no demuestra por sí solo naturalidad ni acierto del modelo con los prompts activos.

## Cómo localizar el responsable con los registros actuales

| Primera discrepancia | Evidencia a revisar | Responsable probable |
| --- | --- | --- |
| Interpreta mal la petición | `semantic_extraction`: intención, operación, filtros, referencia | Contexto entregado, prompt del extractor y normalización |
| Entiende la petición, pero pierde dormitorios/planta | Comparar filtros extraídos y `catalog_resolution.query` con memoria previa | Transición en `property-context.ts` |
| Los resultados son correctos, pero la respuesta es una lista poco útil | `dialogue_decision.source`, especialmente `catalog_compare` o `catalog_select` | Plantilla de `catalog-dialogue.ts` y revisión posterior |
| Se recupera una respuesta anterior tras reescritura | Auditoría `turn_completeness.status`, `issues`, `catalog_guard` | Reglas de cobertura y validación, no necesariamente el prompt comercial |
| Se deriva sin petición del cliente | `advisor_handoff`; auditoría `requested_advisor`, `requires_advisor`, `handoff_reason`, `additional_questions_handoff`, solicitudes y estados de cobertura | Intención explícita frente a valoración de dato faltante |

No todos esos campos completos se muestran en el flujo visual actual. Parte de la auditoría se registra en `messages.tool_calls` al guardar la respuesta; la vista de pasos contiene un resumen. No se debe prometer que hoy el administrador puede corregir cualquier causa únicamente desde el guion del panel.

## Orden propuesto para una corrección futura

1. Conservar restricciones compatibles al refinar categoría y representar explícitamente la alternativa ofrecida y su aceptación. Separar el requisito original de cinco dormitorios del conjunto de alternativas de tres que acepta explorar; aceptar explorar no debe sustituir silenciosamente su requisito original ni seleccionar una unidad.
2. Separar el resultado verificado del catálogo de su presentación: calcular grupos/diferencias, validar los atributos de cada grupo, reducir repetición y limitar preguntas innecesarias.
3. Requerir un dato concreto realmente ausente antes de derivar; un fallo de redacción o un borrador rechazado no acredita falta de información.
4. Validar la conversación completa con expectativas de contenido, avance, continuidad y ausencia de acciones indebidas. Evaluar por separado el modelo con los prompts activos y contextos controlados, sin envíos reales.
5. Retomar la bitácora explicable para mostrar la primera discrepancia y la configuración responsable.

No se propone añadir una excepción por frase ni cambiar el modelo como sustituto de estas correcciones. La entrada común de interpretación existe, pero las políticas de transición y respuesta todavía tienen responsabilidades repartidas que pueden contradecirse.
