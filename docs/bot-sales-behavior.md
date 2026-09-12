# Conversación comercial y audios — 12 de septiembre de 2026

El problema no se resuelve añadiendo más plantillas a Kommo. Kommo entrega el mensaje; el servidor interpreta el turno, consulta el inventario y decide cómo continuar. Los guiones deben obedecer al estado real de la conversación y de la agenda.

## Referencias y adaptación

- [NAR: experiencias de agentes al mejorar la consulta inicial](https://www.nar.realtor/news/real-estate-news/sales-marketing/wrapping-up-a-year-of-real-estate-practice-changes). Escuchar, hablar menos y comprender las necesidades. Adaptación: reutilizar lo que el cliente ya dijo y evitar encadenar formularios.
- [Huthwaite: metodología SPIN](https://www.huthwaiteinternational.com/spin-methodology). Explorar necesidades, relacionar la solución con ellas y acordar un siguiente paso. Su estructura es flexible, no una secuencia rígida. Adaptación: una pregunta útil como máximo, beneficios pertinentes y visita como invitación, nunca como cita ya aceptada.
- [NAR: motivación y presentación de hechos](https://www.nar.realtor/news/real-estate-news/sales-marketing/win-more-seller-buyer-business). Adaptación: distinguir el atractivo del sector de una promesa de reventa. No trasladamos normas contractuales estadounidenses al proceso ecuatoriano.
- [OpenAI: transcripción](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create). La API necesita formato y nombre de archivo correctos. Se conserva el modelo configurado, con `whisper-1` como valor predeterminado.

La fórmula de tres beneficios sirve como orientación: el bot puede usar de uno a tres si responden a la necesidad. No debe inventar un tercer beneficio, repetir instalaciones ni explicar la compra en todos los turnos.

## Decisiones del bot

| Situación | Respuesta y siguiente paso |
|---|---|
| Saludo o punto sin contexto comercial | Saludo breve y ofrecimiento de ayuda. |
| Información del proyecto | Apertura amable, ubicación y experiencia de vivir/invertir; una pregunta útil si falta orientación. |
| Ya indicó vivir/invertir, dormitorios o prioridades | Aprovechar esos datos. No volver a preguntarlos para completar una lista. |
| Dos preguntas de calificación consecutivas | Dar información útil y permitir que el cliente decida cómo seguir. |
| Presupuesto todavía indefinido | Ofrecer ayuda para ordenar entrada/cuota y conocer financiamiento. No aprobar crédito ni exigir información personal para mostrar el proyecto. |
| Unidad identificada en texto, imagen o audio | Contrastar con el catálogo. Entregar el modelo de esa unidad si existe; aclarar si el código es ambiguo. |
| Solicitud de fotografía | Explicar que se comparte una vista interactiva, sin presentarla como foto real. Puede acompañarse de una invitación a conocer el inmueble. |
| “Se ve interesante” después del modelo | Reconocer interés y ofrecer visita si no se ofreció antes. No crear solicitud de agenda todavía. |
| “Sí” a la invitación de visita | Empezar a recopilar día y hora. No confirmar ni notificar al asesor prematuramente. |
| Invitación rechazada o cita ya en curso | No insistir en otra visita ni reiniciar calificación. Responder las consultas nuevas. |
| Varias preguntas en un mensaje | Cubrir cada tema. Jardines, sector y reventa tienen comprobación explícita de cobertura y respuesta de respaldo. |
| Financiamiento | Mantener las reglas existentes: Pichincha/JEP, sin crédito directo, elección y consentimiento separados, sin repetir la introducción. |
| Petición de una persona, baja o cita confirmada/cancelada | Prevalecen los flujos existentes de atención humana, consentimiento y agenda. Una cortesía no reabre esos flujos. |

La memoria de invitación/rechazo se guarda por conversación después de que Kommo acepta el mensaje. Los datos de un lead no se usan para decidir por otro. Los materiales enviados no significan que el cliente los vio: el bot usa lo que el cliente declara, no inventa métricas de lectura.

## Audio

Se reconoce audio OGG/Opus, WAV, MP3 y FLAC mediante su firma cuando el servidor lo entrega como archivo genérico, y los tipos declarados compatibles, incluido M4A/WebM. El límite de descarga permanece en 20 MB. Se conservan el texto escrito y la transcripción en el mismo turno.

Un audio vacío, ilegible, inaccesible o demasiado grande genera una indicación adecuada para nota de voz. Si también hay una pregunta escrita, se conserva. Un adjunto sin URL no se convierte en un saludo. El contenido transcrito sigue siendo información no confiable del lead; no autoriza acciones ni cambia las instrucciones del sistema.

## Mensaje sin respuesta e integridad del envío

El mensaje de las 11:54 sobre jardines, sector y reventa se recibió y registró. A las 11:55 el evento terminó en `uncertain` con `KOMMO_UNAVAILABLE`. El lead tenía la IA habilitada y el campo remoto DETENER IA en falso. Al revisar Kommo, RESPUESTA IA conservaba el texto de las 11:43: no apareció una respuesta nueva a ese turno.

Se concilió únicamente ese evento: los eventos remotos del contacto mostraban como última salida la de las 11:43 y no había una salida posterior registrada localmente. Se cerró el bloqueo como `reviewed_without_resend`, conservando el error y la evidencia. No se borró el lead ni se reenviaron mensajes antiguos. Los nuevos mensajes pueden continuar por el circuito normal.

La versión anterior no registraba qué operación de Kommo falló. La nueva distingue lectura, actualización de campo y lanzamiento del bot. Las lecturas reintentan hasta tres veces ante cortes, 429 y 5xx. Los PATCH/POST no se repiten automáticamente. Un envío incierto continúa requiriendo conciliación: el proveedor podría haberlo aceptado antes de cortar la conexión. No se debe resolver un fallo de red borrando todo el historial.

El servicio sigue ejecutándose en el servidor, independientemente de que un asesor esté conectado. Si una lectura falla en todos los reintentos, se conserva el diagnóstico para revisión; estas mejoras no garantizan disponibilidad ininterrumpida de los proveedores.

## Validación

- `npm.cmd run test:integrations`: regresiones de agenda, financiamiento, medios, contexto de unidades y entrega única; incluye escenarios nuevos de voz, invitación, rechazo y separación entre leads.
- `node scripts/evaluate-sales-policy.cjs --live`: lectura de catálogo/guiones activos y evaluación con OpenAI; no modifica leads ni envía WhatsApp.
- Prueba de voz sintética en español: la API real transcribió “departamento doscientos diez” como “departamento 210”, usando un WAV servido como `application/octet-stream`. La descarga de Kommo se simuló; queda por observar una nota de voz real del canal.
- `npm.cmd run build`: compilación y comprobación de tipos.

Los escenarios comprobados reducen los fallos conocidos. No constituyen una garantía de cubrir todas las formulaciones posibles; las respuestas nuevas conservan auditoría para añadir regresiones cuando aparezca un caso distinto.
