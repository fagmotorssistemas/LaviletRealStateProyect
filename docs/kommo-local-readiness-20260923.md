# Preparación local mientras Kommo bloquea el historial

No se repitió la consulta de mensajes 403 ni se regeneraron credenciales. Todo sigue local en main. No se ejecutaron migraciones, recuperación, mensajes a clientes, cambios CAPI, commit o despliegue. Se conservaron los cambios previos y los 116 respaldos existentes.

## Correcciones de esta revisión

- Los avisos humanos con estado fallido, pendiente, generado, borrador o accepted quedan en el diario, pero no entran al procesamiento de toma de control humana. Antes podían persistirse como respuesta de asesor.
- Un entrante explícito sin el campo auxiliar de autor no se descarta. Se acepta sec_created_at cuando no hay created_at. Se mantienen las comprobaciones de cuenta, canal e identidad.
- El origen guardado transporta ahora su ID de mensaje hasta el cálculo. La atención publicitaria exige encontrar ese entrante en la evidencia original y restringe los mensajes al mismo talk (o chat cuando no existe talk), desde ese entrante. Respuestas de otras conversaciones, anteriores o de otros anuncios no completan el indicador.
- Una referencia wamid y un ID Kommo distintos requieren una correspondencia original comprobada: no se comparan nombres, teléfonos o cercanía temporal. Sin esa correspondencia el contacto permanece por verificar. Los ocho históricos de Casa De Tarqui no cambian a respondidos o sin responder.
- El evaluador general también exige que la respuesta posterior pertenezca a la conversación del primer entrante. Los audios voice con transcripción siguen siendo audio, y picture se reconoce como imagen.
- Las observaciones pueden llegar antes de existir la ficha CRM. La lectura del diario ahora puede asociar en memoria observaciones sin lead_id únicamente cuando coinciden ambos IDs originales (contacto y ficha Kommo), existe un único propietario dentro del negocio y pertenece al conjunto autorizado. No escribe esa relación ni reasigna mensajes históricos. No utiliza teléfonos. Las identidades ambiguas quedan fuera.
- Se conservan adquisición única, filtros de campaña/anuncio, costo ponderado por gasto/contactos y exclusión de personas sin anuncio. No se alteraron puntuaciones, umbrales ni eventos de interés. Frío por defecto sin fecha de evaluación continúa como Sin evaluar.

## Verificación real, únicamente lectura

La cola actual contiene 81 eventos entrantes completados y 684 cancelados. No hay eventos advisor_outbound almacenados. No demuestra ausencia de notificaciones originales: el descarte pudo ocurrir antes de guardar. No se dispone de logs originales de producción que permitan probarlo.

En los 81 completados se comprobó: 74 textos sin adjunto, cuatro imágenes picture, dos audios voice y un sticker; cero archivos file/document. La mediana origen → recepción fue 2,46 segundos para textos, 3,46 para imágenes, 3,48 para audio y 3,54 para el único sticker. Son muestras recibidas entre el 16 y el 23 de septiembre, no una garantía de entrega ni una demora hasta el indicador. Los cancelados no forman parte de esa medida.

No se comprobó recepción original de respuestas de asesores, Salesbot ni archivos. Tampoco se comprobó actualización automática desplegada del indicador. Las tablas kommo_message_evidence y lead_interest_evaluations todavía no existen en remoto: sus migraciones continúan pendientes. Por ello, refrescar la consulta no permite declarar éxito de sincronización. El informe mantiene separados sent_at, observed_at y asOf/hora de consulta; no existe todavía una medida real de extremo a extremo hasta la pantalla.

La consulta de interés actual del negocio encontró 30 fichas frías sin fecha de evaluación, tres frías con fecha y tres tibias con fecha. Se conservan como estados distintos; no son cifras filtradas de Casa De Tarqui ni una evaluación nueva. No se modificó ninguna ficha.

## Pruebas locales (simuladas)

Treinta casos de regresión pasaron: atribución y conjuntos, conversación ajena, mensajes previos, Salesbot y multimedia, fallos de envío, autor auxiliar ausente, fechas en milisegundos, lectura de observaciones previas a la ficha, identidad ambigua y clasificación de interés. Incluyen PGlite con SQL real para recepción atómica, permisos, deduplicación y protección de reinicios.

También pasaron TypeScript, ESLint de los archivos revisados y compilación completa de producción. No se publicaron los artefactos.

Un fallo de diario o cola revierte ambos en la misma transacción. Repetir una recepción ya confirmada no duplica evidencia ni trabajo, incluso simulando respuesta HTTP perdida. Esto no prueba reintento del proveedor: un 503 no garantiza nueva entrega. No existe una garantía de cero pérdida ante caída prolongada sin almacenamiento duradero alternativo. No se simuló ni ejecutó un envío externo.

## Activación pendiente y prueba contigo

1. Obtener autorización posterior para activar los cambios. Aplicar la protección 20260923205830, luego el diario/recepción atómica 20260923174920 y la evaluación 20260923211512; verificar tablas, RLS, permisos y RPC con los scripts de solo lectura preparados. No aplicar automáticamente todo el directorio de migraciones.
2. Desplegar conjuntamente el receptor y los consumidores compatibles, una vez disponibles las RPC. Ninguna de estas acciones se ejecutó ahora.
3. El receptor exige un secreto de webhook válido; el valor local vacío comunicado por el usuario provoca 401. Debe configurarlo privadamente el responsable en el entorno de prueba y en el emisor autorizado. No se modificó el secreto ni se deshabilitó la autenticación. El token REST y ese secreto cumplen funciones diferentes.
4. Antes de mensajes reales, identificar un contacto de prueba exacto y registrar su clasificación interna auditable, con autorización separada. Nunca reutilizar una persona comercial por parecido de nombre. Verificar que esté excluido de todas las cifras comerciales. Usar un entorno aislado o recepción en modo observación (automatización deshabilitada) para no disparar bots, cambios comerciales ni CAPI.
5. Necesitamos una referencia publicitaria original comprobada para esa persona y su conversación. En modo observación no se registra una nueva adquisición comercial: si aún no existe esa referencia, la parte anuncio/contador de la prueba sigue bloqueada; no se fabricará una asignación para hacerla pasar. La comprobación aislada puede ejecutar la misma lógica con la referencia original disponible, manteniendo cero aportes del contacto interno al panel comercial.
6. Tú envías un entrante; desde Kommo envías una respuesta de texto y otra de audio en la misma conversación. Probar aparte una salida de Salesbot si el canal la permite y la autorizas. Yo no enviaré mensajes. Guardar evidencia de cuenta, contacto, ficha, chat/talk, anuncio, IDs originales, autor, tipo, estado, fecha de mensaje y recepción.
7. Comprobar que se recibe cada salida realmente enviada, que el audio no requiere texto ni lectura, y que la primera respuesta es la primera salida válida posterior en esa conversación. Un mensaje posterior en otro chat no debe cambiar esa primera respuesta. La prueba interna debe quedar excluida del contador comercial; el cálculo aislado con los mismos datos debe mostrar una adquisición y una respuesta, no dos por texto+audio.
8. Medir origen → recepción → disponibilidad en consulta → observación en pantalla. Verificar un reintento controlado sin efectos comerciales, no presuponerlo por el código HTTP. Si falta un evento, detener la conclusión y registrar qué tipo, cuenta y conversación faltan.

El permiso de historial pendiente de soporte sigue siendo necesario para el contraste completo de los ocho contactos anteriores. Los webhooks futuros no reconstruyen ni certifican el pasado. La sincronización permanece incompleta.
