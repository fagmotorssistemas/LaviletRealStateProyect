# Derivación incorrecta al consultar precios

Caso observado: Carlos, 16 de septiembre a las 11:51 (Ecuador), pidió precios y tres cuartos. El filtro no reconocía `cuartos`; una revisión posterior propuso otro texto de precio. La validación rechazó esa reformulación y convirtió el rechazo en una derivación aunque existía una cotización verificada.

## Cambios

- `src/lib/integrations/automation/price-reply.ts`: reconoce cuartos, habitaciones y dormitorios con cifras o palabras. Acepta la variante `departmentos`. Cuando el catálogo no ofrece la cantidad solicitada, presenta las cantidades disponibles sin tratar esa preferencia como falta de información.
- `src/lib/integrations/automation/conversation.ts`: un precio rechazado en la reformulación conserva la respuesta previa y registra `rejected_price_guard`; no añade por ese motivo una derivación. Mantiene las derivaciones por datos realmente pendientes. La auditoría distingue la propuesta descartada de la respuesta enviada.
- `scripts/integrations.test.cjs`: regresiones para sinónimos, cantidades no disponibles, rechazo de precios, derivaciones legítimas y valores del campo de pausa.

## Detener IA

La API de Kommo confirma que el campo 451530 es texto, no booleano ni lista. El lector actual considera detenidos `true`, `1`, true y 1. Tanto `false` como `false1` permiten continuar por este control, aunque existen otros controles de pausa. No se encontró una escritura de `false1` en el repositorio; no se atribuye a una persona o integración sin historial que lo pruebe. El valor recomendado para reanudar es `false`.

## Validación y alcance

210 pruebas de integraciones, cobertura de turnos y continuidad residencial pasaron. No se enviaron mensajes reales ni se reactivaron leads durante las pruebas. La corrección no elimina la intervención humana cuando falta una política verificada ni cambia las reglas de consentimiento financiero.
