# Informe de correcciones de la automatización — 16 de octubre de 2026

Este documento explica qué se corrigió después de la [auditoría integral](./auditoria-integral-2026-10-16.md), qué ocurría antes y qué resultado se espera. Se distingue la implementación local de la disponibilidad en producción. Escribir y probar código no acredita por sí solo un despliegue, una migración aplicada ni un mensaje recibido por un cliente.

**Actualización documental del 17 de octubre de 2026:** la [sección 9](#9-correcciones-posteriores-del-16-y-17-de-octubre-de-2026) incorpora las correcciones posteriores, su cobertura y lo que permanece abierto. Las cantidades y estados de las secciones 1 a 8 pertenecen a la intervención original del 16 de octubre; no representan el estado actual de toda la batería ni una comprobación nueva de producción.

## 1. Resultado y alcance

Se trabajó sobre los **20 hallazgos de la auditoría**. Las correcciones abarcan memoria comercial, instrucciones de redacción, alcance del revisor, recuperación de fallos, seguimiento, showroom, análisis e interfaz. También se repararon conexiones de datos que aparecieron al ejecutar las pruebas con el contrato vigente.

Las protecciones iniciales de la reserva —A-01 y A-02— ya estaban en la revisión de partida de este trabajo, `aa1fe2a`. Se conservaron y se comprobaron de nuevo. Además, se corrigieron pérdidas de referentes y de consultas atendidas que las pruebas detectaron durante esta intervención.

Al comenzar existía trabajo local del panel de análisis y sus dos migraciones. Se conservó, se integró en la comprobación y se completó su cobertura; este informe no presenta todo ese trabajo previo como una creación de este turno.

**La IA revisora permanece desactivada para todos los leads.** Se alinearon sus contratos para una eventual activación, sin activarla. Tampoco se enviaron mensajes a leads, se ejecutó mantenimiento productivo, se aplicaron funciones SQL, se modificaron plantillas de Kommo ni se desplegó el código durante esta intervención.

Los dos hallazgos operativos, A-07 y A-08, siguen requiriendo una intervención en el entorno productivo. Se prepararon diagnósticos seguros; no se presenta su causa como confirmada ni su operación como reparada.

| Estado al cierre | Cantidad |
| --- | --- |
| Corregidos o revalidados en código y pruebas locales | **18** |
| Pendientes de resolver en el entorno productivo | **2** |
| Total de hallazgos de la auditoría | **20** |

Los 18 incluyen las protecciones previas de A-01/A-02 y el trabajo de análisis conservado; no significan 18 implementaciones nuevas ni 18 arreglos desplegados.

## 2. Detalle de los 20 hallazgos

| ID | Antes | Corrección o actuación | Resultado esperado y límite |
| --- | --- | --- | --- |
| **A-01 · Memoria de la selección** | Una aclaración podía borrar la unidad y las alternativas aceptadas. Volvían los cinco dormitorios históricos. | Se conservan decisiones y referentes ante aclaraciones, disculpas y consultas ajenas. Se comprueban las protecciones ya incorporadas. | Una aclaración sobre una reserva no reinicia la búsqueda. Un cambio expreso del cliente sí puede cambiarla. |
| **A-02 · Operación vigente compartida** | Distintos bloques conservaban estados incompatibles: reserva del 605 en uno y ninguna unidad en otro. | Se revalida el contexto operativo compartido y la recuperación de la selección desde la solicitud registrada. Se reparan también los enlaces de preguntas y referentes descritos en la sección 3. | El seguimiento de una reserva se atiende con su unidad y estado real, sin volver por rutina a presupuesto o dormitorios. No convierte una solicitud en reserva confirmada. |
| **A-03 · Saludo repetido** | La hora, el tono cálido o la primera consulta informativa podían impulsar otra bienvenida. | Se establece una autoridad única: `contrato_redaccion.saludo.requerido`. Las fórmulas sociales iniciales se tratan como saludo. | Tras la bienvenida, una pregunta sobre suites recibe la información solicitada, sin otro «Buenos días» por obligación. |
| **A-04 · Presentación y categorías** | Una instrucción autorizaba describir el proyecto y otra prohibía mencionar categorías. | La restricción se aplica solo cuando `presentacion_sin_tipos=true`; un resumen aprobado puede describir sus categorías. | El redactor puede presentar La Vilet de forma breve y coherente, sin recibir órdenes opuestas ni desplegar todo el catálogo. |
| **A-05 · Brochure y presentación** | Persistían objetivos separados o justificaciones como «brochure y guía personalizada». | Se conecta el ofrecimiento con los datos de presentación pendientes en `offer_after_profile`, con expresión libre. Se conservan `share_now`, el material ya compartido y las excepciones de entrega. | Se entiende para qué se piden nombre y residencia en la apertura, sin imponer una frase fija ni bloquear una entrega autorizada. |
| **A-06 · Función del revisor** | Quedaban instrucciones para revisar tono, capturas, pertinencia o el siguiente paso comercial. | Se limita la revisión a hechos y promesas. Se alinean el flujo principal y la redacción operacional con el contrato factual vigente. | Si se habilita en el futuro, el revisor puede detectar una afirmación comercial falsa, pero no decidir qué preguntar ni exigir una cortesía. Sigue desactivado. |
| **A-07 · Mantenimiento atrasado** | El último mantenimiento consultado estaba atrasado. No estaba comprobado el motivo del cron. | Se añade un comprobador HTTP de solo lectura y un diagnóstico SQL administrativo. Se vuelve a consultar el estado, sin ejecutar trabajadores. | Es posible distinguir configuración, ejecución y disponibilidad. **No queda resuelto en producción** hasta comprobar el programador y recuperar su funcionamiento. |
| **A-08 · Estructuras del embudo** | La API devolvía `PGRST205` al consultar ficha e historial comercial. | Se comprueba de nuevo y se entrega diagnóstico de existencia de tablas, historial de migraciones y programador. | Se evita confundir una consulta fallida con cero registros. **La disponibilidad productiva sigue pendiente** de comprobar y resolver en Supabase. |
| **A-09 · Recuperación tras una derivación fallida** | Si fallaba la función SQL de derivación, también podía perderse la recuperación o el aviso técnico. | La recuperación conserva la incidencia aunque falle esa función. Se diferencia el aviso aceptado de la derivación efectivamente registrada y se protege el estado de revisión. | Un fallo de derivación no deja el caso sin rastro ni autoriza decir que ya tiene asesor. No se repiten envíos inciertos sin contrastarlos. |
| **A-10 · Seguimiento y modo informativo** | Los seguimientos podían volver a calificar a quien solo quería conocer el proyecto. | Se utiliza el modo y la intención estructurada guardada; no se escoge el tema por palabras del último texto. | Se mantiene información pertinente sin reabrir por rutina presupuesto, financiamiento o visitas. Las plantillas comerciales de 14/21 días se omiten en modo informativo. |
| **A-11 · Permiso y fecha de retoma** | Un plazo o una negativa registrados no gobernaban todas las programaciones y envíos. | Se revalidan permiso, ficha comercial y `resume_at` al programar y antes de enviar. Un horizonte sin fecha suficiente no se transforma en una fecha inventada. | «Más adelante» no produce una retoma arbitraria. Un nuevo acuerdo desplaza la fecha anterior. Una fuente fallida no equivale a autorización. |
| **A-12 · Categoría del inmueble** | Un penthouse podía aparecer llamado «departamento» en el seguimiento. | Se conserva su categoría y su denominación en el contexto y las instrucciones. | Los mensajes posteriores siguen hablando del penthouse conocido, sin cambiarle el tipo. |
| **A-13 · Navegación del showroom** | Observar una unidad podía escribir preferencias declaradas e incluso un vínculo `consulto`. | La observación conserva señales y sesión, pero deja de escribir dormitorios/categoría como preferencias o rebajar vínculos existentes. Las solicitudes expresas mantienen su registro. | Revisar una unidad no equivale a elegirla. Una consulta o elección expresa sigue teniendo valor comercial. |
| **A-14 · Mensajes de citas** | Parte de la autorización dependía de encontrar determinadas palabras, enlaces o formulaciones en el mensaje. | Se comprueban datos estructurados de lugar, fechas, opciones y la propuesta aprobada. Se conserva el mensaje exacto autorizado por el asesor. | La misma dirección u horario pueden expresarse naturalmente sin que una coincidencia de texto decida el envío. Se mantienen destinatario, permisos, vigencia y controles contra duplicados. |
| **A-15 · Interpretación del análisis** | La actividad reciente podía desplazar una objeción o un rechazo explícito hacia «no caído». | El análisis conserva factores y posición del cliente con citas comprobables. La actividad y la inactividad se guardan por separado. | Un rechazo expresado hace diez minutos no desaparece porque el chat siga activo. Una objeción o el silencio tampoco cierran comercialmente el lead por sí solos. |
| **A-16 · Incidencias en el análisis** | Los fallos previos al envío con estado `cancelled` podían quedar fuera del panel. | Se incluyen incidencias que necesitan revisión en `failed`, `uncertain` y `cancelled`, con alcance autorizado. Se resuelve también la clave compuesta lead/contacto. | El panel puede mostrar un problema técnico pendiente aunque no tenga estado `failed`. Las cancelaciones normales no se convierten en alertas. |
| **A-17 · Actualización de la interfaz** | La consulta periódica podía reemplazar el embudo por una carga y cortar el trabajo. | Se separan carga inicial, actualización en segundo plano y error de actualización. Se conservan los datos existentes ante un fallo temporal y se descartan respuestas obsoletas. | La información se actualiza conservando las tarjetas, el foco, el desplazamiento y las notas del componente que sigue abierto. |
| **A-18 · Pruebas desactualizadas** | La batería exigía contratos retirados: el código corregía prosa o el revisor decidía preguntas y tono. También había simulaciones incompletas. | Se migran las respuestas simuladas al contrato actual, con preguntas y recibos explícitos del redactor; se conservan escenarios y controles comerciales. Se comprueban diferencias del SDK instalado. | Las pruebas dejan de pedir que se restaure comportamiento rechazado por el usuario y permiten encontrar fallos reales de continuidad. El resultado final se detalla en la sección 6. |
| **A-19 · Contexto excesivo o reintroducido** | Una consulta general podía recibir de nuevo unidades y grupos que otra proyección ya había omitido. | La proyección de evidencia respeta `project_overview`. Las referencias de hechos apuntan a las fuentes que realmente recibe el modelo. | Una explicación general no se convierte en un inventario de unidades por tener esos datos disponibles. Omitir catálogo no significa que no existan inmuebles. |
| **A-20 · Aceptación financiera** | Reconocer el permiso dependía de la formulación de la invitación del redactor; algunos textos del cliente podían activar una revisión por coincidencia léxica. | Se guarda un recibo tipado de la invitación realmente entregada y se exige la interpretación actual fundamentada del cliente. Se elimina la lectura del mensaje previo del redactor para resolver esa autorización. | «Sí» puede responder a invitaciones equivalentes sin una frase obligatoria. Consultar cuotas, requisitos o una evaluación anterior no autoriza por sí solo recopilar datos legales o iniciar una nueva revisión. |

## 3. Fallos adicionales encontrados al comprobar la continuidad

Estos defectos se encontraron al adaptar y ejecutar las pruebas. Se agrupan con los hallazgos de continuidad y contexto; no se suman como nuevos incidentes reales ni se usan para inflar el inventario de la auditoría.

### 3.1 Una respuesta podía seguir registrada como pendiente

El contrato del redactor identifica consultas mediante referencias como `R1` o `R2`. Una función guardaba ese identificador donde la memoria esperaba el fragmento correspondiente del cliente. Por eso podía no reconocer que el precio ya se había respondido.

Se enlaza el identificador con la consulta canónica de ese mismo turno y se conserva también el ID. Es una relación entre datos estructurados: **no se lee ni se interpreta la redacción de la respuesta**. Solo se marca atendida tras la aceptación del envío y con el estado correspondiente; una consulta diferente o un envío fallido no cierra el precio pendiente.

### 3.2 Una pregunta podía perder sus unidades

Algunos consumidores recibían el ámbito verificado del plan, pero no las filas completas del catálogo. El filtro trataba esa ausencia como un catálogo vacío y eliminaba todos los identificadores. Además, varias rutas del plan no indicaban el acto de su pregunta.

Se distingue un catálogo omitido de un catálogo explícitamente vacío. Cuando no se suministran las filas, los referentes se limitan al ámbito verificado de ese mismo plan. Se añaden actos canónicos para reserva, financiamiento, visita, presupuesto y selección. Los metadatos del redactor no pueden ampliar por su cuenta el conjunto permitido.

### 3.3 Una confirmación podía perder aquello que confirmaba

Al guardar la pregunta final no siempre se incorporaban los referentes ya preparados: la ciudad de residencia por confirmar o la consulta propuesta de una alternativa. Se incorporan como candidatos estructurados, únicamente cuando coinciden el ID y el acto de la pregunta emitida. Los referentes contradictorios no se escogen silenciosamente.

Esto permite conservar qué ciudad se estaba confirmando y qué alternativa se había ofrecido, sin volver a deducirlo por las palabras de la respuesta.

### 3.4 Solicitudes con errores de escritura

Se corrigió una ruta que anulaba una intención de cita bien fundamentada por IA cuando el reconocedor textual no entendía una falta ortográfica. Se conservan negativas, condiciones y exclusión de gestiones ajenas al proyecto. También se corrige el reconocimiento de «serparar» en la protección de solicitudes de reserva, conservando sus comprobaciones de unidad, evidencia, condiciones y resultado operativo.

### 3.5 La aceptación de reserva también dependía de la frase del redactor

La comprobación final encontró el mismo problema de A-20 en dos puntos del flujo de reserva. Con idénticos metadatos y unidad, «¿Desea iniciar la reserva del penthouse 605?» permitía continuar; «¿Damos ese paso con la unidad elegida?» podía perder la aceptación, aunque el mensaje ya explicara la reserva.

Se crea un recibo de invitación desde los metadatos de la pregunta, un plan coincidente y una única unidad verificada. La normalización y la ejecución comprueban ese recibo, la respuesta actual del cliente y el inventario. No vuelven a interpretar las palabras o los números de la pregunta del redactor. Las tres paráfrasis de la regresión continúan con el 605; negativas, condiciones, evidencia antigua y unidades múltiples, desconocidas, retiradas o distintas de la selección siguen protegidas.

Los registros históricos sin recibo no conceden una autorización nueva mediante un «sí» aislado. Puede ser necesario reconfirmar esa decisión; no se borra una gestión ya registrada ni una aceptación financiera persistida por introducir estos recibos. Se guardan en el JSON de conversación existente: **no requieren una migración SQL nueva**.

## 4. Cómo debería cambiar una conversación

Los textos siguientes son **ejemplos de resultado esperado**, no plantillas incorporadas ni respuestas generadas y certificadas por un modelo real en esta intervención.

| Situación | Problema anterior | Comportamiento esperado |
| --- | --- | --- |
| Ya eligió el 605 y pregunta por su reserva. | Reaparece la pregunta de tres dormitorios o la necesidad histórica de cinco. | Atender el estado de la solicitud del 605 y la atención pendiente, usando únicamente lo respaldado por el registro. |
| Después de la bienvenida pide información de suites. | Se repite «Buenos días» antes de responder. | Continuar directamente con la información solicitada y los datos de presentación que todavía corresponda pedir. |
| Primera presentación con brochure pendiente. | Ofrecer brochure y pedir datos parecían acciones desconectadas, o se imponía una justificación fija. | «Nos gustaría compartirle el brochure del proyecto. Para enviárselo, ¿podría indicarnos su nombre y dónde reside actualmente?» La formulación puede variar. |
| Dice que por ahora solo quiere conocer el proyecto. | Un seguimiento vuelve a presupuesto o financiamiento. | Conservar esa intención y ofrecer únicamente información pertinente; no convertir una pregunta de precio en permiso para calificarlo. |
| Observa varias unidades en el showroom. | Se transforma la navegación en preferencias o una elección. | Conservar la observación; aclarar o atender su consulta sin atribuirle una selección. |
| Acepta una invitación financiera expresada como «¿Damos ese paso?». | El código no reconoce la frase y pierde la aceptación. | Enlazar la respuesta actual con la invitación tipada entregada y conservar las condiciones del trámite. |
| Acepta la solicitud de reserva tras «¿Comenzamos esa gestión para el 605?». | Dos comprobaciones podían rechazar la paráfrasis de la pregunta. | Conservar el referente y la aceptación mediante el recibo tipado; registrar únicamente la solicitud operativa autorizada. |
| Dice «quiero revisar la evaluación financiera que ya me hicieron». | Un patrón textual podía interpretarlo como permiso para iniciar otra revisión. | Atender la consulta sobre la gestión existente. No iniciar un trámite nuevo por esa expresión. |

Se espera una mejora en coherencia, continuidad y pertinencia. La naturalidad también depende del modelo, del contexto real y de los datos disponibles. **Pasar pruebas con respuestas simuladas no garantiza que todas las futuras respuestas suenen bien.** Esa comprobación corresponde a simulaciones con modelos y a la revisión controlada de conversaciones reales tras el despliegue.

## 5. Decisiones que se conservaron

- El redactor entrega el mensaje completo. Las correcciones de contexto y permisos no autorizan al código a añadir o reformular frases del mensaje final.
- La presentación conserva el nombre inicial y la residencia; el nombre legal completo y la cédula pertenecen a la revisión financiera autorizada, con sus requisitos de unidad y entidad.
- Se mantienen las excepciones vigentes de entrega del brochure y el material ya compartido. La conexión inicial con los datos no se convierte en una prohibición absoluta de entrega.
- La revisión por IA sigue desactivada para todos los leads; no se cambia el modelo elegido ni se activa otra revisión como efecto de estos ajustes.
- Se mantiene la activación por mensajes nuevos y la protección frente a seguimientos históricos de campañas anteriores.
- No se habilita la retoma automática de 30/60 días ni se recuperan trabajos antiguos por esta intervención.
- El envío de renders adjuntos y la reducción de listas de locales a dos o tres opciones siguen aplazados. No se modificaron plantillas aprobadas para alterar su contenido comercial.
- Una solicitud de reserva sigue siendo una solicitud para el equipo. La confirmación de reserva, el cierre y el asesor asignado requieren registros reales.

## 6. Comprobaciones y evidencia

| Comprobación | Resultado final |
| --- | --- |
| Regresión de la intervención | **2.550 / 2.550 aprobadas**, 0 fallos, 0 omitidas; **205 archivos únicos**. |
| TypeScript | Aprobado: comprobación global sin emitir archivos. |
| ESLint | Aprobado en **143 archivos intervenidos**, sin errores ni advertencias. |
| Compilación de producción | Aprobada, código de salida 0; incluye compilación, TypeScript y generación de 79 páginas. |
| Navegador local | **2 / 2 pruebas aprobadas**: actualización del embudo sin perder trabajo y panel de análisis en escritorio/móvil. |

La selección de regresión amplía los archivos de la auditoría original e incluye las pruebas intervenidas. No representa todas las pruebas de otras áreas del repositorio. El [anexo estructurado](./informe-correcciones-auditoria-2026-10-16.json) conserva el manifiesto, las fechas y los resultados. Las capturas del panel se inspeccionaron visualmente.

Durante la generación de páginas apareció un diagnóstico de lectura de contactos de prueba, `test_contacts_action_failed / UNKNOWN`; la compilación terminó correctamente. Eso no acredita por sí solo un fallo productivo ni certifica esa pantalla con una sesión real.

Comandos reproducibles desde la raíz del proyecto:

```powershell
npm.cmd run test:audit-corrections
npm.cmd run test:lead-pipeline-refresh-ui
npm.cmd run test:conversation-analysis-ui
node node_modules/typescript/bin/tsc --noEmit --pretty false
npm.cmd run build
```

El comando de auditoría bloquea la red y retira credenciales del entorno de sus procesos. No ejecuta el worker productivo.

La batería utiliza respuestas de IA, CRM y base de datos simuladas. Las pruebas SQL de integración emplean una base local aislada; las pruebas visuales utilizan una aplicación local con datos ficticios. No prueban la entrega real de WhatsApp, la lectura de una notificación por un asesor ni el funcionamiento del cron privado de producción.

Se migraron escenarios existentes, en lugar de volver a introducir los contratos antiguos para que pasaran. Entre los controles conservados están: precio y condiciones respaldados, superficies y categorías, negativa del cliente, diferencia entre información y autorización, selección expresa, permisos, ausencia de operaciones confirmadas, errores de transporte, idempotencia y continuidad tras dudas intermedias.

La auditoría anterior documentó **2.019 comprobaciones: 1.583 aprobadas y 436 fallidas**. Esas 436 no eran 436 defectos productivos: mezclaban contratos obsoletos, simulaciones incompletas y problemas funcionales. La batería actual amplía la selección de archivos; sus cifras no se deben restar directamente para afirmar que se corrigió ese número de errores reales.

## 7. Estado productivo y pasos de puesta en marcha

La consulta de solo lectura del **16 de octubre de 2026, 19:07 UTC / 14:07 de Bogotá**, mostró:

| Comprobación | Resultado observado |
| --- | --- |
| `lead_commercial_profiles` por API | No disponible: `PGRST205`. |
| `lead_commercial_stage_observations` por API | No disponible: `PGRST205`. |
| Último mantenimiento completo consultado | 15 de octubre, 16:50 UTC; aproximadamente 1.577 minutos de antigüedad al comprobarlo. |
| Configuración consultada | Automatización habilitada, sin modo seco y sin restricción global de pruebas. Esto no acredita que el programador esté ejecutándose. |

`PGRST205` acredita que esa consulta no encuentra la estructura en la API; **no determina por sí solo si falta la tabla, la migración o actualizar la caché del esquema**. El diagnóstico administrativo debe resolver esa distinción antes de volver a aplicar SQL.

Se entregan:

- [Comprobador HTTP de solo lectura](../../scripts/automation-healthcheck.mjs): consulta disponibilidad y antigüedad del mantenimiento. No llama trabajadores, funciones de envío ni proveedores.
- [Diagnóstico SQL administrativo de solo lectura](../../scripts/automation-readonly-diagnostics.sql): contrasta tablas, registro de migraciones y estado del programador. No activa cron ni envía mensajes.
- La migración existente [20261015210000_lead_commercial_pipeline.sql](../../supabase/migrations/20261015210000_lead_commercial_pipeline.sql) es la referencia de las estructuras del embudo. Hay que contrastar su aplicación y el esquema antes de decidir el remedio.
- Para el fallo SQL de derivación `42P10`, la referencia existente es [20261016110000_fix_lead_assignment_notification_conflict.sql](../../supabase/migrations/20261016110000_fix_lead_assignment_notification_conflict.sql). La recuperación más resistente de A-09 no sustituye comprobar que esa corrección SQL esté aplicada; aquí no se acreditó su aplicación productiva.
- Las dos migraciones del trabajo local del análisis son [20261016220000_conversation_analysis_reviews.sql](../../supabase/migrations/20261016220000_conversation_analysis_reviews.sql) y [20261016221000_conversation_analysis_v2_candidates.sql](../../supabase/migrations/20261016221000_conversation_analysis_v2_candidates.sql). Su ejecución productiva no se realizó ni se acreditó aquí.

El nuevo seguimiento comprueba la ficha comercial para respetar permisos y acuerdos. Si esa fuente no se puede consultar, se detiene con `NUTRITION_COMMERCIAL_PROFILE_FAILED`; no interpreta el fallo como permiso. Por eso resolver A-08 es necesario para comprobar el funcionamiento de estos seguimientos en producción.

Después de comprobar y resolver las estructuras y el programador, corresponde desplegar el código y verificar con contactos autorizados: continuidad del 605, apertura seguida de una consulta, modo informativo, consentimiento financiero, seguimiento acordado, recuperación de una derivación y visualización de incidencias. Las pruebas de entrega deben contrastar el proveedor y el historial; aceptar una petición HTTP no prueba que el cliente haya recibido o leído el mensaje.

## 8. Archivos y áreas principales

| Área | Fuentes principales |
| --- | --- |
| Reserva y referentes | `property-context.ts`, `reservation-operation-context.ts`, `commercial-journey.ts`, `continuation-question.ts`, `conversation.ts`, `turn-semantics.ts`, `reservation-invitation.ts`, `reservation-action.ts`. Las protecciones iniciales ya estaban en la revisión de partida. |
| Redacción y presentación | `dialogue-writing-rules.ts`, `conversation-tone.ts`, `lead-introduction.ts`, `response-plan.ts`, `response-content-scope.ts`, `focused-review.ts`, `turn-completeness.ts`, `operational-copy.ts`, `tone-settings.ts`. |
| Contexto y consultas atendidas | `task-context.ts`, `turn-completeness.ts`, `question-references.ts`, `continuation-question.ts`. |
| Recuperación y citas | `generation-recovery.ts`, `worker.ts`, `visit-rules.ts`, `turn-interpretation.ts`. |
| Seguimiento | `nutrition-intent.ts`, `nutrition-context.ts`, `nutrition-week-one.ts`, `nutrition-later.ts`, `lead-nurture-state.ts` y sus instrucciones. |
| Showroom | `src/lib/tour/enrichTourLead.ts`. |
| Financiamiento | `financing-invitation.ts`, `financing.ts` y la persistencia del acto en `conversation.ts`. |
| Análisis | `conversation-analysis.ts`, `conversation-analysis-contract.ts`, `conversationAnalysis.service.ts`, `src/lib/inmobiliaria/conversationAnalysis.ts` y el panel existente en `analisis-conversaciones`. |
| Embudo | `useLeadPipeline.ts`, `src/app/inmobiliaria/leads/page.tsx`. |

Las rutas sin prefijo de esta tabla pertenecen a `src/lib/integrations/automation/`. El anexo de comprobaciones de este informe registra el alcance exacto de archivos ejecutados. El informe original se conserva como evidencia de lo encontrado; este documento registra las actuaciones posteriores.

## 9. Correcciones posteriores del 16 y 17 de octubre de 2026

Esta ampliación reúne los cambios posteriores que estaban repartidos en los informes de interpretación, estabilización y validación. Se corresponde con los [patrones S-01 a S-17 de la auditoría](./auditoria-integral-2026-10-16.md#12-ampliación-de-hallazgos-del-17-de-octubre-de-2026). Las familias cubren distintas maneras de expresar una consulta o decisión; no constituyen respuestas fijas para mensajes concretos.

Las fuentes revisadas están presentes en el commit local `a1fc19f3cc5e1ef42a32233d68786a8c19ea8dfd`. Los registros de validación conservan el estado de su propia ejecución, incluida la indicación de cambios locales que tenían entonces. No se transforma esa evidencia en una afirmación de despliegue actual.

### 9.1 Antes, cambios y casos cubiertos

| ID | Antes | Corrección implementada y casos cubiertos | Resultado esperado y límite |
| --- | --- | --- | --- |
| S-01 | El significado interpretado por IA podía rechazarse por vocabulario, formato o por reconstruir la pregunta previa desde su prosa. | Contrato compartido de comunicación, solicitudes, autoridades y referencias; preferencias de visita con componentes y fuentes; recibos tipados de las preguntas realmente entregadas. Cubre paráfrasis, errores de escritura, respuestas breves y fecha/hora aportadas en mensajes distintos. | El código comprueba datos y condiciones operativas sin reinterpretar palabras. Completar una preferencia permite registrar la solicitud cuando se cumplen sus requisitos; anunciar una cita confirmada exige su registro propio. La migración de visitas pertenece a esa intervención previa. |
| S-02 | Un selector por palabras podía excluir los hechos que respondían a la consulta. | Selección de bloques de contexto desde solicitudes y temas interpretados por IA, manteniendo políticas publicadas y fuentes compartidas. Cubre seguridad del edificio, ubicación, características y consultas equivalentes expresadas de formas distintas. | El redactor recibe los hechos pertinentes disponibles. No se le autoriza a inventar características ni a convertir medidas del edificio en estadísticas del barrio. |
| S-03 | Límites internos se convertían en descargos; la desconfianza podía provocar una disculpa por algo no dicho. | Regla común de respuesta útil y positiva, alineación de bloques particulares y contraste con el historial real. Cubre objeciones, seguridad, materiales, visitas y dudas sobre la información anterior. | Explicar lo pertinente sin enumerar espontáneamente carencias o garantías inexistentes. Una pregunta directa sobre un dato ausente recibe una respuesta breve y honesta; no se oculta ni se inventa. Solo se rectifican afirmaciones anteriores realmente equivocadas. |
| S-04 | Una petición corriente de información podía guardar una pausa persistente y detener el flujo. | Decisión estructurada de pausa, retoma o ausencia de cambio; validación de coherencia antes de planificar. Se repararon y verificaron dos estados afectados mediante actualización condicionada, conservando los demás datos. | Pedir información mantiene la orientación pertinente. Una pausa explícita, una negativa o una decisión pospuesta conserva su alcance. Las dos reparaciones no equivalen a una limpieza automática de todos los estados históricos. |
| S-05 | Un objetivo histórico podía imponerse al actual, recuperar requisitos sustituidos o reabrir la búsqueda durante una operación. | Prioridad del plan actual, contexto operativo compartido y conservación de selección, consultas y alternativas aceptadas. Se retira de la búsqueda activa el requisito reemplazado y se conserva como historia. | Atender la consulta actual y continuar desde la decisión vigente, sin reiniciar requisitos ya resueltos ni inventar otra gestión. Un cambio expreso del cliente sigue teniendo efecto. |
| S-06 | El formato del lote podía invalidar citas y una intención principal podía desplazar decisiones de otro mensaje. | Recuperación de citas contiguas con diferencias solo de espacios, conservación de cifras/negaciones/orden e instrucciones de integración de todos los mensajes. Contradicciones estructurales se devuelven a la IA mediante reparación limitada y registrada. | Conservar consultas y datos simultáneos sin aclaraciones genéricas causadas por formato. Una segunda extracción responde a una validación concreta; no es el revisor ni una obligación de procesar siempre dos veces. |
| S-07 | Explicar el brochure podía activar el enlace o hacer desaparecer la presentación parcial pendiente. | Decisiones separadas para explicar contenido, esperar decisión, completar perfil y compartir ahora. Cubre consultas intermedias, nombre aportado junto con una consulta, petición expresa de envío y rechazo de datos o material. | Explicar contenido sin entregar por una mera mención. Si aporta un dato, conservarlo y pedir solo el pendiente cuando corresponda el recordatorio autorizado. La petición expresa y las excepciones vigentes permiten entrega sin forzar datos. |
| S-08 | El recordatorio de residencia volvía a ofrecer y justificar el brochure aunque el perfil estuviera bien interpretado. | Acción `await_profile` y separación de ofrecimiento inicial y aclaraciones. El contrato conserva procedencia y significado temporal del lugar declarado. | Reconocer el dato recibido y preguntar solo por la residencia actual pendiente. No repetir el beneficio ni asumir que una residencia anterior u origen es la actual; una expresión incierta se aclara. |
| S-09 | Una elección contextual podía perderse o coexistir con restricciones antiguas; números descriptivos podían convertirse en filtros. | Interpretación de elecciones respecto de la pregunta entregada, roles numéricos estructurados y prioridad de la aceptación de alternativas. Se distinguen referencias de comparación, consultas y selección expresa. | No volver a preguntar una categoría ya elegida ni deducir dormitorios de personas, edades u otras cantidades. Mencionar una categoría para consultar no equivale siempre a elegirla; no se inventan unidad, finalidad ni presupuesto. |
| S-10 | Los agregados del catálogo podían describir un grupo más amplio que el conjunto elegido por el plan. | Proyección de evidencia de presentación sobre `selection_scope`, cálculo de rangos desde sus miembros y obligación de identificar el subconjunto al describirlo. Se conservan por separado las consultas independientes y comparaciones actuales. | Superficies, precios y plantas corresponden al grupo consultado. No generalizar sus datos a otra distribución ni inferir inexistencia global desde contexto recortado. |
| S-11 | La consulta de altura podía mezclar plantas, recuperar unidades anteriores o contaminar el siguiente turno. | La IA entrega `floor_query` y su referente; el código calcula el máximo o compara plantas del catálogo. La consulta temporal caduca al siguiente turno y conserva preferencias, presupuesto y selección. | Responder sobre las plantas solicitadas sin volver por rutina a otras unidades. Explorar otra altura no aumenta el presupuesto, acepta otra categoría ni autoriza financiamiento. Si falta un referente inequívoco, se aclara. |
| S-12 | El texto de una nota de voz podía contener una cifra equivocada; la traza no identificaba el transcriptor efectivo. | Se documentó y verificó la separación entre transcripción acústica e interpretación con Luna. **No se cambió el transcriptor ni se corrigió el audio original.** Quedan pendientes una comparación con ese audio y el registro del modelo efectivo. | No presentar la migración de imágenes a Luna como mejora de transcripción. Los controles de voz clara y confianza no garantizan cada dígito. El valor predeterminado local sigue siendo `whisper-1`; no acredita el modelo del evento productivo examinado. |
| S-13 | Un número contradictorio con una referencia relativa podía tratarse como elección inequívoca de otra opción. | El intérprete puede declarar `reference_kind=ambiguous`; el consumidor conserva búsqueda/selección y el plan `clarify_unit_reference` pide aclarar candidatos. Cubre referencias relativas incompatibles con las opciones realmente ofrecidas, también en texto transcrito. | Aclarar antes de mostrar otro recorrido o cambiar distribución. No autocorregir el número ni bloquear una petición clara e independiente de otra unidad. Depende de que la IA identifique la ambigüedad; no repara el sonido. |
| S-14 | Una unidad identificada podía terminar con un objetivo genérico sin pregunta. | Plan `confirm_selected_option` cuando falta decidir continuidad y no existe una acción autorizada de mayor prioridad. La aceptación de la pregunta entregada se guarda como continuidad de esa unidad, separada de la selección. | Proponer continuar con la opción conocida sin repetir ficha, recorrido o presupuesto pospuesto. Aceptar esa continuidad no inicia visita, financiamiento ni reserva. No se repite si ya está resuelta. |
| S-15 | Agradecer podía cerrar el intercambio mediante un atajo sin redactor, aun con una decisión pendiente. | Separación interpretada por IA de `courtesy_only` y `closing_only`; `resume_pending_decision` conserva la pregunta realmente pendiente y permite retomarla una vez. La memoria de repetición se guarda tras el envío aceptado y con metadatos coincidentes. | Un agradecimiento neutro puede continuar la decisión; no la acepta. Una despedida explícita se respeta. No se inventa captura porque falten campos ni se insiste indefinidamente; pausas, límites de perfil y gestiones en espera conservan prioridad. |
| S-16 | La instrucción exacta y el mensaje analizado eran difíciles de contrastar; una ruta sin redactor resultaba poco clara. | Panel destacado con el JSON capturado de `contrato_redaccion.objetivo_siguiente`, acceso al contexto y perfil originales, copia y aviso de ausencia de llamada. Mensaje fijo en la vista de pasos y conservación de selección al actualizar. | Inspeccionar lo que realmente recibió el redactor, sin recalcularlo con reglas actuales. Registros parciales se señalan. La mejora no incluye la vista de arquitectura: la interferencia del minimapa sigue pendiente. |
| S-17 | Aprobaciones parciales podían interpretarse como cierre de toda la automatización o de sus fallos históricos. | Evaluador de secuencias con modelos reales, memoria y operaciones ficticias; registros de intentos fallidos y resultados por ejecución. Se separan aceptación estructural, naturalidad, pruebas históricas y operación productiva. | Más evidencia sobre recorridos completos, sin prometer cobertura universal. La revisión individual de 432 fallos sigue aplazada; los controles estructurales no certifican cada frase ni un despliegue. |

### 9.2 Responsabilidades y siguientes pasos del flujo

La IA intérprete produce la intención y los datos estructurados. El **planificador actual es código**: combina esos datos con memoria, consultas y operaciones para preparar el objetivo del redactor. El redactor recibe ese objetivo junto con el contrato, la ficha, el historial y la evidencia seleccionada; escribe el mensaje completo. El objetivo cambia según el turno y las rutas breves que no llaman al redactor no tienen una entrada de redacción que mostrar.

La interfaz conserva el JSON capturado, incluidos identificadores de pregunta, acto y alcance cuando existen. No es una nueva interpretación posterior de lo que debió pasar. Si hubo varias llamadas de redacción, se identifica la llamada mostrada y se puede consultar su contexto.

Se recomendó evaluar un planificador conversacional de IA limitado, primero en comparación sin control operativo. **Esa recomendación no está implementada.** La IA revisora sigue desactivada; estas correcciones no la habilitan ni le trasladan el siguiente paso comercial.

### 9.3 Validación disponible y pendientes

| Ejecución conservada | Resultado y alcance |
| --- | --- |
| [Estabilización](./validacion-estabilizacion-2026-10-16.json) | 364 comprobaciones actuales aprobadas y veinte turnos en cinco secuencias con Luna. Batería histórica: 2.695 comprobaciones, 2.263 aprobadas y **432 fallidas**. |
| [Brochure, interés y multimedia](./validacion-brochure-interes-y-multimedia-2026-10-17.json) | 391 comprobaciones actuales aprobadas, ocho turnos sintéticos y una imagen sintética. No se evaluó la precisión acústica. |
| [Lotes, brochure y plantas](./validacion-lotes-brochure-y-plantas-2026-10-17.json) | 403 comprobaciones actuales aprobadas y 17 turnos sintéticos con Luna. |
| [Contexto del redactor](./validacion-contexto-redactor-2026-10-17.json) | 413 comprobaciones actuales aprobadas y ocho turnos sintéticos. Interfaz comprobada a 1440, 768 y 390 píxeles. Se conserva una formulación poco natural pese a aprobar el recorrido estructural. |
| [Referencias y cortesías](./validacion-referencias-y-cortesias-2026-10-17.json) | 430 comprobaciones actuales aprobadas y siete turnos sintéticos con Luna. Primer intento fallido conservado; ejecución final aprobada. TypeScript, ESLint, build y comprobaciones de interfaz aprobados en ese corte. |

Estas cifras corresponden a ejecuciones sucesivas con cobertura solapada. No se suman ni se restan de las 2.550 comprobaciones del cierre original para calcular una cantidad de errores corregidos. Los 432 fallos proceden de la batería histórica posterior al cambio de contrato; su revisión individual no se reanudó en esta actualización documental.

Permanecen pendientes:

1. Comparar transcriptores con el audio original y una colección representativa de números, rectificaciones y referencias relativas; conservar la transcripción y el modelo efectivo por llamada.
2. Reconciliar cada fallo histórico cuando el usuario retome esa revisión, conservando sus controles comerciales y distinguiendo contratos antiguos de regresiones reales.
3. Resolver la navegación del minimapa de arquitectura, reproducida también sin el encabezado fijo.
4. Ampliar las evaluaciones de naturalidad y comprobar el código/configuración efectivamente desplegados antes de afirmar cobertura productiva.

La actualización del 17 de octubre modifica documentación y sus anexos. No añade migraciones, no cambia modelos, no aplica SQL, no despliega ni envía mensajes. Las preferencias tipificadas de visita dependen de la migración ya documentada [20261017000000_typed_visit_preferences.sql](../../supabase/migrations/20261017000000_typed_visit_preferences.sql); no se afirma que esté pendiente en el entorno del usuario.

### 9.4 Modelos de voz y reconocimiento de identificadores

En el recorrido revisado, un modelo especializado convierte el audio en texto y Luna interpreta después ese texto. El valor predeterminado local de `OPENAI_TRANSCRIPTION_MODEL` sigue siendo `whisper-1`. La traza examinada no identifica el transcriptor efectivo; por tanto, no atribuye por sí sola el error a ese modelo concreto.

La documentación oficial consultada el 17 de octubre recomienda **`gpt-transcribe` para grabaciones completas** y permite contexto e indicaciones de idioma para mejorar el reconocimiento de términos del dominio. Es un candidato para una comparación controlada con notas de voz del proyecto. [Guía de transcripción](https://developers.openai.com/api/docs/guides/transcription), [modelo GPT-Transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe).

`gpt-4o-transcribe` también documenta mejoras de exactitud y reconocimiento de idioma respecto de los Whisper originales; el código actual ya admite esa familia y su variante mini. Incorporar `gpt-transcribe` requeriría adaptar la validación de modelos y comprobar formatos, controles y resultados: **no basta con poner ese nombre en la variable actual**. No se hizo ese cambio. [Modelo GPT-4o Transcribe](https://developers.openai.com/api/docs/models/gpt-4o-transcribe).

**No está demostrado que otro modelo hubiera reconocido correctamente un número de esta grabación.** Para comprobarlo hay que comparar el mismo audio y medir especialmente identificadores, negaciones y rectificaciones, además de la calidad general. El contexto puede orientar al transcriptor, pero no debe forzarlo a sustituir lo dicho por una unidad esperada.

GPT-6 Luna en la API admite texto e imágenes y **no audio directo**. La experiencia de voz de ChatGPT no demuestra que se utilice la misma cadena de transcripción que en esta integración. Luna puede detectar contradicciones en el texto y el historial, pero recibir una cifra ya equivocada no equivale a escuchar el audio original. [Capacidades de GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
