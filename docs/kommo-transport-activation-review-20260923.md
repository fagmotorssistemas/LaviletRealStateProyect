# Activación propuesta: transporte nuevo separado del historial

## Investigación real

Lecturas autorizadas de Kommo de 23 septiembre 2026, 23:08–23:10 UTC, cuenta 36919007:

| Webhook | Destino (sin secretos) | Suscripción | Estado |
| --- | --- | --- | --- |
| 47472151 | www.lavilett.com/api/integrations/kommo/webhook | add_message | disabled=false |
| 47464183 | n8n.ksinuevos.com/webhook/lavilet-chat | add_message | disabled=false |

Ninguno está suscrito a add_outgoing_message. Es una interrupción comprobada antes del receptor para esa vía de notificación. No prueba que no existan otras integraciones o descartes previos.

El destino La Vilet contiene el parámetro key; se omitió su valor. GET sin credenciales al path del receptor devuelve 405 desde Vercel, coherente con una ruta POST existente. El nuevo path /api/integrations/kommo/observe devuelve 404: aún no está desplegado. No se hicieron POST de prueba ni escrituras remotas. No se verificó la validez del secreto remoto ni el commit desplegado. El secreto local vacío no demuestra una avería en producción.

Las 33 conversaciones legibles en Kommo y los 81 eventos entrantes completados guardados identifican origin=waba. Eso confirma el canal registrado como WhatsApp Business API; no identifica de forma suficiente el proveedor/instalación exacta. GET /api/v4/sources devuelve 204 para esta integración (solo informa sus propias fuentes). El catálogo devuelve 233 widgets sin ninguno marcado is_active_in_account y las consultas específicas tampoco identificaron la conexión. No se confunde catálogo disponible con integraciones instaladas. El responsable confirmó posteriormente que la integración instalada es WhatsApp Business; no se necesita repetir esa identificación para preparar el observador.

No hay acceso autorizado a los logs Vercel/n8n. La consulta de logs Supabase devolvió Insufficient scope. Sí hay acceso SQL de lectura a eventos persistidos. No se puede certificar la ruta HTTP de cada registro ni el estado del flujo n8n solo por su webhook habilitado. El contacto interno Pablo, ficha 4453096/contacto 9431328, tiene bot_enabled=false actualmente en CRM; eso no acredita que n8n o un Salesbot independiente no puedan enviar.

## Solución oficial propuesta

Conservar WhatsApp y los dos webhooks existentes. Añadir una suscripción separada con add_message y add_outgoing_message al receptor nuevo de observación. La documentación permite webhooks en Advanced y describe salientes de usuarios y Salesbot, con texto y adjuntos. No requiere leer el endpoint de historial bloqueado. La aceptación efectiva de la nueva suscripción y entrega de cada tipo en esta cuenta se comprobarán después de autorizarla; no se afirman todavía.

El receptor preparado en src/app/api/integrations/kommo/observe/route.ts autentica con el secreto de webhook existente, normaliza cuenta/canal/mensaje y llama únicamente lv_record_message_evidence. No encola automatización, no ejecuta workers ni llama Kommo o Meta. Conserva la fecha original, fecha de observación, autor, dirección, tipo y chat/talk. Los reintentos se deduplican en el diario. Un error de persistencia responde 503; se aplican reintentos finitos del proveedor, no una garantía de recuperación ilimitada.

Esta vía cubre nuevos mensajes notificados desde Kommo. Los enviados directamente desde otra aplicación o canal no quedan garantizados por el evento documentado: deberán probarse separadamente. Los fallidos o pendientes no se convierten en respuesta. Si el plan deniega la suscripción, guardar el HTTP y pedir a soporte habilitación de add_outgoing_message para Advanced; no reemplazar WhatsApp ni eludir el permiso de historial.

Referencias oficiales:
- https://developers.kommo.com/docs/webhooks-general
- https://developers.kommo.com/reference/webhook-events
- https://developers.kommo.com/changelog/conversations-list-and-outgoing-message-webhook
- https://developers.kommo.com/reference/sources

## Paquete exacto a autorizar y orden

1. Revisar y aplicar 20260923205830_disable_destructive_contact_resets.sql, conservando los 116 respaldos. Luego 20260923174920_kommo_message_evidence.sql (diario, clasificaciones internas y tres funciones). No hace falta aplicar la migración de interés para probar transporte. Verificar permisos/RLS/funciones mediante operations/verify_kommo_protection_readonly.sql. No ejecutar todas las migraciones de la carpeta.
2. La activación del observador no depende del filtro ni del contacto de n8n. No conectar el observador a ese flujo ni modificar su restricción. La selección y clasificación de una persona interna se requiere únicamente antes de generar mensajes de prueba; no bloquea el despliegue ni la recepción pasiva autorizados.
3. Destino propuesto: despliegue Vercel **Preview del proyecto actual**, ruta `/api/integrations/kommo/observe`, sin promoverlo a Production ni asignarle www.lavilett.com. El hostname exacto será el que Vercel asigne al crear ese despliegue; todavía no existe y se verificará antes de suscribir. El despliegue Next incluye el árbol local: revisar sus cambios existentes y no atribuir el paquete entero solo al observador. Usar AUTOMATION_MODE=off y configuración sin cron en ese entorno; no cambiar los valores productivos ni la restricción test_only. Exponer exclusivamente el endpoint autenticado necesario al webhook; no quitar la protección de producción. Verificar configuración privada del secreto sin imprimirla. Si no puede reutilizarse la configuración autorizada, solicitar configuración privada al responsable, no cambiar credenciales automáticamente.
4. Añadir únicamente el webhook paralelo al endpoint del entorno de prueba, eventos [add_message, add_outgoing_message], preservando ambas suscripciones existentes y sus destinos íntegros. No registrar la URL con key en documentos o logs. Verificar por GET que quedó habilitado. Si Kommo rechaza el evento, detener esta fase y registrar el error; no hacer cambios alternativos improvisados.
5. Verificar pasivamente las notificaciones nuevas de actividad normal: cuenta, identificadores originales, conversación, dirección, autor, estado y fechas de origen/recepción. No generar mensajes para esta comprobación. La falta de un tipo de evento durante ese intervalo no demuestra que no se entregue.
6. La prueba controlada siguiente es independiente y puede seguir pendiente mientras el observador registra actividad normal. La posterior promoción de la aplicación a producción es otra decisión y no está incluida en este ensayo.

## Requisitos concretos pendientes de activación

- Autorización explícita para las dos migraciones indicadas, despliegue Preview y tercera suscripción. Ninguno se ha ejecutado.
- Acceso autorizado al proyecto Vercel y sus registros. Confirmar el hostname del despliegue y que Kommo pueda hacer POST sin una pantalla de inicio de sesión. No desproteger toda la aplicación: si no puede limitarse el acceso necesario, revisar el alojamiento antes de suscribir.
- Configuración privada del Preview: NEXT_PUBLIC_SUPABASE_URL del proyecto xhjnyntywqhczdtecgim, SUPABASE_SERVICE_ROLE_KEY solo servidor y KOMMO_WEBHOOK_SECRET no vacío de al menos 32 caracteres, como exige secretMatches. Verificar presencia y validez sin imprimir valores. No modificar el archivo local ni secretos productivos. Si falta configuración autorizada, el responsable debe provisionarla privadamente. El token para leer el historial de Kommo no es necesario para recibir notificaciones.
- AUTOMATION_MODE=off y ausencia de cron en Preview. El observador solo llama lv_record_message_evidence; no llama lv_receive_kommo_observation. Crear esa otra función en la migración no la ejecuta ni activa el receptor comercial.
- Verificar RLS y permisos después de migrar: sin acceso directo de anon/authenticated al diario y clasificaciones; escritura del diario desde el servidor autorizado. Verificar protección de reinicios y conservación de respaldos.
- Comprobar aceptación real de la suscripción independiente add_message/add_outgoing_message. Si Kommo la rechaza, registrar el error sin alterar los receptores actuales.
- Verificar persistencia y deduplicación con registros reales y medir sent_at frente a observed_at. Un 503 no garantiza recuperación: si se agotan reintentos, declarar el intervalo incompleto y conservar evidencia del fallo.

Capturar evidencia y actualizar el panel productivo son entregas distintas. El código local del detalle CRM y marketing ya lee el diario, pero desplegar el Preview no actualiza la aplicación productiva. La publicación posterior del panel requiere autorización separada. No declarar actualizado el contador productivo por el mero hecho de recibir eventos.

## Acción exacta para la prueba (después de la activación aprobada)

Solo antes de enviar mensajes de prueba: confirmar el filtro real de n8n, la identidad y carácter interno de la persona, su exclusión comercial y si las automatizaciones actuales podrían responderle. No modificar ni ampliar el filtro. Esto no bloquea la observación pasiva.

No hace falta anuncio ni campaña para comprobar transporte. **El contacto está pendiente de selección confirmada**, sin reiniciarlo ni borrar su conversación. La condición real del CRM consultada mantiene enabled=true, dry_run=false, test_only=true y test_lead_id=52fa6e93-4bd4-42ad-963a-666e9c7902a7: Carlos Fabián, ficha Kommo 4454162/contacto 9432278, bot_enabled=true. Es la configuración del CRM, no una lectura de n8n. El usuario confirmó WhatsApp Business y que n8n está activo para una persona; falta el ID/condición de ese flujo. Si elegimos su persona permitida, n8n podría responderle: no se promete ausencia de respuestas automáticas de otros receptores. No se ampliará la restricción para la prueba.

1. Acordar hora de inicio y anotar el chat/talk utilizado. Desde el WhatsApp de ese contacto, el usuario envía “Prueba de transporte La Vilet [hora acordada]”. El agente comprueba evento entrante y evidencia guardada, con IDs originales y tiempos.
2. Desde Kommo, un asesor responde en esa misma conversación “Respuesta de prueba [hora]”. El agente comprueba outgoing_message, autor interno, estado enviado y fecha posterior al entrante.
3. Desde Kommo, el asesor envía un audio corto en esa misma conversación. Se comprueba adjunto voice/audio, fecha y autor, sin exigir texto ni lectura. El contador aislado sigue teniendo una persona respondida, no dos.
4. Probar Salesbot en un paso adicional únicamente si el usuario autoriza y lo ejecuta. El texto y audio de asesor no validan Salesbot por sí solos.
5. Usar operations/verify_kommo_transport_readonly.sql con la hora acordada para origen → observación → consulta. Medir además la hora en que aparece en la vista de detalle del CRM del entorno de prueba. Si esa vista no expone la evidencia, registrar esa diferencia; no sustituirla por éxito del SQL. El panel comercial debe excluir siempre al contacto interno y no sumar gasto ni adquisiciones de prueba.
6. La asociación publicitaria es una segunda prueba: requiere una referencia real de un anuncio existente, con consentimiento del responsable, o evidencia original ya disponible. No se inventa un anuncio ni se necesita crear una campaña pagada. El contador publicitario sigue fuera del criterio de aprobación de la primera prueba de transporte.

## Recuperación ante fallos

- Si falla la migración, detener antes de suscribir; revisar transacción y permisos sin borrar tablas/backups existentes.
- Si falla el observador, deshabilitar únicamente la nueva suscripción, preservar diario y logs; no tocar las suscripciones existentes. Volver al despliegue de prueba anterior o retirar ese entorno sin revertir la protección ni borrar evidencia.
- Registrar el intervalo sin observación: los reintentos son finitos. No recuperar ni reenviar históricos automáticamente.
- Si se detecta envío no previsto de otro flujo, parar la prueba y revisar n8n/Salesbot; no reiniciar la ficha.

## Validación y límites

El test local del observador verifica tres eventos con forma documentada (entrante, asesor, audio bot), autenticación, persistencia y error 503, y prohíbe dependencias comerciales. Es simulado. No demuestra que se hayan recibido salientes reales. El historial 403 no se consultó de nuevo. Los ocho de Casa De Tarqui siguen por verificar.

Pasaron la compilación completa (incluye la ruta observe), TypeScript, ESLint del receptor y git diff --check. Se confirmó main. Las lecturas de inventario utilizaron el token existente sin imprimirlo, sin consultar mensajes y sin escribir remotamente.

Pendientes para activación: acceso/configuración del despliegue, autorización del paquete y aceptación real de add_outgoing_message. Pendiente solo para la prueba activa: filtro de n8n y contacto interno confirmado. Pendiente histórico independiente: permiso de lectura del historial de Kommo. Estos dos últimos no bloquean la preparación del observador.
