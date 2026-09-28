# Validación de afirmaciones y texto preparado para envío

## Evidencia compartida

`turn-evidence.ts` entrega `turn-evidence-v2`: mantiene unidades y agregaciones de catálogo y añade `project_facts`. Cada cantidad del proyecto conserva identificador, ruta de origen, sujeto, dimensión, valor canónico, unidad y texto original. El redactor y el revisor reciben esa misma evidencia.

`project-quantities.ts` extrae cantidades de instalaciones y políticas explícitas (`instalaciones`, `politica_comercial`, `financiamiento`, `financing_policy`). No extrae hechos del historial, resúmenes de IA ni mensajes del cliente. Normaliza horas/minutos, distancias en metros/kilómetros y porcentajes. Las áreas, precios, dormitorios y baños siguen sus contratos existentes de catálogo, con sus referencias de unidad, comparaciones y límites; una duración no autoriza esos datos.

La comprobación conserva tres resultados:

- `supported`: sujeto y dimensión identificados, relación numérica satisfecha.
- `contradicted`: el valor contradice la evidencia del sujeto identificado.
- `unresolved`: no se identifica el sujeto o hay fuentes contradictorias. No equivale a afirmar que el dato es falso ni activa por sí solo una derivación.

Solo el tramo de una cantidad respaldada queda excluido de la comprobación numérica heredada. Su cifra no se agrega a una lista global que pudiera autorizar otra afirmación. Las cantidades desconocidas requieren reparación, no una aprobación narrativa del revisor. La base de respaldo pasa también el control de cantidades. Las discrepancias y referencias sin resolver comparten el presupuesto existente de reparación.

## Alcance y límites

La resolución de sujeto utiliza términos del atributo y proximidad dentro de la cláusula; no interpreta universalmente todo el español. Las paráfrasis sin referencia inequívoca se rechazan como no resueltas para que se reformulen. Los controles semánticos siguen verificando negaciones, contexto y afirmaciones no numéricas. El control numérico heredado permanece para cifras todavía no representadas por estos contratos y para decisiones operativas protegidas; no se ha eliminado indiscriminadamente.

## Integridad antes de Kommo

`delivery-integrity.ts` distingue cambios de formato documentados de cambios de contenido. Conserva como equivalentes espacios, mayúsculas, un saludo conocido y la sustitución de «amenidades» por «instalaciones». Solo el aviso devuelto por una derivación real puede agregarse como acción confirmada sin reinterpretar el cuerpo aprobado.

`conversation.ts` registra el texto aprobado y lo compara con el resultado final. Si hay un cambio adicional de contenido, ejecuta una revisión final con el contexto verificado. Esta revisión no ejecuta nuevas derivaciones. Si falla, recupera el texto aprobado y conserva el aviso operativo real. No hay un bucle indefinido. Esto puede añadir llamadas al modelo en turnos con cambios de contenido posteriores; no añade llamadas por simples cambios de formato.

`messageExplanation.ts` y `reviewDecision.ts` muestran afirmación, contexto, evidencia, fuente, resultado y texto preparado para envío. Aprobación, preparación y confirmación de entrega siguen siendo estados distintos.

## Archivos y pruebas

- `src/lib/integrations/automation/project-quantities.ts`: extracción, referencias, unidades y relaciones de cantidades del proyecto.
- `src/lib/integrations/automation/turn-evidence.ts`: evidencia compartida v2.
- `src/lib/integrations/automation/turn-completeness.ts`: integración con revisión, reparación y base de respaldo.
- `src/lib/integrations/automation/delivery-integrity.ts`: comparación del contenido aprobado y final.
- `src/lib/integrations/automation/conversation.ts`: revisión de modificaciones finales y trazabilidad.
- `src/components/inmobiliaria/automation/workflow/messageExplanation.ts` y `reviewDecision.ts`: diagnóstico visible.
- `scripts/project-quantities.test.cjs`: equivalencias, sujetos intercambiados, valores incorrectos, conflictos de fuentes, ausencia de respaldo e integridad del envío. Incluido en `test:conversation`.
- `scripts/turn-completeness.test.cjs`: integración del control y rechazo sin falsa derivación.

## Reproducción histórica

Se leyó la ejecución `05857cc9-1280-496e-9f6e-ce7fc37824b4` del 26 de septiembre. Su contexto incluía «Sistemas de seguridad 24h». Se reprodujeron localmente el borrador y la revisión guardados, sin volver a llamar al modelo ni enviar mensajes: resultado `checked`, texto original conservado, «24 horas» asociado a `instalaciones.6.amenity_name`. Esto verifica el falso rechazo numérico de ese caso; no constituye una auditoría independiente de cada afirmación comercial de ese borrador.
