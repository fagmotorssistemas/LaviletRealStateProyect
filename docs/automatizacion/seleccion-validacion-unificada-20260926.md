# Selección y validación de respuestas — 26 de septiembre de 2026

## Alcance

Corrección de decisiones conversacionales, recorrido 360, validación numérica, reparación y explicación de rechazos. No modifica recepción de leads, pertenencia al proyecto, sincronización de DETENER IA, puntuación, temperatura, SQL ni configuración productiva.

## Problemas comprobados

- Una selección explícita podía convertirse en búsqueda al recibir atributos inferidos del extractor. Una confirmación también podía devolver todos los candidatos antes de leer el número elegido.
- El revisor aceptaba «superiores a 140 m²», pero el control de números exigía encontrar 140 como valor exacto del catálogo.
- El control de áreas interpretaba «23,01 m² de área exterior» como superficie interior.
- Los rechazos del catálogo y de controles específicos de una ruta ocurrían después del intento de reparación.
- El texto podía confirmar una unidad sin que la memoria y la entrega del recorrido reflejaran esa elección.

## Decisión de selección

La referencia explícita del mensaje actual se resuelve antes de filtros heredados y respuestas afirmativas a preguntas pendientes. No se acepta un código inventado por el extractor a partir del historial: el número debe estar en el mensaje actual.

Se conservan rechazos («no el 202, quiero el 602»), comparaciones, códigos desconocidos, disponibilidad y cambios de tema. Una elección concreta actualiza seleccionados, foco, alcance de consulta y pregunta pendiente. Los atributos de una búsqueda antigua no se reaplican a la unidad identificada.

El recorrido se prepara a partir de ese mismo estado también en rutas de catálogo. Una ambigüedad real no envía un recorrido de otra unidad. Se mantiene la comprobación de material ya enviado y la posibilidad de solicitarlo nuevamente.

## Contrato numérico

El revisor devuelve relaciones con `unit_id`, `field`, `value`, `operator`, `upper_value` y un fragmento literal. Los operadores admitidos son igualdad, mayor/menor estricto o inclusivo e intervalo. Las fichas históricas sin operador se interpretan como igualdad.

El código comprueba la relación contra datos verificados; la aprobación narrativa del revisor no sustituye esa comprobación. Para relaciones no exactas también comprueba que el límite y el operador correspondan al fragmento. Solo los valores comprobados amplían las cifras permitidas: nunca el texto completo del revisor.

Las superficies interiores y exteriores conservan atributos separados. Cuando la frase no tiene una etiqueta de área explícita reconocible, se puede usar la referencia estructurada del revisor tras verificar fragmento, unidad y valor. Esa referencia no puede contradecir una etiqueta explícita del texto. Las relaciones colectivas deben ser verdaderas para todos los miembros de su ámbito.

Ejemplos: 142,09 y 140,53 son mayores que 140, pero no ambos mayores que 141. «Entre 140 y 143» es un intervalo; «de 109,69 a 120,83» presentado como rango de catálogo exige extremos presentes en el conjunto pertinente. No se autorizan diferencias calculadas sin evidencia.

## Aceptación y reparación

La normalización de la copia comercial se aplica antes de revisar el borrador. La comprobación del catálogo, cifras, precios y restricciones de recopilación financiera participa en el mismo ciclo de aceptación.

Presupuesto máximo compartido: una reparación del texto o de los metadatos. No se reinicia el presupuesto cuando falla otro control. Una reparación del texto exige volver a validar su resultado. No se reescribe el mensaje para corregir una referencia interna del revisor.

Se conservan rechazos directos de enlaces inventados, garantías crediticias sin respaldo, falsa identidad humana y afirmaciones no respaldadas sobre ingresos por alquiler. Las omisiones reparables, los números y los errores de catálogo pueden recibir el intento acotado. Si la reparación falla técnicamente se conserva la causa original además del fallo del intento.

La respuesta base también pasa por controles factuales y de ruta al utilizarse como respaldo. Si no los cumple, no se envían esas cifras como si estuvieran verificadas: se conserva una respuesta explícita de imposibilidad de confirmación y el diagnóstico.

Se mantienen comprobaciones de integridad en el coordinador y antes del envío para detectar una alteración posterior o incumplimiento del contrato. No sustituyen el ciclo normal de reparación ni autorizan datos por su cuenta. Los avisos de acciones realmente ejecutadas siguen protegidos.

## Interfaz y trazas

`final_validation` registra la decisión conjunta, códigos y detalles de áreas: fragmento, atributo, operador, valores recibidos y valores de evidencia. `fallback_validation` registra la comprobación del respaldo. Cada intento conserva sus controles; un intento fallido no borra el motivo inicial.

La vista de explicación muestra la decisión conjunta y el dato comprobado. Los registros antiguos no se recalculan ni se rellenan con información inventada.

## Pruebas

- Elecciones explícitas con filtros inferidos y con respuesta afirmativa; memoria, foco, consulta y enlace coherentes.
- Recorrido completo de «el 605 por favor» y «pero si ya le dije la 605» por el coordinador y la validación real, usando proveedores simulados.
- Variantes de áreas interiores/exteriores; límites correctos e incorrectos; intervalos y grupos.
- Rechazo de superficies intercambiadas incluso si el revisor intenta aprobarlas.
- Reparación de rechazo final de catálogo, con un solo intento y nueva revisión.
- Regresiones de conversaciones, integración, interfaz, tipos y compilación.

Estas pruebas no envían WhatsApp ni modifican datos productivos. La aceptación de frases arbitrarias no se garantiza: ante una interpretación no demostrable se mantiene la comprobación y, cuando corresponde, el intento de reparación.

## Archivos y líneas

Resultado de verificación local: 199/199 pruebas de conversación; 222/222 de integración; 25/25 de interfaz. TypeScript y generación de producción de Next completaron. Tras endurecer el contrato de límites numéricos se repitieron las 82 pruebas específicas de catálogo y revisión: 82/82.

La batería amplia de automatización obtuvo 118/119: persiste la expectativa anterior de `style` frente al motivo real `unsupported_fact` en `rejects unsolicited prices in a generated category-choice reply`. Ambos resultados rechazan la propuesta; no se cambió esa prueba ni su política comercial dentro de esta intervención.

Estado: cambios locales, pendientes de publicación. No se hicieron migraciones ni pruebas de envío real.

El índice siguiente se genera sobre el cambio local para facilitar la revisión. Las líneas pueden desplazarse en commits posteriores.

| Archivo | Lineas del cambio |
| --- | --- |
| `scripts/catalog-dialogue.test.cjs` | 28-54 |
| `scripts/integrations.test.cjs` | 2360 |
| `scripts/integrations.test.cjs` | 2438-2466 |
| `scripts/property-context.test.cjs` | 21-41 |
| `scripts/turn-completeness.test.cjs` | 20-42 |
| `src/components/inmobiliaria/automation/workflow/messageExplanation.test.ts` | 99-109 |
| `src/components/inmobiliaria/automation/workflow/messageExplanation.ts` | 80-81 |
| `src/components/inmobiliaria/automation/workflow/messageExplanation.ts` | 193-197 |
| `src/lib/integrations/automation/catalog-dialogue.ts` | 1 |
| `src/lib/integrations/automation/catalog-dialogue.ts` | 5-6 |
| `src/lib/integrations/automation/catalog-dialogue.ts` | 102 |
| `src/lib/integrations/automation/catalog-dialogue.ts` | 112-115 |
| `src/lib/integrations/automation/catalog-dialogue.ts` | 175-193 |
| `src/lib/integrations/automation/conversation.ts` | 987-995 |
| `src/lib/integrations/automation/conversation.ts` | 1033-1038 |
| `src/lib/integrations/automation/conversation.ts` | 1040 |
| `src/lib/integrations/automation/conversation.ts` | 1053 |
| `src/lib/integrations/automation/conversation.ts` | 1055 |
| `src/lib/integrations/automation/conversation.ts` | 1075-1076 |
| `src/lib/integrations/automation/property-context.ts` | 216-254 |
| `src/lib/integrations/automation/property-context.ts` | 331 |
| `src/lib/integrations/automation/semantic-review.ts` | 2 |
| `src/lib/integrations/automation/semantic-review.ts` | 17-19 |
| `src/lib/integrations/automation/semantic-review.ts` | 24-25 |
| `src/lib/integrations/automation/semantic-review.ts` | 36-46 |
| `src/lib/integrations/automation/semantic-review.ts` | 53 |
| `src/lib/integrations/automation/turn-completeness.ts` | 2-3 |
| `src/lib/integrations/automation/turn-completeness.ts` | 30-32 |
| `src/lib/integrations/automation/turn-completeness.ts` | 282 |
| `src/lib/integrations/automation/turn-completeness.ts` | 284-290 |
| `src/lib/integrations/automation/turn-completeness.ts` | 298-302 |
| `src/lib/integrations/automation/turn-completeness.ts` | 304-305 |
| `src/lib/integrations/automation/turn-completeness.ts` | 354-355 |
| `src/lib/integrations/automation/turn-completeness.ts` | 367-369 |
| `src/lib/integrations/automation/turn-completeness.ts` | 377 |
| `src/lib/integrations/automation/turn-completeness.ts` | 398 |
| `src/lib/integrations/automation/turn-completeness.ts` | 437-454 |
| `src/lib/integrations/automation/turn-completeness.ts` | 459 |
| `src/lib/integrations/automation/turn-completeness.ts` | 469-470 |
| `src/lib/integrations/automation/numeric-relations.ts` | 1-43 (nuevo) |
