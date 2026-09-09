# Control de respuestas de La Vilet

La interfaz administrativa est? en /inmobiliaria/automatizacion/guion, secci?n C?mo responde. Guarda los prompts del proyecto en agent_prompts y el ejecutor los consulta en cada mensaje. No se necesita desplegar al editar su contenido.

- saludo_inicial: texto literal para saludos aislados (Hola, buenos d?as, buenas tardes y buenas noches). No dispara scoring ni financiamiento.
- respuesta_comercial: instrucciones de redacci?n comercial para consultas.
- revisor_respuesta: valida el borrador comercial y devuelve JSON con aprobada booleano. Si lo rechaza, se utiliza la respuesta gen?rica del c?digo.
- resumen_conversacion, extractor_eventos y clasificador_intenciones: procesamiento del contexto. Conservar los contratos JSON al editarlos.
- guion_preguntas se administra desde la secci?n de preguntas.

Las reglas de pausa del bot, consentimiento, deduplicaci?n, ventana de WhatsApp, permisos y validaci?n de citas siguen en c?digo y base de datos. Los prompts no pueden omitirlas. Los textos determin?sticos de visitas y financiamiento y las instrucciones de clasificaci?n de propuestas siguen en c?digo.

Cambios del 2026-09-09: se agregaron saludo_inicial y revisor_respuesta a agent_prompts, sin modificar tablas. Se reinici? el lead 52fa6e93-4bd4-42ad-963a-666e9c7902a7: conversaciones, solicitudes, cita cancelada, colas, puntuaci?n y preferencias comerciales. Conserva identidad y v?nculo Kommo; no se modific? Kommo. Verificado: nuevo, lanzamiento, fr?o, puntuaci?n 0, sin preferencia, bot activo y cero conversaciones/citas.

Publicaci?n pendiente: subir el c?digo y desplegar para habilitar el saludo y el editor ampliado en producci?n.
