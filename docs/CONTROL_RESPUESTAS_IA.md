# SDR de La Vilet: guion y funcionamiento

El editor está en **Inmobiliaria → Automatización → Guion → Cómo responde**, ruta `/inmobiliaria/automatizacion/guion`, con acceso de administrador. Abra **Conversación y orientación comercial** para editar el tono, los ejemplos y las preguntas de venta. Guardar actualiza `agent_prompts`; el ejecutor lee los cambios en los siguientes mensajes. Los cambios en la lógica del código sí requieren desplegar.

La pantalla abre primero el prompt comercial. Distingue los cinco prompts que utiliza el SDR de las plantillas antiguas de referencia; añadir un tema independiente no lo conecta automáticamente al ejecutor. El guardado comprueba la versión para evitar sobrescribir una edición más reciente.

| Control | Función |
| --- | --- |
| `respuesta_comercial` | Responder la consulta, orientar con datos reales y hacer una pregunta de descubrimiento pertinente. |
| `saludo_inicial` | Bienvenida literal para el primer saludo breve. Un nuevo «Hola» después de una respuesta no reinicia el diálogo. |
| `resumen_conversacion` | Memoria estructurada de lo respondido, consulta actual y pregunta pendiente. |
| `extractor_eventos` | Preferencias, visita, baja, atención humana y financiamiento. Mantener el contrato JSON y la evidencia del mensaje actual. |
| `revisor_respuesta` | Revisar hechos, tono y continuidad antes del envío. Puede pedir una reescritura. |

Las preguntas de la sección de guion son orientativas. Se incorporan al prompt comercial cuando se guardan: no se exige hacerlas todas, repetir datos conocidos ni completar un formulario antes de una visita. El clasificador comercial heredado dejó de usarse; la clasificación de respuestas a propuestas de visita sigue protegida en código.

## Comportamiento comercial

Se usa un tono cercano, de usted, sin emojis ni nombre o identidad de asesor. Se responde primero lo que consulta el cliente y después se avanza con una pregunta. No se repiten la bienvenida ni la descripción institucional en cada turno.

Para vivienda: tipo, vivir/invertir, dormitorios o prioridad, presupuesto orientativo, plazo y visita. Para locales: negocio propio/inversión, actividad, tamaño, presupuesto y visita. Es una guía flexible: una petición de visita se atiende sin exigir completar la calificación.

Ejemplos de estilo incluidos en el guion (no representan precios ni disponibilidad reales):

> Cliente: Quiero algo comercial.
>
> La Vilet: Claro, podemos enfocarnos en los locales de La Vilet. ¿Lo busca para su propio negocio o como inversión para arrendarlo?
>
> Cliente: Para poner una cafetería.
>
> La Vilet: Entonces conviene revisar una distribución que se adapte a su cafetería. ¿Qué tamaño aproximado tiene en mente?

No se deriva automáticamente a un asesor para dar información básica. Una petición explícita de atención humana o llamada usa el proceso de derivación existente y no confirma una llamada automáticamente.

## Visitas y precios

Una petición de visita sin horario pregunta por día y hora antes de crear la solicitud. Al recibir una preferencia se comprueba que la solicitud quedó guardada; la respuesta distingue ese registro de la confirmación. Si ya existe otra solicitud, no se afirma que se registró una nueva. Aceptar una visita exige una propuesta enviada y vigente, respetando los controles existentes de base de datos.

El modo comercial se obtiene de `project_automation_config`, independientemente de la etapa calculada del lead. En lanzamiento se ocultan precios del contexto. En preventa solo pueden citarse valores publicados de unidades que coincidan con la búsqueda. En la revisión actual ninguna unidad publicada tenía precio comercial; no se inventaron rangos ni horarios disponibles para imitar los ejemplos.

## Base de datos y reversión

El 10 de septiembre de 2026 UTC se actualizaron cinco filas de `agent_prompts`, verificadas por versión y hash: comercial, bienvenida, resumen y revisor a versión 2; extractor a versión 4. La operación fue transaccional. No creó ni alteró tablas o funciones.

El nuevo código utiliza campos existentes:

- `conversations.summary`: conserva el resumen JSON después de registrar una respuesta aceptada.
- `leads.behavior_signals.sdr`: actividad comercial, área, prioridad, plazo, presupuesto textual y dormitorios textuales. Se guardan únicamente fragmentos presentes en el mensaje actual.
- `leads.preferred_category` y `purchase_purpose`: incorporan las declaraciones actuales y admiten `local`. Al cambiar entre vivienda y local, se descartan los datos de búsqueda incompatibles y los dormitorios anteriores.
- Las solicitudes de visita, mensajes, eventos y derivaciones siguen usando las tablas y procedimientos existentes.

Esta corrección no reinicia leads ni borra mensajes. Se conservaron los controles de pausa, baja, intervención humana, deduplicación, ventana de WhatsApp y validación de citas.

Respaldo de código anterior: commit `ec8953e755a665a414ef1b61cf12fb2b99e35fcc`. Respaldo de prompts y manifiesto: `tmp/sdr-review/prompts-before.json` y `tmp/sdr-review/checkpoint.json`.

Operaciones revisables en el repositorio:

- `supabase/operations/20260910_sdr_prompts.sql`: actualización ya aplicada, no volver a ejecutar.
- `supabase/operations/20260910_sdr_prompts.rollback.sql`: restaura los contenidos anteriores solo si no hubo ediciones posteriores. Se debe revertir junto con el código correspondiente; no ejecutar automáticamente al desplegar.

## Validación y publicación

Las pruebas de integración cubren saludos consecutivos, preferencias recién declaradas, evidencia, cambio de categoría, solicitudes de visita, reescritura, baja y errores de envío. Las pruebas de agenda y guion cubren tiempos, asignación y preguntas. `npm run test:integrations`, `npm run test:automation` y `npm run build` son las comprobaciones locales.

`node scripts/evaluate-sdr.cjs` evalúa conversaciones sintéticas con el modelo y el catálogo real. Hace llamadas facturables a OpenAI, no envía mensajes ni modifica Supabase. Guarda resultados en `tmp/sdr-review/evaluation.json`; `--resume` continúa donde se interrumpió. La evaluación de la revisión final completó cinco turnos antes de detenerse: OpenAI devolvió `credit_balance_exhausted`. No se considera terminada la validación final con el proveedor.

Para probar en WhatsApp: publicar estos cambios en Vercel, reponer el saldo de la cuenta API utilizada y enviar un mensaje nuevo. Si existen eventos `uncertain`, revisar su causa y el estado en Kommo antes de conciliarlos; no reenviar indiscriminadamente. El ejecutor cada minuto observado en esta sesión es el proceso local `automation-cron.mjs --watch`; su continuidad depende de que el equipo permanezca encendido y conectado.

OpenAI documenta `credit_balance_exhausted` como saldo prepago agotado; reintentar no restaura el acceso: [errores de API y solución](https://developers.openai.com/api/docs/guides/error-codes).
