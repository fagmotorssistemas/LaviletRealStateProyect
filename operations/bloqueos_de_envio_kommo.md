# Respuestas pendientes por errores de Kommo

El 15 de septiembre de 2026, el mensaje del lead Kommo 3577404 llegó correctamente, con la IA habilitada tanto en La Vilet como en Kommo. La escritura del campo de respuesta fue rechazada con HTTP 402, `Payment required`. No se llegó a iniciar Salesbot. Una comprobación conservando el mismo valor de «Detener IA» devolvió también 402; las lecturas seguían funcionando.

Ese código confirma el rechazo del proveedor, pero no permite identificar desde la API si la causa comercial concreta es una suscripción, una restricción o un límite de la cuenta. Se debe revisar en Kommo o con su soporte. Reiniciar conversaciones no resuelve el rechazo.

## Protección aplicada

- Los rechazos HTTP conocidos se distinguen de los timeouts y resultados desconocidos. No se informa que se envió una respuesta rechazada.
- Ante 401, 402 o 403 se guarda un bloqueo del proyecto. El ejecutor no consume más mensajes ni sigue intentando envíos. Los webhooks siguen conservándose en la cola.
- El aviso aparece en el CRM para los perfiles con acceso a Automatización. Incluye el código, los mensajes pendientes y enlaces a las conversaciones afectadas.
- Una lectura exitosa de Kommo no borra el bloqueo: poder leer la cuenta no prueba que permita enviar.
- Si un mensaje pendiente supera la ventana de respuesta, queda como incidencia para atención del equipo; no desaparece como una tarea exitosa.

## Recuperación

1. Resolver el aviso de la cuenta o las credenciales/permisos en Kommo.
2. Un administrador selecciona **Ya revisé Kommo: reanudar pendientes** en el aviso del CRM. No prueba ni afirma que el proveedor se recuperó; permite al ejecutor volver a procesar los mensajes nuevos que estaban en espera.
3. Si Kommo vuelve a rechazar las solicitudes, se activa otra vez el bloqueo.
4. Los intentos que fallaron previamente requieren revisar la conversación y atender la consulta pendiente. No se reprocesa su mensaje original: algunas acciones internas podrían haber ocurrido antes del error. Cuando se atendió, el administrador puede marcar **Ya atendí esta conversación**.
5. Los timeouts y envíos de resultado desconocido conservan su bloqueo por contacto hasta una revisión técnica del historial del proveedor. La recuperación de la cuenta no los reenvía ni los descarta.

La recuperación no cambia «Detener IA», no borra el historial y no inicia un Salesbot desde el botón. El ejecutor conserva sus comprobaciones de pausa, intervención del asesor, consentimiento y ventana de respuesta.

## Implementación y validación

`delivery-state.ts` utiliza la tabla existente `lv_integration_events`; no requiere SQL nuevo. `kommo.ts` registra los rechazos; `worker.ts` preserva la cola y las incidencias. `AutomationDeliveryBanner.tsx` muestra el estado; `/api/integrations/delivery` restringe las acciones de recuperación a administradores autenticados y al mismo origen. `/api/integrations/status` incorpora el estado de envíos, además de las lecturas de conexión.

Las pruebas de `scripts/delivery-health.test.cjs` simulan los rechazos, el fallo original, la recuperación, los timeouts, la caducidad y los permisos. No contactan a clientes.
