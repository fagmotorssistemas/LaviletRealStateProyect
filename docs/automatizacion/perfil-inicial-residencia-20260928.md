# Presentación inicial, nombre y residencia

## Secuencia

1. Un saludo aislado conserva la bienvenida y la pregunta de ayuda. No inicia la captura de perfil.
2. La primera consulta sustantiva se responde antes de solicitar datos. En información general se presenta el proyecto y su ubicación sin enumerar categorías; en consultas concretas se conserva la respuesta pertinente y verificada.
3. La invitación inicial completa es: «Para enviarle el brochure digital completo con los planos y brindarle una guía personalizada, ¿podría indicarnos su nombre y en qué ciudad o país reside actualmente?» Si ya se conoce un dato, se pregunta solo el faltante.
4. El siguiente intercambio entrega el brochure aunque el cliente responda parcialmente o continúe con otra consulta. Una petición explícita del brochure se atiende directamente, sin exigir datos.
5. Si responde solo parte del perfil, se permite un recordatorio sobre lo faltante. Si continúa con una consulta concreta o rechaza compartir datos, se atiende su intención sin insistir. Una ciudad o un país bastan para la residencia; no se exige proporcionar ambos.
6. Después se retoma la continuación comercial guardada. La presentación de categorías aparece junto a la pregunta sobre esas opciones; no queda separada por la captura de datos. Una categoría o cantidad de dormitorios ya elegida no se vuelve a preguntar.

No se reactiva esta presentación en conversaciones que ya tenían intercambio comercial. Las solicitudes operativas de cita y financiamiento mantienen sus flujos. Las descripciones siguen sujetas a evidencia; no se añadieron afirmaciones no verificadas sobre plusvalía comparativa, acabados, terrazas de todas las unidades ni visitas a obra.

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

Los cambios se aplican a nuevas ejecuciones después del despliegue; no reescriben mensajes históricos ni suponen entrega o lectura en WhatsApp por el mero hecho de registrar la respuesta.
