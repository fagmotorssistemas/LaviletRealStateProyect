# Reparación de metadatos del redactor — 23 de septiembre de 2026

El redactor podía incluir su propia pregunta final en `requests`, reservado para solicitudes literales del cliente. La validación rechazaba correctamente esos metadatos, pero también se perdía una redacción válida.

## Cambio

- `turn-completeness.ts`: instrucciones y descripciones del esquema separan `reply`, `requests` y `question`, con el ejemplo de Carlos y los cinco dormitorios.
- Un resultado con metadatos inválidos permite un solo intento adicional de redacción, en cualquier ruta que use este redactor. El intento recibe el error concreto, el borrador y los metadatos originales, y debe conservar exactamente `reply`.
- Si modifica el texto, vuelve a fallar o el servicio no responde, se conserva la respuesta base. No se eliminan solicitudes automáticamente.
- Después de reparar se ejecutan los controles de contenido y siempre la revisión independiente, incluso si el texto coincide con la base. Reparar el formato no acredita la veracidad ni la cobertura.
- El límite global sigue siendo dos llamadas de escritura por turno. Los reintentos de contenido para precios verificados ya existentes comparten ese límite; no se encadenan reparaciones ilimitadas.

## Bitácora

Se reutiliza `repair_attempts` (Intentos de corrección del borrador), que ya se conserva en la traza. Incluye el error inicial, la vista protegida del borrador y `final_status`: `checked` si el resultado terminó aprobado, o el motivo final de descarte. El estado general y `issues` conservan el resultado final y sus controles fallidos. Los metadatos originales enviados para reparar no se añaden a la bitácora.

## Alcance y límites

Solo afecta nuevas ejecuciones después del despliegue. No cambia rutas comerciales, validadores de superficies ni construcción de enlaces de recorridos. Un fallo interno puede añadir una llamada de escritura y la revisión correspondiente, con su latencia y costo. Las pruebas usan respuestas simuladas: verifican las protecciones y el flujo, no garantizan una tasa de errores determinada del modelo real.
