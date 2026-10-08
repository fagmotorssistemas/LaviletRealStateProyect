# Automatización de La Vilet y cambios realizados

**Fecha:** 7 de octubre de 2026. **Versión analizada:** `0adbe80`. **Período de cambios:** septiembre y octubre de 2026.

La sección de automatización reúne la atención comercial por WhatsApp, el seguimiento de leads y las herramientas para supervisar las decisiones del bot. El trabajo realizado incluye el panel operativo, el motor conversacional, la coordinación de citas, la orientación financiera, las reglas de negocio y la trazabilidad de cada ejecución.

El núcleo operativo está acotado al proyecto La Vilet. Los filtros y parte de la configuración contemplan proyectos, pero no acreditan un motor general habilitado para cualquier proyecto.

El código analizado está versionado y la validación local de esta revisión aprobó **1.799 pruebas en 135 archivos únicos**, sin fallos, cancelaciones ni omisiones. La disponibilidad en producción depende del despliegue, las migraciones y la configuración de Supabase y Kommo; estos resultados validan el comportamiento local cubierto por las pruebas.

## Funciones de la sección

| Área | Qué contiene | Qué permite hacer |
| --- | --- | --- |
| Monitoreo | Indicadores, filtros, tabla de leads y detalle de conversación | Identificar interesados, revisar su estado y priorizar atención |
| Control de leads | Diagnóstico, causas, evidencias y recomendaciones | Identificar bloqueos, esperas y necesidad de intervención |
| Flujo visual | Mapas de arquitectura y recorrido por mensaje | Revisar los pasos registrados, sus decisiones y el resultado |
| Pruebas y revisión | Contactos de prueba, respuesta rápida y modos de revisión | Probar el comportamiento y observar los controles de respuesta |
| Conocimiento y reglas | Configuración del proyecto y políticas comerciales | Administrar la información que puede utilizar el bot |

Las dos últimas áreas se muestran a administradores. El acceso a las rutas y a los datos también depende de los permisos del usuario y de la organización. La API de ejecuciones exige controles adicionales de administración.

### Monitoreo y atención de leads

El tablero permite filtrar por proyecto, fechas, origen, etapa comercial, temperatura, asesor, traspaso, estado del bot y SLA, además de buscar leads. Conserva los filtros en la URL y presenta 25 registros por página. Los indicadores resumen el período y proyecto seleccionados.

El detalle del lead reúne mensajes, eventos de puntuación, temperatura, etapa, unidades de interés, visitas, seguimientos y escalaciones. La cola de atención humana distingue solicitudes que requieren atención y las asignadas al asesor actual. Las citas tienen una bandeja especializada para conservar su coordinación y confirmación.

La etapa comercial, la temperatura y el seguimiento son estados distintos: un lead puede estar en oportunidad, tener temperatura tibia y mantener una tarea de seguimiento. El estado físico de la obra y la etapa comercial del proyecto se configuran por separado.

### Conocimiento y reglas comerciales

La administración permite configurar guion, tono, ubicación, estado del proyecto, lugares visitables, materiales, precios, financiamiento, descuentos, horarios, SLA y puntuación. El centro de conocimiento organiza proyecto, catálogo, políticas, conversación y operación, con acciones de borrador, publicación y pausa de políticas.

Los precios se administran por unidad. Su presentación depende de la disponibilidad, publicación y política comercial: la visibilidad referencial en lanzamiento es configurable. Los hechos sobre el sector requieren verificación y autorización para su uso. La fecha de entrega conserva su nivel de certeza; el bot debe respetar los datos autorizados del proyecto.

## Cómo funciona la automatización

El ejecutor propio está implementado en Next.js, con persistencia y funciones SQL en Supabase. Kommo recibe los mensajes de WhatsApp y lanza Salesbot para las respuestas. El código del ejecutor en vivo exige `AUTOMATION_N8N_DISABLED=true`, además de las condiciones de activación; la ejecución descrita corresponde al motor de la aplicación.

1. **Recepción.** El webhook identifica el contacto y registra el mensaje y el evento de entrada. Detecta duplicados y conserva el orden de recepción.
2. **Programación.** La cola persistente agrupa mensajes pendientes del contacto. Un Workflow durable despierta la conversación; el cron sirve como mecanismo de mantenimiento y recuperación.
3. **Permisos.** Se comprueban activación, modo de ejecución, restricciones de prueba, ventana de conversación, estado del bot, rechazo de comunicaciones y actividad del asesor.
4. **Contexto e interpretación.** Se consulta historial, pregunta pendiente, preferencias, catálogo y configuración. El extractor identifica intención, datos, restricciones y solicitudes, con controles sobre la evidencia del mensaje actual.
5. **Ruta de negocio.** Se atiende la consulta comercial, selección de unidad, visita, financiamiento, reserva o solicitud de asesor según el contexto y los permisos.
6. **Respuesta y validación.** El redactor prepara la respuesta. La revisión y sus posibles reparaciones dependen del modo configurado; los controles del servidor mantienen sus responsabilidades específicas.
7. **Envío y continuidad.** Se escribe la respuesta en Kommo y se solicita Salesbot. Se registra el resultado, se actualiza la memoria según el flujo y se programan tareas elegibles.

La agrupación normal usa una demora de 30 segundos, que puede desplazarse cuando llegan nuevos mensajes. Ese valor no es una garantía de tiempo total de respuesta: también intervienen cola, inferencia, validación y transporte.

### Catálogo y continuidad comercial

El bot consulta unidades y precios autorizados, conserva las opciones presentadas y distingue una consulta de una selección explícita. Si una característica solicitada no existe, puede proponer alternativas reales cuando la necesidad admite ajustes, y debe obtener aceptación antes de sustituir la búsqueda.

El recorrido residencial progresa por tipo de inmueble, plantas disponibles y unidades identificadas. Conserva datos ya conocidos y un presupuesto pospuesto. Puede responder precios, dimensiones y comparaciones de opciones anteriores sin reiniciar automáticamente la búsqueda. El brochure y los enlaces de tour dependen del pedido y de la referencia de unidad; una referencia ambigua requiere aclaración.

### Citas y visitas

El motor recopila fecha, hora y destino, valida horarios y distingue agendar, reagendar y cancelar. La preferencia del lead inicia una coordinación con el asesor; la confirmación requiere completar el flujo correspondiente. Los destinos deben estar autorizados según el estado del proyecto. Solicitar atención de un asesor no concede por sí solo permiso para coordinar una visita.

La implementación incluye recordatorios y control del asesor responsable. Una cita confirmada se integra con la puntuación y la asignación del lead. El flujo diferencia visitar la oficina situada en el proyecto de visitar un edificio o unidad terminados.

### Financiamiento y reservas

La orientación financiera contempla entidades habilitadas, como JEP y Banco Pichincha, y recopilación progresiva de datos. Elegir un banco conserva una preferencia; iniciar la revisión financiera requiere consentimiento. La entidad se vuelve a comprobar durante la captura y antes del traspaso. Una entidad desactivada no debe recibir una nueva derivación por un expediente antiguo.

El presupuesto total y el capital inicial se mantienen separados. El flujo prepara información para revisión; no garantiza aprobación crediticia. Una solicitud de reserva genera una intervención del asesor y su recibo operativo: **no bloquea inventario ni constituye una reserva contractual**.

### Seguimiento y control humano

Las tareas de nutrición dependen de políticas del proyecto, consentimiento, estado comercial, actividad del asesor y condiciones de entrega. La elegibilidad se comprueba nuevamente al ejecutar una tarea. Un nuevo mensaje, una coordinación activa o una entrega incierta pueden cancelar o impedir el seguimiento.

El código incluye pasos de 24 horas y días 7, 14 y 21. Su disponibilidad efectiva requiere activación y plantillas aprobadas; la existencia de una tarea no garantiza que se envíe.

La respuesta manual del asesor, el control `DETENER IA` y un rechazo global de comunicaciones detienen la automatización según sus reglas. La asignación de un asesor, por sí sola, no equivale a una respuesta manual. El seguimiento de recuperación comercial a los días 30 y 60 permanece como una funcionalidad planificada, distinta de la recuperación técnica de fallos del worker.

### Flujo visual y diagnóstico por mensaje

Los mapas muestran el recorrido general, pausas de IA, citas, financiamiento y nutrición. La vista por mensaje permite consultar los pasos registrados, el contexto utilizado, las unidades recuperadas, las causas de decisiones, los borradores, las revisiones, los modelos, los tiempos y el uso de tokens cuando están disponibles.

Los costos son estimaciones calculadas a partir del uso registrado y las tarifas del panel. La vista no reconstruye datos o razones ausentes de una ejecución anterior y no modifica ejecuciones pasadas. La trazabilidad ayuda a localizar el origen de un problema de contexto, interpretación, revisión o entrega.

## Cambios comprobados en el historial

Los siguientes hitos registran a Carlos como autor en Git. El proyecto también incluye contribuciones de otros integrantes en integraciones compartidas; la tabla delimita los cambios revisados de automatización.

| Fecha | Commit | Cambio incorporado |
| --- | --- | --- |
| 08 septiembre | `5ed5dc0` | Panel de leads, indicadores, detalle, reglas y guion; migraciones de agenda y coordinación |
| 09 septiembre | `0e09859` | Motor en la aplicación con webhook, worker, conversación, IA, visitas e integración Kommo |
| 15 a 18 septiembre | `5904dd9`, `473877e`, `f14f579` | Controles de bloqueos, continuidad, registro de visitas y recordatorios |
| 21 septiembre | `c8142ec` | Control de leads, cola de asesores, Workflow, trazas, alternativas y tours por unidad |
| 22 a 23 septiembre | `c1149bb`, `0e5a39f` | Motor conversacional compartido y ampliación de diagnóstico de borradores |
| 06 octubre | `520b231` | Compactación del extractor y correcciones de brochure y solicitud de reserva |
| 07 octubre | `b2db65a` | Extractor mini, controles de evidencia y consentimiento, bancos activos y confiabilidad de transporte |
| 07 octubre | `1bbf599` | Ayudas en ajustes y mejoras de exploración y continuidad comercial |
| 07 octubre | `5c581e3`, `0adbe80` | Demostración de revisión restringida a contactos de prueba y validación de interpretación previa |

### Ejemplos de correcciones

| Situación | Riesgo anterior identificado | Comportamiento incorporado |
| --- | --- | --- |
| Familia de seis personas | Convertir personas en seis dormitorios | Separar contexto familiar y requisito de dormitorios |
| Al menos dos dormitorios | Guardar exactamente dos | Conservar mínimo, máximo o intervalo respaldado |
| Pregunta sobre opciones ofrecidas | Recuperar un filtro antiguo y reiniciar la búsqueda | Mantener la referencia y el objetivo actual del turno |
| Elegir JEP | Iniciar revisión financiera sin autorización | Conservar elección y comprobar consentimiento aparte |
| Aceptar alternativas | Interpretar un sí comercial como visita | Vincular la aceptación a la pregunta realmente entregada |
| Presupuesto y entrada | Mezclar capital inicial y precio total | Validar el importe y su función antes de persistirlo |
| Pedir reserva | Activar visita o asesor adicional sin evidencia | Validar cada solicitud independiente y registrar su acción |
| Envío incierto | Reintentar y generar duplicados | Bloquear envíos relacionados y exigir conciliación con evidencia |

### Modelos y modos de revisión

El valor predeterminado del extractor pasó de `gpt-4.1` a `gpt-4.1-mini`. El redactor permanece en `gpt-4.1-mini`, el revisor en `gpt-5-mini` y el clasificador de alcance en `gpt-4o-mini`. Son valores del código: las variables de entorno pueden reemplazarlos por función. El cambio permite evaluar un extractor de menor costo sin cambiar simultáneamente el redactor; el ahorro de toda la conversación requiere medición propia.

| Modo | Comportamiento |
| --- | --- |
| Revisión normal | Puede evaluar, rechazar o reparar la propuesta según el flujo y las reglas |
| Revisión general desactivada | Omite al revisor; conserva los controles obligatorios y permisos aplicables del servidor |
| Demostración con observación | Para contactos de prueba inscritos válidamente, registra observaciones sin bloquear ni reparar el borrador por esos hallazgos |

El modo demostración requiere inscripción inequívoca del contacto. La interpretación, el enrutamiento, los permisos y el transporte todavía pueden detener el flujo. No se debe presentar una respuesta observada como si hubiese aprobado la revisión normal.

## Pruebas revisadas y resultados

La ejecución de esta revisión usó el runner de Node, el cargador TypeScript del proyecto, respuestas simuladas y bases PGlite locales. Se ejecutaron los 129 archivos del manifiesto previo y un complemento de seis archivos nuevos. Los grupos son disjuntos; se contaron los archivos una sola vez.

| Comprobación de esta revisión | Resultado |
| --- | --- |
| Grupo del manifiesto de 129 archivos | 1.679 aprobadas de 1.679; 32 suites; 30,515 segundos |
| Complemento de 6 archivos | 120 aprobadas de 120; 2,555 segundos |
| Total de los grupos disjuntos | **1.799 aprobadas en 135 archivos únicos** |
| Fallos, canceladas, omitidas y pendientes | **0** en ambos grupos |
| TypeScript sin emisión ni caché incremental | Código de salida 0, sin errores |
| Comprobación de espacios con Git | Código de salida 0 |

Las duraciones son de las ejecuciones locales de pruebas, no de conversaciones con clientes. El entorno utilizó Node `22.19.0`, mientras que el proyecto declara `24.x`; la validación del entorno de publicación sigue siendo necesaria.

### Cobertura funcional comprobada

| Grupo de pruebas | Qué comprueba |
| --- | --- |
| Conversación y continuidad | Perfil, saludo, preguntas pendientes, referencias y cambios de tema |
| Catálogo y selección | Dormitorios, plantas, precios, categorías, alternativas, comparación y tours |
| Intención y consentimiento | Solicitudes reales, negaciones, citas de terceros y límites de acciones |
| Financiamiento | Captura progresiva, entidades habilitadas y separación entre elección y permiso |
| Redacción y revisión | Evidencia numérica, hechos, obligaciones, reparación y modos de revisión |
| Transporte y SQL | Orden, exclusión entre conversaciones, admisión Kommo y entrega incierta |
| Workflow y costos | Construcción de trazas, explicación de mensajes y cálculo de uso registrado |
| Configuración y reservas | Hechos autorizados del sector, ajustes, acciones y recibos operativos |

El repositorio también conserva una evaluación histórica del extractor del 7 de octubre: **108 reproducciones aprobadas sobre 48 escenarios** después de los controles y **12 inferencias reales aprobadas** en el reensayo final. Son resultados anteriores, separados de las 1.799 pruebas locales de esta revisión. En las 108 salidas originales, 68 cumplían el contrato y 40 necesitaban ajustes o recuperación; el resultado final no implica que el extractor acertara siempre sin controles.

La ejecución actual no consumió créditos del modelo ni realizó envíos a leads. No valida la entrega real de WhatsApp, reconocimiento de audio, interfaz completa en navegador, build de producción ni funciones remotas aplicadas. La evidencia y los comandos reproducibles quedan en [evidencia de esta revisión](evidencia-presentacion-2026-10-07.json).

La cobertura descrita es funcional por casos y aserciones; no se calculó un porcentaje de cobertura de líneas o ramas. Los 135 archivos seleccionados tampoco representan todas las pruebas del repositorio.

## Estado y pendientes operativos

El módulo y sus correcciones están presentes en el commit analizado. La configuración de ejecución debe habilitar el motor, salir de simulación y conservar un alcance operativo autorizado. Las funcionalidades configurables pueden permanecer apagadas aunque su código exista.

Las migraciones nuevas de transporte y entidades financieras deben verificarse en Supabase antes de publicar código que dependa de ellas: `20261006220000_transport_reliability.sql` y `20261007013000_financing_active_lender_intake.sql`, en ese orden y sobre un esquema compatible.

Kommo puede aceptar el lanzamiento de Salesbot sin confirmar entrega ni lectura en WhatsApp. Sigue siendo necesario verificar cuándo Salesbot lee el campo compartido de respuesta y comprobar la entrega observada. El despliegue, las plantillas aprobadas, los permisos y las entidades activas determinan el funcionamiento real de las integraciones.

Los próximos pasos operativos son verificar las migraciones y el modelo efectivo del despliegue, ejecutar una conversación con un contacto autorizado y registrar el resultado de entrega. La recuperación comercial de días 30 y 60 debe implementarse y validarse antes de presentarla como disponible.

## Guion para presentar el trabajo

### Exposición breve

"Implementé la sección de automatización para reunir la atención comercial de WhatsApp y el control de los leads. El módulo tiene un tablero para revisar indicadores, conversaciones y prioridades, una bandeja para coordinar la intervención de asesores y un flujo visual para entender qué ocurrió con cada mensaje.

El motor recibe mensajes desde Kommo, conserva el contexto, identifica lo que solicita el cliente y selecciona el flujo correspondiente. Puede consultar el catálogo, explicar precios autorizados, presentar alternativas, coordinar visitas y recopilar información financiera con consentimiento. Las reservas se derivan al asesor con registro de la solicitud.

Una parte importante del trabajo fue corregir la continuidad: conservar opciones ya ofrecidas, separar personas de dormitorios, distinguir presupuesto de entrada y evitar que una aceptación comercial autorice una visita o trámite financiero. También añadí controles de orden y entrega para reducir riesgos de mensajes duplicados.

Para supervisar el comportamiento incorporé trazas por mensaje, revisión de respuestas y contactos de prueba. La validación local de esta revisión aprobó 1.799 pruebas en 135 archivos únicos y TypeScript no reportó errores. El código está versionado; el funcionamiento final en producción depende de las migraciones, la configuración y la comprobación de entrega real."

### Recorrido sugerido para la demostración

1. Abrir Monitoreo y explicar los indicadores, filtros y prioridad de atención.
2. Abrir un lead de prueba autorizado y mostrar historial, temperatura, etapa y tareas.
3. Mostrar Conocimiento y reglas para explicar de dónde obtiene el bot sus datos.
4. Revisar una ejecución en Flujo visual y señalar interpretación, catálogo, redacción, revisión y resultado.
5. Explicar los tres modos de revisión y usar un contacto inscrito si se demuestra observación.
6. Cerrar con los resultados de pruebas y los pendientes concretos de publicación y entrega.

Para una exposición sin servicios conectados, los mapas de arquitectura y los resultados guardados permiten explicar el flujo. Una ejecución ausente o sin trazas no debe presentarse como evidencia de una conversación real.

## Referencias del proyecto

- [Pestañas y roles de la sección](../../src/components/inmobiliaria/automation/AutomationSectionTabs.tsx), [página de monitoreo](../../src/app/inmobiliaria/automatizacion/page.tsx) y [centro de conocimiento](../../src/components/inmobiliaria/automation/KnowledgeCenter.tsx).
- [Webhook](../../src/lib/integrations/automation/webhook.ts), [worker](../../src/lib/integrations/automation/worker.ts), [Workflow de conversación](../../src/lib/integrations/automation/conversation-workflow.ts) y [orquestador de conversación](../../src/lib/integrations/automation/conversation.ts).
- [Recorrido comercial](../../src/lib/integrations/automation/commercial-journey.ts), [interpretación del turno](../../src/lib/integrations/automation/turn-interpretation.ts) y [recopilación financiera](../../src/lib/integrations/automation/financing-intake.ts).
- [Modelos por función](../../src/lib/integrations/automation/ai-model-routing.ts), [política de revisión](../../src/lib/integrations/automation/response-review-policy.ts) y [alcance de contactos de prueba](../../src/lib/integrations/automation/response-review-settings.ts).
- [Cambio del extractor y evidencia histórica](cambio-extractor-mini-2026-10-07.md), [diagnóstico y continuidad](11-cambios-trazabilidad-y-continuidad.md) y [scripts de pruebas](../../package.json).
- [Migración de transporte](../../supabase/migrations/20261006220000_transport_reliability.sql) y [migración de entidades financieras activas](../../supabase/migrations/20261007013000_financing_active_lender_intake.sql).

Los documentos de septiembre conservan su valor histórico. Sus etiquetas de cambios locales pendientes deben leerse con la fecha del documento; este informe describe el código del 7 de octubre y separa ese estado de la verificación productiva.
