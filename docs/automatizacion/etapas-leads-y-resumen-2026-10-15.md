# Etapas de los leads y lectura del resumen comercial

**Fecha:** 15 de octubre de 2026. **Destinatarios:** administración y equipo comercial de La Vilet.

El embudo clasifica el avance comercial del lead en seis etapas. La atención pendiente, la nutrición, las citas y el resultado de la oportunidad se registran por separado. Esta separación permite saber cuánto ha avanzado el cliente y qué necesita ahora, sin cambiar su etapa cada vez que hace una consulta o deja de responder.

Los criterios de las etapas corresponden a la implementación del embudo revisada. Las correcciones de avisos, resumen y ficha compartida están implementadas localmente. El diagnóstico conserva las causas de las capturas anteriores; el despliegue y la comprobación con la sesión afectada siguen pendientes.

## Las seis etapas del embudo

| Etapa | Pregunta que permite responder |
| --- | --- |
| Nuevo / Por atender | ¿Todavía falta iniciar la atención? |
| Contacto inicial | ¿Ya comenzó la atención y todavía estamos en la presentación o información general? |
| Necesidad identificada | ¿Ya sabemos qué busca o para qué lo necesita? |
| Interés comercial | ¿Ya consulta condiciones comerciales, revisa una unidad concreta o solicita una visita? |
| Proceso de reserva | ¿Ya existe una solicitud de reserva registrada y respaldada? |
| Venta cerrada | ¿Ya existe un cierre de venta registrado? |

El lead puede avanzar directamente a la etapa que respalden sus acciones. No tiene que recorrer todas las columnas. El presupuesto, la identidad legal y la aprobación financiera no son requisitos generales para responderle ni para reconocer interés comercial.

### Nuevo o Por atender

El contacto está registrado y todavía no hay atención acreditada en las fuentes disponibles. Puede proceder de WhatsApp, del showroom, de una carga manual o de otra fuente.

**Ejemplos:**

- Una persona deja su nombre y teléfono en el showroom y todavía nadie le responde.
- Llega «Hola, quisiera información» y el mensaje continúa pendiente de atención.
- Se crea un contacto manualmente para que un asesor lo atienda.

Dejar los datos o navegar por un inmueble no demuestra elección de unidad. Preparar una respuesta sin enviarla tampoco demuestra atención.

**Gestión correspondiente:** revisar el origen, atender la consulta disponible e iniciar la conversación. Registrar el responsable cuando corresponda.

**Salida:** una respuesta registrada permite acreditar Contacto inicial. Si ya existe evidencia de una necesidad, consulta comercial o gestión más avanzada, puede aparecer directamente en esa etapa.

**Cuando faltan datos:** si falla la consulta de atención, la clasificación es provisional. «No pude consultar respuestas» no significa «nadie le ha respondido».

### Contacto inicial

Existe una respuesta registrada del bot o del asesor y todavía no hay evidencia de una etapa comercial más avanzada. Comprende la bienvenida, la presentación y las primeras consultas generales.

**Ejemplo de conversación:**

> Lead: Hola, quisiera conocer el proyecto.
>
> Atención: Buenas tardes, bienvenido a La Vilet. ¿Qué le gustaría conocer sobre el proyecto?

Puede mantenerse aquí mientras consulta ubicación, concepto o instalaciones sin declarar una necesidad más concreta. Compartir el nombre, la residencia o recibir el brochure no significa elegir un inmueble.

**Gestión correspondiente:** responder la consulta y solicitar los datos de presentación pendientes cuando corresponda. El nombre y la residencia se relacionan con el ofrecimiento del brochure; se conservan las excepciones actuales de entrega. No se exige identidad legal para esta presentación.

**Salida:** pasa a Necesidad identificada al declarar qué busca o su finalidad; una consulta de precios, disponibilidad, financiamiento o visita puede llevarlo directamente a Interés comercial.

### Necesidad identificada

El lead ha declarado qué busca o para qué necesita el inmueble. La declaración debe conservarse con evidencia; no basta una preferencia predeterminada del showroom o una suposición del bot.

**Ejemplos:**

- «Busco un departamento para vivir con mi familia».
- «Quiero un local para abrir una cafetería».
- «Me interesa comprar para arrendar después».
- «Necesito tres dormitorios y prefiero una planta alta».

No necesita haber definido presupuesto, fecha de compra, banco ni una unidad concreta. Tampoco tiene que responder todas las preguntas de calificación para permanecer en esta etapa.

**Gestión correspondiente:** conservar la necesidad y orientar la información hacia ella. Preguntar únicamente lo que ayude a atender su solicitud actual, evitando repetir datos conocidos.

**Salida:** una consulta comercial respaldada, una selección expresa de unidad o una gestión de cita acredita Interés comercial.

### Interés comercial

Existe una señal comercial respaldada: consulta de precios, disponibilidad, financiamiento, reserva informativa, solicitud de visita o elección expresa de una unidad identificable. La implementación reconoce estas señales mediante eventos aceptados, memoria estructurada y registros operativos.

**Ejemplos y límites:**

| Declaración del lead | Qué acredita | Qué todavía no acredita |
| --- | --- | --- |
| «¿Qué precio tienen los departamentos?» | Consulta comercial general de una categoría. | Elección de departamento, presupuesto o intención de reservar. |
| «¿Sigue disponible el 304?» | Consulta de disponibilidad. | Elección de esa unidad o reserva. |
| «¿Qué requisitos piden para el crédito?» | Consulta financiera. | Autorización para recopilar identidad legal o iniciar una evaluación. |
| «Ayúdeme a coordinar una visita el jueves» | Solicitud de visita. | Cita confirmada. |
| «Prefiero el penthouse 605, el de tres baños» | Elección expresa de una unidad, si la referencia se resuelve correctamente. | Reserva, pago o compra cerrada. |
| «¿Cómo se hace una reserva?» | Interés informativo sobre la reserva. | Solicitud operacional ejecutada. |

**Gestión correspondiente:** responder el asunto comercial y respetar los permisos de cada trámite. Si solo está conociendo el proyecto, preguntar un precio no obliga a volver a pedir presupuesto, dormitorios o financiamiento.

**Unidad elegida:** se guarda en un campo independiente. La etapa actual no incorpora una columna adicional llamada Unidad definida.

**Financiamiento autorizado:** se registra su aceptación y se sigue el flujo de unidad, entidad y datos requeridos. Esa gestión puede desarrollarse dentro de Interés comercial; no equivale a Proceso de reserva.

**Salida:** pasa a Proceso de reserva cuando existe la solicitud operacional respaldada. Si se registra una venta real sin etapas intermedias disponibles, el cierre acredita Venta cerrada.

### Proceso de reserva

Existe una solicitud operacional de reserva con unidad o unidades identificadas, evidencia del cliente y mensaje de origen. Representa una gestión que debe atender el equipo comercial.

**Ejemplo:**

> Lead: Quiero iniciar la reserva del departamento 304. Por favor, ayúdeme con el trámite.

La frase debe interpretarse y generar el registro correspondiente. Si ese registro falla, no se debe presentar la reserva como iniciada correctamente; debe quedar una gestión pendiente y el diagnóstico del fallo.

**No significa:** inventario bloqueado, pago recibido, contrato firmado o reserva confirmada. La solicitud al equipo y la reserva efectiva son hechos diferentes.

**Gestión correspondiente:** asignar y dar seguimiento a la solicitud, verificar disponibilidad y condiciones y registrar los resultados. La reserva no se confirma a partir de puntuación, temperatura o una recomendación del bot.

**Salida:** un cierre real de venta permite pasar a Venta cerrada. Una cancelación o cierre sin venta requiere registrar el resultado y su motivo; el silencio por sí solo no lo produce.

### Venta cerrada

Existe un cierre comercial registrado y vinculado al lead y a la unidad. La proyección actual utiliza el registro operativo de cierre de venta.

**Ejemplo:** el equipo registra el cierre del departamento 304 asociado al comprador y a la operación correspondiente.

«Me gusta», «lo voy a comprar», una puntuación alta, una solicitud de reserva o un estado antiguo marcado como vendido no sustituyen ese cierre. Que una unidad se venda a otra persona tampoco convierte en comprador a todos los leads que la consultaron.

**Gestión correspondiente:** continuar con las tareas posteriores a la venta que correspondan. Cualquier rectificación debe gestionarse en el registro operativo, con su respaldo.

## Información que acompaña a la etapa

### Nutrición

La nutrición se activa cuando existe interés de compra futura declarado, un motivo, un plazo o condición y acuerdo de contacto respaldado. No comienza automáticamente por saludar, recibir información o guardar silencio.

> Lead: Me interesa el 605, pero compraría el próximo año. Sí, podemos seguir en contacto.

La ficha puede mostrar **Interés comercial**, unidad elegida **605** y **Nutrición activa**. La etapa conserva el avance; la nutrición indica cómo acompañarlo durante la espera.

El bot sigue respondiendo si el lead escribe. Debe atender consultas sin reiniciar por rutina la calificación. Una petición expresa de avanzar ahora puede terminar la pausa.

Registrar una fecha de retoma no programa por sí solo un WhatsApp. Para mostrar un envío programado tiene que existir una tarea real del ejecutor.

### Estado de atención

| Estado | Significado |
| --- | --- |
| Por atender | No se acredita una respuesta en las fuentes consultadas. |
| Respuesta pendiente del equipo | El lead escribió después de la última respuesta o mantiene consultas pendientes. |
| Esperando respuesta del lead | Existe respuesta registrada y no se detecta una solicitud pendiente según las fuentes disponibles. No demuestra rechazo ni desinterés. |
| Atención por verificar | No se pudo comprobar la información de atención. |

Un cliente en Interés comercial puede tener Respuesta pendiente del equipo. Eso no lo convierte en Nuevo.

### Citas y visitas

La cita se conserva como gestión independiente: solicitada, en coordinación, confirmada, realizada, cancelada o con inasistencia registrada. Una invitación del bot no crea una cita confirmada. La confirmación exige el registro operativo, aceptación del cliente y fecha y hora correspondientes.

Cancelar una cita no cierra automáticamente la oportunidad. Solicitar una visita acredita interés comercial; no reserva el inmueble.

### Resultado de la oportunidad

La oportunidad puede estar abierta, cerrada sin venta con motivo, o ganada mediante un cierre real. Cerrado sin venta es un resultado separado de las seis columnas actuales. El silencio no equivale a cierre.

### Puntos y temperatura

Los puntos valoran señales de interacción conforme a las reglas configuradas. La temperatura resume esa valoración según los umbrales del proyecto. No son un porcentaje de probabilidad de compra ni una aprobación financiera.

Un lead caliente puede seguir en Interés comercial. Solo la evidencia operacional de reserva o venta permite reconocer esos avances.

## Ejemplos de recorridos completos

| Situación | Etapa y campos que corresponden |
| --- | --- |
| Deja datos en el showroom y todavía no recibe atención. | Nuevo / Por atender; origen Showroom; ninguna unidad elegida por navegación. |
| Recibe bienvenida y consulta qué incluye el proyecto. | Contacto inicial; atención según quién tenga la respuesta pendiente. |
| Explica que necesita tres dormitorios para vivir. | Necesidad identificada; finalidad y dormitorios conservados. |
| Desde su primer mensaje pregunta precios de departamentos. | Interés comercial cuando se registra la señal; no requiere completar las etapas anteriores. |
| Elige el 605, pero compra el próximo año y acuerda contacto. | Interés comercial; unidad 605; nutrición activa con evidencia y horizonte. |
| Solicita una visita para el jueves. | Interés comercial; cita solicitada o en coordinación hasta su confirmación real. |
| Pregunta cómo reservar y luego guarda silencio. | Interés comercial; sin reserva operacional; seguimiento sujeto a permisos y configuración. |
| Pide iniciar la reserva y se registra la solicitud respaldada. | Proceso de reserva; gestión del equipo pendiente, sin prometer bloqueo de inventario. |
| Se registra el cierre real de la compra. | Venta cerrada; resultado ganado. |

## Diagnóstico de los avisos del embudo

Los tres mensajes de la captura aparecían cuando fallaba una fuente complementaria de datos. El cargador permitía mostrar el resto del tablero, marcaba la cobertura como incompleta y agregaba un aviso. Su versión anterior descartaba el código concreto de cada error y utilizaba un texto general.

La frase «Su ausencia no acredita que no exista» intenta impedir que una consulta fallida se interprete como una lista vacía confirmada. Su redacción resulta ambigua: lo que falta es la lectura, no necesariamente el registro.

### Solicitudes de reserva

El cargador anterior consultaba `lead_reservation_requests` con la sesión autenticada del usuario. La migración que crea esa tabla revoca el acceso a `authenticated` y permite lectura únicamente a `service_role`. Las migraciones revisadas no añaden una política de lectura para usuarios autenticados.

Esta incompatibilidad explica un fallo de permisos posible aun cuando la tabla existe. La consulta administrativa de solo lectura realizada contra la base configurada en `.env.local` sí pudo acceder a esa tabla.

**Corrección aplicada localmente:** el servidor obtiene primero los IDs de leads visibles mediante la sesión y RLS del usuario. Consulta las reservas exclusivamente para esos IDs y selecciona los campos necesarios para la ficha y clasificación. No concede lectura general ni expone una credencial administrativa al navegador. Sin leads autorizados no realiza esa consulta privilegiada; sin configuración administrativa informa que la fuente no pudo comprobarse.

### Ficha guardada e historial de etapas

Los avisos anteriores mencionaban una posible migración porque las tablas se incorporaron con `20261015210000_lead_commercial_pipeline.sql`. Esa frase se agregaba ante cualquier error: permisos, conexión, caché del esquema u otra causa.

La comprobación administrativa actual confirmó que `lead_commercial_profiles` y `lead_commercial_stage_observations` existen y son consultables en la base configurada localmente. Esto no verifica la sesión del usuario de la captura ni demuestra que la captura utilice el mismo entorno. No corresponde concluir que hoy faltan esas tablas a partir del texto mostrado.

**Corrección aplicada localmente:** se conserva el código seguro, fuente, categoría y referencia del fallo. Se distingue estructura ausente, permiso insuficiente, fallo temporal, configuración del servidor y error inesperado. Los mensajes originales de base de datos no se envían al cliente. La recomendación de revisar migraciones se limita a fallos de estructura. La comprobación del acceso debe repetirse con la sesión y el entorno afectados.

### Presentación y recuperación de los avisos

El tablero muestra un aviso de cobertura, con detalle desplegable y reintento. Su contenido se adapta a la causa registrada:

> Algunas secciones no pudieron cargarse. La clasificación puede estar incompleta.
>
> Reservas: no se pudieron consultar con su acceso actual.
>
> Ficha guardada e historial: consulte el diagnóstico de cada fuente.
>
> Reintentar carga · Ver detalle técnico

El diagnóstico técnico debe incluir la causa registrada y una referencia de ejecución, sin credenciales ni contenido sensible. Los estados «sin reservas», «nutrición no activa» o «sin historial» no deberían presentarse como confirmados cuando su fuente está indisponible.

El aviso se retira cuando una nueva consulta verifica la recuperación. Las columnas señalan el recuento provisional y los contactos afectados muestran etapa o nutrición por verificar. Las secciones de reservas, citas, seguimiento e historial distinguen una lista vacía verificada de una fuente indisponible. La nutrición no comprobada queda fuera de los filtros Activa y No activa hasta recuperar su lectura.

## Diagnóstico del resumen y la línea de tiempo

### Por qué aparecen el evento y los puntos por separado

La versión anterior de `buildAutomationTimeline` generaba dos elementos por cada registro de `lead_score_events`: uno de tipo Evento detectado, con el identificador interno, y otro de tipo Puntos asignados, con su incremento y motivo. El componente del resumen presentaba ambos como tarjetas independientes.

Por tanto, `asked_delivery_date` y «+15 · preguntó por fecha de entrega» representan el mismo registro. Son dos representaciones visuales; esa duplicación no demuestra que se hayan sumado dos veces los puntos.

### Traducción y significado de los eventos de la captura

| Identificador interno | Nombre visible propuesto | Significado | Puntos registrados en las reglas consultadas |
| --- | --- | --- | --- |
| `first_response` | Participación del lead | Se registra una señal de respuesta del lead. No representa la primera respuesta del bot ni del asesor. | +5 |
| `declared_unit_type` | Tipo de inmueble indicado | El lead declara qué tipo de inmueble le interesa. No elige una unidad concreta. | +10 |
| `requested_visit` | Solicitud de visita | Se registra una señal de solicitud de visita. No demuestra confirmación de cita. | +40 |
| `asked_delivery_date` | Consulta de fecha de entrega | El lead pregunta por los plazos del proyecto. No acredita una fecha prometida. | +15 |

Estos valores coinciden con las reglas activas consultadas el 15/10/2026 y con la captura. Son configurables. El historial debe mostrar los puntos guardados al ocurrir cada evento, aunque después cambie la regla.

`first_response` se añade durante la normalización de mensajes. La regla actual no es repetible y la escritura usa una clave de hito por lead para evitar acreditarla en cada mensaje. El texto guardado «respondió el primer mensaje» es menos preciso que Participación del lead; conviene conservar el dato histórico y mejorar su explicación visible.

El motivo actual de `declared_unit_type` menciona departamento o suite, aunque el contrato admite otros tipos. La explicación visible debe utilizar la preferencia respaldada cuando esté disponible, o una descripción general del tipo de inmueble, sin inventar una selección.

### Presentación implementada localmente

Cada evento aparece una sola vez, con nombre, explicación y variación de puntos juntos:

> **Consulta de fecha de entrega · +15 puntos**
>
> El lead preguntó por los plazos de entrega del proyecto.
>
> 15 de octubre de 2026, 17:33 · Hora de Ecuador

> **Participación del lead · +5 puntos**
>
> Se registró su participación en la conversación. Esta regla se acredita una sola vez por lead.
>
> 15 de octubre de 2026, 17:20 · Hora de Ecuador

Un detalle desplegable puede conservar el identificador, el motivo original y la referencia al mensaje. Los eventos desconocidos deben tener una etiqueta comprensible y conservar el código en ese detalle, sin inventar significado.

El resumen superior reúne etapa comercial y su motivo, atención pendiente, unidad elegida, cita, nutrición, próxima acción y puntuación actual con temperatura. La explicación aclara el significado de los puntos. Los datos técnicos de Kommo y los identificadores quedan en Origen e integración.

### Temperatura, totales y mensajes relacionados

El cambio de temperatura debe conservar su propia entrada cuando existe un registro real. Por ejemplo: «Temperatura: de tibio a caliente · puntuación registrada: X». La puntuación se muestra solo si el registro la contiene; no se completa con una estimación.

Unir evento y cambio de temperatura como causa y efecto exige una referencia fiable. La coincidencia de minuto no basta: pueden existir varias señales o mensajes en el mismo periodo. Si falta correlación, se presentan próximos en el tiempo y sin atribuir una causalidad individual.

Los incrementos +5, +10 y +40 suman 55; añadir +15 da 70. Ese cálculo ilustra las señales visibles, pero no acredita el total del lead: puede haber eventos anteriores, ajustes o una captura parcial. La interfaz debe leer el total registrado y evitar reconstruir un saldo histórico a partir de una página incompleta.

La línea anterior incluía mensajes del cliente y del asesor, pero no las respuestas del bot. La nueva presentación incorpora registros del bot y permite abrir el mensaje original cuando se puede resolver por ID interno o externo. Distingue la fecha de registro de la señal de la fecha del mensaje y usa hora de Ecuador incluso si el navegador está en otro huso horario.

La traducción debe reutilizar `CONVERSATION_EVENT_DETAILS`, ya existente, para conservar el mismo significado en el inspector y el resumen. No se necesita otra colección independiente de frases.

## Correcciones aplicadas localmente y cómo comprobarlas

| Prioridad | Corrección | Comprobación necesaria |
| --- | --- | --- |
| Alta | Resolver la lectura autorizada de reservas. | Usuario autorizado puede leer su alcance; usuario ajeno no accede; una solicitud respaldada permite clasificar Proceso de reserva. |
| Alta | Conservar y clasificar los errores de cada fuente. | Estructura ausente, permiso denegado y fallo temporal producen diagnósticos distintos. |
| Alta | Mostrar cobertura incompleta y recuperación real. | Una lectura fallida no muestra ausencia confirmada; al recuperarse desaparece el aviso y se recalculan cifras. |
| Alta | Unificar ficha, etapas e historial comercial entre Leads y Automatización. | El mismo lead presenta iguales criterios comerciales y permisos desde ambos accesos. |
| Media | Mostrar un solo elemento por evento con puntos y significado. | Dos representaciones del mismo registro se convierten en una; dos eventos diferentes no se fusionan. |
| Media | Traducir eventos con el contrato compartido y mejorar los motivos imprecisos. | Ningún código conocido queda como título; first_response no se describe como respuesta del bot. |
| Media | Ordenar el resumen y dar contexto a la temperatura. | Etapa, atención, puntuación y citas se distinguen; no se atribuye una reserva a una puntuación alta. |
| Media | Vincular evidencia y fechas con el intercambio original. | Sin referencia fiable no se inventa mensaje de origen, causalidad ni puntuación acumulada. |

Las comprobaciones locales cubren acceso exacto a reservas, errores y recuperación de fuentes, significado de eventos, incrementos históricos, referencias de mensajes, clasificación provisional, acceso desde Automatización y protección financiera. Las revisiones en Chromium usan componentes reales con datos simulados, en escritorio y móvil. No se modifican pesos de puntuación ni políticas de lectura de la base. El despliegue y la comprobación con usuarios reales siguen pendientes.

## Ficha comercial compartida

Leads y Automatización utilizan el mismo panel y la misma acción de servidor para presentar la ficha. Se conservan la autorización por sección, el alcance RLS del contacto, la restricción de edición por responsable y el acceso financiero con aceptación y permiso correspondiente.

Automatización deja de consultar por su cuenta la identidad legal y los ingresos para construir una segunda ficha. El formulario de resultado financiero se conserva en la ficha común para administradores autorizados. Historial de etapas y Visitas muestran los mismos registros comerciales que la ficha; las antiguas etapas del bot no se utilizan como historial comercial actual.

La pestaña antigua Nutrición se denomina Seguimientos automáticos. Nutrición sigue siendo la pausa de compra futura con acuerdo de contacto, visible en la ficha y el resumen. Los seguimientos de otros responsables no se presentan como ausentes cuando el usuario no puede comprobarlos.

## Referencias de implementación

- Etapas y campos: `src/types/leadPipeline.ts`.
- Criterios de clasificación: `src/lib/inmobiliaria/leadPipeline.ts` y sus pruebas.
- Carga y avisos: `src/services/leadPipelineSources.service.ts`.
- Reserva operacional y permisos originales: `supabase/migrations/20260929101000_reservation_handoff_receipt.sql`.
- Persistencia comercial e historial: `supabase/migrations/20261015210000_lead_commercial_pipeline.sql`.
- Construcción de la línea de tiempo: `src/lib/inmobiliaria/leadAutomation.ts`.
- Presentación del resumen: `src/components/inmobiliaria/automation/AutomationLeadDetailDrawer.tsx`.
- Significado compartido de eventos: `src/lib/integrations/automation/event-contract.ts`.
- Normalización de participación: `src/lib/integrations/automation/conversation-rules.ts`.

