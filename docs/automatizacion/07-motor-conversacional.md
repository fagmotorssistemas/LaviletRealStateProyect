# Motor conversacional y diagnóstico por turno

Esta referencia describe la implementación local del contrato `lavilet-dialogue-v2`. No acredita un despliegue, una configuración de producción ni la entrega de un WhatsApp. Los mapas generales explican responsabilidades; los pasos guardados de una ejecución muestran qué ocurrió en ese turno.

## Responsabilidades

El transporte conserva el recorrido Kommo → webhook → cola persistente → worker → Kommo/Salesbot. Deduplicación, bloqueo del worker, autorización, intervención humana, opt-out, ventana de respuesta y manejo de envíos inciertos siguen siendo controles del servidor.

`conversation.ts` coordina el turno. Antes de elegir una respuesta conversacional, los turnos autorizados pasan por `interpretConversationTurn`, en `turn-interpretation.ts`. Este módulo tiene un esquema cerrado y versionado; devuelve interpretación, solicitudes del turno y diagnóstico. Un saludo puro utiliza `literal_greeting`; un contenido sin texto interpretable utiliza `unreadable_input`. Ambos pasan por el mismo contrato sin realizar una inferencia innecesaria. No heredan acciones de mensajes anteriores.

Los eventos duplicados, vencidos, pausados, fuera del lead autorizado o cedidos a un asesor pueden terminar antes de interpretar. Esas salidas deben conservar el motivo y `execution_exit`. Por tanto, “todos los turnos elegibles pasan por el intérprete común” no significa que todo webhook llame a un modelo.

El catálogo y los resultados de herramientas son la autoridad para los hechos. `property-context.ts` resuelve referencias y restricciones; `catalog-dialogue.ts` construye respuestas desde resultados del catálogo. Una consulta de planta o de mayor superficie permite buscar sin exigir que el cliente conozca previamente el número de unidad. El grupo residencial no equivale a elegir departamentos. Las candidatas, el objeto de la última pregunta y la elección del cliente son estados diferentes.

Las operaciones de visitas y financiamiento conservan su validación y sus RPC. La interpretación propone una intención; una acción solo puede afirmarse cuando su resultado quedó verificado. La redacción no concede permisos ni confirma citas o financiamiento por sí misma.

## Bitácora observada

`execution-trace.ts` guarda resúmenes en `lv_automation_execution_steps`. Las claves principales son:

| Paso | Evidencia útil |
| --- | --- |
| `execution_version` | Esquema de bitácora, versión de código disponible, contrato, modelo configurado e identidades de prompts realmente capturadas. |
| `message_received` | Cantidad de mensajes agrupados y presencia de adjuntos. |
| `response_permission` | Permiso o motivo concreto de pausa. |
| `commercial_context` | Contexto disponible y cantidad de mensajes del historial. |
| `decision_context` | Disponibilidad del catálogo y entidades financieras; se omite para saludos puros y contenido ilegible. |
| `semantic_extraction` | Método de interpretación, intención, solicitudes y referencias normalizadas. |
| `catalog_resolution` | Filtros aplicados, candidatas, referencia y motivo de aclaración. |
| `dialogue_decision` / `route_selected` | Ruta efectiva, razón y pregunta o protección aplicada cuando el emisor las registra. `route_selected` conserva compatibilidad. |
| `response_validation` | Controles realizados y resultado de validación, sin suponer una revisión ausente. |
| `message_delivery` | Aceptación de Kommo, pausa o error de la solicitud. |
| `state_persisted` | Resultado del guardado de memoria y programación de seguimientos. |
| `execution_exit` / `execution_failed` | Resultado de salida o interrupción y código sanitizado. |

Los pasos opcionales no se inventan para completar el dibujo. El API de workflow construye `path` desde `step_order` cuando hay bitácora. Sin pasos, devuelve `traceSource: inferred`; si falla su lectura, muestra `AUDIT_READ_FAILED`. Una ruta inferida no demuestra que el extractor, el redactor o el revisor se hayan ejecutado. Un duplicado tampoco demuestra una visita confirmada.

La versión de código procede de `VERCEL_GIT_COMMIT_SHA` o `AUTOMATION_CODE_VERSION`, si existe. Una ausencia aparece como “Sin dato”. La versión del prompt extractor es la huella de las instrucciones realmente usadas; no se guarda su contenido. Las versiones no observadas no se completan con la configuración actual, porque podría ser distinta de la del turno histórico.

`accepted` significa que Kommo aceptó iniciar Salesbot. No significa `delivered` ni `read`, y la interfaz lo indica. Si falla el guardado de memoria después de esa aceptación, se conserva como fallo de memoria; no debe repetirse el envío para obtener una traza perfecta.

## Protección de datos y fallos de auditoría

Los resúmenes se sanitizan al escribir y también al leer trazas antiguas: credenciales, parámetros de URL, teléfonos, correos, identificadores y campos financieros personales no deben aparecer en el workflow. La bitácora no sustituye el historial protegido de conversaciones. Los emisores deben preferir IDs de catálogo, filtros no personales, recuentos, estados y códigos; no añadir el JSON completo del extractor, documentos, datos bancarios ni cuerpos de proveedores.

Una escritura fallida de bitácora no cambia el resultado comercial ni repite operaciones. Tanto errores devueltos por Supabase como excepciones generan `AUTOMATION_TRACE_FLUSH_FAILED` en el log del servidor, con código y recuentos sanitizados. La escritura tiene un límite de espera de cinco segundos. Los pasos abiertos sin resultado se guardan como fallo `TRACE_STEP_NOT_FINISHED`.

## Cómo investigar una respuesta

1. Abrir la ejecución concreta en Workflow, no solo el mapa general. Comprobar si hay pasos observados o ruta inferida.
2. Revisar versión de código, contrato, modelo y prompt. No comparar dos ejecuciones como equivalentes si esas identidades son distintas o faltan.
3. Leer permiso y salida: distinguir una pausa o fallo de entrega de una mala interpretación.
4. Contrastar `semantic_extraction` con la pregunta pendiente y el turno completo. Revisar qué fue reconocido y qué quedó desconocido.
5. Revisar `catalog_resolution`: filtros, conjunto candidato y razón. Para “tres dormitorios”, el rango debe calcularse únicamente sobre las unidades de tres dormitorios, no sobre todo el catálogo.
6. Revisar la decisión y la validación: una aclaración determinística también puede tener un referente equivocado. Una etapa ausente no cuenta como aprobación.
7. Separar aceptación de Kommo, guardado del mensaje y guardado de memoria. Consultar los errores de auditoría si faltan pasos; no reenviar por esa ausencia.

## Evaluación sin envíos

Las pruebas determinísticas verifican contratos, filtros, agregados, referentes, negaciones y recibos de herramientas con datos aislados. Deben incluir conversaciones completas: vivienda → categoría → mayor superficie → planta → aceptación del referente ofrecido. Un rango calculado debe incluir los IDs y filtros que lo respaldan.

Una evaluación del modelo utiliza las instrucciones reales y mensajes anonimizados, con salida hacia un recolector de evaluación, nunca hacia `runAutomation`, `processConversation` ni herramientas que escriban o envíen. El modelo puede proponer operaciones; el entorno de evaluación solo permite herramientas de lectura simuladas. Registrar aciertos de interpretación, cobertura, aclaraciones innecesarias, fidelidad de referentes y latencia.

Un modo sombra debe ejecutar únicamente interpretación y planificación sobre una copia del estado, comparar decisiones y guardar métricas aisladas. No debe llamar la ruta completa y confiar en que un flag evite sus efectos. El despliegue o la activación de ese modo es una operación separada; esta documentación no afirma que exista un servicio sombra activo.

Pruebas locales de la bitácora y del mapeo, sin proveedores:

```text
node --require ./scripts/test-typescript.cjs --test src/lib/integrations/automation/execution-trace.test.ts src/lib/integrations/automation/execution-route.test.ts
```

Para reproducir los casos de continuidad y los fallos de cruce de rutas:

```text
npm run test:dialogue-replay
```

El [registro del caso del 22 de septiembre](./08-regresion-conversacional-2026-09-22.md) conserva causas, cambios, alcance y límites. Las acciones de un mensaje mixto se validan contra `mensaje_accion`; la baja de seguimiento conserva alcance global. Las solicitudes extraídas tienen dominio para distinguir una confirmación de visita de otra consulta en el mismo turno.
