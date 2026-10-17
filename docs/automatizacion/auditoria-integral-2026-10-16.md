# Auditoría de la automatización de La Vilet

**Actualización documental del 17 de octubre de 2026:** la [sección 12](#12-ampliación-de-hallazgos-del-17-de-octubre-de-2026) reúne los patrones de fallo encontrados después del corte original. Sus correcciones y límites se detallan en la [ampliación del informe de correcciones](./informe-correcciones-auditoria-2026-10-16.md#9-correcciones-posteriores-del-16-y-17-de-octubre-de-2026). Los 20 hallazgos, la versión y las cifras del 16 de octubre que siguen conservan su carácter histórico.

**Fecha:** 16 de octubre de 2026. **Versión revisada y publicada:** `36ecc00b19b8c3407f63bbd2836ea5cf93971be0`. **Corte de consultas operativas:** 12:17, hora de Bogotá/Guayaquil. Las horas de las conversaciones de este informe usan esa misma zona horaria.

**Resultado:** la pregunta repetida sobre tres dormitorios tiene una causa reproducible en el código actual. Una aclaración anterior borró la unidad elegida y la alternativa aceptada; después, el plan recuperó la necesidad antigua de cinco dormitorios y ordenó volver a preguntar por tres. Las correcciones anteriores cubrieron otras continuaciones, pero dejaron abierta esta ruta.

La revisión registra **20 hallazgos de distinta naturaleza**: 16 problemas actuales comprobados por fuentes, trazas o reproducciones; una observación operativa cuya causa requiere acceso administrativo; dos ambigüedades de instrucciones; y un riesgo estructural. No son 20 mensajes equivocados observados ni 20 causas nuevas independientes del inventario anterior. El detalle distingue expresamente evidencia, riesgo y límites.

Esta fue una auditoría de lectura. **No se modificaron el bot, la configuración, las funciones SQL ni los datos comerciales; no se enviaron mensajes, no se ejecutaron trabajadores productivos ni se llamaron modelos.** Solo se generaron este informe y sus anexos de auditoría. La IA revisora sigue desactivada para todos los leads.

## 1. Qué se examinó y cómo interpretar los resultados

Se revisaron la recepción de mensajes, activación por audiencia, interpretación, memoria, plan comercial, instrucciones del redactor, alcance del revisor, transporte, recuperación de fallos, reservas, asignación, alertas, citas, seguimientos, showroom, análisis y actualización de la interfaz. Se contrastaron fuentes actuales con registros productivos acotados y se ejecutaron pruebas locales aisladas.

Se utilizaron cuatro tipos de evidencia:

| Evidencia | Qué permite concluir | Qué no demuestra |
| --- | --- | --- |
| Trazas de una conversación real | Qué recibió cada componente, qué decidió y qué respuesta produjo esa versión. | Que otra versión posterior tenga exactamente el mismo comportamiento. |
| Reproducción con funciones actuales | Que una transición o decisión sigue siendo posible con el código revisado. | Que se haya enviado un mensaje nuevo a un cliente. |
| Consulta operativa de lectura | Configuración, registros y errores disponibles en el momento del corte. | Definiciones privadas de funciones SQL, estado del cron o funcionamiento de una sesión de asesor que no se inspeccionó. |
| Pruebas automatizadas con simulaciones | Contratos, cálculos, transacciones y comportamiento de las funciones bajo esas entradas. | Naturalidad o cumplimiento del modelo real cuando se sustituye la IA por una respuesta simulada. |

No se hizo una auditoría de seguridad integral, una prueba visual con una sesión autenticada del asesor, una campaña de simulaciones con modelos ni una certificación de todos los contactos históricos. Las consultas productivas realizadas fueron de lectura; las pruebas locales bloquearon red y retiraron credenciales. No se reproducen teléfonos, documentos ni el contenido completo de prompts privados en este informe.

Las prioridades se interpretan así: **P1**, continuidad comercial, operación o validación que debe resolverse primero; **P2**, inconsistencia funcional o de experiencia; **P3**, alineación de instrucciones sin fallo concreto demostrado.

## 2. Qué pasó con la reserva del 605

Referencia del caso: lead de Kommo **4454162**. La solicitud es una **solicitud de inicio de reserva**, no una reserva confirmada ni una venta.

| Hora | Hecho comprobado | Efecto |
| --- | --- | --- |
| 00:49 | Se registra la solicitud de reserva del penthouse 605, inicialmente en cola. | Ya existe una gestión comercial que debe conservarse. |
| 09:15 | El cliente pregunta qué pasó porque no le han confirmado nada y dice «fue un error». | El extractor identifica seguimiento de una gestión, pero la clasificación general termina en `scope_clarification`. |
| Después de esa respuesta | El redactor aún había recibido el 605 y la aceptación de tres dormitorios. Al guardar el turno, `rememberPropertyReply()` vacía selección, referencias y estado de exploración por esa clasificación. | Se pierde una parte de la memoria, aunque otro bloque sigue indicando el 605. |
| 09:19 | El cliente aclara que el error era su mensaje anterior y que sigue esperando al asesor. | El extractor lo entiende como respuesta a la aclaración, incluso registra que no se debe reiniciar la búsqueda. |
| 09:20 | El plan encuentra `selected_ids=[]`, recupera el requisito antiguo de cinco dormitorios y elige `clarify_requirements`. | Ordena al redactor proponer otra vez tres dormitorios. El redactor mezcla el seguimiento de la reserva con esa pregunta incorrecta. |
| 09:35 | Los registros consultados muestran asignación al asesor Carlos y creación de la notificación. | Esto ocurre después de la captura de las 09:20; no demuestra que ya existiera una alerta a esa hora ni que el asesor la hubiera leído. |

La contradicción del turno quedó distribuida en varios bloques:

| Bloque | Estado que recibió o conservaba |
| --- | --- |
| Recorrido comercial anterior | Operación en curso y unidad 605. |
| Contexto de inmuebles | Sin selección y sin la alternativa de tres dormitorios aceptada. |
| Memoria histórica de requisitos | Cinco dormitorios. |
| Nuevo siguiente paso comercial | Pedir aceptación de tres dormitorios. |
| Mensaje actual del cliente | Seguimiento porque nadie se comunica con él. |

**El redactor no inventó por sí solo ese siguiente paso: el plan se lo indicó.** Por eso añadir otra frase al prompt, como «no repita preguntas», no resuelve la causa.

### ¿No se había corregido antes?

Se había protegido la selección en consultas informativas y algunas respuestas a preguntas anteriores. También se había retirado la intervención del código sobre la prosa del redactor. **Eso no cubría el borrado posterior por `scope_clarification`.**

La respuesta de la captura se generó con `2d0149161907b19db0682c3f9dc2fbe6671d0236`, anterior al despliegue `36ecc00`. Sin embargo, la rama destructiva permanece en [property-context.ts](../../src/lib/integrations/automation/property-context.ts), líneas 1097–1098, y se reprodujo con el código actual:

```text
Antes: unidad elegida = 605; alternativa aceptada = 3 dormitorios.
Aclaración de alcance: se vacía el contexto de inmuebles.
Después: no hay selección ni alternativa aceptada en ese bloque.
Consulta comercial: reaparecen los 5 dormitorios históricos.
Plan: preguntar si acepta una alternativa de 3 dormitorios.
```

La corrección necesaria es conservar decisiones del cliente, incorporar la solicitud de reserva vigente en un contexto operativo compartido y dar prioridad a esa gestión. Una duda, disculpa o tema ajeno puede suspender la búsqueda; no debe revocar elecciones sin una declaración del cliente.

En ese momento, una respuesta coherente habría sido, **como ejemplo y no como plantilla obligatoria**:

> Entendido. Se refiere al mensaje anterior; su solicitud para iniciar la reserva del penthouse 605 sigue registrada. Aún está pendiente la atención del equipo.

Solo se puede afirmar que se avisó, asignó o contactó a alguien si el registro de esa acción lo respalda. No corresponde volver a preguntar dormitorios.

## 3. Hallazgos actuales

Los identificadores siguientes agrupan causas. Un mismo incidente puede depender de varios hallazgos; no se suman como incidentes independientes.

| ID | Prioridad | Hallazgo | Naturaleza |
| --- | --- | --- | --- |
| A-01 | P1 | Una aclaración borra selección y alternativas aceptadas. | Actual, reproducido. |
| A-02 | P1 | Plan, redactor y revisor no comparten siempre la operación vigente. | Actual, comprobado en la traza. |
| A-03 | P2 | Primera consulta de información se confunde con primera bienvenida. | Conflicto de instrucciones y respuesta observada. |
| A-04 | P2 | La apertura prohíbe y exige categorías simultáneamente. | Conflicto de instrucciones activo. |
| A-05 | P3 | El objetivo del brochure conserva formulaciones generales ambiguas. | Riesgo de alineación; no fallo nuevo reproducido. |
| A-06 | P2 | Algunos prompts atribuyen al revisor funciones que su autoridad actual excluye. | Riesgo de alineación; revisor apagado. |
| A-07 | P1 | No aparece un ciclo reciente de mantenimiento global. | Observación productiva; causa por verificar. |
| A-08 | P1 | Dos estructuras del embudo no están disponibles en la API productiva. | Error productivo comprobado. |
| A-09 | P1 | El aviso de recuperación depende de que funcione la derivación. | Riesgo estructural con antecedente real. |
| A-10 | P1 | Los seguimientos pueden reabrir presupuesto o crédito rechazado/pospuesto. | Actual, reproducido. |
| A-11 | P1 | La fecha acordada de retoma no gobierna los seguimientos. | Actual, reproducido y rastreado. |
| A-12 | P2 | Algunos seguimientos llaman departamento a un penthouse. | Actual, reproducido. |
| A-13 | P1 | El enriquecimiento del showroom convierte navegación en preferencias. | Ruta actual alcanzable. |
| A-14 | P2 | Quedan comparaciones literales del mensaje en rutas de citas. | Residuo actual fuera del redactor principal. |
| A-15 | P2 | El análisis reemplaza un rechazo explícito reciente por «no caído». | Actual, reproducido. |
| A-16 | P2 | El análisis omite errores técnicos con estado `cancelled`. | Consulta actual e incidente omitido comprobados. |
| A-17 | P2 | El embudo aún entra en carga bloqueante cada 30 segundos. | Comportamiento del código actual. |
| A-18 | P1 | La batería general no está aprobada y mezcla contratos antiguos y nuevos. | Verificación actual. |
| A-19 | P2 | El ensamblado reincorpora catálogo excluido y contradice su instrumentación. | Actual, reproducido; volumen adicional medido. |
| A-20 | P1 | El consentimiento financiero depende del vocabulario de la invitación. | Actual, falso negativo reproducido. |

### A-01. Borrado de memoria durante aclaraciones

**Evidencia:** `rememberPropertyReply()` devuelve un contexto vacío para `business_out_of_scope`, `vehicle_out_of_scope` y `scope_clarification`, en [property-context.ts](../../src/lib/integrations/automation/property-context.ts), líneas 1097–1098. La reproducción actual elimina el 605 y los tres dormitorios aceptados.

**Qué provoca:** requisitos antiguos vuelven a parecer pendientes. Cambiar de tema o pedir una aclaración puede destruir decisiones válidas.

**Corrección propuesta:** separar contexto suspendido de contexto revocado; conservar selección, aceptación y procedencia salvo reemplazo o desistimiento explícitos. Probar reserva → espera de asesor → aclaración y tema ajeno → regreso a la gestión.

### A-02. Operación comercial fragmentada

**Evidencia:** en el turno de las 09:20, el recorrido comercial conservaba el 605, `property_context` estaba vacío y el contexto operativo de revisión tenía `reserva:null`. [commercial-journey.ts](../../src/lib/integrations/automation/commercial-journey.ts), desde `purchaseReadiness()` en la línea 123, calcula la preparación desde el contexto de inmuebles sin resolver esa discrepancia con la solicitud vigente.

**Qué provoca:** un componente conoce la reserva mientras otro planifica como si el cliente siguiera buscando. El revisor histórico señaló falta de respaldo de hechos verdaderos porque no recibió las fuentes pertinentes.

**Corrección propuesta:** proporcionar a todos los componentes una proyección común con unidad elegida, solicitud vigente, estado, asignación y acciones verificadas. Resolver contradicciones con evidencia de decisiones y registros, sin analizar ni alterar la prosa del redactor.

### A-03. Saludo repetido

**Evidencia:** la respuesta generada para la consulta de suites tenía historial con la bienvenida anterior y `saludo.requerido=false`; aun así comenzó con «Buenos días». No hubo transformación posterior del texto. El mensaje enviado manualmente a las 11:38 reutilizó ese borrador; no fue una nueva generación a esa hora.

[conversationTone.ts](../../src/lib/inmobiliaria/conversationTone.ts), línea 17, pide acompañar el saludo en «la primera solicitud de información». [conversation-tone.ts](../../src/lib/integrations/automation/conversation-tone.ts) pide no volver a saludar por una duda intermedia; [ai.ts](../../src/lib/integrations/automation/ai.ts), línea 46, añade instrucciones generales de saludo al redactor. La prueba `warm-opening-preservation.test.ts`, línea 86, exige conservar parte de esa instrucción ambigua.

**Límite:** no se puede conocer el razonamiento interno exacto del modelo. Sí se comprobó el resultado y la ambigüedad de instrucciones que lo favorece.

**Corrección propuesta:** distinguir bienvenida de la conversación, primera consulta sustantiva y continuación. Ningún bloque de tono debe sugerir una nueva bienvenida cuando el turno es continuación. Evaluar secuencias reales, sin exigir una frase fija.

### A-04. Presentación inicial contradictoria

**Evidencia:** [dialogue-writing-rules.ts](../../src/lib/integrations/automation/dialogue-writing-rules.ts), línea 8, prohíbe tipos y usos cuando `generic_introduction=true`. [response-plan.ts](../../src/lib/integrations/automation/response-plan.ts), líneas 191 y 271, y [turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts), alrededor de la línea 430, permiten y exigen las categorías del resumen inicial aprobado. Las instrucciones se componen en la misma solicitud.

**Qué provoca:** el redactor recibe dos objetivos incompatibles para una apertura general y puede omitir la presentación autorizada o introducirla pese a la prohibición.

**Corrección propuesta:** una sola decisión de presentación. La restricción de categorías debe depender de `presentacion_sin_tipos=true`, sin prohibir de forma universal el resumen aprobado.

### A-05. Vínculo entre brochure y datos

**Evidencia:** [lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts), línea 472, conecta correctamente el ofrecimiento con nombre y residencia, preservando las excepciones de entrega. [response-plan.ts](../../src/lib/integrations/automation/response-plan.ts), línea 190, conserva la formulación general «no existe una justificación obligatoria» y «la entrega autorizada [...] no queda condicionada».

**Evaluación:** las excepciones son intencionadas y deben conservarse. La redacción general puede diluir la secuencia inicial; no se demostró una nueva entrega incorrecta causada por esa frase en esta auditoría.

**Corrección propuesta:** expresar una secuencia clara: ofrecer y vincular los datos pendientes cuando corresponde; entregar sin esa espera cuando el estado autoriza una excepción. Mantener libertad de palabras y no volver obligatoria una justificación literal.

### A-06. Alcance del revisor descrito de formas distintas

**Evidencia:** [reviewer-authority.ts](../../src/lib/integrations/automation/reviewer-authority.ts), línea 4, y [writer-content-review.ts](../../src/lib/integrations/automation/writer-content-review.ts), línea 37, limitan la revisión a hechos afirmados y promesas comerciales. Excluyen continuidad, preguntas, omisiones, estilo y siguiente paso. En cambio, [response-content-scope.ts](../../src/lib/integrations/automation/response-content-scope.ts), línea 16, y [lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts), líneas 471 y 474, todavía atribuyen al revisor pertinencia y captura de datos.

**Qué significa:** activar el revisor actual **no resolvería por diseño** la pregunta repetida de tres dormitorios. Ahora está apagado para todos, por lo que este residuo no demuestra un bloqueo actual.

**Corrección propuesta:** alinear todas las instrucciones con las responsabilidades acordadas. La evaluación de continuidad puede incorporarse a una auditoría de conversaciones independiente y posterior; no implica reactivar el revisor de envío ni devolver al código la facultad de juzgar la prosa.

### A-07. Mantenimiento global sin registro reciente

**Evidencia:** al corte del 16/10 a las 12:17, el último evento de mantenimiento registrado terminaba el **15/10 a las 11:50:02**. No apareció otro en más de 24 horas. [vercel.json](../../vercel.json) contiene cron de Meta, no el ciclo global de automatización. La migración [20260910041000_automation_cloud_scheduler.sql](../../supabase/migrations/20260910041000_automation_cloud_scheduler.sql) define el planificador de Supabase y requiere verificar su activación y ejecución.

**Impacto potencial:** pueden seguir funcionando las respuestas disparadas por webhooks mientras no avanzan tareas de seguimiento, recordatorios, showroom, análisis o recuperación que dependen del mantenimiento.

**Límites:** la conexión disponible no permite consultar `cron.job` ni los registros privados del planificador. No se confirmó si está desactivado, falla la llamada o existe otro problema. Había un contacto de showroom programado para las 11:59 que seguía `scheduled` a las 12:17; tampoco se comprobó que fuera elegible para envío, porque podría cancelarse por una conversación ya iniciada.

**Corrección propuesta:** inspección administrativa de cron, ejecuciones y errores; alertar por ausencia de ciclos. Antes de reactivarlo, comprobar la audiencia y vencimiento de tareas para evitar envíos atrasados. No ejecutar un trabajador real solo para probar.

### A-08. Ficha e historial del embudo no disponibles

**Evidencia:** las consultas productivas a `lead_commercial_profiles` y `lead_commercial_stage_observations` devolvieron **PGRST205**, tablas no disponibles en la caché del esquema.

**Qué provoca:** la ficha guardada y su historial pueden verse incompletos. Es el origen comprobado de los avisos sobre esas secciones; no demuestra ausencia de leads ni de solicitudes.

**Corrección propuesta:** comprobar la aplicación de [20261015210000_lead_commercial_pipeline.sql](../../supabase/migrations/20261015210000_lead_commercial_pipeline.sql), la existencia y permisos de las tablas y el refresco del esquema de la API. El error por sí solo no distingue migración pendiente de caché sin actualizar. No ejecutar migraciones anteriores de nuevo sin contrastar su registro.

### A-09. Recuperación dependiente de una función que también puede fallar

**Evidencia:** [generation-recovery.ts](../../src/lib/integrations/automation/generation-recovery.ts), líneas 163–182, intenta la derivación antes del aviso al cliente y comparte un bloque de error exterior. En el caso de suites, el rechazo falso del borrador fue seguido por un error `42P10` de esa derivación y tampoco salió el aviso de recuperación.

**Estado:** el SQL específico de `42P10` tiene parche en el repositorio; su aplicación productiva no pudo confirmarse. Aunque esté aplicado, otro fallo de esa función conserva el mismo riesgo estructural.

**Corrección propuesta:** registrar y supervisar la recuperación aunque la derivación falle; permitir reintentos de operaciones verificables y un aviso veraz cuando proceda, sin afirmar una asignación que no ocurrió. Conservar deduplicación y la prohibición de repetir envíos de resultado desconocido.

### A-10. Seguimientos que reabren asuntos rechazados o pospuestos

**Evidencia:** reproducciones actuales de [nutrition-context.ts](../../src/lib/integrations/automation/nutrition-context.ts), [nutrition-week-one-rules.ts](../../src/lib/integrations/automation/nutrition-week-one-rules.ts) y [nutrition-later-rules.ts](../../src/lib/integrations/automation/nutrition-later-rules.ts):

| Mensaje/contexto | Decisión reproducida |
| --- | --- |
| «El presupuesto lo veré después; por ahora solo quiero conocer el proyecto». | Propone ayudar a definir presupuesto. |
| «No quiero financiamiento, solo información». | La ruta de 24 horas selecciona financiamiento. |
| «No quiero crédito, solo conocer el proyecto». | La ruta de siete días selecciona `financing_options`. |

**Alcance:** 24 horas está desactivado, pero siete días está habilitado. La elección del tema usa palabras y no respeta de forma común el modo informativo y las negativas. No se afirmó que esos ejemplos se enviaran realmente; quedan otros controles previos al envío.

**Corrección propuesta:** aplicar al seguimiento el estado e intención persistentes, temas rechazados y preguntas ya resueltas. Una palabra negada no autoriza un ofrecimiento. La redacción debe responder al objetivo permitido, sin plantillas comerciales impuestas por coincidencias léxicas.

### A-11. Nutrición comercial y fecha de retoma desconectadas del envío

**Evidencia:** [lead-nurture-state.ts](../../src/lib/integrations/automation/lead-nurture-state.ts), línea 24, conserva `resume_at`. Los criterios de [nutrition-context.ts](../../src/lib/integrations/automation/nutrition-context.ts), líneas 41–46, y las rutas de siete, catorce y veintiún días no utilizan esa fecha ni el acuerdo de contacto de nutrición para gobernar su calendario. Una prueba del criterio de elegibilidad mantiene apto al contacto pese a una fecha futura acordada; no se ejecutó el flujo completo ni un envío.

**Qué provoca:** «compraría el próximo año, retomemos en esa fecha» puede coexistir con seguimiento ordinario a los siete días. El campo describe el acuerdo, pero no crea por sí solo la tarea de retoma. No se halló un trabajador específico de retoma a 30 o 60 días.

**Corrección propuesta:** distinguir conversación activa, seguimiento por silencio y contacto futuro acordado. Definir fecha/frecuencia y conectarlas al programador. No confundir consentimiento de rastreo con autorización de acompañamiento ni recuperar seguimientos históricos.

### A-12. Categoría incorrecta en seguimientos

**Evidencia:** el catálogo `605/category=penthouse` produce «departamento 605» en funciones de 24 horas y siete días. Faltan categorías completas en [nutrition-context.ts](../../src/lib/integrations/automation/nutrition-context.ts), líneas 28–38, y [nutrition-week-one-rules.ts](../../src/lib/integrations/automation/nutrition-week-one-rules.ts), líneas 36–64.

**Corrección propuesta:** conservar la categoría verificada en el objetivo y en las referencias de las rutas secundarias; cubrir suite, departamento, penthouse y local. No solucionar este error reescribiendo por código la respuesta libre del redactor.

### A-13. Showroom: observación convertida en preferencia

**Evidencia:** [enrichTourLead.ts](../../src/lib/tour/enrichTourLead.ts), líneas 186–190, completa `preferred_category` y `preferred_bedrooms` desde la tipología observada cuando están vacíos. Se llama desde [api/tour/lead/route.ts](../../src/app/api/tour/lead/route.ts). Dos o más dormitorios se convierten en departamento; una tipología sin dormitorios conocidos puede convertirse en suite.

**Qué provoca:** mirar el penthouse 605 puede quedar registrado como preferencia de departamento; una visita a un espacio no equivale a una decisión de compra. Esto contradice el cuidado del flujo nuevo de entrada del showroom.

**Corrección propuesta:** guardar unidad observada, tiempo, fuente y solicitud expresa por separado. Solo la declaración del cliente debe alimentar preferencias de búsqueda o selección. Revisar registros previos sin asumir que todo dato inferido sea falso ni borrarlo masivamente.

### A-14. Rutas de citas que todavía inspeccionan texto

**Evidencia:** [visit-rules.ts](../../src/lib/integrations/automation/visit-rules.ts), líneas 35–36, compara dirección/mapa; línea 58 exige la lista literal de horarios; línea 95 descarta un borrador si no contiene esa lista.

**Alcance:** son rutas operativas de citas, fuera del redactor principal. Por tanto, la eliminación de vetos del mensaje principal sí existe, pero no permite afirmar que no quede ninguna comparación de prosa en todo el sistema.

**Corrección propuesta:** mantener comprobaciones sobre permisos, disponibilidad y fechas estructuradas; retirar el juicio sobre cómo está expresado un borrador libre. Distinguirlo de enviar una plantilla operativa expresamente aprobada, cuyo contenido sí es fijo por contrato.

### A-15. Análisis que descarta un rechazo explícito reciente

**Evidencia:** [conversation-analysis.ts](../../src/lib/integrations/automation/conversation-analysis.ts), líneas 20 y 41–42, fuerza `not_dropped` si no han pasado 24 horas desde el último mensaje. Reproducción con IA simulada:

```text
Cliente hace 5 minutos: «No me interesa, el precio es demasiado alto».
Resultado simulado del evaluador: reason=price, basis=explicit, cita válida.
Resultado guardado por el código: reason=not_dropped, basis=unknown.
La explicación conserva: «Dijo expresamente que no le interesa por el precio».
```

**Qué provoca:** el gráfico y la clasificación pueden contradecir el resumen. El tiempo de silencio se mezcla con la existencia de un rechazo declarado.

**Corrección propuesta:** separar actividad, objeción, intención de continuar y motivo de cierre. La falta de silencio no borra un rechazo inequívoco; una objeción aislada tampoco implica abandono. Conservar evidencias y distinguir motivos expresos de hipótesis.

### A-16. Errores técnicos omitidos del análisis

**Evidencia:** la consulta de [conversation-analysis.ts](../../src/lib/integrations/automation/conversation-analysis.ts), línea 32, solo admite eventos `failed` y `uncertain`. El caso de suites terminó `cancelled`, con `requires_review=true` y `RPC_HANDOFF_LEAD_42P10`, por lo que queda fuera de esa fuente técnica.

**Corrección propuesta:** clasificar errores por resultado y necesidad de atención, incluyendo cancelaciones técnicas pertinentes. Una cancelación normal por mensaje nuevo no debe contarse como fallo. Si la consulta de incidencias falla, indicar evidencia incompleta en vez de equipararla a ausencia de fallos.

### A-17. Actualización bloqueante del embudo

**Evidencia:** [useLeadPipeline.ts](../../src/hooks/inmobiliaria/useLeadPipeline.ts), líneas 130–141, llama cada 30 segundos a `reload()`, que activa `isLoading`. [LeadPipelineBoard.tsx](../../src/components/inmobiliaria/leads/LeadPipelineBoard.tsx), línea 105, aplica `pointer-events-none` y opacidad al tablero durante esa carga.

**Qué provoca:** la ruta del embudo todavía puede impedir temporalmente interacción durante actualizaciones automáticas. La mejora de refresco en Automatización no se extendió a este hook.

**Corrección propuesta:** separar carga inicial de sincronización en segundo plano, conservar tarjetas y selección y actualizar solo los datos que cambiaron. No se comprobó en navegador un reinicio del desplazamiento; ese síntoma necesita prueba visual.

El recorte por altura fija ya no aparece en el componente revisado: las columnas crecen con su contenido. Se mantiene paginación de doce leads por columna; es una decisión distinta del recorte de altura.

### A-18. Pruebas generales y contratos desalineados

**Evidencia:** la batería general actual no pasa; véase la sección 7. Algunas pruebas esperan `business-risk-v2`, deducen preguntas leyendo la prosa o exigen correcciones textuales que el usuario pidió retirar. Otras fallan por aislamiento, esquemas o expectativas todavía sin resolver.

**Qué significa:** los 283 controles específicos aprobados en el cambio anterior no certificaban toda la automatización. Tampoco es válido etiquetar los 436 fallos generales como 436 errores del bot o descartarlos todos como pruebas obsoletas.

**Corrección propuesta:** adaptar pruebas a los contratos vigentes preservando el comportamiento de negocio, resolver discrepancias y añadir secuencias completas. No borrar un test solo porque ahora falle. Separar pruebas de reglas/operaciones, pruebas del redactor con metadatos y evaluaciones semánticas independientes.

### A-19. Catálogo reincorporado después de excluirlo y contexto extenso

**Fallo reproducido:** para «¿para qué necesitaría esa guía personalizada?», `taskVerifiedContext()` selecciona una explicación general y marca 65 fichas disponibles y **cero incluidas**. Sin embargo, la captura del contexto final de `completeTurnReply()`, usando un redactor simulado, termina con **65 fichas y diez grupos**. La instrumentación conserva simultáneamente `blocks.catalogo.included=0` e `included_unit_count=65`.

El ensamblado de [turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts), líneas 289–316, construye evidencia desde el contexto canónico y aplica después `taskModelEvidence()` de [task-context.ts](../../src/lib/integrations/automation/task-context.ts), línea 160. Esa composición debe investigarse como una unidad: el recorte aislado funciona, pero no se conserva hasta el modelo. Es un fallo de pertinencia e instrumentación comprobado, aunque no prueba por sí solo que el redactor vaya a mencionar esas unidades.

**Evidencia:** la generación incorrecta del 605 recibió 129.853 caracteres. La consulta de suites, 181.880. Una generación real posterior con `36ecc00` recibió **225.500 caracteres**, de los cuales 59.838 eran instrucciones y 160.575 contexto. En ese contexto destacan `razonamiento_contextual` con 68.770, `evidencia_turno` con 36.569 y `obligaciones_del_turno` con 29.124 caracteres. Se registraron 59.875 tokens de entrada del redactor en esa llamada.

**Evaluación:** el tamaño por sí solo no demuestra el motivo de un error. Sí aumenta la superficie donde una decisión puede repetirse, quedar desactualizada o contradecir otra. En el caso 605 se comprobó esa contradicción concreta; en la consulta sobre la guía se comprobó la pérdida del recorte de contexto.

**Corrección propuesta:** conservar una selección final coherente y sus métricas, una decisión comercial autorizada por turno y fuentes comunes. Retirar instrucciones duplicadas o inalcanzables después de comprobar sus llamadores. Reducir contexto con pruebas de conservación de hechos y memoria, no con recortes ciegos. Medir calidad, tiempo y tokens antes y después.

En la muestra de cuatro eventos aceptados por el proveedor, el ciclo total tardó aproximadamente entre 41 y 70 segundos. Las dos llamadas actuales al redactor duraron unos 8–9 segundos; no corresponde atribuir toda la espera a la escritura de la IA. Hace falta desglosar contexto, base de datos, cola y transporte. No se acordó ni certificó un tiempo objetivo de atención en esta auditoría.

### A-20. Consentimiento financiero dependiente de palabras del redactor

**Evidencia:** [financing.ts](../../src/lib/integrations/automation/financing.ts), línea 59, calcula `asksConsent` leyendo el mensaje anterior mediante `operationalFinancingInvitation()`. [financing-invitation.ts](../../src/lib/integrations/automation/financing-invitation.ts), desde la línea 17, reconoce esa invitación por expresiones y verbos determinados.

En una reproducción aislada, una invitación explícita a iniciar la revisión preliminar terminada en «¿Le parece si procedemos?» y una respuesta afirmativa vinculada a `financing_invitation` acaban con consentimiento nulo: «procedemos» no pertenece al vocabulario reconocido. El dato estructurado no elimina esa dependencia de la prosa.

**Qué provoca:** una forma válida de ofrecer el mismo trámite puede dejarlo sin iniciar y generar otra pregunta innecesaria. Es un falso negativo reproducido; no se demostró una aprobación indebida de un trámite productivo.

**Corrección propuesta:** registrar el acto de invitación con un recibo estructurado del redactor y vincular la respuesta a ese acto. Mantener la aceptación inequívoca del cliente y los controles de autorización; no sustituirlos por un «sí» genérico ni ampliar listas de palabras. Esto también muestra que retirar los vetos de la respuesta principal no retiró todas las lecturas de prosa en decisiones operativas.

## 4. Incidente de suites: qué se corrigió y qué queda

Referencia: Kommo **6066856**, evento `90e17057-5d48-4da8-8e62-76dc47d32d5f`.

1. El redactor produjo áreas interiores y exteriores que coincidían con el catálogo.
2. Una comprobación de código no interpretó correctamente el plural «espacios exteriores» y comparó esas áreas como interiores.
3. Rechazó el borrador con `catalog_area_mismatch`. **La IA revisora no había ejecutado ese rechazo.**
4. La recuperación intentó derivar al equipo, pero la función SQL falló con `42P10` por un conflicto de unicidad incompatible.
5. La consulta quedó sin envío y requirió atención. El segundo mensaje visible se envió manualmente.

| Parte | Estado comprobado |
| --- | --- |
| Rechazo de prosa en la ruta principal con revisor desactivado | Retirado del código y del despliegue actual. |
| Extracción de cifras o preguntas para vetar/reescribir la respuesta principal | Retirada en `36ecc00`; continuidad pasa a metadatos. |
| Revisor | Desactivado globalmente; dos respuestas reales de `36ecc00` registraron `review_disabled` y aceptación del proveedor. |
| SQL de notificación genérica | Parche versionado en `20261016110000_fix_lead_assignment_notification_conflict.sql`; prueba aislada reproduce el error anterior y el éxito posterior. Aplicación en producción no confirmada con el acceso disponible. |
| Resistencia de recuperación ante cualquier nuevo fallo de derivación | Sigue pendiente, A-09. |
| Saludo repetido del borrador | Explicado en A-03; no queda resuelto por retirar el veto. |
| `\n\n` visible en el envío manual | La salida original tenía saltos reales de línea, no secuencias literales `\\n`; no se atribuye al transporte automático sin evidencia adicional. |

La cadena de migraciones explica el `42P10`: una migración del 14/10 amplió la unicidad de notificaciones; la del 16/10 a las 09:00 volvió a definir una función con el conflicto antiguo de tres campos. El parche de las 11:00 utiliza la restricción nombrada `advisor_notifications_assignment_uq`. Esto es distinto del error de lectura de superficies: **hubo dos causas encadenadas, no una sola migración que provocara la interpretación del mensaje.**

## 5. Estado operativo y límites de las funciones implementadas

### Activación y atención de contactos anteriores

El preflight productivo de lectura mostró:

| Ajuste | Valor al corte |
| --- | --- |
| Automatización | `enabled=true`, modo real, `dry_run=false`, `test_only=false`. |
| Audiencia | `future_messages`, activada el 16/10 a las **09:18:28**. |
| Restricción por contacto de pruebas | No activa en entorno ni webhook. |
| IA revisora | `enabled=false`, `observationOnly=false`. |
| Modelo de análisis de conversaciones | `gpt-4.1`. |
| Seguimiento 24 horas | Desactivado; plantilla sin aprobación/vinculación según configuración. |
| Seguimientos 7, 14 y 21 días | Habilitados, sujetos a elegibilidad y ejecución del mantenimiento. |
| Horario comercial configurado | 09:00 a 18:00, America/Guayaquil. |

El filtro de audiencia utiliza la fecha original del mensaje: permite atender mensajes nuevos de contactos antiguos y no autoriza recuperar acciones anteriores a la activación. Las pruebas aisladas de ese límite pasan. La muestra de seis eventos entrantes posterior a la activación contiene cuatro aceptados por el proveedor, uno sustituido por nueva entrada y uno cancelado por el fallo histórico de suites. **Aceptado por el proveedor no significa entrega o lectura final en WhatsApp.**

### Reservas, asesores y alertas

En el código y la transacción aislada se verificó el registro de la solicitud, el intento de asignación automática y la creación de una alerta urgente distinta de la confirmación de reserva. Las pruebas cubren deduplicación, falta de asesor elegible, fallo de notificación y recuperación desde la bandeja autenticada. Una solicitud válida puede conservarse aunque falle el aviso; su estado debe seguir siendo visible. Esto no acredita por sí solo la aplicación de todas las funciones SQL en producción.

La política de «asesor disponible» significa hoy: cuenta activa, rol permitido, recepción de leads habilitada y rotación, conservando un responsable elegible. **No significa presencia en línea, turno laboral, vacaciones, capacidad disponible ni aceptación explícita.** Es una definición de negocio que falta concretar si se espera una disponibilidad más estricta.

La alerta inspeccionada es un diálogo y una campana **dentro de la aplicación**. No se acreditó un canal de aviso externo por sistema operativo, correo o WhatsApp para cuando el asesor no tiene la aplicación abierta. Tener el diálogo implementado no garantiza que el asesor haya recibido o leído una alerta.

### Citas y recordatorios

El código incluye recordatorio de cita dos horas antes para citas aceptadas o reprogramadas. Expira noventa minutos antes; además, la programación exige margen de treinta minutos antes del momento del recordatorio. Una cita creada con poco margen puede quedar sin ese recordatorio por diseño actual. Debe definirse si en ese caso se espera confirmación inmediata u otra política.

La existencia del código y de pruebas de campos no certifica el envío productivo, especialmente mientras falta verificar el mantenimiento global. Pedir una cita no confirma que ya exista un horario aceptado; la cita tampoco sustituye la etapa comercial.

### Showroom y recorrido 360

Existe conexión de registro, contexto y primer contacto programado. El flujo distingue una observación de una elección expresa, salvo el enriquecimiento antiguo descrito en A-13.

La selección de una unidad observada por tiempo utiliza actualmente:

- Al menos **120 segundos activos** en la unidad.
- Al menos **50 %** del tiempo observado total.
- Al menos **1,5 veces** el tiempo de la segunda unidad.
- Una solicitud expresa tiene prioridad; si la señal es ambigua, se utiliza el contacto genérico.

El primer contacto se programa con cinco minutos de espera y utiliza los Salesbots **26428** y **26430**, y el campo **538638**, «Unidad Observada Showroom». Esa variable describe lo observado, no una preferencia de compra confirmada. El flujo contempla «Sí, quiero información», «Más adelante» y «No recibir mensajes»; conserva los datos de inscripción y solicita solo lo que falte, como residencia, sin repetir el nombre ya declarado.

No se verificó durante esta auditoría la configuración final de las plantillas y botones en la cuenta de Kommo/Meta ni un envío real. Un registro en la cola no acredita envío; antes de salir deben comprobarse permisos, conversación ya iniciada, atención humana y otras condiciones. Los renders y el envío de imágenes siguen aplazados por decisión del usuario.

### Análisis y panel

El análisis usa `gpt-4.1`, procesa hasta los últimos sesenta mensajes, guarda citas y separa motivo declarado, hipótesis y desconocimiento. No ejecuta su recomendación de siguiente paso ni contacta al lead. Se consultaron diez registros de análisis almacenados; no equivalen necesariamente a diez leads únicos.

El gráfico de residencia utiliza datos declarados del perfil, no deduce residencia a partir de IP. Conviene normalizar ciudad y país y distinguir desconocidos. El uso actual de ciudad o, si falta, país como una sola categoría puede mezclar niveles geográficos. Los gráficos de caída deben corregir A-15 y A-16 antes de interpretarse como conclusiones fiables sobre conversión.

## 6. Conciliación de las 29 familias históricas

El inventario del 15/10, corte `17615fc`, tenía **18 corregidas en código, 4 parciales, 6 pendientes y 1 aplazada**. Es un registro histórico, no una certificación actual de 18 comportamientos con IA. Los 20 hallazgos de esta auditoría no se suman a esas 29 familias: varios corresponden a las mismas áreas y otros describen operación, pruebas o riesgos.

| ID | Familia y ejemplo del problema anterior | Estado histórico | Evaluación al 16/10 |
| --- | --- | --- | --- |
| RC-01 | El código completaba el mensaje del redactor. | Parcial. | Ruta principal corregida; quedan rutas secundarias, como citas, que deben alinearse. A-14. |
| RC-02 | Deducir actos o preguntas comparando palabras del borrador. | Corregida en código. | La continuidad principal usa metadatos del redactor. Falta evaluar su coherencia con generaciones reales. |
| RC-03 | Revisor con poder sobre estilo y siguiente paso. | Parcial. | Autoridad principal limitada y revisor apagado; instrucciones secundarias necesitan alineación. A-06. |
| RC-04 | Justificación fija «brochure y guía personalizada». | Corregida en código. | Objetivo libre implementado; armonizar secuencia y excepciones. A-05. |
| RC-05 | «Mucho gusto, Nombre» obligatorio. | Corregida en código. | No se encontró esa obligación literal vigente en la ruta revisada. El saludo repetido tiene otra causa, A-03. |
| RC-06 | «Presupuesto total aproximado» como fórmula dirigida. | Corregida en código. | Objetivo permite presupuesto previsto con lenguaje libre. Naturalidad no recertificada con IA. |
| RC-07 | La mera palabra «brochure» activaba entrega. | Corregida en código. | La ruta estructurada distingue mención y solicitud; utilidades de respaldo antiguas requieren revisión de llamadores. |
| RC-08 | Prohibición amplia de introducciones o justificaciones. | Corregida en código. | Se permite cortesía pertinente; queda el conflicto de primera consulta/saludo, A-03. |
| RC-09 | Advertir por defecto que una distribución no sirve a una familia. | Corregida en código. | Instrucción principal alineada; recomendación contextual con modelo real pendiente. |
| RC-10 | Financiamiento por oportunidad genérica o presupuesto indefinido. | Parcial. | Ruta principal más acotada; seguimientos pueden introducirlo indebidamente. A-10. |
| RC-11 | Captura comercial obligatoria después de toda duda. | Corregida en código. | Modo informativo implementado en ruta principal; no cubre todos los seguimientos ni la pérdida de memoria de reserva. A-01 y A-10. |
| RC-12 | Filtros de compra aplicados a toda consulta del proyecto. | Corregida en código. | No recertificada con extracción y recuperación completas; no se declara reabierta sin nueva evidencia. |
| RC-13 | Cautela fija sobre instalaciones sin considerar la política. | Corregida en código. | Hay fuente de política; falta contrastar precedencia y respuesta real del escenario. |
| RC-14 | Aviso referencial de precios en cada turno. | Corregida en código. | Frecuencia y recibo del redactor implementados; secuencia completa con IA pendiente. |
| RC-15 | Preguntar por contado/procedimiento cambiaba aceptación financiera. | Corregida en código. | Instrucción preserva consentimiento; transición integral del expediente pendiente de recertificar. |
| RC-16 | Entrada pendiente bloqueaba continuar. | Corregida en código. | El flujo distingue entrada indefinida de límites para calcular; falta recertificar el caso bancario completo. |
| RC-17 | Pedir dormitorios tras «para vivir» pese a indiferencia. | Parcial. | Objetivo principal respeta indiferencia; persiste un prompt comercial antiguo. Su efecto depende de la ruta. |
| RC-18 | Conservar el presupuesto antiguo como techo tras aclarar que era entrada. | Corregida en código. | Memoria distingue roles del importe; falta validar toda la secuencia con búsqueda y respuesta. |
| RC-19 | Precios solo si existía `ask_price` explícito. | Corregida en código. | Se contemplan consultas implícitas; extracción y entrega reales pendientes de evaluación específica. |
| RC-20 | Seguimientos sin consultar modo informativo. | Pendiente. | Abierta y reproducida. A-10. |
| RC-21 | Intención de seguimiento inferida por palabras. | Pendiente. | Abierta y reproducida con negativas a crédito. A-10. |
| RC-22 | Categorías incompletas en seguimiento. | Pendiente. | Abierta y reproducida con penthouse 605. A-12. |
| RC-23 | Navegación del showroom guardada como preferencia. | Pendiente. | Ruta alcanzable todavía presente. A-13. |
| RC-24 | Mostrar todas las unidades de una planta en vez de abreviar. | Aplazada por el usuario. | Se conserva el aplazamiento. Retirar vetos de prosa no autoriza por sí solo la presentación abreviada. |
| RC-25 | Aplazamiento financiero podía convertirse en consentimiento `false`. | Pendiente. | El prompt publicado distingue posponer la revisión de entrar en modo informativo, pero la redacción requiere una prueba específica. No se reprodujo un fallo actual. |
| RC-26 | Prohibición universal de categorías en apertura genérica. | Pendiente. | Conflicto activo confirmado. A-04. |
| RC-27 | Redactor financiero obligado siempre a español. | Corregida en código. | Instrucción actual sigue idioma del cliente; no se ejecutó conversación financiera real en otro idioma. |
| RC-28 | Una oferta del bot podía reemplazar referencias y borrar la selección. | Corregida en código. | La conservación en ese tramo existe. El 605 se borra por otra rama posterior, no por el mismo mecanismo. A-01. |
| RC-29 | Nueva categoría reemplazaba todas las preferencias. | Corregida en código. | Existe combinación de filtros compatibles. No resuelve el retorno de requisitos antiguos después de borrar otro bloque. A-01 y A-02. |

Fuente histórica: [inventario de reglas](auditoria-reglas-2026-10-15.json). El corpus actual contiene **118 escenarios**; no equivale al número de causas ni al de pruebas ejecutadas. No se reportan «miles de reglas en conflicto» ni líneas depuradas que esta auditoría no haya medido.

## 7. Pruebas ejecutadas y sus límites

Se reunieron los archivos únicos de las baterías locales relacionadas, sin invocar modelos ni servicios externos. La comparación histórica se ejecutó bajo el mismo aislamiento y concurrencia, sustituyendo fuentes antiguas en memoria desde Git, **sin modificar el espacio de trabajo**. No es una compilación o despliegue integral de la versión anterior.

| Revisión | Archivos | Pruebas | Pasan | Fallan |
| --- | ---: | ---: | ---: | ---: |
| Actual `36ecc00` | 157 | 2.019 | 1.583 | 436 |
| Comparación `ce3c212`, archivos comunes | 151 | 1.969 | 1.655 | 314 |

De los 436 fallos actuales, **312 también fallaban en la comparación y 124 pasaban antes**. La coincidencia se hace por archivo y título: un mismo título fallido puede tener causas diferentes en cada versión. Los 124 se agrupan en 29 expectativas de pregunta sin metadatos, 58 de revisión/vetos retirados, 29 del contrato anterior del revisor, 6 de esquema y 2 de reescritura por código retirada. Esto evidencia deuda de adaptación y validación del último cambio; no demuestra automáticamente 124 regresiones productivas.

Clasificación inicial de los 436 fallos:

| Grupo | Cantidad | Interpretación |
| --- | ---: | --- |
| Dependencias nuevas ausentes en simulaciones de prueba | 28 | Error confirmado del montaje de esas pruebas. |
| Aislamiento incompleto de servicios, credenciales o red | 162 | Agrupación probable; algunas causas internas quedan envueltas por otro error y requieren diagnóstico individual. |
| Datos simulados incompatibles con esquemas requeridos | 35 | Desalineación de esquema comprobada. |
| Preguntas sin los metadatos actuales del redactor | 29 | La prueba espera deducción de prosa retirada. Debe conservarse el objetivo de continuidad al adaptarla. |
| Revisión o vetos de prosa anteriores | 119 | Cambió el contrato; cada prueba necesita conservar su intención de negocio. |
| Respuesta simulada del antiguo revisor | 31 | Incompatible con `content-review-v1`. |
| Expectativas antiguas de contexto o propósito | 5 | Contrato de prueba desactualizado. |
| Reescritura por código expresamente retirada | 2 | La expectativa contradice la responsabilidad actual. |
| Exigencia de palabras comerciales concretas | 3 | Comprobación literal que no certifica significado. |
| Reintentos predeterminados del SDK | 2 | Recuento de peticiones distinto del esperado. |
| Expectativa de transporte pendiente de aclaración | 1 | No declarada defecto productivo. |
| Diferencias heredadas separadas para diagnóstico individual | 19 | El diagnóstico final se explica debajo; no se descartaron automáticamente como simulaciones. |
| **Total** | **436** | **La batería general no está aprobada.** |

Se cerró después la clasificación individual de esas diecinueve diferencias: una demuestra la reincorporación indebida de catálogo, A-19; al investigar otra apareció el falso negativo de consentimiento financiero, A-20. El test original de ese segundo caso esperaba aceptación desde una oferta ambigua y no demostraba por sí solo el fallo; se construyó una reproducción inequívoca adicional. Las otras diecisiete corresponden a argumentos, audiencia de prueba, confianza admitida, roles monetarios o expectativas de autoridad/recibos anteriores. **Clasificarlas no significa repararlas ni haber vuelto a aprobar esas pruebas.** El anexo JSON conserva el diagnóstico por título.

Tampoco se encontró pérdida del prestamista JEP en la prueba que inicialmente lo sugería: el estado y el contexto del redactor lo conservan; la expectativa fallida exigía ese paso de captura en las obligaciones del revisor. En una prueba de continuidad de propuestas, la preparación ya no llega a la ruta real por faltar recibo y catálogo; debe adaptarse antes de que vuelva a proteger el escenario.

Además, una batería operativa aislada pasó **137 de 137** comprobaciones, incluyendo asignación, alertas, audiencia y campos de recordatorio. Se solapa parcialmente con la general; no se suman ambas cifras como pruebas únicas.

El escritor simulado de algunas pruebas fabrica la pregunta a partir del mismo plan que se evalúa. Eso sirve para contratos y transporte, pero no es una evaluación independiente de naturalidad. Tampoco las pruebas que verifican la existencia de una frase en un prompt certifican que el modelo real actúe bien.

Los registros TAP, manifiestos y clasificación por archivo/título permanecen en `tmp/` como evidencia local. Las agrupaciones probables no deben presentarse como diagnóstico exhaustivo de cada fallo.

## 8. Controles que sí se verificaron

- La respuesta principal actual se conserva sin reconstrucción de preguntas ni veto semántico del código. Esto no elimina validaciones de permisos, datos estructurados o autorización de acciones.
- La audiencia posterior a activación permite atender mensajes nuevos de contactos antiguos sin reactivar seguimientos previos.
- Entradas nuevas cancelan seguimientos pendientes del ciclo anterior; antes del envío se vuelven a comprobar exclusión de contacto, atención humana, mensajes sin responder, citas y resultados de envío inciertos.
- La solicitud de reserva y la confirmación efectiva se distinguen; existen asignación automática, tipos de alerta e idempotencia en la transacción probada.
- Un fallo de notificación no debe destruir una solicitud válida; hay recuperación desde la bandeja autenticada además de la ruta global.
- La ficha comercial usa una proyección compartida entre vistas; su persistencia productiva está limitada por A-08.
- El tablero revisado crece en altura; no mantiene el recorte fijo de la captura anterior.
- El análisis exige citas válidas y no ejecuta sus recomendaciones. Sigue necesitando las correcciones de clasificación descritas.

## 9. Orden recomendado de corrección y criterios para cerrarla

| Orden | Trabajo | Qué debe comprobarse para darlo por corregido |
| --- | --- | --- |
| 1 | A-01 y A-02: continuidad de reserva y memoria común. | Reserva del 605 → «nadie me llama» → aclaración de «error» conserva unidad y gestión; no pregunta dormitorios ni vuelve a ofrecer la reserva ya solicitada. Cambio de tema no revoca selección. |
| 2 | A-07, A-08 y A-09: operación y recuperación. | Mantenimiento con registros recientes; tablas consultables; parche SQL confirmado; un fallo provocado solo en entorno aislado deja incidencia y recuperación verificables sin duplicar mensajes. |
| 3 | A-10 a A-13: seguimiento, fechas y showroom. | «Solo información» y «no crédito» no generan ofertas indebidas; una fecha futura gobierna contacto; mirar una unidad no modifica preferencias declaradas; categoría correcta. |
| 4 | A-03 a A-06, A-14 y A-20: depuración de responsabilidades y prompts. | Una instrucción por decisión; sin saludo repetido por primera consulta; presentación coherente; brochure con excepciones; sin comparaciones de prosa en rutas libres; invitación financiera reconocida mediante metadatos, conservando consentimiento real. Revisor sigue apagado salvo nueva instrucción del usuario. |
| 5 | A-15 a A-17: análisis e interfaz. | Rechazo explícito reciente conserva su evidencia; cancelación técnica aparece y cancelación normal no; refresco conserva interacción, ficha y desplazamiento. |
| 6 | A-18 y A-19: verificación y reducción de contexto. | Contratos de prueba adaptados sin perder casos de negocio; fallos restantes diagnosticados; evaluación independiente de secuencias; comparación de calidad y tiempos al reducir duplicaciones. |

Para cada corrección deben registrarse por separado: cambio de código, migración aplicada, despliegue, prueba aislada, evaluación con modelo cuando haga falta y comprobación productiva sin contactar leads sin autorización. «Está escrito» y «pasó una prueba de texto» no son estados de cierre suficientes.

No se propone reparar automáticamente la memoria de contactos históricos ni reenviar respuestas antiguas. Las incidencias con entrega desconocida requieren comprobar el historial antes de cualquier reintento.

## 10. Evidencia y trazabilidad

El [anexo estructurado de esta auditoría](auditoria-integral-2026-10-16.json) contiene identificadores, clasificación, fuentes, cifras y límites sin copiar datos personales completos. Los archivos `tmp/` siguientes permiten reproducir la revisión local y no son documentación pública:

| Evidencia local | Contenido |
| --- | --- |
| `tmp/audit-reservation-20261016.json` | Secuencia del 605, fuentes de memoria y reproducción actual. |
| `tmp/suite-failed-execution-trace.json` | Traza histórica de suites, composición del prompt y borrador. |
| `tmp/audit-live-snapshot-20261016.json` | Configuración y eventos de mantenimiento al corte. |
| `tmp/audit-live-modules-20261016.json` | Errores del embudo, contacto programado de showroom y análisis almacenados. La consulta exploratoria de tiempos usó una columna inexistente; ese error fue del auditor y no se cuenta como defecto. |
| `tmp/audit-future-inbound-sample-20261016.json` | Seis eventos posteriores a la activación. |
| `tmp/audit-model-metrics-20261016.json` | Modelos, tamaños, tokens y duraciones de la muestra. |
| `tmp/audit-current-prompt-composition-20261016.json` | Composición del prompt actual y reglas publicadas de consentimiento. |
| `tmp/audit-analysis-reproducer-20261016.json` | Reproducción aislada del rechazo explícito sobrescrito. |
| `tmp/audit-unresolved-context-capture-20261016.json` | Captura del catálogo que reaparece después del recorte y comprobaciones adicionales de continuidad. |
| `tmp/audit-test-unresolved-triage-20261016.json` | Diagnóstico individual de las diecinueve diferencias inicialmente pendientes y reproducción financiera. |
| `tmp/audit-consent-paraphrase-triage-20261016.json` | Comparación de invitaciones financieras equivalentes, recibos y aceptación del cliente. |
| `tmp/audit-operations-20261016.json` | Revisión operativa, 137 comprobaciones y límites. |
| `tmp/audit-inventory-reconciliation-20261016.json` | Conciliación de las 29 familias históricas. |
| `tmp/audit-full-regression-20261016.tap` | Resultado actual de 2.019 pruebas. |
| `tmp/audit-baseline-regression-20261016.tap` | Resultado de comparación con fuentes anteriores en memoria. |
| `tmp/audit-test-classification-20261016.json` | Clasificación de los 436 fallos por archivo y título. |

Las afirmaciones de este informe describen el corte indicado y la versión revisada. Los hallazgos quedan documentados; **las correcciones propuestas no se aplicaron durante esta auditoría**.

## 11. Corrección posterior: continuidad durante una solicitud de reserva

**Implementada localmente el 16/10 por instrucción posterior del usuario; pendiente de despliegue y comprobación productiva.** Esta actualización aborda A-01 y la parte de A-02 correspondiente a continuidad y fuentes compartidas de reservas. El inventario y los resultados generales anteriores conservan su corte histórico; no se declara cerrada toda la auditoría.

Cambios realizados:

- Una aclaración o tema ajeno suspende referencias transitorias, sin borrar la unidad elegida, la alternativa aceptada ni las preferencias ya declaradas.
- Se consulta una vez por turno la solicitud de reserva anterior. Su estado y la asignación actual llegan al extractor, al plan y al redactor; la revisión, si se habilita en otra ocasión, recibe la misma evidencia. El revisor del proyecto sigue desactivado.
- Si una elección ya se perdió, puede recuperarse desde una solicitud verificada y una unidad inequívoca. Esa recuperación conserva procedencia y no atribuye una nueva elección al lead ni confirma reserva, pago, notificación leída o contacto del asesor.
- El seguimiento de una solicitud vigente tiene prioridad sobre volver a preguntar presupuesto, categoría, dormitorios o si desea iniciar la misma reserva. Consultar requisitos tampoco inicia otro trámite.
- El precio o los detalles de una unidad elegida no recuperan dormitorios de una búsqueda anterior por faltar un filtro opcional.
- Una nueva búsqueda, una elección distinta o un rechazo explícito conserva efecto entre turnos. Un saludo posterior o una lectura temporalmente fallida no vuelve a activar la solicitud antigua. Rechazar la reserva del 602 no revoca la solicitud del 605.
- Si falla la lectura durante una consulta de seguimiento, se conserva ese límite de verificación sin volver a calificar al cliente. No se afirma que no exista solicitud ni se inventa una selección para reparar datos ausentes.

**Validación:** 106 pruebas de memoria, planificación, lectura y continuidad, más tres pruebas del ejecutor `processConversation` con fronteras externas simuladas: **109 pasan, cero fallan**. TypeScript y ESLint pasan. No se llamaron modelos ni servicios reales. Las pruebas cubren reserva → aclaración → seguimiento; memoria antigua vacía; cambio al 602; nueva búsqueda; rechazo → saludo → siguiente mensaje; consulta de requisitos; lectura fallida; y restricciones actuales expresas.

Comandos reproducibles:

```text
npm run test:reservation-continuity
npm run test:reservation-continuity-runtime
```

El registro local está en `tmp/reservation-scope-fix-tests-20261016.tap`, `tmp/reservation-scope-runtime-20261016.tap`, `tmp/reservation-scope-types-20261016.log` y `tmp/reservation-scope-lint-20261016.log`.

Esta corrección **no agrega migraciones SQL**, no reenvía mensajes históricos ni modifica directamente la ficha de contactos en producción. Una negativa conversacional deja de dirigir la búsqueda hacia esa reserva; no equivale a cancelar por sí sola una solicitud registrada ni a liberar inventario. Los demás hallazgos permanecen con el estado señalado en la auditoría.

## 12. Ampliación de hallazgos del 17 de octubre de 2026

La revisión posterior encontró fallos compartidos entre interpretación, contexto, memoria, planificación y redacción. Una extracción correcta no bastaba: un consumidor podía descartar una decisión válida, recuperar un objetivo antiguo o entregar al redactor hechos de otro conjunto. Por eso varias respuestas parecían haber perdido el flujo aunque las reglas siguieran presentes en las fuentes.

Los registros siguientes describen **familias de mensajes y transiciones que podían verse afectadas**, sin convertir cada conversación en una regla particular. Los identificadores S-01 a S-17 sirven para enlazar el diagnóstico con su corrección. Amplían o concretan hallazgos anteriores; **no se suman a los 20 originales como 17 causas independientes ni como 17 incidentes productivos**.

### 12.1 Patrones encontrados

| ID | Familia de mensajes o situación | Fallo general y consecuencia | Evidencia y relación con la auditoría |
| --- | --- | --- | --- |
| S-01 | Saludos, fechas, horas, aceptaciones y solicitudes expresadas con vocabulario o formatos variados. | Tras la interpretación de IA, otros componentes volvían a decidir el significado por palabras o formatos. Una interpretación válida podía perderse antes de planificar o registrar una operación; también se reconstruían permisos leyendo preguntas anteriores del bot. | Fuentes, reproducciones y pruebas de contrato. Amplía A-03, A-14 y A-20. |
| S-02 | Consultas sobre seguridad, características del proyecto o temas expresados con sinónimos. | La selección textual de contexto podía ocultar hechos pertinentes. El redactor recibía menos información de la necesaria y contestaba con una carencia en lugar de explicar las medidas o características aprobadas. | Fuentes y recorrido con modelo real. Amplía A-19. |
| S-03 | Objeciones, dudas, desconfianza y preguntas sobre límites del proyecto. | Prohibiciones internas terminaban convertidas en advertencias espontáneas al cliente. Algunos bloques favorecían disculparse por afirmaciones que no figuraban en el historial. El resultado era una respuesta defensiva, extensa o ajena a la preocupación concreta. | Conflictos de instrucciones y evaluación de secuencias. Relacionado con A-04 y A-06. |
| S-04 | Solicitudes normales de información, precios o características. | Pedir información podía interpretarse como una orden de pausar la orientación comercial. Ese modo persistía y suprimía preguntas pertinentes de presentación o descubrimiento en mensajes posteriores. También había estados erróneos ya guardados que un cambio de prompt no reparaba. | Trazas, estados persistidos y pruebas de pausa/retoma. Amplía A-10 y A-02. |
| S-05 | Aclaraciones, consultas intermedias y aceptación de una alternativa durante una búsqueda o gestión vigente. | El objetivo actual podía competir con una pregunta histórica o con requisitos ya sustituidos. La respuesta atendía un tema, pero terminaba pidiendo una decisión anterior, repitiendo una flexibilización o reabriendo la búsqueda durante una reserva. | Reproducciones y secuencias completas. Amplía A-01 y A-02. |
| S-06 | Varios mensajes agrupados que aportan, por separado, una consulta, un dato o una preferencia. | Diferencias de espacios y saltos de línea podían invalidar la procedencia de una cita correcta y disparar otra extracción. Además, la intención principal podía desplazar una declaración independiente de otro mensaje del mismo lote. | Trazas con motivo de reparación y evaluación de lotes. Relacionado con A-02 y A-18. |
| S-07 | Preguntas sobre el contenido del brochure, solicitudes de envío y entrega parcial de datos de presentación. | Se mezclaban explicar el material, autorizar su entrega y completar el perfil. Podía enviarse el enlace sin petición de envío, detenerse indebidamente la captura parcial o desaparecer el dato pendiente tras contestar una pregunta intermedia. | Pruebas y secuencias con modelo real. Concreta A-05. |
| S-08 | Aclaraciones sobre residencia actual, anterior u origen, después de una oferta inicial del brochure. | Aunque la ficha conservara el significado del lugar, el contrato podía ordenar ofrecer otra vez el material. La respuesta repetía una justificación ya dada en lugar de reconocer el dato y aclarar únicamente lo pendiente. Una expresión temporal incierta tampoco justificaba inventar la residencia actual. | Comparación de perfil, contrato y respuesta registrada. Concreta A-05 y A-02. |
| S-09 | Elecciones contextuales de categoría, aceptación de alternativas y cantidades usadas para describir necesidades o evaluar espacios. | Podía perderse una elección válida o conservarse a la vez un requisito antiguo incompatible. Códigos citados como contexto y cantidades descriptivas podían confundirse con nuevas selecciones o restricciones. El plan volvía a preguntas ya resueltas o buscaba otro conjunto. | Reproducciones y recorridos de comparación/elección. Amplía A-01, A-02 y A-12. |
| S-10 | Información de inmuebles filtrada por categoría, dormitorios u otro subconjunto. | El plan seleccionaba un conjunto concreto, pero la evidencia del redactor conservaba agregados de un grupo más amplio. Las superficies o plantas podían atribuirse al subconjunto equivocado y la redacción no dejaba claro a qué inmuebles correspondían. | Entradas registradas del redactor y pruebas de proyección. Amplía A-19 y A-12. |
| S-11 | Consultas por la planta más alta, opciones por encima/debajo de otra planta o precios de una planta concreta. | El alcance temporal de altura podía competir con el presupuesto o seguir activo en el turno siguiente. La respuesta mezclaba plantas o terminaba preguntando por unidades ajenas a la consulta. La lectura textual de plantas añadía otra interpretación a la de IA. | Trazas y secuencias de altura, precio y presupuesto. Amplía A-02 y A-19. |
| S-12 | Notas de voz que contienen números de unidad u otros identificadores sensibles a un dígito. | Un número incorrecto ya presente en la transcripción se propagaba como entrada al intérprete. Los controles de voz clara no acreditaban la exactitud de cada cifra. La traza examinada no conservaba el modelo de transcripción efectivo, por lo que el valor predeterminado local no prueba cuál se usó en producción. | Texto recibido antes de la extracción y aclaración posterior del usuario. **Audio original sin reevaluar y procedencia del modelo pendiente.** |
| S-13 | Referencias relativas a opciones ofrecidas acompañadas de un número incompatible con ese conjunto. | Se privilegiaba el número como referencia inequívoca, aunque contradijera la relación con las alternativas anteriores. Esto podía cambiar categoría, distribución o recorrido sin aclarar la intención. Es distinto de una petición clara e independiente de otra unidad. | Traza y simulación real que detectó el fallo antes de corregirlo. Relacionado con A-02. |
| S-14 | Detalles o recorrido de una unidad ya identificada cuando todavía falta decidir si continuar con ella. | El plan podía terminar en un objetivo genérico sin pregunta ni continuación requerida. El redactor describía la opción, pero no recibía una decisión concreta que proponer; selección, continuidad y permiso transaccional no estaban suficientemente separados. | Plan registrado sin pregunta y regresión específica. Amplía A-02. |
| S-15 | Agradecimientos durante un recorrido con una decisión pendiente y despedidas explícitas. | Un atajo de cortesía equiparaba agradecer con terminar y podía omitir por completo al redactor. Se perdía la continuidad aunque faltara una decisión. La solución tampoco podía consistir en insistir después de cada agradecimiento ni convertirlo en aceptación. | Traza del atajo y secuencias de cortesía/cierre. Amplía A-02 y A-03. |
| S-16 | Revisión del flujo de un mensaje, sus reparaciones y la instrucción exacta enviada al redactor. | El objetivo JSON era difícil de localizar; la ausencia de llamada al redactor podía confundirse con un plan omitido. El desplazamiento y las actualizaciones dificultaban contrastar el mensaje con sus pasos. En la vista de arquitectura también se reprodujo una interferencia del minimapa con la navegación. | Capturas originales y pruebas de navegador. La mejora de pasos está comprobada localmente; **la interferencia del minimapa sigue abierta** y se reproduce sin el encabezado fijo. |
| S-17 | Cierre de validación tras sustituir contratos y reglas del flujo. | Aprobar comprobaciones estructurales o algunas secuencias no demostraba naturalidad general ni reconciliaba los fallos históricos. Simulaciones incompletas y expectativas antiguas podían mezclarse con regresiones actuales; atribuir todos sus fallos a obsolescencia habría ocultado problemas. | Resultados conservados por ejecución. Amplía A-18. **La revisión individual de 432 fallos permanece aplazada y abierta.** |

### 12.2 Correcciones implementadas y trabajo abierto

El [informe de correcciones, sección 9](./informe-correcciones-auditoria-2026-10-16.md#9-correcciones-posteriores-del-16-y-17-de-octubre-de-2026), enlaza cada patrón con el cambio aplicado, los casos cubiertos y el comportamiento esperado. La revisión documental se contrastó con las fuentes de `a1fc19f3cc5e1ef42a32233d68786a8c19ea8dfd`; ese identificador acredita la revisión local, no un despliegue verificado.

Las correcciones de interpretación mantienen a la IA como responsable del significado. El código consume referencias, decisiones y permisos estructurados, comprueba procedencia y ejecuta cálculos u operaciones. No se incorporó un planificador de IA nuevo ni se reactivó la IA revisora. Los ejemplos de evaluación no se añadieron como filtros productivos de redacción.

Quedan abiertos la comparación del audio original entre transcriptores, el registro del modelo de transcripción efectivo, la revisión histórica individual, la navegación del minimapa y una evaluación más amplia de naturalidad. La aclaración de referencias de S-13 reduce una consecuencia de una posible transcripción incorrecta; **no corrige el reconocimiento acústico de S-12** ni permite reemplazar silenciosamente una cifra.

### 12.3 Evidencia posterior y alcance de las comprobaciones

| Registro | Cobertura y resultado de su ejecución |
| --- | --- |
| [Interpretación y continuidad](./correccion-interpretacion-y-continuidad-2026-10-16.md) | Contrato de interpretación, permisos y preferencias de visita tipificadas. Conserva el resultado general de aquella iteración y su migración propia. |
| [Estabilización del flujo](./estabilizacion-conversacion-2026-10-16.md) y [validación](./validacion-estabilizacion-2026-10-16.json) | 364 comprobaciones específicas aprobadas; cinco secuencias y veinte turnos con Luna. La batería histórica de ese corte tiene 432 fallos. Se verificaron dos reparaciones puntuales de estado productivo, sin mensajes. |
| [Brochure, interés y multimedia](./correcciones-brochure-interes-y-multimedia-2026-10-17.md) | Interpretación del contenido del material, decisiones contextuales y separación de modelos de imagen y transcripción. |
| [Validación de lotes, brochure y plantas](./validacion-lotes-brochure-y-plantas-2026-10-17.json) | 403 comprobaciones aprobadas y 17 turnos sintéticos con Luna; incluye integridad de lotes y consultas temporales de altura. |
| [Validación del contexto del redactor](./validacion-contexto-redactor-2026-10-17.json) | 413 comprobaciones aprobadas y ocho turnos sintéticos con Luna; residencia, alcance de dormitorios y revisión visual a 1440, 768 y 390 píxeles. Una secuencia aprobó sus condiciones estructurales con una expresión poco natural: ambos resultados se conservan. |
| [Validación de referencias y cortesías](./validacion-referencias-y-cortesias-2026-10-17.json) | 430 comprobaciones aprobadas y siete turnos sintéticos con Luna; referencia contradictoria, continuidad de unidad y cortesía. TypeScript, ESLint y build aprobados en ese corte. El audio original no formó parte de la prueba. |

Los conjuntos se solapan y **no se suman como pruebas únicas**. Las llamadas reales de estas evaluaciones usan datos y operaciones comerciales ficticios; no acreditan entrega de WhatsApp, agenda productiva ni lectura de alertas. Los intentos fallidos se conservan en sus registros. Esta ampliación solo actualiza documentación: no ejecuta nuevamente las baterías, no modifica leads y no cambia modelos, SQL ni despliegues.
