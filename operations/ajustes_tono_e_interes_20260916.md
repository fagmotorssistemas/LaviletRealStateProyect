# Ajustes de tono e interés — 16 de septiembre de 2026

## Casos revisados

Conversaciones de Carlos y Pablo del 15 de septiembre: confusión con taxis/comida/cafetería, rechazo explícito seguido de una consulta de precios, derivación por un dato no verificado y saludo «Buenas».

## Reglas anteriores y cambios

| Archivo en `src/lib/integrations/automation/` | Antes | Ahora |
| --- | --- | --- |
| `business-scope.ts` | El clasificador insistía en identificar a La Vilet al aclarar consultas ajenas; su respuesta no pasaba por las reglas comerciales de no repetición. | Recibe `marca_ya_presentada`. Después de la primera presentación explica el límite sin repetir la marca, incluso si el borrador necesita un texto de respaldo. En mensajes mixtos evita duplicar la presentación. |
| `commercial-engagement.ts` (nuevo) | No había memoria específica del rechazo general o de la confusión de negocio. | Calcula un modo informativo a partir del historial y la memoria guardada. Comprender el giro del negocio o preguntar precios no revoca el rechazo. Una nueva intención explícita de compra permite retomar la orientación. Pedir información financiera sigue siendo atendible. |
| `sales-policy.ts` | Una cotización activaba la invitación; solo se recordaba el rechazo a una visita. Las reglas decían que se añadiría una invitación si estaba habilitada, aunque el plan no la hubiera seleccionado. | El modo informativo impide invitaciones, ofertas de unidades y brochure proactivos. El texto del plan coincide con la acción elegida. La ausencia de presupuesto deja de justificar por sí sola una oferta financiera. |
| `price-reply.ts` | La primera cotización podía añadir financiamiento automáticamente sin comprobar rechazo o confusión anteriores. | En modo informativo entrega el precio sin esa oferta. Mantiene la orientación cuando el cliente expresa una duda de capacidad de compra. |
| `sdr.ts` y `turn-completeness.ts` | Las reescrituras podían volver a introducir una invitación comercial genérica. | Reciben la regla del turno y rechazan borradores que reintroducen ofertas no solicitadas; conservan la respuesta previa, sin recortar hechos ni precios. |
| `conversation.ts` | La composición operativa podía añadir ofertas; la presentación de marca no tenía memoria duradera; la derivación agregaba «Podrá continuar por aquí sin volver a explicar lo que busca». | Guarda `_sales_memory.passive_sales`, `_sales_memory.property_interest` y `_brand_introduced` después del envío aceptado. Protege la reescritura operativa y acorta el aviso de derivación. |
| `conversation-style.ts` | Copiaba «Buenas» del saludo recibido. La regla general sobre presupuesto invitaba a ofrecer financiamiento aun sin una duda expresada. | Usa un saludo completo según la hora de Ecuador y corrige «Buenas.» al inicio del borrador. La orientación financiera responde a una duda del cliente, respetando el modo informativo. |

## Contradicciones encontradas

- El límite de negocio pedía repetir la identidad, mientras el estilo comercial pedía no repetir la marca.
- Cotizar se trataba como señal suficiente para ofrecer una visita, incluso después de un rechazo.
- Dos pruebas antiguas exigían ofrecer financiamiento tras «entiendo, ¿cuánto valen?», aunque el lead venía de pedir otro servicio. Se actualizaron al criterio informativo solicitado.

## Validación

- Pruebas de integración, nutrición de semana uno, salud de entrega, cobertura de consultas y continuidad residencial: 234 aprobadas.
- Casos nuevos: rechazo con historial recortado, interés renovado, crédito solicitado explícitamente, reescritura que intenta añadir ofertas, presentación de marca una sola vez, saludo en tres franjas horarias y aviso breve de derivación.
- Las pruebas simulan los envíos; no contactan a los leads. No se modificaron políticas de mascotas ni se reactivaron leads derivados a asesores.

Estos cambios son de aplicación; no requieren ejecutar SQL. Su activación en el bot depende del despliegue de esta versión.

## Integración para publicar

La subida inicial encontró el commit remoto `50b401c` de diseño. Se integró conservando sus cambios. La compilación detectó que ese commit había dejado vacíos cuatro archivos todavía importados por la aplicación: `StatusBadge.tsx`, `VisitanteHome.tsx`, `Modal.tsx` e `inmobiliaria.service.ts`. Se recuperó únicamente el contenido de esos cuatro archivos desde la versión anterior que compilaba. El cambio local del usuario en `src/app/inmobiliaria/layout.tsx` no forma parte de esta corrección.
