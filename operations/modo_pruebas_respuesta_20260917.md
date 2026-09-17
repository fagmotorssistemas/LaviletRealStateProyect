# Modo de pruebas de tiempos de respuesta

Interfaz: `/inmobiliaria/automatizacion/pruebas`, pestaña **Modo de pruebas**.
Contacto permitido: 0987110032 / +593987110032. Se identifica en el proyecto y se verifica de nuevo antes de procesar. No admite números arbitrarios.

Está desactivado por defecto. El administrador puede activarlo y pulsar **Restaurar tiempos habituales** al terminar. No cambia el tono, las pausas, el consentimiento, los horarios de citas ni los seguimientos.

La configuración se guarda versionada como `automation_test_response_mode` en `agent_prompts`, inactiva como prompt, siguiendo el almacenamiento existente del control de tono. No modifica `lv_auto_config` ni requiere migración SQL.

El webhook conserva primero el evento original. Después de responder a Kommo, `after` espera cinco segundos, comprueba otra vez la configuración, adelanta solo los eventos pendientes de ese contacto y solicita una ejecución dirigida del worker. Conserva la fecha de disponibilidad original para restaurarla si se desactiva antes de procesar.

La ejecución dirigida mantiene el bloqueo global, los estados pendientes/inciertos, el límite de mensajes con adjuntos y el procesamiento normal con sus comprobaciones de envío. No ejecuta mantenimiento ni notificaciones de otros contactos. Si falla la activación rápida o el worker está ocupado, los eventos permanecen para el ejecutor programado. Cinco segundos es la espera de agrupación, no una garantía del tiempo total de respuesta.

Pruebas: `node --test scripts/test-response-mode.test.cjs scripts/integrations.test.cjs`. Comprobar además build y ESLint de archivos cambiados. No se envían mensajes reales desde estas pruebas.
