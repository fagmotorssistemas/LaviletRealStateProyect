# Estabilización del flujo y de la redacción

Fecha local: 16 de octubre de 2026. Revisión de partida: `230b817`. Este informe complementa la auditoría y las correcciones anteriores; no cambia sus resultados históricos.

**Estado:** las correcciones descritas están en el trabajo local. Se repararon y verificaron dos estados de conversación en producción, sin enviar mensajes. El cierre de validación de la batería histórica sigue abierto; este documento no certifica un despliegue ni que todos sus fallos sean obsoletos.

## Qué causaba las respuestas observadas

Había tres causas compartidas. Primero, un selector de contexto buscaba palabras y podía ocultar los datos de seguridad cuando el cliente decía «zona segura». Segundo, la interpretación confundía pedir información con pedir una pausa comercial y conservaba esa decisión entre mensajes. Tercero, algunos bloques particulares pedían reconocer datos faltantes, aunque la regla general buscaba una explicación breve y positiva.

El redactor recibía, por tanto, información incompleta o instrucciones incompatibles. Mantener una regla escrita en un documento no bastaba para que esa regla llegara al modelo con los hechos y el estado adecuados.

La solución conserva esta división: la IA interpreta y redacta; el código valida los datos estructurados, su procedencia, los cálculos y las operaciones. Comprobar que una cita tiene fecha y hora, que una cita literal pertenece al mensaje real o que una operación tiene un comprobante no es decidir el significado de la conversación por palabras.

## Las quince correcciones y su alcance

| Nº | Antes | Cambio aplicado | Resultado que se busca y evidencia |
| --- | --- | --- | --- |
| 1 | Una prohibición interna podía convertirse en un descargo al cliente. | Instrucción común de información útil y límites internos en todas las llamadas de redacción y en la copia operativa. | Explicar directamente los hechos pertinentes. Las carencias y los límites no se enumeran espontáneamente. Una pregunta explícita sobre algo inexistente sigue recibiendo una respuesta honesta y breve. |
| 2 | Los bloques de seguridad, verdad del proyecto y materiales podían volver a introducir las advertencias. | Se alinearon esos bloques y las descripciones del brochure y del 360. | Una respuesta de seguridad explica las medidas previstas del edificio. Un enlace al recorrido describe los espacios previstos sin añadir por rutina una negación sobre obra terminada. |
| 3 | `relevantFacts()` y la selección de políticas dependían de vocabulario. | Las solicitudes y los temas interpretados por la IA seleccionan bloques completos de hechos. Las políticas publicadas conservan su alcance y restricciones. | Sinónimos o faltas de ortografía no ocultan vigilancia, monitoreo o accesos. Se comprobó la proyección compartida por las dos rutas de contexto. |
| 4 | «Quiero información» podía guardar `information_only`. | Decisión explícita y separada `qualification_decision=pause/resume/unchanged`. | Pedir información mantiene la orientación normal. Una petición expresa de suspender preguntas comerciales sí conserva la pausa entre turnos. Negarse a crédito o a una visita no suspende toda la atención. |
| 5 | Campos incompatibles podían llegar al plan. | Validación de relaciones entre campos y reparación de IA acotada al bloque contradictorio. | Una pausa sin decisión explícita o un tema actual marcado como inexistente se repara antes de planificar. La reparación no puede sustituir permisos, perfil o decisiones inmobiliarias ya válidos. |
| 6 | La desconfianza provocaba disculpas por afirmaciones que el bot nunca hizo. | Instrucciones de interpretación contextual y de redacción basadas en el historial real. | Mantener una explicación anterior correcta y desarrollar hechos pertinentes; rectificar únicamente una afirmación realmente hecha y equivocada. La naturalidad se evalúa también con el modelo real. |
| 7 | Saludo, presentación y consulta general podían confundirse. | Se conserva el contrato de saludo de la versión de partida y se integra con la nueva interpretación de información. | Un saludo aislado ofrece ayuda abierta; una consulta general recibe la presentación autorizada. Una continuación no se convierte por rutina en otra bienvenida. |
| 8 | La pausa errónea podía eliminar la solicitud inicial de datos y la secuencia del brochure. | Se comprueba la secuencia completa: información, nombre/residencia pendientes y entrega autorizada. | Solicitar únicamente los datos faltantes. Conservar las excepciones de entrega del brochure; una petición explícita del material no se retiene para forzar datos. |
| 9 | Podía aparecer una pregunta genérica en lugar de información útil, o una captura repetida. | El tema actual se reconoce como solicitud; se conservan los objetivos y recibos estructurados de las preguntas realmente entregadas. | Primero responder. Retomar una pregunta cuando aporta continuidad; no exigir una pregunta al final de cada respuesta. Las pruebas de evaluación guardan la pregunta y el recorrido antes de evaluar el turno siguiente. |
| 10 | Una aclaración podía reactivar los cinco dormitorios históricos o perder el 605. | Se conservan las protecciones de selección/reserva ya incorporadas en `230b817` y se prueban con la nueva selección de contexto y el redactor real. | Reserva del 605 → aclaración → seguimiento mantiene unidad y alternativa aceptada. No se vuelve a pedir aceptar tres dormitorios ni se crea otra reserva por consultar su estado. |
| 11 | Permisos de trámites distintos podían mezclarse en simulaciones o continuaciones. | Se mantienen autoridades independientes para reserva, visita y financiamiento. Se restauró memoria de consultas financieras desde la interpretación actual y se conectaron consumidores que omitían ese contexto. | Un sí para información o detalles no acepta crédito ni reserva. Una consulta de precio con visita conserva ambas solicitudes y la unidad actual. |
| 12 | La interpretación de visita podía mezclar identificadores de fragmentos con identificadores de mensajes; la reparación no recibía el texto original. | Esquema de procedencia limitado a IDs reales, reglas claras para preferencias de lugar y reparación con sus mensajes originales. | Conservar hora y fecha aportadas en turnos diferentes. Completar el registro de solicitud cuando se reúnen los datos necesarios; describir el resultado real en positivo. La confirmación de agenda conserva su operación propia. |
| 13 | Dos conversaciones ya estaban atrapadas en una pausa inferida de una petición de información. | Reparación puntual con evidencia revisada, comprobación del evento y actualización condicionada a que el resumen completo no haya cambiado. | **Dos reparaciones aplicadas y verificadas**. Se preservaron los demás datos del resumen. No se reinició masivamente a los leads ni se enviaron mensajes. |
| 14 | La batería histórica mezclaba lectores de prosa retirados, simulaciones incompletas y posibles regresiones. | Se migraron comprobaciones concretas a entradas y recibos explícitos, se ejecutó el manifiesto completo y se conserva un inventario de cada fallo restante. | **Cierre parcial.** Las pruebas del contrato actual pasan; la reconciliación individual de toda la batería histórica no ha terminado. No se restauraron lectores de palabras para conseguir un resultado verde. |
| 15 | Las comprobaciones anteriores sustituían los proveedores por respuestas simuladas. | Evaluador reproducible con intérprete, plan, memoria y redactor reales; red limitada a OpenAI y operaciones comerciales sintéticas. | Secuencias completas y revisión de sus respuestas. Sus resultados y limitaciones se registran en el anexo de validación; no prueban entregas de WhatsApp ni agendas reales. |

## Cambios adicionales encontrados al comprobar el recorrido

- Se restauró la protección por **rol numérico interpretado**: personas del hogar y cantidades usadas para evaluar un espacio no se convierten en nuevos requisitos de dormitorios. El código compara campos estructurados; no busca palabras del cliente.
- Una referencia de comparación o seguimiento ya no se convierte en una referencia explícita nueva solo porque la IA haya incluido códigos de unidades como contexto.
- La aceptación de una alternativa tiene prioridad sobre la búsqueda genérica. Se reprodujo un recorrido que dejaba `bedrooms=3` junto con un requisito estructurado de cinco dormitorios. La prueba nueva falló antes del cambio. Ahora se elimina el requisito sustituido de la búsqueda activa, se conserva la necesidad original como historial y se comprueba la elección de penthouse en el turno siguiente.
- Esa prioridad cubre las preguntas de requisitos, categoría y confirmación de dormitorios. Una aceptación puede coexistir con una elección explícita de categoría en el mismo mensaje; ambas decisiones se conservan. Las pruebas distinguen esta elección de una categoría mencionada únicamente para consultar información.
- Si el perfil completo se entrega después de una presentación real, puede completar el intercambio del brochure aunque los metadatos de la pregunta anterior fueran inutilizables. Se comprueban las declaraciones actuales; no se inventa un recibo de pregunta ni se vuelven a pedir esos datos. La evaluación real detectó la demora y se volvió a comprobar la entrega en ese mismo turno.
- La aceptación de detalles de una opción usa el recibo pendiente y sus candidatos reales. No reconstruye esa aceptación leyendo el texto del bot ni elige la opción más barata entre varias.
- La cotización combinada con una visita recibe la interpretación actual y el contexto inmobiliario, además del contrato del turno.
- Se retiraron lectores de prosa de precio que permanecían como utilidades de diagnóstico sin uso productivo. Su retirada no debe describirse como la corrección de un veto productivo activo. La comprobación semántica de hechos corresponde a la IA revisora cuando está habilitada.
- Se conservaron los cálculos y las fuentes de precios: catálogo vigente, autorización para compartirlos, unidad, categoría, superficie, disponibilidad y diferencia calculada. Las pruebas de precios comprueban esas relaciones, sin presentar una función retirada que devuelve `[]` como prueba de exactitud del redactor.

Una búsqueda inicial señaló llamadas del controlador sin contexto; la comprobación de tipos mostró que varias eran cierres locales que ya lo utilizaban. Se descartó ese diagnóstico y se revirtieron los argumentos innecesarios. Solo se cuentan las conexiones que realmente faltaban.

## Ejemplos de comportamiento esperado

Los siguientes son ejemplos de intención y tono, no respuestas literales obligatorias.

**Información general:** «Saludos, quiero información» recibe una bienvenida cuando corresponde, una presentación breve del proyecto y el ofrecimiento del brochure vinculado a los datos iniciales pendientes. No activa por sí solo una pausa comercial ni obliga a preguntar «¿qué información quiere?».

**Seguridad:** «¿Es una zona segura?» puede recibir «El proyecto contempla vigilancia permanente y sistemas de monitoreo las 24 horas». Las medidas se atribuyen al edificio. No se añaden estadísticas inexistentes ni un párrafo sobre lo que no se garantiza. Si pregunta específicamente por un indicador del barrio, se responde sobre ese dato puntual con honestidad.

**Desconfianza:** si el cliente cuestiona esa explicación, el bot conserva el hecho anterior y desarrolla información pertinente del proyecto o aclara la preocupación concreta. No afirma que antes prometió una zona segura si nunca lo dijo.

**Pausa:** «Quiero conocer el proyecto, pero por ahora no quiero preguntas de compra» permite seguir conversando y respondiendo precios. Conserva la pausa de las capturas comerciales, sin anunciar repetidamente las preguntas que evitará. Una petición actual de retomar la búsqueda permite reanudarla.

**Cinco dormitorios:** «¿Qué precio tiene uno de cinco dormitorios?» requiere explicar brevemente que no se dispone de esa distribución y presentar las alternativas pertinentes. Aceptar revisar tres dormitorios conserva esa aceptación; escoger después penthouse no reinicia la pregunta sobre cinco frente a tres.

**Reserva:** «Todavía nadie me ha llamado» conserva la solicitud vigente del 605. Se explica su estado real y la atención que sigue, sin volver a preguntar dormitorios ni asegurar que hubo una llamada que no está registrada.

**Cita:** «A las tres de la tarde» guarda la hora; «o sea, el miércoles 21 de octubre» completa la fecha. Cuando el resultado operativo acredita el registro, se comunica la solicitud registrada y la revisión de agenda que sigue. No se sustituye el registro por repetir «debe revisarse antes de confirmar».

## Validación y límites

| Comprobación | Resultado |
| --- | --- |
| Contrato actual y regresiones seleccionadas del controlador | **364 / 364**, sin fallos ni omisiones. |
| Batería histórica completa | **2.695 pruebas: 2.263 aprobadas y 432 fallidas**. No está aprobada. |
| Conjunto adicional de precios, metadatos, ubicación, idioma y continuidad | **90 / 90**. Se solapa con las otras baterías; no se suman sus cifras como pruebas únicas. |
| TypeScript global | Aprobado. |
| ESLint en archivos de código y pruebas intervenidos | **56 archivos**, sin errores ni advertencias. |
| Compilación de producción | Aprobada, salida 0. Durante el prerender se registró `test_contacts_action_failed / UNKNOWN`, también observado en el informe anterior; esta compilación no certifica esa pantalla autenticada. |
| Secuencias aceptadas con el modelo real | **Cinco casos, veinte turnos**, con `gpt-6-luna` y operaciones comerciales sintéticas. Se conservan también los intentos fallidos. |
| Reparación de datos | **Dos conversaciones**, aplicadas y verificadas; el resto del resumen coincide con el plan revisado. |

Las cinco secuencias cubren apertura → datos → brochure → ubicación → seguridad → desconfianza; pausa → consulta de precios → retoma; precio del 605 → solicitud de reserva → aclaración; hora → día → registro de solicitud de visita; y cinco dormitorios → aceptación de tres → penthouse → comparación → elección del 605.

La evaluación detectó dos causas nuevas antes de aceptar esos recorridos: la prioridad incorrecta de la búsqueda genérica y la demora del brochure tras metadatos inutilizables. También se corrigieron omisiones del propio evaluador —guardado del recibo de pregunta, consulta resuelta y recorrido comercial— para no atribuir al producto fallos introducidos por la simulación.

El [anexo de validación](./validacion-estabilizacion-2026-10-16.json) contiene las cifras finales de esta intervención, los comandos y el alcance. El [inventario de fallos históricos](./fallos-historicos-estabilizacion-2026-10-16.json) conserva cada prueba pendiente y su archivo. No se eliminan del manifiesto general para ocultar sus resultados.

Entre los contratos antiguos encontrados hay pruebas que aún piden identificar una pregunta leyendo la prosa, inferir una visita desde una extracción vacía o corregir por palabras una clasificación de IA equivocada. Se migraron comprobaciones concretas a metadatos explícitos, conservando sus decisiones y fuentes. Esto **no demuestra que los 432 fallos restantes sean exclusivamente obsolescencia**. Su inventario mantiene el estado abierto hasta reconciliar cada caso; ese cierre y la validación de los posibles problemas funcionales pendientes siguen formando parte del trabajo restante.

Las pruebas específicas ejercitan también el controlador real con CRM y base de datos simulados; las pruebas SQL utilizan PGlite. El evaluador con modelos usa datos ficticios y comprobantes sintéticos de operaciones. No ejecuta `processConversation` contra leads reales, no agenda una visita productiva y no acredita recepción o lectura de avisos.

Se observaron tiempos de espera agotados del proveedor en intentos de evaluación. Un intento fallido se conserva como tal; una ejecución posterior no borra ese antecedente. Los controles automáticos de los ejemplos son comprobaciones de evaluación, no nuevos filtros productivos sobre la prosa.

La mejora esperada es que el redactor reciba hechos completos, una intención coherente y la memoria correcta. Esto favorece respuestas más útiles y naturales. No permite garantizar que cualquier conversación futura carecerá de errores.

## Estado de producción

La consulta de esta intervención comprobó que la IA revisora sigue **desactivada**, también sin modo de observación. Las tres estructuras consultadas —ficha comercial, historial de etapas e intake de visitas— respondieron por la API. Es una observación actual; no identifica quién aplicó una migración ni certifica todas las funciones SQL.

El código local no se ha desplegado ni subido en esta intervención. Las dos reparaciones de estado sí se aplicaron y se verificaron mediante relectura del resumen completo. No se ejecutaron trabajadores de mantenimiento ni envíos a leads.

No se creó una migración SQL nueva para estos cambios. La lógica de visitas de la revisión de partida utiliza la existente [20261017000000_typed_visit_preferences.sql](../../supabase/migrations/20261017000000_typed_visit_preferences.sql). No se afirma aquí que esté pendiente ni se reaplica: su estado efectivo debe contrastarse con el registro del entorno donde se despliegue.

La puesta en marcha completa sigue condicionada al cierre de validación descrito. El informe anterior y sus resultados no se sustituyen por una afirmación de que toda la automatización quedó aprobada.
