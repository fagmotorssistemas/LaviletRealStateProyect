# Seguimiento, material y visitas — 14 de septiembre de 2026

## Controles en la plataforma

En **Automatización → Reglas y SLA → Visitas del bot** se puede permitir o impedir que el bot sugiera visitas. En Lanzamiento, el valor inicial es desactivado. El destino de una sugerencia habilitada puede ser el terreno donde se construirá el proyecto o la oficina de atención en esa misma dirección. Desactivar sugerencias no impide atender una cita solicitada expresamente por el cliente.

Se guarda en `projects.policies_json.bot_visits`, conservando las demás políticas. La lectura del bot y la escritura administrativa respetan proyecto y tenant; las escrituras comprueban `updated_at` para no perder cambios simultáneos.

Los precios mantienen el mismo origen (`units.published_commercial_price`) y la visibilidad de lanzamiento. Se informa el precio o rango de la opción elegida con variantes breves; en Lanzamiento se aclara que los valores son referenciales y pueden cambiar. No se habla de precios registrados o autorizados. Un presupuesto bajo puede recibir orientación sobre financiamiento; nunca se multiplica implícitamente por mil ni se promete aprobación.

## Brochure

Archivo original: `Brochure_Digital_LaVilet_Interactivo_v5.pdf`. Publicación: `/materiales/brochure-la-vilet-v5.pdf`.

- 8 páginas, 74 enlaces, 64.600.672 bytes.
- SHA-256: `5b2e52c93ad2fbeaabda56dec2091c437e818c35fba8c8ee7c2167a6dbb31521`.
- Se conserva el PDF original, sin modificar sus enlaces, imágenes o contenido.
- El bot envía un enlace directo cuando se solicita el brochure, se pide que comparta información o se acepta una oferta previa de material. Una consulta combinada sobre precio conserva la cotización y añade el enlace.
- En lanzamiento se aclara que representa el proyecto previsto, no departamentos construidos ni avances físicos de obra.
- Las solicitudes de vehículos y sus continuaciones reciben una respuesta de ámbito comercial; no abren financiamiento, citas ni traspasos por inferencias del modelo. Las consultas sobre parqueaderos y vehículos como parte de pago siguen su flujo inmobiliario.

## Seguimiento contextual a las 24 horas

En **Automatización → Reglas y SLA → Seguimiento** está el bloque de 24 horas. Es independiente de las cuatro semanas, que siguen sin ejecutor de envíos.

Texto para una plantilla **WhatsApp / Marketing** en Kommo:

> Hola, le saludamos de La Vilet. Estamos disponibles para {{1}}. ¿Le gustaría continuar la conversación?

Vincular `{{1}}` al campo de lead **Nutricion_24h**, ID **530422**. El campo recibe solo la frase contextual, no todo el mensaje. Ejemplos para presentar a Meta:

- `ayudarle con lo que necesite`
- `resolver sus dudas sobre el proyecto`
- `ampliar la información sobre la suite 210`
- `orientarle sobre las opciones de financiamiento`
- `resolver sus dudas sobre el recorrido de la suite 210`

Salesbot indicado por el usuario: **20968**, “NUTRICION 24 HORAS”. Debe enviar esa plantilla una sola vez y finalizar, sin otro temporizador ni mensajes libres. La plataforma ya calcula las 24 horas. El administrador confirma esa vinculación en la interfaz.

**Verificación realizada:** `NUTRICION_MENSAJE_24H`, ID **12838**, es `amocrm` (plantilla general), con cuerpo `{{lead.cf.530422}}` y sin revisiones de Meta. No sirve como plantilla de WhatsApp para este envío. El seguimiento permanece desactivado hasta contar con la plantilla aprobada y su vinculación correcta. Tanto al activar como al enviar se consulta Kommo y se comprueban tipo `waba`, aprobación, nombre, texto y campo. No se convierte texto libre en una plantilla mediante una variable de cuerpo completo.

### Horario y destinatarios

- 24 horas desde el último mensaje del cliente, tras una respuesta del bot aceptada por Kommo.
- De lunes a viernes 09:00–18:00, siempre dentro del horario configurado del proyecto. Sábado también se limita a ese horario (actualmente 09:30–13:30). Domingo cerrado. Hora de Ecuador continental.
- Si vence de noche o fuera del horario, espera a la siguiente apertura. Se vuelve a verificar justo antes de enviar.
- Solo WhatsApp, consentimiento de seguimiento afirmativo, IA activa y lead elegible. Se excluyen bajas, ventas cerradas, personas sin interés, atención de asesor, citas pendientes y preguntas todavía sin responder.
- Al llegar un mensaje del cliente se cancela el pendiente anterior. No se inicia automáticamente una solicitud de crédito o cita por aceptar retomar la conversación.
- Un envío por mensaje de origen; máximo un seguimiento de este tipo cada siete días. No reintenta envíos inciertos. Los trabajos de más de siete días expiran.
- La activación se aplica a nuevos turnos atendidos; no dispara mensajes a conversaciones antiguas.

### Ejecución y diagnóstico

Usa el cron y bloqueo global existentes. Los trabajos son eventos `maintenance` con `payload.task = nutrition_24h` y `contact_key = null`, para que el agrupamiento de mensajes entrantes nunca los absorba. La clave única es `nutrition24h:<conversationId>:<messageId>`. No requiere migración SQL ni que alguien tenga el panel abierto.

Se comprueban nuevamente lead, conversación, último mensaje, consentimiento, pausa remota de Kommo, solicitudes de visita y configuración antes de iniciar el Salesbot. Se guarda en `messages` el texto renderizado tras la aceptación del envío; “aceptado” no equivale a entrega confirmada. Un error incierto se conserva para revisión y no se reenvía automáticamente.

Diagnóstico en `lv_integration_events`: filtrar `payload.task = nutrition_24h`; revisar `available_at`, `status` y `result`. El resultado de cada conversación incluye `nutrition.scheduled` y su motivo si no se programó.

Referencias: [plantillas WhatsApp en Kommo](https://support.kommo.com/docs/manage-whatsapp-business-message-templates), [lectura de plantillas y revisiones](https://developers.kommo.com/reference/get-templates).
