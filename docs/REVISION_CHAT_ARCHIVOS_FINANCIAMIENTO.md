# Revisión de conversación, archivos y financiamiento

## Causas comprobadas

- Las imágenes de Kommo responden con redirecciones `amojo.kommo.com → drive-g.kommo.com → storage.googleapis.com`. La descarga anterior rechazaba cualquier redirección, antes de invocar el modelo.
- Un archivo fallido sustituía el turno entero, incluso si había una consulta escrita. Los stickers también disparaban ese mensaje.
- La expresión «120.83» no activaba la consulta de medidas. El catálogo tenía cuatro coincidencias (202, 302, 402, 502), pero el contexto ocultaba las áreas y la alternativa acababa derivando al asesor.
- «De 3 dormitorios» se interpretaba como permiso para enumerar medidas, aunque solo respondía una preferencia.
- Las repeticiones de financiamiento correspondían a distintos mensajes entrantes que regresaban al mismo estado y plantilla. Las dos entidades solo estaban habilitadas para el teléfono de prueba.
- «Sí, pero con crédito directo» debe responderse como condición/pregunta, sin convertirlo en autorización de revisión bancaria.

## Cambios

Descarga limitada en tamaño y tiempo, con validación HTTPS y de cada destino; almacenamiento externo solo tras la redirección del drive de Kommo. Imágenes en detalle alto y PDF como archivo. Se conservan títulos y números legibles, se contrastan con el catálogo y se guarda una referencia de conversación. Una coincidencia ambigua no crea interés en una unidad arbitraria. No se usan UUID inventados por el extractor.

Los errores de lectura conservan el texto y registran códigos de diagnóstico sin URLs firmadas. Un sticker aislado no inicia una consulta; una reacción junto con texto no lo anula. Un archivo ilegible no implica que el canal solo admita texto.

El guion acompaña las explicaciones con aperturas breves y cercanas; evita «uso mixto». El bot responde referencias del catálogo sin derivación innecesaria. La memoria de beneficios admite las consultas explícitas.

Crédito directo: no se ofrece, confirmado por el responsable. Constructora: Agmen, solo cuando se pregunta; no identifica al propietario. Banco Pichincha/JEP: publicación general autorizada por el responsable en esta conversación, con respaldo de configuración en `tmp/financing-public-*`.

Las preguntas de crédito directo no crean solicitudes ni recogen datos personales. El consentimiento condicionado no inicia una revisión. La selección de entidad avanza el flujo; las respuestas repetidas se detectan. La deduplicación de webhooks, la cola por contacto, los bloqueos del ejecutor y las operaciones inciertas siguen evitando reenvíos automáticos de acciones ambiguas.

## Validación y límites

`node --test scripts/integrations.test.cjs`, `node scripts/evaluate-chat-corrections.cjs` y `npm run build`. Las evaluaciones no envían WhatsApp ni modifican leads. Se prueba el plano real de LC-05, además de referencias de área, tono, preguntas múltiples, archivos fallidos y solicitudes de confirmaciones inventadas.

La lectura depende de la nitidez y del acceso al archivo. Se admiten imágenes JPEG/PNG/WebP, PDF y los formatos de audio que ya soportaba la transcripción. Otros adjuntos reciben una aclaración concreta; no se promete leer cualquier formato. Las pruebas cubren los casos observados y sus variantes, no garantizan todas las respuestas posibles de un modelo.

Referencias de implementación: [imágenes y visión](https://developers.openai.com/api/docs/guides/images-vision) y [entradas de archivos](https://developers.openai.com/api/docs/guides/file-inputs).
