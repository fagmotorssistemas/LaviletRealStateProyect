# Presentación inicial, nombre y residencia

## Secuencia

1. Un saludo aislado conserva la bienvenida y la pregunta de ayuda. No inicia la captura de perfil.
2. La primera consulta sustantiva se responde antes de solicitar datos. En información general se presenta el proyecto y su ubicación sin enumerar categorías; en consultas concretas se conserva la respuesta pertinente y verificada.
3. La invitación inicial completa es: «Para enviarle el brochure digital completo con los planos y brindarle una guía personalizada, ¿podría indicarnos su nombre y en qué ciudad o país reside actualmente?» Si ya se conoce un dato, se pregunta solo el faltante.
4. El siguiente intercambio entrega el brochure aunque el cliente responda parcialmente o continúe con otra consulta. Una petición explícita del brochure se atiende directamente, sin exigir datos.
5. Si aporta el nombre después de la solicitud inicial, pero no la residencia, se pregunta una vez por la ciudad o país que falta. Si acompaña el nombre con una consulta concreta (por ejemplo, precios), se responde primero esa consulta y se conserva el siguiente paso de identificación de necesidades para retomarlo después del recordatorio. El recordatorio se consume solo cuando esa pregunta autorizada se envía realmente. Si vuelve a omitirla o rechaza compartir datos, se continúa identificando sus necesidades sin insistir. Una consulta comercial sin aportar datos de perfil no autoriza por sí sola otro recordatorio. Las operaciones protegidas de reserva, visita o financiamiento mantienen su prioridad. Una ciudad o un país bastan para la residencia; no se exige proporcionar ambos.
6. Después se retoma la continuación comercial guardada. La presentación de categorías aparece junto a la pregunta sobre esas opciones; no queda separada por la captura de datos. Una categoría o cantidad de dormitorios ya elegida no se vuelve a preguntar.

La conversación conserva evidencia de la pregunta efectivamente enviada; un intercambio comercial o un brochure por sí solos no acreditan que se pidieran los datos. Un reinicio de prueba limpia esa memoria, aunque WhatsApp y Kommo conserven sus mensajes. Las solicitudes operativas de cita y financiamiento mantienen sus flujos. Las descripciones siguen sujetas a evidencia; no se añadieron afirmaciones no verificadas sobre plusvalía comparativa, acabados, terrazas de todas las unidades ni visitas a obra.

## Permiso compartido de captura

`profile_collection_decision` distingue solicitar por primera vez, recordar, confirmar un origen, posponer, rechazar y completar. Redactor y revisor reciben la misma decisión y los campos y preguntas autorizados. Que la residencia figure como dato pendiente no autoriza a pedirla en un turno donde se decidió continuar con las necesidades del cliente.

La revisión comprueba esa autorización junto con la consulta actual. Si se desactiva la revisión final, el redactor sigue recibiendo las reglas sin añadir una llamada oculta de revisión; una pregunta de perfil no autorizada no se registra como un nuevo recordatorio pendiente.

La decisión también acompaña las rutas protegidas, como una reserva, una visita o una derivación. Omitir la presentación en esas rutas no vuelve a autorizar la captura. El recibo de la pregunta enviada conserva además las unidades y filtros de la propuesta correspondiente: un registro sin esos datos no puede ocultar otro registro válido de la misma pregunta. Preguntas o propuestas diferentes no se combinan.

En financiamiento, elegir JEP o Banco Pichincha conserva la preferencia de entidad, pero no autoriza todavía a pedir identidad, cédula, empleo o ingresos. El estado `continuacion_pendiente` exige primero consentimiento, incluso si el cliente ya envió un documento incompleto. Redactor y revisor reciben `collection_allowed=false` y la pregunta de autorización; después de aceptar se retoman los campos financieros que correspondan.

## Dónde se guarda

- `conversations.summary._lead_profile`: `full_name`, `residence_city`, `residence_country` y `sources`. Cada fuente incluye declaración literal, mensaje de origen y fecha.
- `conversations.summary._lead_introduction`: etapa, recordatorio utilizado, brochure entregado y continuación pendiente.
- `leads.name`: se actualiza con el nombre declarado y validado. No se toma el alias de WhatsApp como declaración del cliente.

El perfil se guarda al registrar la respuesta aceptada para envío, siguiendo la persistencia conversacional existente. La residencia no se infiere del teléfono, nacionalidad, lugar de origen, dirección del proyecto ni lugar desde donde escribe. Un cambio de ciudad o país no se combina automáticamente con el otro dato geográfico antiguo si no se volvió a declarar. No se infiere el país a partir de una ciudad.

No hace falta una migración para esta etapa: la residencia queda en campos estructurados del resumen asociado al lead. Los mapas, normalización geográfica y paneles de análisis quedan para una etapa posterior.

## Archivos y responsabilidades

| Archivo | Funciones o secciones modificadas |
| --- | --- |
| `src/lib/integrations/automation/lead-introduction.ts` | `leadIntroductionTurn`, `leadIntroductionIssues`, invitación, política de entrega y reglas de redacción. |
| `src/lib/integrations/automation/turn-interpretation.ts` | Esquema de residencia, `profile_evidence` y `evidencedProfile`; validación de declaraciones actuales. |
| `src/lib/integrations/automation/conversation.ts` | Contexto del perfil pendiente, persistencia de evidencia, protección frente a continuación financiera accidental y aplicación de presentación antes del redactor. |
| `src/lib/integrations/automation/turn-completeness.ts` | Propósito `collect_lead_profile`, instrucciones del perfil, validación de pregunta y brochure y conservación de la invitación al verificar precios. |
| `src/components/inmobiliaria/automation/workflow/messageExplanation.ts` | Etiquetas de captura, residencia y controles de presentación/brochure. |
| `src/lib/integrations/automation/lead-introduction.test.ts` | Secuencia, parciales, omisiones, peticiones directas y conversaciones previas. |
| `scripts/turn-interpretation.test.cjs` | Nombre declarado, residencia actual frente a origen, viaje o ubicación del proyecto, evidencia literal y país no inferido. |
| `scripts/turn-completeness.test.cjs` | Revisión real de presentación, pregunta con propósito, categorías diferidas y brochure oficial. |
| `scripts/integrations.test.cjs` | Intercambio completo con persistencia de nombre y residencia, entrega y retorno al flujo. |
| `package.json` | Comando `npm run test:lead-introduction`. |

## Verificación

La prueba de presentación incluye el recorrido de tres turnos: información general → nombre → residencia. La revisión comprueba que el redactor no quite el propósito personalizado, no adelante categorías y no omita ni invente el enlace del brochure.

`npm run test:conversation-regression` reúne las regresiones de perfil, continuación, brochure, alternativas, datos de catálogo, financiamiento y recuperación. Ejecuta funciones reales con respuestas de IA controladas, sin consultas a modelos ni modificaciones de la base remota. Comprueba los contratos y los límites del flujo; la calidad de una respuesta nueva del modelo requiere además evaluación con mensajes reales.

La auditoría también cubre una cita ya registrada seguida de una consulta sobre un inmueble. Si el borrador se difiere explícitamente al redactor final, ese redactor debe completarlo; una respuesta vacía sin tal decisión sigue siendo un error. No se repite el registro de la cita para reparar la redacción.

Una elección actual como «prefiero esa opción» puede seleccionar la única unidad enfocada y compatible, aunque el bot haya preguntado después por su uso. Una afirmación simple a esa pregunta, varias opciones, un foco retirado o evidencia de una elección antigua no autorizan esa selección.

Si una cifra no distingue entre presupuesto total y dinero para la entrada, el recorrido comercial y el de financiamiento comparten la misma pregunta de aclaración. La cifra sola no confirma cobertura suficiente ni autoriza pasar a reserva o financiamiento. Una aclaración entre categorías, pisos o unidades conserva la decisión pendiente original; no la sustituye por otro paso comercial.

### Resultado de la auditoría del 6 de octubre de 2026

| Comprobación | Resultado |
| --- | --- |
| Todas las pruebas TypeScript de automatización | 720 aprobadas, 0 fallidas |
| `npm run test:conversation` | 397 aprobadas, 0 fallidas |
| `npm run test:integrations` | 268 aprobadas, 0 fallidas |
| `npm run test:conversation-regression` | 193 aprobadas, 0 fallidas; 6,4 segundos de ejecución de pruebas |
| TypeScript y lint de los archivos modificados | Sin errores ni advertencias |

El comando rápido es un subconjunto de regresiones para detectar antes los fallos habituales; sus pruebas no se suman a las suites completas. La auditoría cerró los 43 casos que fallaban anteriormente: había expectativas y adaptadores antiguos, y también defectos reales de continuidad, consentimiento, presupuesto y redacción diferida. Se conservaron controles negativos: no enviar precios o superficies incorrectos aunque el revisor apruebe, no registrar como enviado un borrador agotado y no pedir datos financieros antes del consentimiento. Estos resultados son pruebas locales con respuestas de IA controladas, no una evaluación exhaustiva del modelo en producción.

Los cambios se aplican a nuevas ejecuciones después del despliegue; no reescriben mensajes históricos ni suponen entrega o lectura en WhatsApp por el mero hecho de registrar la respuesta.
