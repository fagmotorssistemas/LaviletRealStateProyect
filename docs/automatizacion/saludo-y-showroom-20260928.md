# Saludo inicial y continuidad hacia el showroom virtual

## Comportamiento corregido

El primer mensaje sustantivo recibe un saludo aunque el cliente no haya saludado. La decisión consulta las respuestas anteriores del bot o del asesor y la fecha de la última respuesta; no depende de que el borrador de IA incluya «Hola». Los agradecimientos aislados mantienen su tratamiento de cortesía.

Cuando el cliente pregunta cómo ver los espacios, el sistema ofrece el recorrido virtual. Si hay una unidad identificada, utiliza su enlace; si todavía no hay una selección inequívoca, puede ofrecer el tour general. Una referencia explícita a unidades ambiguas o inexistentes conserva sus controles de aclaración.

Una consulta sobre unidades terminadas puede incluir el tour cuando el estado verificado indica que no hay acceso a unidades físicas. Se conserva la respuesta sobre ubicación y construcción. El enlace se presenta como representación virtual del proyecto, sin prometer obra terminada ni visita presencial.

Una corrección breve del cliente puede conservar la intención de visualización de su mensaje inmediatamente anterior. Por ejemplo, «Los departamentos, perdón» después de «¿Cómo puedo ver los edificios?» aclara qué quiere visualizar. No inicia por sí sola otra búsqueda por categoría. La ficha de cobertura debe citar el mensaje actual y usar el anterior únicamente como contexto.

## Archivos

| Archivo | Cambio |
| --- | --- |
| `src/lib/integrations/automation/conversation-style.ts` | `greetingForTurn`: saludo de primer contacto sin depender del saludo del cliente. |
| `src/lib/integrations/automation/virtual-showroom.ts` | Detección de consulta visual, corrección contextual y consulta de estado físico. |
| `src/lib/integrations/automation/conversation.ts` | Adjunta el showroom antes de revisar la respuesta y registra `showroom_continuation` en la auditoría. |
| `src/lib/integrations/automation/unit-model.ts` | Permite el tour general de forma explícita y aclara la naturaleza virtual del recorrido. |
| `src/lib/integrations/automation/project-material.ts` | Diferencia showroom físico de recorrido virtual disponible. |
| `src/lib/integrations/automation/turn-interpretation.ts` | Instrucciones para mantener la intención al interpretar correcciones. |
| `src/lib/integrations/automation/turn-completeness.ts` | Evidencia del mensaje actual y continuidad visual en la redacción y revisión. |
| `src/lib/integrations/automation/project-information.test.ts` | Regresión de saludo inicial y ausencia de repetición. |
| `src/lib/integrations/automation/unit-tour-link.test.ts` | Correcciones contextuales, tour general y referencias ambiguas. |
| `scripts/integrations.test.cjs` | Verifica el texto enviado para corrección visual y consulta de construcción. |

## Alcance

No se modifican las ventanas de espera, agrupación de mensajes ni recepción de leads. La resolución contextual opera sobre los mensajes que ya existen en el historial. Los controles de datos, enlaces y cobertura siguen activos: estas correcciones no garantizan que cualquier borrador de IA sea aceptado.

Los cambios necesitan desplegarse para afectar nuevas ejecuciones; no alteran mensajes ya enviados.
