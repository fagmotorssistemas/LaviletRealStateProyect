# Continuidad conversacional — 22 de septiembre de 2026

Estado: implementación local sobre `7c047d6`, sin despliegue ni cambios de configuración remota. El usuario autorizó aplicar la reconstrucción después de revisar la conversación. Los textos de correcciones adjuntos describían cambios ya presentes en esa base; no se volvió a aplicar su diff.

## Fallos que motivaron el cambio

La conversación recorría vivienda, cinco habitaciones, departamentos frente a penthouses, mayor superficie, igualdad de tamaños, quinta planta y aceptación de la opción ofrecida. El bot alternaba respuestas correctas con peticiones innecesarias del número de unidad.

| Síntoma | Causa identificada | Tratamiento local |
| --- | --- | --- |
| «Vivienda» excluía suites | Se interpretaba como selección de departamento. | Grupo residencial separado de categoría; consulta del inventario publicado. |
| «La opción más grande» pedía un código | Se confundía consulta de máximos con selección entre unidades recordadas. | Operaciones search/rank/compare/select/details; ranking calculado y empates conservados. |
| Tres dormitorios aparecían con superficies de dos dormitorios | La redacción recibía el catálogo completo y los controles comprobaban cifras sin sus relaciones. | Filtrado previo y validación de unidad, categoría, dormitorios y superficie en el resultado. |
| «5ta planta» no resolvía la opción | Filtro de planta ausente del contrato; expresiones ordinales incompletas. | floor_number normalizado y combinado con la búsqueda actual. |
| «Sí prefiero esa opción» pedía el número otra vez | Se recordaban varias opciones, pero no el objeto de la última pregunta. | pending_question con acto, target_ids y candidate_ids; focused_ids independiente de selected_ids. |
| Corregir una ruta rompía otra | Varias salidas respondían antes de interpretar; reglas y redacciones podían contradecir la decisión inicial. | Interpretación común antes de las rutas; reglas de acción con evidencia; revisión y trazas de cada etapa. |

El catálogo comprobado durante el análisis distinguía los departamentos 202, 302, 402 y 502, de tres dormitorios, con 120,83 m² interiores y 27,03 m² exteriores, de los departamentos 304, 404 y 504, de dos dormitorios, con 109,69 m² interiores y 34,59 m² exteriores. Esos datos son una instantánea para reproducir el problema, no una regla comercial fija. La implementación consulta los valores vigentes del catálogo.

## Recorrido y fuentes de autoridad

1. El transporte registra y deduplica; los permisos deciden si el bot puede atender.
2. El alcance separa consultas inmobiliarias de otras gestiones. El texto completo conserva las bajas de mensajes; las acciones comerciales requieren evidencia en la parte inmobiliaria.
3. `turn-interpretation.ts` aplica `lavilet-dialogue-v2`: intención, solicitudes con dominio, evidencia y filtros. Los saludos y archivos ilegibles usan el mismo punto de entrada sin inferencia; no necesitan catálogo ni financiamiento.
4. `property-context.ts` resuelve referencias contra memoria e inventario. `catalog-dialogue.ts` ejecuta filtros, extremos, comparaciones y construye hechos verificables.
5. Visitas, financiamiento y asesor conservan sus validaciones operativas. Un «sí» a la distribución de una unidad no es consentimiento financiero. El clasificador secundario de visitas no autoriza por sí solo una baja.
6. La revisión completa atiende solicitudes adicionales, conserva preguntas con referentes y rechaza mezclas de datos del catálogo. Las reglas genéricas de redacción no prohíben medidas ya verificadas para una respuesta de detalles.
7. El envío conserva sus comprobaciones. Se guarda memoria tras aceptación de Kommo; las confirmaciones de visita guardan el resultado verificado de su RPC. La confirmación mantiene su outbox existente y las consultas adicionales se contestan aparte, sin repetir la acción.

El resumen libre generado por otra llamada de IA se sustituyó por actualización estructurada de hechos y estado. El esquema de memoria sigue en `conversations.summary`; no exige una migración nueva. La memoria antigua se interpreta mediante compatibilidad con el historial. Un audio ilegible conserva el referente pendiente para que el cliente pueda repetir la respuesta.

## Pruebas reproducibles

```text
npm run test:dialogue-replay
npm run test:conversation
npm run test:integrations
npm run test:automation
npx tsc --noEmit --incremental false
npm run build
```

`test:dialogue-replay` usa las frases reportadas, el enrutador real, la normalización, el catálogo, la persistencia de memoria y la validación. Simula únicamente servicios externos y salidas del modelo. Incluye errores del extractor, las opciones 502/504, audio ilegible, mapa después de una pregunta, opt-out, alcance mixto, fallo de inferencia y confirmaciones con consultas adicionales. Ninguna de estas pruebas envía WhatsApp ni usa un lead real.

Resultado de la validación local: 215 pruebas de integración, 139 de conversación y 102 de automatización aprobadas, 456 en total. Las 14 pruebas seleccionadas por `test:dialogue-replay` forman parte de integración y no se suman otra vez. TypeScript sin emisión y ESLint de los archivos TypeScript modificados también aprobados. El archivo histórico de integración en CommonJS conserva incompatibilidades con la regla global que prohíbe `require`; no se presenta el lint global del repositorio como aprobado.

La compilación final `npm run build` terminó correctamente con Next.js 16.2.0. Esto valida el proyecto local; no publica la aplicación.

Para investigar nuevas fallas, agregar primero la conversación reducida como regresión y localizar el primer desacuerdo entre interpretación, filtros, resultado, pregunta, validación y envío. Corregir la responsabilidad correspondiente; no añadir una excepción al prompt y otra al redactor para el mismo dato.

## Límites y siguiente validación

- Las pruebas aisladas comprueban la lógica y los contratos. No miden por sí solas la calidad del modelo con los prompts activos en producción, su latencia ni la entrega real por WhatsApp.
- No se cambió el modelo configurado. Hace falta una evaluación controlada del extractor con variantes reales antes de ampliar tráfico; cambiar el modelo no sustituye esa evaluación.
- La memoria y la bitácora no forman una transacción con Kommo. Un fallo de guardado queda visible; no se reenvía un mensaje aceptado por intentar completar la bitácora.
- `accepted` acredita la aceptación de Kommo, no la entrega al teléfono. Las trazas antiguas sin pasos siguen marcadas como inferidas.
- Continúan las rutas especializadas de visitas, precios, financiamiento y compatibilidad histórica. Este cambio centraliza la interpretación y las consultas de catálogo; no afirma haber eliminado toda regla especializada del proyecto.
- Los hallazgos previos de conexión —webhook antiguo de n8n, suscripción de salidas de Kommo y campo del recordatorio de dos horas— requieren verificación operativa separada. No se modificaron servicios remotos como parte de este cambio.
- No existe garantía de cero errores. La mejora consiste en acotar las decisiones, comprobar los hechos y poder localizar y reproducir fallas por versión y etapa.

El despliegue y la prueba con un lead controlado quedan separados de esta implementación local. La guía de diagnóstico está en [Motor conversacional](./07-motor-conversacional.md).
