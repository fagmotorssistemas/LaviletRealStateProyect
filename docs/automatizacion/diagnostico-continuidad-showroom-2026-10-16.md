# Continuidad de selección y contacto del showroom

Fecha: 16 de octubre de 2026. Estado: diagnóstico contrastado y correcciones implementadas localmente, pendientes de despliegue y comprobación real. El cierre al final distingue el código terminado de sus dependencias productivas. No se ejecutaron envíos a leads durante esta implementación.

La conversación revisada aceptó explorar tres dormitorios y luego expresó preferencia por el 605. La aceptación quedó guardada, pero la elección acompañada de una pregunta de precio se redujo a una consulta informativa. El plan usó un conjunto vacío de unidades elegidas y volvió a preguntar qué requisito flexibilizar. El enlace 360 estaba disponible y quedó opcional. Ajustar únicamente el tono del redactor no corrige esta cadena.

## Hallazgos de la conversación

Las horas siguientes corresponden a Ecuador continental y Colombia. Los importes y superficies son los de las fuentes de esa ejecución, no una cotización comercial vigente.

| Momento | Evidencia | Consecuencia |
| --- | --- | --- |
| 00:27 | Se piden cinco dormitorios y su precio. La búsqueda completa no encuentra coincidencias y ofrece alternativas de tres. | Corresponde explicar directamente la distribución disponible; «precio autorizado» y «opciones residenciales verificadas» trasladan lenguaje técnico al cliente. |
| 00:33 | «Sí, sí, está bien, exploremos esas opciones». La memoria guarda exploración autorizada y tres dormitorios aceptados. | No corresponde volver a pedir esa misma aceptación en turnos posteriores. El requisito original puede conservarse como antecedente. |
| 00:35 | Elige revisar penthouses por amplitud y pregunta precio. | La respuesta ofrece 602 y 605 con precios, pero omite las diferencias físicas que ya estaban disponibles. El plan suprime la presentación de unidades al atender una consulta informativa. |
| 00:39 | Pregunta diferencias aparte del precio. | El bot sí explica baños y superficies. Esto confirma que los datos existían; la primera omisión no se debió a falta de fichas. |
| 00:42 | «Entonces el 605 me gusta más» y «¿qué precio tenía?», en el mismo lote. | El extractor conserva `ask_price`, `details` y el número 605, pero no una decisión de selección independiente. |
| 00:43 | La resolución identifica el 605, mantiene `selected_ids` vacío y deja la consulta con alcance `selected`. | El plan obtiene cero candidatos, declara que hay que aclarar requisitos y el redactor recupera los cinco dormitorios del antecedente. |

El problema final no fue una interrupción técnica del extractor ni un fallback. Hubo respuesta generada y entregada. La interpretación de precio pasó; la decisión simultánea de elección no se conservó.

### Selección y consulta simultáneas

`property-context.ts` conserva la selección anterior para operaciones `details`; solo crea una selección nueva cuando la operación es `select`. Un mensaje con elección y precio puede quedar clasificado únicamente como `details`. El número de unidad se resuelve y enfoca, pero no queda elegido. Luego `commercial-journey.ts` restringe la planificación a `context.selected_ids` si el alcance es `selected`; con esa lista vacía, no encuentra candidatos y alcanza `clarifyRequirements()`.

La solución debe representar por separado la consulta actual, el sujeto al que se refiere y la decisión expresada. «El 605 me gusta más; ¿qué precio tenía?» conserva la preferencia concreta y responde precio. «¿Cuánto cuesta el 605?» identifica un sujeto, pero por sí solo no elige una unidad. Ninguna variante autoriza reserva, pago, cita o recopilación financiera.

Un alcance de selección vacío exige resolver la referencia o pedir aclaración, según la evidencia. No acredita incompatibilidad de dormitorios ni ausencia de inventario. La comprobación debe ocurrir antes de construir el plan comercial.

### Necesidad original y alternativa aceptada

La memoria conserva cinco dormitorios como necesidad original y, por separado, tres como exploración aceptada. El plan del último turno incluso recupera el filtro de tres, pero usa el conjunto vacío de seleccionados. Su diagnóstico de incompatibilidad permite después que el redactor vuelva a la necesidad antigua.

La búsqueda activa debe usar el ajuste aceptado hasta que el cliente lo cambie. Conservar el antecedente no lo convierte en una obligación pendiente. Una nueva declaración como «no, al final sí necesito cinco» sí cambia la búsqueda; una pregunta de precio o una cortesía no la cambia.

### Fuentes compartidas con el revisor

El revisor recibió `fuentes_autorizadas.unidades=[]` y `grupos=[]`. Por ello rechazó el respaldo del precio y de los tres dormitorios del 605. La revisión estaba en modo observación (`enabled=false`, `blocking=false`), por lo que ese resultado no impidió la entrega.

Debe existir una referencia factual común para resolución, planificación, redacción y revisión, incluyendo la ficha de la unidad explícita aunque todavía no exista una elección comercial. No se debe activar un bloqueo general como sustituto de reparar las fuentes: podría convertir respuestas correctas en nuevas contingencias. Primero se corrige la proyección y se verifica su coherencia; el modo de aplicación del revisor se mantiene como una decisión independiente.

### Recorrido disponible pero opcional

El resultado ya tenía `https://www.lavilett.com/tour?unidad=605`. El contrato dejó `required_links=[]`, porque no reconoció una selección nueva. La regla de enlaces considera obligatorio el recorrido de una selección nueva válida, salvo rechazo o envío previo según corresponda.

Al conservar la elección, se debe calcular el material requerido sobre esa misma unidad. El enlace no sustituye la respuesta de precio. No se reenvía por rutina si ya fue entregado, no se fuerza si el cliente lo rechaza y no se inventa cuando no existe un modelo autorizado. Una representación compartida por varias unidades debe identificarse con ese alcance.

## Respuestas de referencia

Estos ejemplos fijan la intención y los hechos mínimos; no son plantillas obligatorias ni pruebas de variación de sinónimos.

**Cinco dormitorios sin coincidencias y consulta de precio:**

> Lamentablemente, no contamos con viviendas de cinco dormitorios, por lo que no tenemos un precio para esa distribución. Podemos ayudarle a revisar departamentos y penthouses de tres dormitorios con espacios amplios. ¿Le gustaría conocer estas alternativas?

La afirmación de ausencia requiere catálogo completo para el alcance consultado. Si falla la lectura o faltan fichas, corresponde explicar que se comprobará disponibilidad; no declarar inexistencia. Si el cliente considera cinco dormitorios indispensables o ya rechazó la alternativa, no insistir en tres.

**Primera presentación de los dos penthouses:**

> En la sexta planta alta tenemos dos penthouses de tres dormitorios:
>
> • 602: 142,09 m² interiores, 25,30 m² exteriores y dos baños completos. Precio referencial: USD 341.016.
> • 605: 140,53 m² interiores, 23,01 m² exteriores y tres baños completos. Precio referencial: USD 337.272.
>
> El 602 tiene un poco más de superficie; el 605 ofrece un baño completo adicional. ¿Cuál le gustaría revisar con más detalle?

No es necesario volcar todos los campos. Se incluyen dos o tres diferencias útiles para la prioridad expresada. Elegir una categoría no vuelve a pedir dormitorios ni obliga a pedir planta cuando solo existe una compatible. Esta propuesta no cambia la presentación general de los nueve locales, aplazada expresamente.

**Elección del 605 acompañada de pregunta de precio:**

> El penthouse 605 tiene un precio referencial de USD 337.272. Cuenta con tres dormitorios y tres baños completos. Aquí puede explorar su distribución en el showroom 360: https://www.lavilett.com/tour?unidad=605. Es una representación del proyecto.

No hace falta una pregunta al final de cada respuesta. Si la continuación aporta algo, debe partir de la unidad ya elegida, sin reabrir el ajuste aceptado.

## Nombre que se muestra en las conversaciones

La ruta de Workflow usa `leads.name` y, si falta, genera literalmente `Lead Kommo #...`. El webhook ya recoge el nombre del autor del mensaje; la ejecución revisada conserva un alias de WhatsApp. Esa fuente no se usa como alternativa en esa etiqueta.

La propuesta es mostrar primero el nombre declarado por el cliente o registrado por él en el formulario; después, el nombre disponible de su perfil de WhatsApp o del contacto, distinguiendo su origen. Como última alternativa, teléfono enmascarado o «Contacto sin nombre». El ID de Kommo permanece en el detalle técnico y en la búsqueda. La agrupación sigue usando IDs estables, nunca nombres, para evitar mezclar homónimos.

Un alias de WhatsApp no confirma identidad legal ni reemplaza los datos exigidos para una revisión financiera. No debe tomarse el nombre de un asesor, del bot o del negocio como nombre del cliente. Tampoco una etiqueta genérica de Kommo debe imponerse sobre un nombre disponible del contacto.

## Entrada del showroom

Se propone una entrada específica de showroom que reutilice el motor conversacional y la ficha común. No conviene duplicar toda la lógica de catálogo, visitas, precios y consentimiento en otro bot. La entrada aporta origen, material observado, datos registrados y propósito de la invitación; después continúa con las reglas comunes.

### Configuración proporcionada

| Uso | Identificador |
| --- | --- |
| Campo de texto «Unidad Observada Showroom» | `538638` |
| Salesbot con unidad observada | `26428` |
| Salesbot sin unidad observada | `26430` |

Son identificadores proporcionados por el responsable. La captura posterior muestra la plantilla con unidad aprobada, en categoría marketing. Falta comprobar en la cuenta la vinculación de los Salesbots, las variables y los botones y verificar por separado la plantilla genérica; no están activados por este diagnóstico. Un ID de Salesbot no es por sí mismo un ID de plantilla aprobada por Meta.

La captura confirma el cuerpo **«Estuvo revisando [Unidad Observada Showroom]»**. Por tanto, el campo `538638` debe contener **«el penthouse 605»**, sin repetir «revisando». El ejemplo «nuestros espacios» es una muestra para la variable; no acredita qué unidad observó un visitante concreto. No se requiere cambiar el texto por esta causa.

La navegación acredita que revisó una unidad cuando la asociación es fiable; no acredita que la eligió. Si el recorrido representa varias unidades o el interés no se puede atribuir, usar el Salesbot genérico. Los umbrales de tiempo anteriores siguen siendo propuestas, no un disparador implementado.

### Datos de los formularios

| Ruta del showroom | Datos solicitados |
| --- | --- |
| `TourLeadGate` | Nombre, correo y teléfono. |
| `TourInfoRequestModal`, formulario completo | Nombre, correo, teléfono y solicitud. |
| `TourInfoRequestModal`, teléfono ya conocido | Solicitud sin repetir el formulario completo. |
| `TourPhoneUnlockModal` | Teléfono. |

Estas rutas no preguntan residencia actual. La geolocalización que puede completar ciudad o país es una señal de navegación, no residencia declarada. Antes de preguntar, se revisan formulario vinculado y ficha común; no se presupone que todos los registros incluyen nombre.

### Respuestas a los botones

| Botón | Tratamiento propuesto |
| --- | --- |
| Sí, quiero información | Acepta información sobre la invitación vinculada. Con unidad observada fiable, comienza por esa unidad; con invitación genérica, pregunta qué le gustaría conocer. No acepta financiamiento, cita, reserva ni elección de compra. |
| Más adelante | Reconoce la preferencia y permite acordar cuándo contactar. No asigna automáticamente siete días ni activa nutrición sin el acuerdo correspondiente. Si el cliente sigue preguntando, responde su consulta. |
| No recibir mensajes | Registra la baja del alcance de contacto correspondiente y cancela invitaciones y seguimientos automáticos pendientes; confirma brevemente. No revoca por error una reserva ni borra el expediente. |

La respuesta se vincula al mensaje realmente enviado, su propósito y su contexto. No se interpreta cualquier «sí» de cualquier conversación como aceptación del showroom. Si existe una invitación antigua y ahora pregunta otra cosa, prevalece la consulta actual. Un botón reenviado o duplicado no dispara dos respuestas ni dos gestiones.

Si nombre conocido y residencia pendiente, se puede responder primero sobre el espacio y añadir:

> Para conocer un poco mejor lo que busca, ¿en qué ciudad o país reside actualmente?

Otra opción es atender su duda primero y pedir la residencia después, cuando aporte continuidad. En esta entrada no se presenta la residencia como requisito para desbloquear información o para enviar un brochure ya ofrecido. No se cambia globalmente la apertura normal ni sus excepciones de entrega.

Si solo hay teléfono, se pide nombre y residencia cuando corresponda; si ya están ambos, no se repiten. Los datos del formulario deben incorporarse con evidencia de su origen y vínculo con el contacto, sin convertir el alias del perfil o la ciudad inferida por IP en datos declarados.

El primer mensaje requiere permiso, plantilla/canal habilitados y control de duplicados. Si ya escribió por WhatsApp o el equipo atiende su solicitud, se cancela la invitación genérica pendiente. Antes de lanzar el Salesbot se guarda una invitación con identificador único y estado; una respuesta de resultado desconocido se concilia antes de reintentar. Las respuestas recibidas desde Kommo deben conservarse en el historial común para que el motor reconozca a qué invitación contesta.

## Indicador de escritura

WhatsApp Cloud API dispone de una operación para mostrar el indicador real de escritura y marcar el mensaje como leído. Se necesita acceso al número de WhatsApp y al ID del mensaje entrante de Meta. El ID de evento o de mensaje interno de Kommo no debe usarse como sustituto sin verificar la correspondencia. Referencia: [colección oficial de Meta](https://www.postman.com/meta/whatsapp-business-platform/request/lhf0duq/send-typing-indicator-and-read-receipt).

La operación [Transfer typing information de Kommo](https://developers.kommo.com/reference/typing-info) describe el indicador del cliente dentro de la interfaz de Kommo; no acredita el indicador del negocio en el WhatsApp del lead. Hay que verificar la capacidad del canal conectado o acceso autorizado a Cloud API antes de prometer su integración.

Se mostraría mientras se prepara una respuesta real, respetando la vigencia del indicador del proveedor. Un fallo de ese aviso no debe detener la respuesta. No se añade una burbuja de texto «escribiendo...» ni una demora artificial. La ejecución de precio revisada tardó aproximadamente 67 segundos desde recepción del último evento hasta completarse; el indicador no sustituye revisar agrupación, colas y llamadas secuenciales para reducir esa espera.

## Ubicación del análisis y alcance aplazado

El futuro panel **Análisis de conversaciones** irá como entrada propia de la barra lateral, cerca de Inicio, con acceso desde la ficha compartida. No será otra pestaña dentro de Automatización. El vínculo de ficha abre el mismo expediente, sin crear una segunda identidad del lead.

El envío de fotografías y renders queda aplazado por instrucción expresa del 16 de octubre. Las propuestas anteriores de JPEG/PNG, adjuntos y coordinación con el 360 se conservan como referencia futura, sin implementación en esta revisión.

## Prioridad y notificación de reserva

La etiqueta **Alta** de la bandeja significa prioridad de atención. No representa temperatura comercial, puntuación ni confirmación de reserva. En el caso de la primera captura, la consulta está marcada con `sla_status=vencido`: el plazo de respuesta expiró. El motivo es una consulta sin respuesta por `TURN_INTERPRETATION_INVALID`, no una solicitud de reserva.

La solicitud del 605 quedó efectivamente guardada el 16 de octubre a las 00:49, con recibo de reserva solicitada y `handoff_status=queued`. No tiene asesor asignado ni notificaciones en `advisor_notifications` al realizar esta consulta. Es una solicitud para iniciar la gestión, no una reserva confirmada del inventario.

El código del aviso urgente existe: la migración `20261014180000_urgent_reservation_notifications.sql` prepara las notificaciones y `UrgentReservationAlert` presenta un diálogo con «Atención urgente», «Un cliente quiere reservar», acceso a Kommo y confirmación de lectura. El destinatario es el asesor asignado habilitado para ese proyecto. La función sale sin crear aviso cuando `assigned_to` es nulo. La lógica contempla notificar después de asignar una solicitud en cola.

En esta ejecución la solicitud llegó fuera del horario configurado: viernes de 08:30 a 18:30, zona America/Guayaquil. La asignación de un contacto sin responsable respeta ese horario; el recibo real confirma que quedó en cola. Esta condición explica la falta de destinatario; no permite certificar por sí sola que todos los triggers productivos estén instalados correctamente.

Queda una cobertura pendiente: una solicitud de reserva sin asignar necesita un aviso persistente al responsable de coordinación o de guardia del proyecto, con destinatarios autorizados, aunque todavía no corresponda repartirla. Al asignarla debe notificarse al asesor real, con control de duplicados. El aviso y la cola son distintos: registrar la solicitud no demuestra haber notificado a alguien. Debe poder verse el estado del aviso y cualquier error de entrega.

También hay una clasificación frágil en `advisorAttention.ts`: la expresión de prioridad busca fragmentos como `reserv` con límite de palabra, que no coinciden con la palabra completa «reserva». Una solicitud en cola sin plazo vencido puede terminar como prioridad normal. Conviene derivar la prioridad de un tipo estructurado de solicitud; la coincidencia textual solo debe servir para compatibilidad histórica. El motivo visible debe decir, por ejemplo, «Reserva solicitada · sin asignar» o «Prioridad alta · plazo de respuesta vencido».

## Actualización de la interfaz sin interrumpir la lectura

`AdvisorAttentionQueue` llama cada treinta segundos a la recarga general del monitoreo. `useLeadAutomationDashboard` activa la carga general y vuelve a asignar el arreglo de tenants. La carga de la ficha depende de ese arreglo; se ejecuta nuevamente, pone `detailLoading=true` y el drawer sustituye el contenido por un spinner. Esto explica la interrupción aun cuando el usuario no cambió de lead.

La propuesta conserva actualizada la información mediante:

- Carga inicial visible y actualizaciones posteriores en segundo plano, manteniendo los datos anteriores durante la consulta.
- Invalidación de datos por eventos cuando el canal en tiempo real esté disponible, con una comprobación discreta de respaldo ante desconexión.
- Actualización de bandeja, ficha y contadores por separado; cambiar una asignación no exige recargar todo el monitoreo.
- Identificadores de acceso estables y aplicación de cambios solo cuando varían los datos pertinentes.
- Conservación de pestaña, posición de lectura, filtros, selección de texto y formularios sin guardar. Si una actualización entra en conflicto con una edición, avisar sin sobrescribirla.
- Sin ocultar la información ante un error temporal de actualización; mostrar el fallo y permitir reintento.
- Solicitudes agrupadas y cancelación de respuestas obsoletas para evitar consultas simultáneas y regresiones de estado.

Las notificaciones ya tienen un canal de cambios y comprobación periódica independiente. No hace falta eliminar la actualización de los avisos para evitar la recarga visual de la ficha. Una reserva urgente puede generar su alerta mientras el resto de la pantalla conserva la lectura. La propuesta no consiste únicamente en aumentar el intervalo.

## Alcance de las correcciones

| Prioridad | Cambio | Resultado esperado |
| --- | --- | --- |
| 1 | Aviso de reserva en cola sin asignar | Un responsable autorizado recibe el aviso urgente; queda evidencia de destinatario, estado y reintentos. |
| 1 | Prioridad estructurada de la bandeja | Una solicitud de reserva no queda normal por una coincidencia de texto; el motivo de Alta se entiende. |
| 1 | Actualización sin interrupciones | La ficha permanece visible y conserva la lectura mientras cambian los datos. |
| 1 | Elección y consulta en un mismo turno | Elegir 605 y preguntar precio conserva ambas intenciones. |
| 1 | Alcance de selección vacío | No se interpreta como falta de unidades ni reabre requisitos. |
| 1 | Alternativas aceptadas | Tres dormitorios aceptados siguen activos salvo cambio real del cliente. |
| 1 | Fuentes compartidas de revisión | El revisor recibe la ficha y el precio de la referencia resuelta. |
| 2 | Presentación de penthouses | Precio y diferencias útiles desde la primera comparación. |
| 2 | Lenguaje natural ante ausencia de distribución | Explicación directa, sin términos internos ni falta de precio atribuida a autorización. |
| 2 | Recorrido del espacio elegido | Enlace pertinente cuando corresponde, sin duplicar material ni inventar disponibilidad. |
| 2 | Nombre visible de conversaciones | Nombre declarado o alias válido de WhatsApp antes del identificador técnico. |
| 2 | Entrada del showroom y Salesbots | Conectar registro, contexto fiable, permiso, deduplicación, dos Salesbots y respuestas a botones. |
| 2 | Datos ya conocidos en showroom | Aprovechar nombre registrado y preguntar solo residencia u otros datos faltantes, sin reiniciar la apertura. |
| 3 | Indicador real de escritura | Verificar capacidad del canal y acceso al mensaje de Meta; integración no bloqueante. |
| 3 | Panel de análisis con IA | Entrada en barra lateral, análisis respaldado por evidencia y gráficas; implementación pendiente. |

Los umbrales de navegación y el retraso antes del contacto del showroom siguen propuestos. Las pruebas amplias y la validación del despliegue se realizan después de las correcciones acordadas. Los renders adjuntos y la primera presentación de dos o tres locales permanecen aplazados. Los pendientes históricos de retoma, recordatorios y prioridad entre reserva y cita mantienen su alcance; esta revisión no acredita que estén terminados.

## Casos para la corrección y las pruebas posteriores

1. Aceptar tres dormitorios y preguntar después precio: mantener el ajuste aceptado.
2. Elegir 605 y preguntar precio en uno o varios mensajes agrupados: conservar ambas acciones.
3. Preguntar solo precio del 605: informar sin inventar elección de compra.
4. Decir «me gusta el 605, pero necesito cinco dormitorios»: atender la incompatibilidad nueva, sin resolverla como aceptación irrestricta.
5. Rechazar explícitamente tres dormitorios: no insistir ni convertir crédito en solución física.
6. Buscar dentro de `selected` sin selección guardada: resolver sujeto o aclarar; no declarar falta de unidades.
7. Elegir una unidad no disponible, un código inexistente o dos alternativas: no recuperar arbitrariamente otra selección antigua.
8. Presentar dos penthouses tras elegir categoría y pedir precio: incluir diferencias físicas útiles y precios, sin repetir dormitorios como pregunta.
9. Unidad con 360 disponible, ya enviado, rechazado o inexistente: aplicar cada condición sin omisiones ni duplicaciones.
10. Ficha resuelta por precio con revisión posterior: el revisor recibe esa misma fuente, incluso si no hubo selección comercial.
11. Showroom con nombre, solo teléfono o residencia ya declarada: pedir exclusivamente campos pendientes.
12. Botones del showroom frente a un «sí» sin invitación, respuestas tardías y duplicados: vincular contexto y preservar la consulta actual.
13. Opt-out antes de un trabajo pendiente: cancelar el envío; no reactivarlo por una visita nueva al sitio.
14. Navegación entre varias unidades o modelo compartido: invitación genérica, sin preferencia inventada.
15. Alias de WhatsApp, homónimos o nombres técnicos de Kommo: etiqueta legible sin mezclar contactos ni confirmar identidad legal.

Estos son casos y criterios documentados; no simulaciones ejecutadas ni cambios ya desplegados.

## Referencias técnicas para implementación

- `src/app/api/integrations/automation/workflow/route.ts`: etiqueta del contacto en el historial.
- `src/lib/integrations/automation/webhook.ts`: nombre de autor recibido.
- `src/lib/integrations/automation/turn-semantics.ts` y `turn-interpretation-input.ts`: elección independiente de consulta informativa.
- `src/lib/integrations/automation/property-context.ts`: selección, foco, aceptación de alternativas y alcance.
- `src/lib/integrations/automation/commercial-journey.ts`: compatibilidad y presentación.
- `src/lib/integrations/automation/response-plan.ts`: enlaces requeridos según decisión y entrega previa.
- `src/lib/integrations/automation/business-risk-review.ts`: fuentes de la revisión.

La ejecución final contrastada corresponde al evento `9ea41d9c-4289-4650-ae5c-2406b36a90fe`, versión `5f23b2f6f1bf45ff5b1ad193b4d2d7da4e67b18b`. El corpus conserva escenarios anonimizados; los identificadores de eventos sirven para localizar la evidencia interna.

## Cierre de implementación local

La decisión posterior del responsable sustituye el aviso a coordinación propuesto inicialmente: **la reserva se asigna automáticamente a un asesor habilitado**. Disponibilidad significa perfil activo, rol asesor o administrador, pertenencia al mismo proyecto y tenant y `receives_leads=true`; no representa presencia en línea. Se conserva el propietario que cumpla esos criterios o se usa la rotación serializada. Esta asignación especial no espera el horario general. El cálculo del plazo conserva el calendario comercial configurado.

La solicitud y su alerta tienen estados independientes. La solicitud permanece registrada si falla el aviso. La ficha muestra aviso pendiente, sin asesor habilitado, creado o fallido; el mantenimiento reintenta con alcance de pruebas y deduplicación por solicitud y destinatario. Si no hay nadie elegible, no se inventa un asesor ni se anuncia una notificación enviada. El aviso es el diálogo urgente y la bandeja privada de la aplicación; este cambio no introduce notificaciones de dispositivo, correo o WhatsApp al asesor.

La entrada real `lv_request_reservation_handoff` usa esta política como única ruta de asignación. Actualiza también la escalación pendiente, para que el responsable del caso coincida con el de la ficha y la solicitud. Durante esa asignación se omite el aviso genérico «Lead asignado»: la reserva tiene su aviso urgente con recuperación propia. Así, un fallo al crear la notificación no borra la solicitud ni genera un segundo aviso genérico. Se conserva la evidencia de los mensajes y la protección contra registrar dos veces la misma solicitud.

Las correcciones locales incluyen:

- Elección de unidad independiente de la consulta principal, con evidencia del turno y respeto de condiciones y negaciones. El precio no selecciona por sí mismo.
- Referencias explícitas para resolver una consulta sin convertir un conjunto vacío de seleccionados en inexistencia de inventario. La alternativa aceptada conserva su filtro activo.
- Fuentes de la unidad resuelta preservadas en la proyección que comparten redactor y revisor; no se cambió el modo global del revisor.
- Presentación de características útiles conservada junto con el precio y lenguaje comercial directo ante una distribución no disponible. La redacción continúa a cargo de la IA.
- Recorrido requerido al reconocer la elección válida, con las reglas anteriores de entrega previa, rechazo y disponibilidad.
- Alias legible de WhatsApp como alternativa al identificador técnico en Workflow, sin convertirlo en identidad confirmada.
- Actualización de monitoreo en segundo plano, identificadores estables y datos conservados durante una consulta. Si hay novedades de la ficha abierta, aparece una opción para actualizarlas cuando el usuario termine de leer o editar; la ficha no se sustituye automáticamente por un spinner.
- Prioridad de reserva respaldada por la proyección comercial y compatibilidad textual corregida. La prioridad muestra su motivo; no se confunde con temperatura.

### Contacto del showroom

El registro programa un único primer contacto por lead y proyecto, cinco minutos después, cuando cuenta con autorización de WhatsApp. El formulario de teléfono ofrece una casilla opcional específica; guardar datos sin esa autorización no dispara el saludo. La captación automática del modal sigue desactivada.

El tiempo se registra para una unidad identificada en la vista de unidad, excluyendo el plano general, áreas comunes, comparación y modales. Se descartan pestañas ocultas e inactividad prolongada. La atribución usa 120 segundos registrados, al menos la mitad del tiempo de unidades y una ventaja de 1,5 sobre la segunda; la solicitud expresa o el guardado explícito de unidad pueden dar una referencia más concreta. Revisar un modelo compartido sin una unidad identificada lleva al mensaje genérico. No se escribe una elección de compra a partir de estos datos.

El envío usa Salesbot `26428` y campo `538638` para unidad, o `26430` para saludo genérico. Se comprueban plantillas aprobadas con el contenido esperado y los tres botones antes de lanzar el bot; si falta la aprobación o no coincide el contenido o sus botones, se aplaza la comprobación. Un resultado desconocido queda para conciliación en Kommo y no se repite automáticamente. La aceptación de ejecución del Salesbot no se presenta como entrega confirmada.

Antes de lanzar se revalidan permiso, modo de prueba, pausa, atención humana y conversación previa. Si el lead ya escribió por WhatsApp, se cancela la invitación genérica. Se mantiene la protección `test_only` y el filtro de contacto de prueba del ejecutor.

La entrada específica reconoce las tres respuestas previstas y preguntas nuevas sobre el espacio. «Sí, quiero información» conserva una referencia informativa, incluso durante la resolución del catálogo; no convierte la navegación en una unidad elegida para comprar. Importa el nombre del formulario con su fuente, sin sustituir la identidad legal requerida posteriormente. Pregunta únicamente los datos de presentación que falten y no vincula residencia con desbloquear el brochure. «Más adelante» no activa capturas ni programa una fecha sin acuerdo; «No recibir mensajes» registra la baja y cancela seguimientos pendientes. Un eco tardío del propio Salesbot no invalida el contexto; otro mensaje posterior del bot o asesor sí impide atribuir un «sí» a la invitación antigua.

La consulta real de Kommo confirmó el campo de texto `538638`, los Salesbots activos `26428` y `26430`, y las plantillas originales `19934` y `19936`: ambas aprobadas, con el cuerpo esperado y sin botones. Se conservaron estas versiones. La API solo permite editar plantillas WABA en borrador; por ello se prepararon dos versiones nuevas siguiendo la [API de plantillas de Kommo](https://developers.kommo.com/reference/edit-templates):

| Plantilla | ID | Estado comprobado |
| --- | --- | --- |
| `SHOWROOM_UNIDAD_BOTONES_V2` | `19938` | Borrador creado, con los tres botones. |
| `SHOWROOM_GENERAL_BOTONES_V2` | `19940` | Borrador creado, con los tres botones. |

Los botones son «Sí, quiero información», «Más adelante» y «No recibir mensajes». La API aceptó las solicitudes de revisión, pero devolvió cero revisiones: los borradores siguen sin cuenta WABA seleccionada y **no hay constancia de envío efectivo a Meta ni de aprobación**. El intento de conservar esa selección mediante la API no tuvo efecto. La interfaz disponible solicita iniciar sesión; no se modificó la autenticación. El script `scripts/prepare-showroom-button-templates.cjs` comprueba ese estado y no declara una revisión confirmada cuando faltan recibos.

Para activarlas, en la interfaz de Kommo se debe seleccionar la cuenta WhatsApp de La Vilet en ambos borradores, enviarlos a revisión y, tras la aprobación, vincular `19938` a Salesbot `26428` y `19940` a `26430`. La API pública de bots consultada muestra metadatos, no acredita el contenido de esos flujos. **Esa configuración y su comprobación siguen pendientes.** El código exige los botones aprobados; las plantillas antiguas sin botones no habilitan esta nueva ruta por sí solas. No se inició ningún Salesbot ni se enviaron mensajes a leads.

### Análisis e indicador de escritura

`/inmobiliaria/analisis-conversaciones` aparece como opción propia de la barra lateral y abre desde la ficha común. Respeta los leads que la sesión puede consultar. Las gráficas muestran residencia declarada, origen, tipo de inmueble, temperatura y motivos explícitos de evaluaciones vigentes. No usan la geolocalización como residencia confirmada y no convierten las hipótesis en motivos declarados.

Se puede evaluar manualmente una conversación. El mantenimiento analiza como máximo una candidata por pasada tras 24 horas de inactividad, dentro del alcance habilitado; no vuelve a evaluar el mismo historial y estado ni permite que una conversación antigua monopolice las pasadas. Se pospone si existen mensajes entrantes pendientes y un fallo de evaluación no interrumpe la planificación de recordatorios o la recuperación de alertas. `CONVERSATION_ANALYSIS_AUTOMATIC=false` desactiva esa evaluación automática. El resultado guarda resumen, objetivo, motivo, fundamento explícito/hipótesis/desconocido, citas comprobadas y recomendación interna. Se limita el contexto a los últimos 60 mensajes y se reducen documentos, correos y números personales antes del modelo. El análisis no modifica etapas, puntuación, asignaciones ni contactos. La lectura de incidentes técnicos aporta evidencia adicional, sin atribuir automáticamente la pausa a ellos. Se avisa cuando hay mensajes posteriores al análisis.

El indicador real de escritura requiere `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION` y el `wamid` entrante de Meta. Kommo debe proporcionar ese identificador o debe conectarse la fuente que lo tenga. Se intenta al empezar a procesar y antes de redactar; un fallo o la ausencia de capacidad no bloquea la respuesta. El resultado de la primera comprobación aparece en el paso de permiso de respuesta. No se enviaron señales reales de escritura durante las pruebas.

### Migraciones y verificación

Aplicar antes de desplegar el ejecutor y las pantallas:

1. `20261016090000_reservation_assignment_and_alert.sql`: asignación y alertas de reserva, sobre la migración urgente del 14 de octubre ya existente.
2. `20261016093000_showroom_contact.sql`: permanencia por unidad y registro del primer contacto.
3. `20261016100000_conversation_analysis.sql`: evaluaciones privadas y selección de candidatas inactivas.

Las comprobaciones locales cubren selección compuesta, precio sin elección, negación, fuentes del revisor, continuidad de identidad, interés dominante, textos de botones e indicador con transporte simulado. PostgreSQL aislado comprueba rotación, ausencia de asesores, alerta fallida, recuperación y permisos. Chromium comprueba la conservación del borrador y la ficha en actualizaciones repetidas, y el panel en escritorio y móvil. TypeScript y la compilación de producción se verifican sin ejecutar simulaciones con modelos ni mensajes a leads.

El cierre verificó **151 comprobaciones de regresión** y una prueba adicional de Chromium en escritorio y móvil, sin fallos. La selección focalizada de reservas, showroom y esquemas contiene 26 comprobaciones dentro de esa regresión; no son 26 adicionales. Las repeticiones de pruebas no se suman como escenarios nuevos. El corpus documental conserva 118 escenarios, una medida diferente del número de comprobaciones ejecutadas.

ESLint pasa sin errores para los archivos modificados y nuevos salvo `TourViewer.tsx`, que mantiene los 70 errores y 18 advertencias contrastados también en `HEAD`. El modal de información conserva una advertencia anterior de dependencias. No corresponde informar una ejecución global de ESLint limpia. Se corrigieron dos efectos sencillos de reinicio de formularios durante esta revisión. La compilación muestra una incidencia previa `test_contacts_action_failed` al prerenderizar la vista de contactos de prueba; pese a ese diagnóstico, el proceso final de compilación terminó con código 0. TypeScript también pasó.

Los renders adjuntos, la presentación inicial de dos o tres locales y las decisiones históricas pendientes de retoma, recordatorios y prioridad entre reserva y cita conservan su alcance anterior.

Las migraciones y el despliegue no se ejecutaron en esta sesión. La configuración local permite consultar Kommo, pero no aporta una conexión PostgreSQL de administración ni credenciales de despliegue. Tampoco están configuradas las credenciales directas de WhatsApp Cloud para el indicador de escritura. El código local y los borradores de Kommo no acreditan que estas funciones estén activas en producción.
