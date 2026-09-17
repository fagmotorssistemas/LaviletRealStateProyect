# Continuidad financiera y preguntas naturales

Cambios de esta entrega:

- `src/lib/integrations/automation/financing-continuation.ts`: reconoce respuestas inequívocas al cargo, tipo de trabajo, antigüedad e ingreso preguntados por el bot. Requiere consentimiento persistido y campo pendiente; no acepta preguntas, solicitudes de empleo, negativas o cambios explícitos de tema como datos. Conserva la ocupación expresada sin inventar correcciones ortográficas y elimina el emoji accesorio.
- `conversation.ts`: aplica esa comprobación antes del clasificador de alcance y conserva el campo al extraer eventos. La revisión final no puede volver a añadir explicaciones innecesarias en preguntas de recopilación.
- `financing.ts`: lee los campos existentes de la precalificación para comprobar qué falta. No modifica la función SQL ni sus estados.
- `business-scope.ts`: distingue expresamente una profesión solicitada por el bot de una petición de empleo o servicios externos.
- `direct-conversation-rule.ts`: aplica a Original, Cercano, Equilibrado y Elegante la regla de pedir el siguiente dato directamente, sin repetir la entidad, el dato anterior o supuestos requisitos internos.
- `operational-copy.ts`: comprueba esa regla al redactar y revisar. Si una reformulación agrega relleno, conserva la pregunta base. Las preguntas del cliente sobre la finalidad de los datos pueden recibir explicación.
- `src/components/inmobiliaria/automation/ProjectReadinessSettings.tsx`: muestra «Pendiente de verificación» hasta el primer guardado. Una fecha predeterminada del formulario no se presenta como verificación realizada.

Pruebas nuevas: `scripts/financing-continuation.test.cjs`, junto con regresiones de integraciones, tonos y proyecto. La huella del clasificador en `scripts/fixtures/conversation-tone-baseline.json` se actualiza únicamente por la regla contextual añadida deliberadamente.

No se modifican el perfil de tono guardado, precios, acuerdos financieros, cédulas existentes ni conversaciones históricas. Los cambios se aplican a mensajes nuevos. No se envían mensajes de prueba a leads reales y no requiere SQL manual.
