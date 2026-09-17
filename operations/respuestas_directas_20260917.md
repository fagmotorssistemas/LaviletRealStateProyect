# Respuestas comerciales sin repetir al cliente

Corrección transversal para Original, Cercano, Equilibrado y Elegante, con cualquier calidez y detalle.

- `src/lib/inmobiliaria/conversationTone.ts`: calidez máxima significa atender la necesidad con información útil. Se reconoce una preocupación real cuando ayude, sin repetir rutinariamente el mensaje del cliente.
- `src/lib/integrations/automation/direct-reply.ts`: regla compartida de redacción y revisión; filtro conservador de introducciones que repiten una intención y cierres genéricos de orientación. Solo elimina una introducción si su contenido está en el mensaje actual y existe una respuesta restante. Conserva condiciones, negaciones, cantidades, enlaces y avisos operativos.
- `src/lib/integrations/automation/direct-conversation-rule.ts`: incorpora la regla a todos los perfiles de escritura y revisión, incluido Original. El detalle debe desarrollar datos útiles, no introducciones ni justificaciones de preguntas.
- `src/lib/integrations/automation/conversation.ts`: aplica el filtro después de la revisión final y antes del envío. Registra `direct_reply_guard: true` cuando modifica el texto. Las etapas anteriores no pueden reinsertar después la frase retirada.
- `scripts/direct-reply.test.cjs`: regresiones con las frases reportadas, conservación de hechos y cobertura de todos los estilos y barras.

Ejemplo: «Comprendo que le interesa abrir un local comercial. Tenemos locales en planta baja. ¿Qué negocio tiene pensado abrir? Así puedo orientarle mejor según sus planes.» pasa a «Tenemos locales en planta baja. ¿Qué negocio tiene pensado abrir?».

El filtro es deliberadamente conservador: no elimina cualquier frase que comience por «Entiendo», ni las confirmaciones necesarias. Las variaciones semánticas más amplias se tratan mediante las reglas de escritura y revisión. No cambia precios, permisos de visita ni la configuración de tono guardada. No necesita SQL ni un nuevo control de interfaz.
