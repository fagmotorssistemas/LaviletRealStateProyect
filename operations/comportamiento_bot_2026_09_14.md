Comportamiento de La Vilet — correcciones del 14 de septiembre de 2026

Cada turno se evalúa completo, incluidos mensajes consecutivos y observaciones sin signo de pregunta. La revisión semántica registra las solicitudes literales, cómo se respondieron y el propósito de cualquier pregunta final. Una duda informativa no se trata como falta de interés.

Las preguntas deben servir para elegir una unidad, mostrar material pertinente, coordinar una visita, iniciar una revisión financiera consentida o facilitar la atención de una persona. Si la respuesta no cambiaría ninguna decisión, se omite la pregunta. Preguntar si un local será para uso propio o inversión orienta la selección del inmueble; no demuestra que un banco acepte ingresos futuros de arriendo.

| Situación | Comportamiento esperado |
| --- | --- |
| Opciones + preocupación por presupuesto + precio | Responder las tres ideas: alternativas, orientación financiera con entidades habilitadas y precio de la categoría pertinente. |
| Casas, precio y pisos de una casa | Aclarar que se ofrecen suites, departamentos y locales; no atribuir a una casa los datos de un departamento. Responder también la consulta financiera si existe. |
| «Pero cuántos pisos tiene la casa» después de crédito directo | Atender la pregunta nueva y aclarar el tipo de inmueble; no repetir la negativa de crédito. |
| «Qué opciones tengo» con varios referentes posibles | Ofrecer una orientación breve según el contexto o aclarar únicamente el referente necesario. |
| «¿Va a venir a la cita?» | Comprobar las citas; reconocer la posible confusión sin inventar una visita ni negar una cita existente. No explicar espontáneamente que es una IA. |
| Precio y fotos del 202 | Responder el precio y adjuntar el material de esa unidad; no adjuntar el mapa por ese motivo. |
| Una respuesta necesita un dato que no existe | Conservar las respuestas verificadas y pasar la consulta pendiente a un asesor mediante una acción real. |
| Pregunta directa sobre si es IA | Responder con honestidad. En los demás casos puede hablar en nombre del equipo sin presentarse. |

Agenda

1. Al preguntar cuándo puede visitar, se indican los días y horas de atención guardados. Se pide la preferencia del cliente, sin presentar la jornada como disponibilidad libre.
2. La preferencia se envía al asesor para verificarla. La fecha y hora aportadas no se vuelven a pedir.
3. Si hace falta proponer alternativas, el asesor dispone de la lista compacta, puede seleccionar hasta tres, editar o agregar horarios y revisar el texto antes de enviarlo. Solo se afirma que hay otra cita cuando existe un conflicto comprobado.
4. Si rechaza todas las alternativas sin aportar otra preferencia, se pausa el bot y aparece una solicitud urgente con resumen e indicación de llamar. Cancelar la visita o proponer otra fecha son situaciones distintas.
5. Después de hablar con el cliente, el asesor puede registrar el acuerdo telefónico. Se comprueban permisos y disponibilidad; el bot sigue pausado. El sistema no afirma haber hecho la llamada ni inventa una aceptación en WhatsApp.

Se verificó en Supabase: desde el lunes 14 de septiembre, «la siguiente semana el lunes a las 10 am» devuelve lunes 21 de septiembre. «Mañana» devuelve martes 15. La redacción incluye «hoy» o «mañana» junto a la fecha explícita cuando corresponde. Una preferencia sigue pendiente hasta su aprobación.

Ubicación

Por ahora el mapa se envía solo cuando lo solicita el cliente o al confirmar realmente la cita. No se adjunta al dar precios, mostrar modelos, hacer una invitación, proponer horarios o revisar una preferencia pendiente.

| Caso | Ejemplo orientativo | Estado |
| --- | --- | --- |
| Solicitud del cliente | «Con gusto. Nuestra oficina está en Ricardo Darquea Granda y Elena Landívar, donde se construirá La Vilet. Aquí puede ver cómo llegar: [mapa]». | Habilitado |
| Cita confirmada | «Su visita está confirmada para [día y hora]. Le esperamos en nuestra oficina: [dirección y mapa]». | Habilitado |
| Recordatorio | «Le esperamos mañana, [fecha], a las [hora]. Aquí puede ver cómo llegar: [mapa]». | Pendiente de aprobación; no repite el mapa actualmente |
| Cambio real del lugar de encuentro | «La cita será en esta dirección actualizada: [dirección y mapa]». | Pendiente de aprobación para un aviso específico de cambio |

Estos mensajes son ejemplos de intención y contenido; la redacción puede variar respetando los hechos y el estado real.

Dónde se controla

| Sección | Control |
| --- | --- |
| Automatización → Reglas y SLA → Modo | Lanzamiento o Preventa. Actualmente existen dos modos comerciales; son independientes de las etapas de cada lead. Seleccionar el modo y guardar. |
| Automatización → Reglas y SLA → Visitas del bot | Activar/desactivar invitaciones y elegir oficina o terreno durante lanzamiento. Una solicitud expresa del cliente puede coordinarse aunque estén desactivadas las invitaciones espontáneas. |
| Automatización → Guion del bot | Instrucciones comerciales y preguntas configurables. Las reglas operativas verificadas prevalecen sobre un cierre genérico del guion. |
| Automatización → Precios | Valores de unidades y visibilidad de precios referenciales de lanzamiento. |
| Automatización → Ubicación | Dirección y mapa de encuentro. |
| Automatización → Monitoreo | Estado del lead y pausa de la IA. |
| Bandeja de citas / Agenda | Preferencias, propuestas, coordinación urgente y acuerdo telefónico. |

También hay controles en código: `conversation.ts` coordina las acciones; `business-scope.ts` interpreta el negocio; `turn-completeness.ts` revisa cobertura y propósito; `financing.ts` controla consentimiento y avance financiero; `product-fit.ts` protege el tipo de inmueble; `visit-location.ts` y `visit-rules.ts` limitan el mapa. SQL protege fechas, disponibilidad, permisos y confirmaciones.

Los dos textos base editables tienen 1.197 palabras / 33 líneas (respuesta comercial) y 588 palabras / 14 líneas (revisor): 1.785 palabras en total. No representan todo el contexto de cada llamada: se añaden las reglas pertinentes, catálogo, estado e historial. El número de líneas cambia con el formato; las pruebas de coherencia y las acciones verificadas son más útiles que contar líneas. Las instrucciones se ejecutan por etapas, no como un único mensaje al cliente.

El paquete SQL aplicado es `operations/activar_coordinacion_y_fechas.sql`. Las pruebas usan conversaciones sintéticas y PostgreSQL local; no envían mensajes a clientes ni realizan llamadas.
