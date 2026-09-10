# Conversación y circuito de visitas — 10 de septiembre de 2026

La revisión corrige tres causas: mensajes transaccionales que sustituían respuestas con textos genéricos, saludo bloqueado durante toda la vida del lead y preferencias interpretadas sin los turnos anteriores.

## Comportamiento

| Situación | Resultado |
| --- | --- |
| «Buenos días, quiero agendar» al retomar | Devuelve el saludo y pregunta los datos que faltan. |
| «Hoy» y luego «a las 4» | Conserva el día y resuelve las 16:00 si es la única interpretación compatible con la jornada. |
| «No puedo a esa hora, mejor a las 3» | Mantiene el día de la propuesta, cambia la hora a las 15:00 y abre revisión para el asesor. |
| «Perfecto, muchas gracias», sin decisión pendiente | «Con mucho gusto». No repite la preferencia ni genera otro evento de visita. |
| «Perfecto, gracias» ante una propuesta enviada | Clasifica si acepta esa propuesta; solo una confirmación sale de la cola de citas. |
| «Quiero reagendar», sin alternativa | Pide otra fecha/hora; no reutiliza automáticamente el intervalo anterior. |
| Cambio de día sin nueva hora | Pregunta la hora; conserva la anterior únicamente si el cliente dice «a la misma hora». |
| «No podré asistir» | Cancela la cita y los avisos pendientes; ofrece otro día u horario. |
| Nueva visita después de cancelar | Crea una coordinación nueva, sin heredar fecha/hora de la cita cancelada. |

Se usan los mensajes reales de la misma conversación y la cadena de solicitudes de la misma cita. Las fechas relativas se calculan desde la fecha de origen del mensaje, en Ecuador, no desde el día de reprocesamiento. Si falta información o hay varias alternativas, se pide aclaración. Horas como «tres y media» conservan los minutos. AM/PM solo se infiere cuando la jornada permite una única interpretación; los huecos libres no sirven para inventar la preferencia.

El asesor puede aceptar el intervalo solicitado si sigue disponible. Se vuelve a comprobar al guardar: responsable autorizado, evidencia del cliente, estado vigente, jornada, ausencias, cruces y mensajes nuevos por procesar. Mientras el cliente aún no acepta una propuesta del asesor, no se confirma en su nombre. El botón vuelve a estar disponible cuando hay una contrapropuesta del cliente válida.

## Textos y guion

No hace falta crear otro Salesbot para estos casos. Se mantienen las rutas existentes:

- Conversación: bot 15578 y campo 457014.
- Propuesta de visita: bot 18724 y campo 519824.
- Confirmación: bot 18730 y campo 519824.
- Recordatorio: bot 18350 y campo 513120.

**Automatización → Guion** continúa editando el saludo y la voz comercial. Se actualizaron los prompts activos `respuesta_comercial` y `extractor_eventos`, conservando el resto del contenido e incrementando su versión. El guion no autoriza una confirmación: los estados y las acciones de base de datos determinan qué puede decir el mensaje.

`conversation-style.ts` contiene continuidad, primer nombre y respuestas de coordinación según los datos disponibles. `visitClock.ts` contiene la redacción de propuesta, confirmación y recordatorio. Son textos transaccionales dependientes del estado, no nuevas plantillas de WhatsApp. El sistema mantiene una respuesta por turno agrupado y conserva los controles de cola existentes.

La propuesta ofrece el horario con una pregunta abierta a alternativas. El nombre del asesor y el enlace se incluyen en la confirmación. Se respeta el límite existente de 256 caracteres: se compacta la fecha antes de recortar elementos de cortesía; nunca se corta el enlace ni se cambia la hora. El primer nombre del cliente se usa de forma ocasional.

## Interfaz

- La fecha/hora solicitada tiene prioridad y mayor tamaño que el nombre o los mensajes.
- «Mensajes del lead» muestra los mensajes entrantes del turno que originó la solicitud. No incluye mensajes posteriores ajenos a esa preferencia.
- Modal con actualización por Realtime y respaldo de consulta cada 15 segundos mientras está abierto.
- Historial inicial de dos cambios; detalles ampliables, estados en español y enlace al chat de Kommo.
- Recomendaciones basadas en la agenda. Seleccionar una recomendación llena el formulario; solamente «Enviar propuesta» genera la propuesta y su cola.
- **Automatización → Ubicación** permite elegir el proyecto, hacer clic/arrastrar el marcador, revisar el enlace y guardar.
- El punto guardado se utiliza en futuras confirmaciones y en la página pública «Ubícanos». Se inicializó La Vilet con las coordenadas que ya usaba la web: −2.892340, −79.030352.

## Base de datos aplicada

Migraciones de esta revisión: `20260910180000_visit_conversation_context.sql`, `20260910183000_project_visit_location.sql`, `20260910184500_visit_context_completion.sql`, `20260910190000_visit_partial_time_details.sql` y `20260910191000_visit_clear_preference_fields.sql`. Ya están aplicadas en Supabase.

Cambios persistentes:

- Dos columnas en `project_automation_config`: `visit_latitude` y `visit_longitude`, con validación de rango y pareja completa.
- Trigger que mantiene `visit_location_url` sincronizado con las coordenadas.
- Funciones para obtener mensajes del turno, interpretar preferencias y reconstruir fecha/hora desde la cadena de solicitudes.
- Contexto de conversación y de envío de visitas con preferencia resuelta y ubicación actual.
- Corrección del trigger de solicitudes para permitir cambios posteriores a una confirmación/rechazo/expiración, conservando su historial.
- Redacción de confirmación y cancelación; actualización de los dos prompts mencionados.

No se borraron registros del lead, conversaciones ni citas para instalar estos cambios. Las pruebas con mutaciones se ejecutaron en transacciones con ROLLBACK: las filas de prueba, colas y cambios de configuración se revirtieron. No se ejecutaron Salesbots ni se aceptó/canceló la cita real del cliente durante las pruebas.

Copias previas locales: `tmp/visit-functions-before.sql` y `tmp/visit-prompts-before.json`. Son material de recuperación manual, no scripts para ejecutar indiscriminadamente. Una reversión del código debe coordinarse con las funciones SQL de contexto; no hay que borrar las nuevas columnas para volver a una versión anterior. Se conserva también el punto de recuperación de la integración en `tmp/integration-checkpoint-2026-09-09T17-41-46-937Z/`.

## Verificación y puesta en producción

Verificado:

- Compilación de producción y TypeScript.
- 34 pruebas de integración y 27 pruebas de automatización.
- `supabase/tests/agenda_quick_actions.sql` y `supabase/tests/visit_conversation_cycle.sql`: disponibilidad, mensajes parciales, contrapropuesta, ambas formas de aceptación, doble clic, cambio después de confirmar, cancelación, nueva visita y ubicación.
- Ocho casos con la API real de IA: `node scripts/evaluate-visit-intents.cjs`. Usa datos sintéticos; consume API, no escribe en la base ni envía WhatsApp.
- Revisión visual del resumen del modal con datos de ejemplo. No equivale a una prueba completa en un teléfono o una sesión autenticada del asesor.

El código necesita un despliegue de producción de Vercel con estos archivos. No requiere nuevas variables de entorno. Las migraciones ya aplicadas no necesitan repetirse.

Kommo reescribe los enlaces cuando está activado el seguimiento de clics. Para conservar el dominio de Google en WhatsApp, ir a **Configuración → Ajustes de chat** y desactivar **Track link clicks / Seguimiento de clics**. Esa preferencia de Kommo no se cambió desde este repositorio. [Instrucciones del proveedor de integración](https://support.chatarchitect.com/books/whatsapp-for-crm/page/disable-link-shortening-in-kommocom).

El módulo genera la URL oficial `https://www.google.com/maps/search/?api=1&query=latitud%2Clongitud`, que no necesita una clave de API de Google. [Documentación de Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).

Después del despliegue: seleccionar/verificar ubicación; enviar «Buenos días, quiero agendar» → día → hora; proponer otra hora desde Agenda; responder «mejor a las 3»; aceptar en Agenda; verificar una única confirmación con asesor y Google Maps; cancelar y verificar que no quedan recordatorios pendientes. Esta prueba final sí envía mensajes reales al número de prueba.
