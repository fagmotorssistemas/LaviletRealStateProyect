# Trazabilidad por mensaje y continuidad de alternativas

Fecha: 22 de septiembre de 2026.

Estado: **implementación local pendiente de despliegue y verificación en producción**. El Workflow base y el motor conversacional v2 ya están versionados en `c1149bb`; este documento describe la ampliación posterior. No acredita que Vercel, los prompts remotos o conversaciones reales estén ejecutando estos cambios.

Los documentos [09](./09-propuesta-bitacora-explicable.md) y [10](./10-diagnostico-conversacion-1058-1124.md) conservan la propuesta y el diagnóstico originales. Sus estados corresponden al momento en que se escribieron; este documento registra la implementación posterior sin modificar aquel historial.

## Cómo revisar una conversación

1. Entre en **Automatización → Workflow → Por mensaje**, en `/inmobiliaria/automatizacion/workflow`. La vista requiere rol administrador y acceso a la organización. La ruta de Workflow existente conserva también sus mapas de estructura.
2. Elija una **Conversación** y después el mensaje o lote de la columna izquierda. Un lote reúne mensajes procesados juntos y comparte sus pasos; no representa varias respuestas independientes.
3. Seleccione un paso para abrir **Qué información utilizó**, **Qué encontró**, **Qué decidió y por qué** y **Qué revisar**.
4. Si hay un enlace **Ver el paso causante registrado**, úselo para llegar a la decisión anterior que produjo esa acción. Las derivaciones también pueden enlazarse desde la decisión que las originó.
5. Use **Ver detalles técnicos de este paso** para consultar identificadores, módulo, entradas, salidas y código de error. **Identidad, versiones y alcance del registro** conserva los datos de conversación, lote y versiones.

**Actualizar** vuelve a cargar los eventos recientes. **Cargar mensajes anteriores** permite continuar hacia atrás, por páginas de 30 eventos. El buscador filtra únicamente los registros ya cargados por nombre, mensaje o resultado; no busca todo el historial remoto.

Solo se agrupan conversaciones y lotes con identificadores registrados. Un evento antiguo sin identidad de conversación aparece por separado. Si solo se ha cargado parte de un lote, la pantalla indica cuántas vistas previas faltan.

## Qué permite comprobar cada paso

| Paso visible | Evidencia que aporta | Límite de interpretación |
| --- | --- | --- |
| Interpretación del mensaje | Intención, filtros, categoría, referente, pregunta pendiente y señales detectadas; método utilizado. | Una clasificación completada puede ser incorrecta. No es una copia completa de todo lo recibido por la IA. |
| Búsqueda y referencias | Consulta efectiva, filtros anteriores y posteriores, motivo de resolución, alternativas y unidades encontradas según los campos registrados. | La consulta representa la búsqueda aplicada al catálogo; no es necesariamente una consulta SQL nueva. |
| Decisión de respuesta | Ruta elegida, respuesta base, pregunta siguiente, resultados del catálogo y regla registrada. | La plantilla del catálogo puede proceder del código aunque exista un guion comercial editable. |
| Revisión de la respuesta | Solicitudes revisadas, propuesta de redacción, datos considerados faltantes, controles aplicados y respuesta conservada. | Un borrador rechazado o una pregunta todavía no contestada no demuestra por sí solo que falten datos. |
| Derivación al asesor | Motivo, regla, paso causante y resultado operativo registrado; estado del bot. | La frase «he pasado su consulta» no sustituye la comprobación de esta acción. |
| Envío a Kommo / Memoria y seguimientos | Resultado del transporte y estado persistido, cuando se registran. | Aceptación por Kommo no equivale a entrega o lectura confirmada en WhatsApp. |

La tabla de unidades utiliza la instantánea de esa ejecución: número comercial, categoría, dormitorios, planta y superficies registradas. Así puede leerse «departamento 502» en lugar de depender de un UUID. Esa instantánea no acredita la disponibilidad actual del inmueble y puede estar limitada o incompleta.

Para investigar una respuesta incorrecta, localice la primera diferencia entre lo pedido y lo registrado: interpretación, filtros, resultados, presentación o revisión. Una derivación debe llevar a su causa explícita; la cercanía de dos pasos no prueba causalidad. Si el vínculo falta, la interfaz lo indica.

## Respuesta base, propuesta y conservada

La instrumentación registra vistas previas separadas de la base preparada, el borrador propuesto y la respuesta conservada tras los controles. Permiten comprobar si la respuesta llegó directamente del catálogo, si una revisión añadió información o si un validador descartó una reformulación y mantuvo la base.

La respuesta conservada en una revisión corresponde a ese paso. El envío posterior puede incorporar un aviso operativo u otro contenido autorizado; para comprobar qué se remitió, revise también el paso de envío. Las vistas previas están sanitizadas y pueden estar abreviadas: no sustituyen el historial protegido de la conversación.

## Dónde se cambia cada comportamiento

**Qué revisar** identifica el tipo de ajuste cuando está registrado: instrucciones del bot, datos del proyecto, configuración o regla del código. Si existe un enlace autorizado al panel, se muestra junto al nombre del ajuste. También muestra el módulo responsable cuando consta en el registro; los detalles técnicos conservan el identificador de la regla y su origen.

Ver la regla registrada no abre un editor de la ejecución ni permite volver a ejecutarla. Tampoco significa que la pantalla muestre todo el código fuente. Una plantilla de `catalog-dialogue.ts`, una transición de filtros o una condición de derivación requieren modificar y validar el código; editar el prompt comercial no reemplaza esas reglas. Un cambio de configuración o código afecta ejecuciones futuras, no reescribe la evidencia histórica.

## Correcciones de continuidad

La petición de cinco dormitorios y la aceptación de explorar opciones de tres se guardan como hechos diferentes:

| Momento | Requisito original | Consulta que se explora | Unidad seleccionada |
| --- | --- | --- | --- |
| Pide cinco dormitorios | Cinco dormitorios | Cinco dormitorios | Ninguna |
| El bot ofrece alternativas de tres | Cinco dormitorios | La propuesta queda pendiente | Ninguna |
| Acepta revisar esas alternativas | Cinco dormitorios | Tres dormitorios | Ninguna |
| Prefiere departamentos | Cinco dormitorios | Departamentos de tres dormitorios | Ninguna |

La pregunta pendiente usa el acto `explore_alternatives` y una `proposed_query` explícita. Al aceptar, la consulta efectiva cambia y `original_query` conserva el requisito inicial. No se interpreta esa aceptación como compra, reserva, visita ni elección de la primera unidad.

Elegir departamentos dentro de una búsqueda residencial conserva restricciones compatibles de dormitorios, planta y superficie. Cambiar entre vivienda y local comercial limpia las restricciones incompatibles. Un «sí» ante varias unidades o categorías no elige arbitrariamente una. Las ofertas pendientes del formato anterior solo se reconocen mediante una compatibilidad acotada: pregunta concreta, consulta original sin resultados y candidatas verificadas.

## Comparaciones y datos realmente faltantes

Las comparaciones agrupan características comunes y explican diferencias relevantes, incluidas las plantas. Si la búsqueda está limitada a tres dormitorios, no incorpora los departamentos de dos dormitorios para completar una lista o un rango de superficies. Los validadores comprueban la relación entre cada unidad o grupo y sus atributos, no solo que una cifra aparezca en algún punto del catálogo.

La revisión distingue `unanswered` —una parte aún no contestada— de `missing_fact` —un dato concreto sin respaldo—. Antes de derivar, contrasta el supuesto faltante con los resultados verificados. Una comparación completa que el revisor marque erróneamente como desconocida no debe generar una derivación. Rechazar un borrador tampoco autoriza esa acción por sí solo.

La corrección conserva consultas adicionales reales. Por ejemplo, si la comparación está resuelta pero se desconoce la política de mascotas, la respuesta mantiene la comparación y la derivación corresponde a mascotas. Un faltante literal identificado por la revisión independiente se conserva aunque el borrador sea rechazado por omitir otra solicitud. La bitácora registra el contraste y enlaza `advisor_handoff` con el paso de cobertura que identificó el faltante.

## Versiones, privacidad e historial anterior

Cada ejecución puede registrar versión del código, contrato de interpretación, modelo y revisiones de instrucciones. Las llamadas instrumentadas al modelo incluyen la tarea y un hash de las instrucciones compuestas realmente utilizadas; no guardan su contenido íntegro. El hash permite contrastar versiones, pero no reconstruir un prompt ni probar por sí solo que una respuesta fue correcta.

Los resúmenes excluyen o protegen credenciales y datos personales o financieros. Son evidencia acotada declarada por el sistema, no una captura automática de cada lectura, documento o cuerpo del proveedor.

La ampliación utiliza la tabla existente `lv_automation_execution_steps` y sus resúmenes; **no incorpora una nueva migración de base de datos**. Requiere que la tabla y los permisos de la instrumentación previa estén disponibles.

Las ejecuciones anteriores conservan únicamente lo que ya registraron. No se inventan motivos, instantáneas, borradores o vínculos causales retrospectivos. Si faltan pasos o falla su lectura, **Por mensaje** indica evidencia incompleta. Si falla el guardado de la traza, el detalle de `AUTOMATION_TRACE_FLUSH_FAILED` queda en los registros del servidor; la interfaz no puede recuperar pasos que no se guardaron.

## Validación local y comprobación posterior

Las pruebas cubren contratos, filtros, transiciones, comparación, derivaciones, sanitización y agrupación de registros. El recorrido completo reproduce vivienda → cinco dormitorios → aceptación → segundo afirmativo → departamentos → diferencias, con distintas salidas simuladas de interpretación. También contrapone una falsa falta de información de catálogo con una pregunta real sobre mascotas.

Los servicios externos y las salidas del modelo se simulan en estas pruebas. No se enviaron mensajes reales ni se evaluó la calidad del modelo con los prompts activos en producción. Pasar las pruebas demuestra comportamiento bajo esos casos controlados; no sustituye esa evaluación posterior.

Comandos para repetir las comprobaciones desde `frontend` en Windows:

```powershell
npm.cmd run test:conversation
npm.cmd run test:automation
npm.cmd run test:integrations
npm.cmd run test:message-trace
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm.cmd run build
```

En esta revisión se completaron correctamente la compilación local y las suites de conversación, automatización, integración y bitácora. Los conteos y resultados del cambio que se publique deben tomarse de su propia validación; este documento no fija un conteo ni certifica un despliegue. Después de desplegar, corresponde comprobar acceso a **Por mensaje**, registros de nuevas ejecuciones, versiones utilizadas y continuidad con contextos controlados; los registros antiguos seguirán teniendo los límites indicados.
