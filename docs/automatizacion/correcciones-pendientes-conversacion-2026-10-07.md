# Correcciones pendientes de conversación y financiamiento

Las conversaciones del 7 de octubre de 2026 muestran pérdidas de continuidad entre la interpretación, la pregunta enviada y la memoria. Las prioridades son conservar la unidad de interés, clasificar correctamente el dinero para la entrada y hacer que todas las capas compartan la misma decisión pendiente. Reforzar el prompt por sí solo no corrige los estados contradictorios.

Estado actualizado el 8 de octubre de 2026: correcciones implementadas y verificadas localmente. El análisis original que sigue conserva los fallos y las propuestas de referencia; sus apartados de pendientes describen la situación anterior a esta implementación. Los modelos no cambiaron; no se hicieron escrituras remotas, despliegue, commit ni push.

## Implementación del 8 de octubre

| Área | Resultado implementado |
| --- | --- |
| Familia, camas y oficina | Una consulta de capacidad no activa la respuesta financiera por palabras aisladas. La superficie total no confirma dos camas: faltan medidas del dormitorio y de las camas. Puede ofrecerse orientación opcional en la oficina habilitada, sin prometer planos, cotas ni una visita a unidades construidas. |
| Unidad y siguiente paso | PH602 se conserva ante solicitudes de detalles, confirmaciones y propuestas del bot. Una etiqueta de confirmación sin una pregunta real no selecciona una unidad. Se conserva el referente del catálogo aunque la proyección sea reducida. |
| Entrada y presupuesto | Los bloques monetarios comparten significado; una entrada explícita queda como capital inicial. La continuación del tour usa la misma memoria, sin otra interpretación del historial. Retirar o reasignar un importe requiere una corrección semántica actual; no se deduce por cantidades iguales. Se eliminan las copias obsoletas y se evita restaurarlas desde CRM. |
| Financiamiento | La aceptación de información no autoriza revisión ni recopilación de datos. El consentimiento válido previo se conserva y permite retomar entidad y campos pendientes después de elegir la unidad, sin reabrir entrada o selección. |
| Perfil y brochure | Una misma frase ambigua no puede confirmar simultáneamente origen y residencia. Se repara la interpretación por bloques; las declaraciones compuestas con residencia explícita siguen siendo válidas. Se mantienen captura, recordatorio limitado y condiciones del brochure. |
| Extractor y revisor | Una reparación focal conserva los datos válidos y distingue citas actuales e históricas. El revisor mantiene su presupuesto independiente para metadatos. La pregunta realmente enviada se puede recuperar localmente cuando su acción es reconocible; no se copia el propósito de un plan a una pregunta ambigua. |
| Redacción | Las rutas finales comparten uso ocasional del nombre, brevedad y continuidad. Las confirmaciones no requieren repetir ficha, importes y rangos. Una sola condición colectiva de precios por respuesta sigue siendo obligatoria si se citan precios. |
| Presentación | Nuevo ajuste en Conocimiento y reglas → Información del proyecto → Presentación inicial: activación, resumen aprobado y fuente. Solo se selecciona para consulta general compatible; no sustituye preguntas específicas, múltiples, perfil ni decisión pendiente. No se deduce estado de obra al abrir la conversación. |
| Interfaz | Ayudas ! por sección y ajuste auditadas para escritorio/móvil. Eventos paralelos comparten el contrato del extractor: aceptados en verde, candidatos sin validar en ámbar. Los errores explican causa, campo, procedencia y reintento cuando la traza los conserva, sin inventar necesidad de asesor. |
| 360 | El enlace general y el brochure previos no suprimen el enlace específico de una unidad ni su reenvío explícito. Penthouse, suite, departamento y local conservan su categoría al describir el recorrido. |

La presentación se guarda en el JSON de políticas existente, con permisos de administrador y control de concurrencia; no requiere una migración nueva. El formulario mantiene el texto al desactivar el uso por el bot. Guardar aplica a próximos turnos y no reescribe conversaciones anteriores.

El modo demostración conserva interpretación, catálogo, memoria y permisos. La excepción permanece limitada a la revisión del borrador de contactos de prueba: no convierte una extracción inválida en autorización para actuar.

## Razonamiento contextual del 8 de octubre

El redactor puede relacionar familia, muebles, movilidad y mascotas con características verificadas sin limitarse a repetir una ficha. La instrucción compartida vive en `needs-guidance.ts` y se incorpora tanto a `FINAL_WRITER_RULES` como a la ruta reducida de recopilación financiera. La guía completa se entrega una sola vez en `razonamiento_contextual.guidance`, junto a las fuentes y límites del turno; el prompt fijo ordena cumplirla. Esto conserva la instrucción de recopilación por debajo de 5.000 caracteres sin eliminar reglas. Los modelos se mantienen.

- El extractor separa una situación personal y una consulta de evaluación de un requisito explícito. No convierte edad en movilidad reducida, hijos en dormitorios, mascotas en permisos ni una duda de distribución en cita o consentimiento. Una preferencia explícita posterior sí sigue sus reglas habituales.
- Las proyecciones de contexto conservan instalaciones y sus restricciones ante detalles, comparaciones, evaluaciones, preferencias cualitativas o consultas iniciales del proyecto interpretadas con confianza alta. Se mantienen las restricciones de acceso; saludos y recopilación financiera pura no amplían ese bloque. No modifican filtros, datos confirmados ni la unidad de interés.
- `contextual-reasoning.ts` entrega fuentes espaciales del turno y comprueba suma, resta, multiplicación y división: operandos, unidades, procedencia y resultado. Los datos espaciales solo se incluyen para la consulta pertinente; una recopilación financiera no necesita repetir todas las medidas del catálogo.
- Se distinguen datos de la ficha, medidas declaradas por el cliente, supuestos explícitamente ilustrativos y resultados derivados. Un resultado de cálculo no modifica las áreas oficiales ni se guarda en el perfil. Una hipótesis necesita estar expresada en el mensaje al cliente; no basta una etiqueta interna del revisor.
- Tener la superficie total, o incluso los m² de una habitación, no acredita largo, ancho, distribución ni espacio de circulación. Sin medidas suficientes se explica qué falta y puede ofrecerse orientación opcional en la oficina habilitada. No se promete disponibilidad de planos, medidas, una cita ni acceso a viviendas terminadas.
- Las dudas actuales se atienden antes de retomar el paso comercial pendiente. PH602, la entrada de $200.000 y los consentimientos previos se conservan; la consulta no reabre tipo, dormitorios, unidad, presupuesto o entidad ya resueltos.

Para ajustar hechos del proyecto, se usan las fuentes de conocimiento y las políticas existentes. La regla de razonamiento es comportamiento común del sistema, no un dato comercial a añadir en la presentación inicial. Los ejemplos de objetos no son nuevas medidas del proyecto.

`npm run test:contextual-reasoning` agrupa los casos nuevos; también quedan incluidos en `npm run test:conversation-regression`. Las pruebas son locales con respuestas de IA simuladas: validan contratos, comprobaciones y continuidad, no certifican todas las futuras respuestas del modelo ni la entrega en WhatsApp.

## Pertinencia y recuperación del presupuesto del 8 de octubre

Implementadas las correcciones autorizadas tras las capturas de presentación, vivienda, tres dormitorios, penthouses y respuesta de presupuesto de 300 mil dólares. Las reglas no dependen de una lista de frases del lead ni de retirar palabras del texto después de generarlo.

- Cada solicitud del extractor lleva topics estructurados y evidencia actual. Un tema disponible en el historial no se convierte en una nueva petición. Los registros anteriores sin topics conservan compatibilidad limitada y comprobada.
- response-content-scope.ts construye un contrato común para redactor y revisor: presentación, ubicación general/exacta, precios de compra, etapa comercial, construcción, entrega y advertencias de cabida. allowed permite atender un aspecto pertinente; no obliga a recitarlo ni demuestra su veracidad. Se mantienen las restricciones físicas y las condiciones comerciales como comprobaciones internas.
- projectContentForWriter selecciona fuentes del redactor sin modificar la evidencia original de revisión ni limpiar cadenas del mensaje saliente. Retira importes de precios y datos de ubicación ajenos a la consulta; conserva medidas, presupuesto, entrada, ingresos, préstamo, porcentajes de políticas y resultados operativos necesarios. Preserva completos los contratos compartidos.
- La presentación predeterminada aprobada de La Vilet incluye las 49 viviendas y las categorías indicadas por el administrador. Saludo y captura de nombre/residencia son decisiones separadas. No agrega etapa, obra, fechas, precios ni fichas por costumbre. Una configuración personalizada guardada prevalece; también se respetan desactivaciones y configuraciones inválidas. Otros proyectos no reciben este resumen.
- El ajuste es visible en Conocimiento y reglas → Información del proyecto → Presentación inicial del proyecto, con enlace directo a /inmobiliaria/automatizacion/proyecto#project-introduction. Usar resumen aprobado de La Vilet prepara el formulario; Guardar cambios aplica la edición con los permisos y el control de concurrencia existentes. El resumen predeterminado no requiere una escritura remota ni migración nueva.
- Una consulta de precios realmente pendiente puede continuar cuando el cliente aclara categoría, unidad o planta. Después de aceptación del envío, validación y cobertura vinculada a la consulta, price_request_status queda answered y se consume su objetivo de continuación. Una aclaración, recuperación o revisión rechazada no certifica que el precio se atendió; la cobertura de otra pregunta tampoco. Las preguntas secundarias de precio no sustituyen una intención principal independiente.
- Precios de compra solo cuando se solicitan actualmente, continúan una consulta sin atender o resultan indispensables para comparar el presupuesto total actual. Una elección posterior de categoría o dormitorios no hereda una autorización ya consumida. Cuando corresponden, sus condiciones son referenciales vigentes y posibilidad de cambio según la política; no se exige narrar lanzamiento.
- La ubicación no vuelve a presentarse en cada respuesta. Su detalle y mapa respetan la petición actual, las negativas y una confirmación presencial comprobada. Etapa, avance de obra y entrega se comunican ante su consulta; las excepciones de visita o representación digital explican solamente el límite pertinente.
- Una selección de tres dormitorios o tipo no exige una advertencia genérica sobre comodidad familiar. Las dudas reales de cabida/accesibilidad conservan el razonamiento condicionado y la orientación opcional, sin prometer medidas, planos, selección ni una acción autorizada.
- La reparación del extractor deja intacto el bloque monetario válido si solo falló propiedad. Si después del reintento persiste exclusivamente una cita histórica de propiedad, puede aislarse ese delta inválido con una certificación actual de contexto, presupuesto independiente alto e idéntico, pregunta de presupuesto conocida y ausencia de otra petición inmobiliaria, preferencias, filtros o permisos. Se conserva la memoria canónica del inmueble. Cualquier incertidumbre o error adicional mantiene los controles normales. El diagnóstico registra budget-property-isolation-v1.
- Normal, demostración y revisión desactivada comparten reglas y selección de fuentes, incluida la recopilación financiera compacta. Demostración sigue registrando hallazgos sin bloquear el borrador; no omite el extractor ni concede permisos.

Las nuevas pruebas de temas, alcance, integración, recuperación y continuidad de precios están en npm run test:response-content y en npm run test:conversation-regression. Son pruebas offline con respuestas simuladas, sin consumo de créditos de modelos o embeddings. No certifican todas las futuras salidas de la IA ni la entrega en WhatsApp.

## Verificación de pertinencia y recuperación

| Comprobación | Resultado |
| --- | --- |
| Barrido TypeScript (150 archivos) | 1.672 aprobadas, 0 fallidas, 0 omitidas; aproximadamente 37 segundos. |
| npm run test:conversation-regression | 672 aprobadas, 0 fallidas; aproximadamente 19 segundos con otras suites en paralelo. |
| Conversación legacy y contexto financiero | 405 aprobadas, 0 fallidas. Se conserva la exclusión documentada del archivo que requiere @electric-sql/pglite ausente. |
| npm run test:project-introduction | 20 aprobadas, incluidas configuración, permisos, concurrencia y contexto real de prompts. |
| Interfaz aislada Playwright | 2 comprobaciones aprobadas: escritorio 1366 px y móvil 390 px; edición, guardado, desactivación y estado predeterminado sin desborde ni errores de página. |
| TypeScript global y ESLint de archivos cambiados | Aprobados, sin errores ni advertencias. |

Las suites se solapan; no se suman como casos únicos. No se consultaron modelos, embeddings, bases remotas ni servicios de mensajería durante estas pruebas. Falta publicar el código y observar la siguiente conversación real.

## Límites y comprobaciones pendientes en operación

- Publicar estos cambios. La Vilet utiliza el resumen aprobado predeterminado si no hay configuración propia; puede editarse desde la interfaz. No se escribió una política en producción.
- Las medidas de dormitorios y camas siguen sin estar disponibles en este caso; la visita ofrecida es orientación en la oficina, no acceso confirmado a planos ni a obra terminada.
- Las pruebas de continuidad usan respuestas simuladas y salidas observadas donde están disponibles. La selección relativa de la más grande es una reproducción representativa; la aceptación de 03:48 usa sus campos semánticos conocidos. No sustituyen una comprobación posterior de ejecución real, entrega de WhatsApp o calidad del modelo.
- Si el extractor confunde una aclaración con información general y faltan metadatos de conversación previa, el selector de presentación no puede reconstruir el significado por su cuenta. Las referencias estructuradas, el brochure ya compartido y preguntas pendientes concretas excluyen el resumen; no se añadieron listas de frases para adivinarlo.
- Las trazas antiguas no contienen necesariamente campo, número de llamadas o resultado de reparación. La interfaz informa esa ausencia; los nuevos fallos conservan los datos seguros del error de interpretación.
- Una prueba anterior de fechas de visita no pudo ejecutarse porque falta la dependencia local @electric-sql/pglite. Se reprodujo la misma ausencia en HEAD; las otras pruebas de conversación y las nuevas focales sí se ejecutaron.

## Verificación local del cambio anterior

| Comprobación | Resultado |
| --- | --- |
| Barrido TypeScript de automatización, configuración y diagnóstico (144 archivos) | 1.573 aprobadas, 0 fallidas, 0 omitidas. |
| npm run test:conversation-regression | 578 aprobadas, 0 fallidas. Aproximadamente 14 segundos. |
| Conversación legacy, sin el archivo con dependencia ausente, más contexto financiero | 405 aprobadas, 0 fallidas. |
| npm run test:project-introduction | 16 aprobadas, 0 fallidas: selección, prompts reales normal/demo, validación y guardado con mocks. |
| TypeScript global | tsc --noEmit aprobado. |
| ESLint de archivos cambiados | Aprobado, sin advertencias. |
| Interfaz | Presentación y ayudas en escritorio 1366 px y móvil 390 px; conservación de texto y versión compartida. Mapa con dos eventos simultáneos aceptados y un candidato tras interpretación fallida comprobado en vista aislada. |

Las suites comparten pruebas; sus cantidades no se suman como casos únicos. Todas las verificaciones de este cambio fueron locales y no consumieron créditos de la API. No se contactaron bancos, Kommo, Supabase ni WhatsApp.


## Fallos comprobados en la conversación

| Caso | Qué ocurrió | Corrección necesaria |
| --- | --- | --- |
| Soy Carlos y soy de Cuenca | La extracción afirmó residencia y origen con la misma frase. El perfil quedó confirmado y se entregó el brochure sin aclarar residencia actual. | Comprobar el significado y la coherencia de los campos. Mantener Cuenca como lugar pendiente de confirmación cuando solo expresa origen. |
| Cinco hijos y dos camas en un cuarto | Se interpretaron los hijos como personas, pero una regla de financiamiento coincidió con las palabras solo y dos y generó una respuesta base financiera ajena a la consulta. | Exigir intención o contexto financiero compatible antes de activar respuestas de entidades. Conservar la consulta sobre distribución y la alternativa de tres dormitorios. |
| Esos 200 mil como entrada inicial | El redactor reconoció la entrada en su texto, pero la interpretación guardó amount, sin clasificar el dinero como initial_capital y sin financing_amounts. | Validar el papel del monto y conservarlo como entrada prevista, separado del presupuesto total y del préstamo. |
| La más grande quiero explorar | El catálogo identificó correctamente la 602 y se compartió su enlace 360 específico. La continuación volvió a pedir el significado de los 200 mil y el redactor abrió detalles u otras opciones. | Conservar la 602 como unidad de interés y retomar el financiamiento pendiente, sin cambiar de opciones por iniciativa del bot. |
| Sí, deme más información | Se atendió la 602, pero el plan contenía dos decisiones: confirmar esa unidad y aclarar entrada frente a presupuesto total. La pregunta enviada sobre continuar con la unidad no quedó como pregunta utilizable en memoria. | Unificar la decisión y comprobar la correspondencia entre el texto enviado, su clasificación y sus unidades de destino. Pedir detalles no elimina la unidad conocida. |
| Sí sí me parece bien | El extractor no vinculó el sí con la pregunta enviada sobre la 602. Conservó penthouse como supuesto dato del mensaje actual y operation none terminó convertido en una búsqueda general. La nueva búsqueda incluyó penthouses de dos y tres dormitorios y dejó la selección vacía. | No convertir una aceptación sin solicitud de cambio en una búsqueda de catálogo. Conservar selección y requisitos hasta un cambio explícito del cliente. La reproducción local confirma que la normalización none a search y la resolución category_change dejan la selección vacía. |
| Pero si ya le dije que la 602 | Se recuperó la selección explícita, pero el siguiente paso volvió a aclarar el monto de entrada. | La unidad y la entrada deben ser hechos compartidos y persistentes, no solo palabras reconocidas en una respuesta. |
| Pero esto también ya le dije que los 200 mil son de entrada | El extractor reutilizó la solicitud anterior deme más información e inventó una cita que mezclaba el mensaje actual con la selección anterior de la 602. El segundo intento eliminó la solicitud antigua, pero conservó la cita inválida de la unidad. | Reparar únicamente los datos actuales inválidos y conservar el contexto histórico en memoria, sin presentarlo como una nueva declaración. |

El último caso terminó con TURN_INTERPRETATION_INVALID. Las dos llamadas del extractor devolvieron resultados completos; la reparación siguió afirmando una selección con una cita que no pertenecía al mensaje actual. El error ocurrió antes del redactor. No demuestra falta de saldo, un fallo de WhatsApp ni que la pregunta necesitara un asesor.

## Estado compartido y siguiente pregunta

Mantener una fuente común para los hechos confirmados, el referente actual y la siguiente decisión. Revisar también el contrato de persistencia y sus pruebas: una presentación alternativa del bot puede borrar selected_ids aunque el cliente no haya cambiado su elección; ese comportamiento aparece incluso como expectativa en una prueba existente. Cada hecho debe conservar su procedencia, significado y estado. El historial resuelve referencias; no aporta declaraciones nuevas al mensaje actual.

- Necesidad original: cinco dormitorios. Alternativa aceptada: explorar tres. No volver a preguntar cuántos necesita después de esa aceptación, ni convertir cinco hijos en cinco dormitorios o en el total de habitantes.
- Tipo preferido: penthouse. No volver a ofrecer departamentos como si no hubiera elegido, salvo que solicite comparar o cambiar.
- Unidad de interés: 602. Pedir detalles, consultar financiamiento o responder gracias no borra esa unidad. Interés en la unidad no equivale a reserva ni compra.
- Entrada prevista: USD 200.000. No convertirla en presupuesto total, monto de préstamo ni fondos verificados. Una nueva aclaración explícita debe corregir la clasificación anterior.
- Permiso para recibir información financiera y permiso para iniciar una revisión financiera son distintos. Conservar el alcance realmente aceptado.
- La pregunta guardada debe corresponder al texto que se envió, incluir el referente y permitir resolver el siguiente sí. Si la clasificación es inválida, reparar esa clasificación sin sustituir silenciosamente la pregunta por otra.

La respuesta a una consulta adicional atiende primero esa consulta y retoma después la decisión pendiente, si corresponde. Los datos ya aportados se saltan. Una pregunta de presupuesto no debe competir con otra de confirmación de unidad dentro del mismo plan.

## Secuencia comercial que debe conservarse

1. Si pide cinco dormitorios, explicar que no existen y ofrecer alternativas de tres en departamentos y penthouses que podrían adaptarse por su amplitud, sin garantizar que cubran sus necesidades. Preguntar si desea revisarlas.
2. Si acepta, presentar ambos tipos compatibles brevemente y preguntar cuál prefiere. Un sí a revisar tres todavía no elige departamento o penthouse.
3. Después de elegir el tipo, mostrar dimensiones y plantas verificadas. Preguntar planta solo cuando haya alternativas reales y todavía no la conozcamos.
4. Presentar las unidades identificadas de la planta y sus características antes de pedir que elija una. Los penthouses de tres de este caso están en una sola planta; no inventar una elección de planta.
5. Preguntar presupuesto solo si falta. Si ya conocemos el monto pero no su papel, aclarar una vez total frente a entrada. Si declara entrada explícita, conservarla directamente.
6. Tras elegir la unidad de interés, retomar el proceso pendiente. No reabrir tipos, dormitorios o unidades sin una solicitud del lead.
7. Para financiamiento, conservar el permiso de revisión si fue concedido; si solo aceptó orientación, explicar brevemente y pedir el permiso correspondiente una vez. Luego entidad autorizada y datos del flujo ya existente, con sus validaciones.

En la secuencia de la 602, el enlace específico ya se entregó correctamente. La pregunta siguiente debe conducir al financiamiento pendiente. Si el permiso para revisar ya existe, un ejemplo es: Seguimos con el penthouse 602 y la entrada de USD 200.000. ¿Con qué entidad prefiere analizar el financiamiento: Banco Pichincha o Cooperativa JEP?

Si solo aceptó información, un ejemplo es: Seguimos con el penthouse 602. Para analizar el financiamiento, ¿desea que iniciemos la revisión por este chat? El sí a continuar con la unidad no autoriza por sí solo recopilar datos financieros.

## Extracción y recuperación

La validación actual distingue las citas del mensaje presente de las referencias históricas, pero la recuperación completa puede corregir un bloque y dejar otro inválido. Debe comprobarse también la coherencia de las acciones y del papel de las cantidades, no únicamente si una cita está contenida en el mensaje.

Pendientes prioritarios:

- Evitar que una frase de aceptación se convierta en una declaración de categoría y abra una búsqueda nueva.
- Conservar la selección ante consultas sobre ella y aceptaciones de una pregunta cuyo destino ya está identificado.
- Resolver correcciones del cliente sobre hechos anteriores sin volver a pedirlos.
- Reparar por bloques cuando sea posible, mantener los hechos válidos y separar lo actual de lo histórico. No sustituir citas inventadas por citas actuales que no demuestren el mismo significado.
- Si un bloque secundario no puede recuperarse, estudiar una continuación limitada que atienda lo válido y aclare lo indispensable, sin ejecutar selección, reserva, visita o financiamiento con datos inciertos. No habilitar un paso general de cualquier interpretación inválida.
- Registrar qué campo siguió inválido y qué intentos se realizaron para que la interfaz explique la causa concreta.

Referencias: turn-interpretation-input.ts, turn-interpretation.ts, turn-semantics.ts, interpretation-memory.ts y property-context.ts en src/lib/integrations/automation.

## Dinero y financiamiento

Unificar la clasificación del monto utilizada por leadBudget, el recorrido comercial, la continuación del tour y la memoria financiera. La continuación del tour calcula un presupuesto desde el historial, pero delega la pregunta al recorrido comercial sin compartir ese resultado. En la traza del tour apareció initial_capital en una lectura del historial, mientras el recorrido comercial siguió ordenando aclarar el monto porque su memoria lo clasificaba como amount.

La orientación inicial debe ser breve: mencionar aliados autorizados y el paso necesario para continuar. Tasas, porcentajes, plazos y ejemplos de cuotas corresponden a preguntas explícitas sobre condiciones o cálculos y a datos publicados vigentes. No deben aparecer automáticamente al aclarar que tiene dinero para la entrada.

Antes de recopilar identidad y empleo, definir la unidad y el alcance del consentimiento. Mantener la elección de JEP o Banco Pichincha cuando ya fue declarada. Conservar las validaciones acordadas de nombre completo, datos incompletos y cédula ecuatoriana de diez dígitos; no confundir aceptar información con autorizar una gestión.

Una unidad elegida debe seguir disponible para el flujo financiero aunque el contexto del redactor contenga un subconjunto del catálogo. Validar disponibilidad y precio con la fuente correspondiente sin perder la referencia del cliente.

## Redacción y revisión

La regla de uso ocasional del primer nombre ya existe en conversation-style.ts y conversation-tone.ts, pero los bloques que la contienen no llegan de forma uniforme al redactor final. El texto debe poder empezar directamente por la respuesta, sin Carlos y La Vilet en cada turno.

- Evitar repetir rangos, dimensiones, la entrada y la descripción completa cuando el mensaje solo confirma un paso.
- Mantener una sola condición colectiva al comunicar precios referenciales vigentes sujetos a cambio, según la política aplicable. No repetir el aviso dos veces en la misma respuesta.
- No volver a cotizar precios en turnos que no lo necesitan. Si se comunica un nuevo precio o rango, conservar sus condiciones; no eliminar la advertencia permanentemente porque se dijo antes.
- Responder con resumen cuando la consulta sea sencilla y ampliar solo los detalles solicitados.
- Separar rechazo de contenido, clasificación contradictoria de una pregunta y error interno del revisor. Conservar un borrador válido y reparar sus metadatos con un límite independiente.
- Revalidar obligaciones aplicables tras una reparación. La revisión no debe inventar otra pregunta, ni invalidar una respuesta por el estilo o por una etiqueta que contradice su texto.
- Consolidar pocas reglas críticas en las instrucciones y enviar solo obligaciones relevantes al turno. Una sección de reglas de oro puede ayudar, pero debe acompañar un estado coherente y controles concretos.

## Consultas sobre camas y distribución

El catálogo contiene superficies interiores y exteriores de la unidad, no las medidas de cada dormitorio. El visor 360 puede mostrar planos por tipología, pero el contexto del bot no consulta esas imágenes ni sus cotas. Compartir una URL del brochure o un enlace 360 no implica que el redactor tenga acceso al contenido o a planos con cotas. El recorrido virtual permite visualizar el diseño, pero no confirma por sí mismo que dos camas entren con circulación suficiente.

Respuesta posible: Para confirmar si caben dos camas necesitamos las medidas de esa habitación y de las camas; la superficie total del penthouse no basta. Si desea, podemos coordinar atención en nuestra oficina para consultar esa distribución con el equipo.

No prometer planos disponibles ni mediciones que el equipo no haya confirmado. La oficina está en el mismo lugar donde se construirá el proyecto; la visita no es a un departamento terminado. Si en el futuro se incorporan planos, registrar unidad, documento, versión, cotas disponibles y acceso real antes de habilitar respuestas basadas en ellos. El bot puede leer adjuntos que reciba mediante las capacidades existentes, pero eso no sustituye la evidencia que falta en este caso.

## Indecisión y visitas

La regla actual ofrece visita cuando hay varias opciones en comparación, una respuesta de incertidumbre con confianza alta, ninguna unidad elegida, financiamiento no aceptado, modo activo y permiso para sugerir visitas. Además evita repetir la invitación ofrecida o rechazada. Su texto propone revisar planos en la oficina, lo que debe condicionarse a la disponibilidad real.

Definición propuesta: el cliente expresa dificultad para elegir entre opciones compatibles identificadas, por ejemplo No sé si elegir la 602 o la 605, o necesita orientación para comparar después de conocerlas. Pedir precio, más información, consultar si caben camas, agradecer, no contestar de inmediato o que falle el extractor no significa por sí solo que esté indeciso.

Ante la duda, atender la inquietud o hacer una aclaración breve. Si una atención presencial ayudaría y está disponible, invitar a la oficina sin prometer planos, acceso a una obra terminada ni una cita ya registrada. La invitación debe ser opcional, respetar una negativa y conservar la unidad o comparación pendiente. Un cliente con unidad elegida también puede pedir ayuda presencial; esa solicitud es una ruta distinta de la indecisión entre opciones.

## Presentación y perfil inicial

Conservar la redacción de la IA con datos aprobados y un objetivo breve. Un ajuste editable de presentación inicial puede definir los hechos y la extensión para consultas generales, sin imponer el mismo mensaje a saludos, preguntas de precio, financiamiento o varias consultas en el primer turno.

- Primer contacto: saludar una vez por la condición de inicio, con o sin saludo del lead, en todas las rutas normales que correspondan.
- Consulta inicial concreta: responder lo solicitado de forma resumida y pedir nombre y residencia actual cuando falten y esté permitido.
- Consulta inicial general: presentación breve y captura de perfil. No añadir por costumbre cantidades, plantas, fecha de entrega ni estado de obra.
- Nombre sin residencia: permitir el recordatorio adicional acordado; después evitar insistencia.
- Soy de Cuenca: aclarar si es residencia actual. Vivo en Cuenca: conservar declaración de residencia. No hacer que el lugar de origen confirmado sustituya la residencia.
- Brochure: conservar las condiciones vigentes de entrega, negativas y excepciones expresas. No entregarlo por una residencia que todavía requiere confirmación.
- Uso vivienda, dormitorios y alternativas aceptadas: conservarlos y retomar la necesidad siguiente, sin repetir lo contestado.

La fecha no estimada se configura en Información del proyecto, Plazo de entrega. El estado físico de la obra tiene su propio ajuste. Datos disponibles no obligan a mencionarlos en cualquier presentación.

## Materiales y datos editables

- Recorrido 360 general al consultar cómo conocer el proyecto y enlace específico cuando después se identifica una unidad o vista compatible, aunque el general ya se haya enviado. Conservar la unidad y comprobar el enlace correspondiente.
- Descuentos por reserva anticipada: definir porcentajes, base del cálculo, unidades o categorías cubiertas, condiciones, fechas de vigencia y publicación. Sin política vigente no afirmar ahorro ni que los precios futuros subirán.
- Afirmaciones del entorno, como barrio seguro: añadirlas como información verificada y editable del proyecto con alcance y respaldo adecuados; evitar garantías absolutas. Mantenerlas separadas de instrucciones que gobiernan el flujo.
- Separar presentación breve, descripción detallada, estado de obra, entrega, políticas comerciales y catálogo. Explicar cuál utiliza el bot y cuándo.

## Interfaz y explicación de errores

Ayudas con el símbolo ! en escritorio y móvil, accesibles por clic y teclado. Cada ayuda explica qué configura la sección, cómo lo usa el bot, cuándo aplica y qué implica guardar o publicar, con ejemplos breves.

La explicación de un error debe distinguir interpretación inválida, revisión del contenido, error del servicio de IA, consulta de Kommo, migración pendiente y entrega no confirmada. Mostrar la causa registrada, el campo, el mensaje actual pertinente, el resultado del reintento y si se produjo una respuesta de contingencia.

Ejemplo de TURN_INTERPRETATION_INVALID: El extractor intentó atribuir al mensaje sobre la entrada una selección de unidad expresada antes. El segundo intento conservó esa cita inválida. No se generó la respuesta comercial; se utilizó el aviso de atención del equipo. No presentarlo como prueba de que la consulta exigía asesoría.

Los nodos de eventos deben situarse después de la interpretación validada y antes de sus decisiones consumidoras, como evaluación de interés. La lista debe proceder de la misma definición del contrato. Un turno puede activar varios eventos; mostrarlos en paralelo sin inventar una ejecución sucesiva. Distinguir candidatos del extractor de eventos realmente aceptados cuando la interpretación falla.

## Modo demostración

Conservarlo solo para contactos de prueba, con revisión y registro de hallazgos y envío no bloqueado por el resultado de la revisión del redactor. Mantener el mismo flujo de interpretación, catálogo y permisos. Los errores anteriores al redactor, como TURN_INTERPRETATION_INVALID, no están cubiertos por esa excepción. Un envío aceptado por Kommo no equivale a entrega confirmada en WhatsApp.

No ampliar esta excepción al extractor para resolver el caso de la 602. La reparación debe conservar hechos y continuidad, no ejecutar una interpretación inválida.

## Validación antes de aplicar

Reproducir secuencias completas con las salidas observadas, no solamente frases aisladas. Los ensayos locales con datos guardados y respuestas simuladas no consumen créditos de la API; las pruebas que vuelvan a consultar modelos o embeddings sí pueden consumirlos y deben identificarse por separado.

Casos prioritarios de regresión:

1. Inicio con saludo, sin saludo, consulta de precio y varias preguntas; captura de perfil consistente.
2. Nombre y origen ambiguo; residencia explícita; recordatorio único; negativa; entrega de brochure.
3. Cinco dormitorios, cinco hijos, dos camas, aceptación de tres; conservar necesidad y no activar financiamiento por palabras aisladas.
4. Elección de tipo y planta; unidades identificadas; no repetir dormitorios ni ofrecer unidades incompatibles.
5. Dos penthouses de tres; la más grande selecciona la 602; detalles conservan la selección; sí a continuar no abre catálogo.
6. Monto sin papel, aclaración como entrada, corrección es para la entrada; no volver a preguntar total frente a entrada.
7. Tour general y luego específico; un solo siguiente paso después de cada envío.
8. Orientación financiera frente a revisión aceptada; unidad primero; entidad conocida; nombre y cédula incompletos.
9. Precio con condición omitida, reparación del texto y etiqueta equivocada del revisor; reparar metadata sin perder la respuesta válida.
10. Reparación de extractor que corrige solicitudes pero deja una selección histórica; explicar el campo pendiente sin inventar una nueva intención.
11. Indecisión entre opciones frente a duda de distribución; invitación a oficina sin prometer planos ni visita a obra terminada.
12. Mismo caso en modo normal y demostración; igual estado y decisiones, salvo la excepción de revisión del redactor.

Estos casos necesitan validación de integración, persistencia y mensajes consecutivos. Que una prueba aislada pase no demuestra que el flujo completo conserve el siguiente paso.
