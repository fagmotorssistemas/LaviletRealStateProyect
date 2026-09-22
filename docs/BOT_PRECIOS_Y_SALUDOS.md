# Precios por fase y saludos — 13 de septiembre de 2026

## Operación

En Automatización → Precios, habilitar **Mostrar precios aproximados en Lanzamiento** y pulsar **Guardar visibilidad**. El ajuste viene desactivado y no cambia los valores del inventario ni el modo comercial. En Preventa se utiliza el precio guardado sin la aclaración de lanzamiento.

Ejemplo con el departamento 502, cuando tiene guardados 310000 USD:

> El precio aproximado del departamento 502 es de $310.000 USD. Es un valor referencial de lanzamiento y puede cambiar hasta que se confirme el precio definitivo.

Si aún no se ha hablado de financiamiento, se añaden las entidades habilitadas y una oferta de acompañamiento. Puede invitar a una visita una vez; respeta las invitaciones rechazadas, la coordinación en curso y las citas pendientes o confirmadas. Ofrecer financiamiento no inicia una revisión, y ofrecer una visita no crea una cita ni avisa al asesor.

No se promete avisar automáticamente cuando se fijen los precios: actualmente no existe una automatización conectada para ese aviso.

## Fuente y controles

- Precio: `units.published_commercial_price`. Se consulta nuevamente en cada turno comercial; imágenes e historial sirven para identificar la unidad, nunca para autorizar un importe.
- Visibilidad: `projects.policies_json.bot_pricing.launch_prices_visible`, estrictamente booleano. No se envían las otras políticas JSON al modelo.
- Las consultas «precio del 502», «precio de la suite 210» y «su precio» resuelven la unidad y consultan el catálogo autorizado. Un código nuevo inexistente no recupera la unidad anterior. Un cambio de categoría no reutiliza su precio.
- Las respuestas sencillas de precio se componen con datos del catálogo. Las consultas mixtas pasan por generación y revisión con una respuesta de precio verificada; se rechazan importes inventados, precios ocultos y aclaraciones incompatibles con la fase.
- La memoria de conversación conserva si ya se habló de financiamiento y si se invitó a una visita, incluso cuando se recorta el historial.
- Los mensajes rutinarios de financiamiento ofrecen acompañamiento en el proceso. Una consulta expresa sobre aprobación sigue recibiendo una respuesta veraz, sin garantizar un crédito.

## Saludos

«Saludos», «Saludos cordiales», «Qué tal», «Hola, ¿cómo están?», «Buen día», «Benos días», saludos repetidos y saludos con emoji reciben una bienvenida breve. El detector debe reconocer el turno completo. «Saludos, ¿cuánto cuesta el 502?» responde al precio; «Hola, no me envíen más mensajes» conserva la solicitud de baja. No se introduce el proyecto a partir de un saludo.

## Nombres de nutrición

Los nombres solicitados para reconocer las plantillas son «Mensaje de nutricion 24h» y «Mensaje de nutricion semana1» hasta «semana4». Como identificadores técnicos propuestos pueden usarse `mensaje_nutricion_24h` y `mensaje_nutricion_semana1` hasta `mensaje_nutricion_semana4`. Al conectarlas deben registrarse los identificadores reales de las plantillas aprobadas, el idioma y su cuenta de WhatsApp; no se debe asumir que el nombre visible coincide con el técnico.

Esta entrega histórica no aprobó ni activó plantillas. El estado posterior cambió: el ejecutor ya dispone de rutas a las 24 horas y en los días 7, 14 y 21, pero cada una depende de su activación, plantilla, consentimiento y elegibilidad. Consulte la definición vigente en [Flujo de leads, nutrición y recuperación](FLUJO_LEADS_NUTRICION_RECUPERACION.md).

Referencia: [Kommo: crear y gestionar plantillas de WhatsApp](https://support.kommo.com/docs/manage-whatsapp-business-message-templates), consultada el 13 de septiembre de 2026. El nombre visible se puede editar y no se muestra al cliente; las plantillas necesitan estado Approved para enviarse.
