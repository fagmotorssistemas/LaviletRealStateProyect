# Recuperación de fallos temporales de OpenAI

## Problema observado

El intento de Pablo (#3577404) del 16 de septiembre a las 09:10, hora de Ecuador, terminó con `OPENAI_HTTP_503`. El ejecutor marcaba cualquier excepción como `uncertain`. Ese estado impedía procesar nuevos mensajes del contacto y la pantalla lo describía como un envío por comprobar, aunque la generación había fallado antes de enviar la respuesta.

## Cambios

- `openai-request.ts` (nuevo): hasta tres intentos de la misma solicitud de inferencia, con espera creciente, variación pequeña y respeto de `Retry-After`. Límite total de 45 segundos por solicitud; si el proveedor exige esperar más, no se adelanta el reintento. Reintenta errores de red, 408, 500, 502, 503, 504 y límites temporales 429 identificados. No reintenta errores de saldo, cuotas de gasto, credenciales ni solicitudes inválidas.
- `ai.ts`: aplica ese mecanismo a generación y transcripción. El reintento no vuelve a ejecutar la conversación, una cita, un trámite financiero ni un envío a Kommo.
- `business-scope.ts` y `conversation.ts`: un fallo de OpenAI agotado conserva su identidad. No se convierte en «no entendí su mensaje» ni en un supuesto audio borroso.
- `generation-recovery.ts` (nuevo): si la generación sigue fallando, registra una derivación real al equipo, pausa la automatización de ese lead y envía una única disculpa breve indicando que la consulta está en la bandeja del asesor. No depende de OpenAI para redactarla. Comprueba pausas, consentimiento, ventana de respuesta, mensajes nuevos, respuestas previas, intervención humana y envíos pendientes antes de actuar.
- `worker.ts`: distingue un fallo de generación de un resultado desconocido de Kommo. Si la recuperación falla antes de intentar enviar, conserva un incidente de generación sin bloquear indefinidamente el contacto como envío incierto. Si se intentó lanzar el mensaje y no se conoce el resultado, conserva `uncertain`: no lo reenvía.
- `delivery-state.ts` y `AutomationDeliveryBanner.tsx`: muestran «Falló la generación de la respuesta; requiere atención» para el caso correspondiente. Los incidentes antiguos inciertos no se descartan sin una revisión específica.

## Aviso de contingencia

«Disculpe la demora. He dejado su consulta en la bandeja del equipo para que un asesor le ayude con ese detalle.»

Solo se utiliza después de comprobar que la derivación quedó registrada. Una respuesta normal conserva la redacción contextual con IA.

## Validación y alcance

Las pruebas simulan recuperación al tercer intento, caída persistente, errores de red, límites de tasa, errores de saldo, respeto de `Retry-After`, duplicados, intervención humana, pausa del bot, mensajes posteriores y fallos del propio aviso. No hacen envíos reales.

No requiere migración SQL. La corrección entra en vigor al desplegar la aplicación. El intento histórico de Pablo no se reenvía por instalar el código: necesita su recuperación específica y comprobar que nadie haya respondido mientras tanto.

El usuario autorizó expresamente la recuperación de Pablo. Se verificaron la publicación del departamento 202, el enlace de su modelo, la ausencia de una respuesta posterior, pausas y otros envíos pendientes. Kommo aceptó la respuesta aprobada con la vista preliminar y se registró el mensaje antes de cerrar el incidente. No se reinició el lead ni se ejecutaron de nuevo acciones comerciales. La aceptación de Kommo no acredita lectura del mensaje.
