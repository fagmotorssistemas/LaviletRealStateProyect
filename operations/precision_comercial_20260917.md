# Precisión comercial y límites de la revisión final

## Cambios

- `src/lib/integrations/automation/commercial-accuracy.ts`: reglas comunes para distinguir información desconocida de prohibiciones reales, orientar comparaciones sin garantías y evitar inferencias sobre seguridad o flujo comercial. Aclaración breve del propósito de un local cuando el cliente pide recomendación y ese dato falta; respeta el propósito ya declarado.
- `direct-conversation-rule.ts`: incorpora esas reglas a todos los estilos y niveles, tanto al escritor como al revisor.
- `turn-completeness.ts`: detecta prohibiciones inventadas sobre arriendos futuros, además de las garantías positivas ya prohibidas. Una revisión no puede añadirlas a una respuesta correcta. Al retirar una afirmación falsa de la base, no introduce explicaciones bancarias por una simple declaración de intención de arrendar; mantiene la explicación cuando el cliente sí pregunta por el respaldo financiero.
- `sdr.ts`: el contexto financiero identifica explícitamente la ausencia de información sobre aceptación/rechazo de ingresos futuros, sin etiquetarla como prohibición. Integra aclaración de recomendación y respuesta para presupuestos simples.
- `price-reply.ts`: reconoce «quiero uno entre unos 300 mil dólares». Para consultas simples de presupuesto prioriza hasta tres unidades publicadas y disponibles dentro del monto y categoría; si ninguna cabe, presenta la menor con la diferencia exacta y consulta flexibilidad. Conserva el permiso de precios y la advertencia de valores referenciales.
- `direct-reply.ts`: amplía los cierres redundantes, incluyendo «así podré orientarle mejor sobre la unidad que más le conviene».
- `conversation.ts`: aplica también la limpieza conservadora de las afirmaciones del sector reportadas, antes del envío final. Las afirmaciones sobre instalaciones reales de seguridad no se eliminan.

Los filtros deterministas son conservadores y se complementan con reglas semánticas de escritura/revisión. Presupuestos con otras condiciones o preguntas siguen por el flujo comercial completo; no se ignoran esas condiciones para usar una respuesta de selección simple.

No modifica precios del catálogo, configuraciones guardadas, datos financieros del lead, conversaciones anteriores ni SQL. Aplica a respuestas nuevas. No se envían mensajes reales durante pruebas.

## Validación

`scripts/commercial-accuracy.test.cjs`: prohibición bancaria inventada, reparación final maliciosa/incorrecta, presupuesto literal y exceso, precios ocultos, propósito conocido, descripción del sector, cierres redundantes y todos los perfiles de tono. Se ejecutan junto a las regresiones de integración, financiamiento y tono.
