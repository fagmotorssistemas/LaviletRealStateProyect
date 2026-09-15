# Nutrición de La Vilet

Actualizado: 2026-09-15. Las semanas 1, 2 y 3 usan las plantillas comprobadas por API y los Salesbots indicados por Carlo. No se hicieron envíos reales durante las pruebas.

## Rutas y campos

| Uso | Plantilla en Kommo | Salesbot | Campo del lead |
| --- | --- | --- | --- |
| Brochure de semana 1 | 13542 · MENSAJE NUTRICION 1S | 21392 | No requiere variable |
| Seguimiento alternativo de semana 1 | 13554 · MENSAJE NUTRICION 1S SEGUIMIENTO | 21394 | 530950 · Nutricion_1s |
| 24 horas, independiente | NUTRICION_MENSAJE_24H | 20968 | 530422 · Nutricion_24h |
| Semana 2 | 13616 · MENSAJE NUTRICION 2S | 21446 | 530952 · Nutricion_2s |
| Semana 3 | 13618 · MENSAJE NUTRICION 3S | 21452 | 530954 · Nutricion_3s |
| Semana 4, pendiente | Pendiente | Pendiente | 530956 · Nutricion_4S, reservado |

Las dos plantillas de semana 1 son WABA y sus revisiones figuraban aprobadas. Se verifica otra vez el ID, cuerpo, variable, ausencia de adjunto inesperado y aprobación antes de enviar. Los IDs de Salesbot son los proporcionados por el usuario; la consulta de plantillas no inspecciona sus pasos internos.

La plantilla de 24 horas encontrada es `amocrm`, sin revisión de Meta: no habilitarla como plantilla WABA hasta corregirla. La semana 1 no depende de esa activación.

El campo 530950 es Texto, Solo API y Visible. Se llena por ID: renombrarlo no cambia la referencia; eliminarlo y recrearlo sí. El cuerpo aprobado permanece fijo, con una frase breve como variable. No usar el campo para reemplazar todo el mensaje.

## Selección y calendario implementados

Después de un nuevo turno respondido por el bot, se programa semana 1 para siete días después del último mensaje del lead. No se recuperan conversaciones antiguas al activar. Se respeta el horario del proyecto, dentro de 09:00–18:00, sin domingos. Deben pasar siete días desde el último seguimiento de nutrición aceptado: si se envió el de 24 horas, semana 1 puede desplazarse al día 8 o a la siguiente apertura.

1. Si el brochure no se compartió y está habilitado: Salesbot 21392.
2. Si ya se compartió: usar 21394 con un propósito relacionado con el historial, o saltar el envío según la configuración.
3. Temas posibles: distribución de la unidad de interés, comparación de opciones publicadas disponibles, información de financiamiento con entidades habilitadas, visita a oficina si el lead mostró interés y la política del proyecto lo permite.
4. Sin un tema útil permitido, se omite el mensaje. No se genera contenido de relleno.

Solo una variante de semana 1 por contacto y proyecto. La memoria incluye las conversaciones de los leads asociados al mismo contacto de Kommo dentro del proyecto. Un cambio reciente de unidad o categoría prevalece sobre preferencias antiguas.

Se requieren canal WhatsApp, permiso de seguimiento, IA activa y elegibilidad del lead. Se comprueban mensajes pendientes, última consulta respondida, cambios de conversación, atención humana, citas, coordinación de visita y evaluaciones con consentimiento. Un nuevo mensaje invalida el pendiente. Antes del Salesbot se revalidan historial, contenido, configuración, horario y Detener IA.

Un error o resultado incierto no se reenvía automáticamente. La respuesta 402 vigente de Kommo mantiene bloqueado el ejecutor hasta que se resuelva y se revise desde el panel de salud de envíos. Configurar semana 1 no elimina ese bloqueo.

## Memoria y continuación

El enlace estable `/brochure` redirige temporalmente al PDF existente `/materiales/brochure-la-vilet-v5.pdf`; ambos son públicos. No se desarrolló todavía el HTML del brochure. Se omite el envío si el enlace no puede verificarse.

La entrega se reconoce por el enlace/archivo real guardado o por la marca de brochure en un mensaje saliente. Una promesa de envío o un enlace pegado por el lead no cuentan. Ambas URLs identifican el mismo brochure. La aceptación por Kommo evita duplicarlo pero no prueba entrega ni lectura.

En Ajustes de automatización → Seguimiento → Semana 1 se puede registrar que un asesor compartió el brochure fuera del sistema, indicando el ID del lead en Kommo. Los mensajes manuales que no están guardados o cuyos enlaces abreviados no identifican el recurso requieren esa marca.

Se registra el cuerpo completo seleccionado y su propósito en `messages.tool_calls.nutrition_week_one`. La respuesta posterior se procesa con ese texto en el historial. Un «sí» inequívoco retoma el ofrecimiento; una nueva pregunta, negativa, condición o varias consultas conserva su significado original. Aceptar información financiera nunca equivale a consentir una evaluación crediticia. No se altera el texto original entrante guardado.

Los motivos de envío, omisión o aplazamiento quedan en `lv_integration_events.result`. La tabla anterior de cuatro semanas es planificación y no dispara mensajes; los controles de cada semana son independientes. La semana 4, la narrativa del proyecto y su memoria de lectura siguen pendientes.

## Semanas 2 y 3

Ambas plantillas fueron comprobadas como WABA aprobadas, con los campos de texto 530952 y 530954. El cuerpo enviado se conserva exactamente; solo se completa la variable. La semana 2 incluye la imagen `LaVilet.png`, ID `ee0ef35c-6df1-4401-baf4-8176c0203dca`; se verifica esa identidad y tipo de adjunto antes del envío. La semana 3 no tiene adjunto.

- Semana 2: a los 14 días del último mensaje atendido. El campo contiene un sustantivo acorde al propósito: `un nuevo hogar`, `un local para su negocio`, `un local comercial`, `una propiedad para invertir` o `el espacio adecuado para usted`. Ya no es el nombre de una unidad ni un verbo de acción.
- Semana 3: a los 21 días. El campo ofrece información de financiamiento, proceso de compra o conversación con un asesor. Se evita un paso ya ofrecido o información ya explicada; si no existe otro paso pertinente, se omite.
- Las nuevas semanas comparten la frecuencia mínima de siete días con 24 horas y semana 1. Una semana anterior pendiente aplaza la siguiente; no se adelantan ni se envían juntas. Los intentos inciertos requieren revisión.
- Cada semana se envía como máximo una vez por contacto/proyecto. Un mensaje nuevo cancela los pendientes y los nuevos turnos elegibles se vuelven a programar, respetando las semanas ya enviadas. Activar no crea pendientes para conversaciones antiguas.
- Las pausas y comprobaciones de elegibilidad se comparten con semana 1 y se revalidan después de escribir la variable, antes de lanzar el Salesbot.
- El cuerpo completo y propósito quedan en `messages.tool_calls.nutrition_week_two` o `nutrition_week_three`. Un «sí» en semana 2 retoma una duda por aclarar, sin inventar cuál. En semana 3 retoma la acción ofrecida. Una pregunta específica o varias consultas conservan prioridad.
- Ni «sí» ni «sí, con JEP» a esta plantilla autorizan una solicitud crediticia. Una solicitud explícita posterior de evaluación sí se procesa con las reglas habituales de consentimiento.
- Ajustes de automatización → Seguimiento permite activar/desactivar cada semana. La configuración se guarda en `projects.policies_json.nutrition_later`, conservando la de semana 1.
- La semana 4 no tiene ruta, Salesbot ni tarea de envío. No se activa.

## Verificación e instalación

- Pruebas aisladas de selección, contexto, consentimiento, fechas, duplicados, pausas, aprobaciones, errores y cambios durante el envío.
- Pruebas de conversación con aceptación y múltiples consultas tras la plantilla.
- Consulta de solo lectura al esquema, catálogo publicado, memoria del contacto y aprobación de plantillas.
- Compilación de producción y comprobación anónima de la redirección del brochure.
- Activación mediante `projects.policies_json.nutrition_week_one`, conservando las demás políticas y comprobando `updated_at`. No requiere SQL nuevo ni lanzar Salesbots para instalar.

Referencias: [campos de Kommo](https://developers.kommo.com/reference/custom-field-by-entity), [campos del lead](https://support.kommo.com/docs/es/customize-fields-in-lead-profiles).
