# Búsquedas y comparaciones por voz

Cambios locales, sin despliegue ni modificaciones de inventario.

- Pedir una habitación no selecciona la opción uno, incluso cuando solo hay una sugerencia visible.
- Las búsquedas explícitas aplican primero los filtros al inventario consultado por el servidor. Una búsqueda genérica de departamentos admite suites con el número exacto de dormitorios solicitado; no modifica su categoría.
- «Otras opciones» recorre las coincidencias restantes. El navegador conserva los identificadores mostrados durante la conversación y el servidor los valida contra su catálogo. Al terminar las coincidencias lo explica y propone cambiar un filtro.
- Un pedido simple nuevo sustituye las ramas de una búsqueda mixta anterior. Se conservan los demás filtros de la conversación.
- Las comparaciones resuelven códigos o posiciones concretas. Con tres opciones, «uno y otro» solicita elegir dos. Las diferencias se calculan con los valores disponibles, sin completar campos vacíos ni describirlos como «no registrados».
- Las preguntas específicas sobre información ausente reconocen brevemente que no puede confirmarse. Los precios y disponibilidad siguen procediendo del servidor.

## Validación

24 pruebas automáticas aprobadas: inventario simulado, búsquedas en español e inglés, paginación conversacional, cambios de filtro, referencias ambiguas, aritmética, campos ausentes y regresiones de interrupción, escucha e invitación de contacto. TypeScript sin errores. ESLint sin errores en la lógica y ruta revisadas; conserva una advertencia previa de variable sin uso en el extractor.

No se consultó el inventario de producción ni se realizó una conversación real con micrófono en esta corrección. No se validó la calidad del modelo o la transcripción mediante llamadas reales.

Para revisar localmente en `/tour`: pedir «departamentos de una habitación», después «otras opciones», y luego «compara la primera y la segunda». Comprobar que las fichas elegidas corresponden a la lista vigente y que los valores hablados coinciden con ellas. Repetir en inglés. La disponibilidad efectiva depende del inventario publicado y de los filtros acumulados.
