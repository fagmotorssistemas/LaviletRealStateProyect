# Correcciones del brochure, el interés comercial y la interpretación multimedia

Fecha local: 17 de octubre de 2026. Revisión de partida: `da0d2e6`.

Este informe complementa la [auditoría integral](./auditoria-integral-2026-10-16.md), el [informe de correcciones](./informe-correcciones-auditoria-2026-10-16.md) y la [estabilización anterior](./estabilizacion-conversacion-2026-10-16.md). Describe cambios locales posteriores; no acredita su publicación ni su disponibilidad en WhatsApp.

## Qué se encontró en las conversaciones

La consulta «qué incluye ese brochure para ver si le comparto mi información» se registró como una consulta informativa y **no** como una solicitud de envío. Sin embargo, la apertura aplicó la excepción de captura omitida y programó el brochure. Por eso corregir únicamente la clasificación del material no bastaba: la decisión de entrega también necesitaba distinguir una duda intermedia de una negativa o una omisión.

En «bueno me interesa algo comercial», los registros no conservaron grupo ni categoría de inmueble. La conciliación de alcance admitió una clasificación mixta que usaba «algo comercial» como asunto ajeno dentro del propio fragmento inmobiliario. El plan volvió a preguntar vivienda/local mientras el redactor describía locales. La contradicción se producía antes de redactar. El revisor estaba desactivado en ambos casos.

Las consultas productivas de esta intervención fueron de lectura. No se enviaron mensajes, no se ejecutaron trabajadores ni se modificaron estados de leads en producción.

## Cambios y resultado esperado

| Antes | Cambio | Resultado esperado |
| --- | --- | --- |
| El contrato de material distinguía pedir, aceptar, rechazar o no pedir. | Se agregan las interpretaciones `inquiry` —consultar contenido antes de decidir— y `defer` —posponer la entrega—, con evidencia actual. | Preguntar qué incluye explica su contenido sin enviar el archivo. Una pregunta y una solicitud expresa de envío en el mismo mensaje conservan ambas intenciones. |
| No contestar de inmediato nombre/residencia podía activar el envío. | Se conserva `brochure_decision_pending` mientras se resuelve la duda, separado de la pausa comercial. | La duda y un «oh, ya» posterior no consumen un recordatorio ni resuelven la decisión pendiente. |
| La decisión no estaba protegida entre turnos. | La memoria, la decisión de perfil, el contrato del redactor y los enlaces autorizados comparten esa espera. | Las consultas posteriores siguen atendiéndose sin adjuntar el brochure por rutina. Al recibir el perfil completo o una petición expresa, se procesa la entrega correspondiente. |
| Posponer el material podía confundirse con consultar su contenido. | La postergación tiene estado propio, `brochure_delivery_postponed`, también cuando el perfil está completo. | «Envíemelo después» no produce una explicación no solicitada de su contenido ni se resuelve solo por conocer el nombre. Una petición posterior de envío levanta la espera. |
| Una captura podía enumerar los datos como condición y repetirlos en una pregunta. | Se alinea la instrucción de apertura y la del redactor final: el ofrecimiento expresa el beneficio del material y la única pregunta pide los datos pendientes. | Menos redundancia, manteniendo redacción libre. Una consulta sobre el contenido no termina con otra invitación a compartir datos. |
| Una respuesta contextual amplia no siempre se conservaba como elección. | El intérprete recibe instrucciones sobre la relación con la pregunta realmente entregada. | «Algo comercial» tras vivienda/local conserva interés comercial y categoría local; no deduce negocio propio, inversión, presupuesto, planta o unidad. «Vivienda» conserva el grupo residencial sin elegir tipología. |
| Un mismo tramo literal podía pertenecer a los dos dominios de una clasificación mixta. | Se comprueba la integridad de los tramos: debe existir una ocurrencia ajena separada de los fragmentos inmobiliarios. Una frontera inválida pasa a conciliación semántica. | El código no decide el dominio por palabras. Dos solicitudes realmente independientes conservan su frontera, incluso con texto repetido en lugares distintos. |
| Una respuesta estructurada de categoría podía llegar sin su significado inmobiliario. | Se comparan los campos interpretados y, si son contradictorios o incompletos, se solicita una reparación limitada a la IA. | La reparación no modifica identidad, importes ni permisos de reserva, visita o financiamiento. El plan avanza desde una preferencia válida en vez de volver a pedirla. |
| La presentación predeterminada solo enumeraba ubicación y tipos. | Se reincorpora la propuesta ya presente en la apertura autorizada: tranquilidad, privacidad y comodidad. Las presentaciones personalizadas guardadas conservan prioridad. | Una presentación algo más expresiva, sin recuperar cantidades históricas, inventario, precios, fechas o garantías. |
| Imágenes/PDF dependían del modelo general y el alcance tenía otro modelo predeterminado. | Se separa `OPENAI_MODEL_MEDIA` y se adopta `gpt-6-luna` por defecto para medios y alcance, con razonamiento `low` independiente. | Luna lee las imágenes y clasifica el alcance. Extracción y redacción conservan sus roles independientes. |

Las excepciones de entrega autorizada se conservan. Rechazar compartir datos no implica una prohibición permanente de recibir el material. Una petición expresa de envío no exige completar el perfil. Rechazar el brochure no equivale a rechazar los datos. Las respuestas sobre el material tampoco autorizan visitas, reservas, revisión financiera ni cambios de unidad.

## Ejemplos

**Consulta del contenido antes de decidir**

- Lead: «¿Qué incluye ese brochure para ver si le comparto mi información?».
- Respuesta esperada: explicar que contiene información del proyecto y planos. Sin enlace ni nueva solicitud de datos en esa respuesta.
- Lead: «Oh, ya».
- Estado esperado: la decisión continúa pendiente; no se envía automáticamente ni se vuelve a insistir.
- Lead: «Soy Elena».
- Resultado: conservar el nombre y, si corresponde el único recordatorio, preguntar solo la residencia.
- Lead: «Actualmente resido en Loja».
- Resultado: completar el perfil y entregar el brochure en ese turno.

**Interés comercial contextual**

- Bot: «¿Le interesa una vivienda o un local comercial?».
- Lead: «Bueno, me interesa algo comercial».
- Resultado: conservar el interés en locales y avanzar al dato pertinente que falta. No repetir vivienda/local. No dar por elegida una unidad ni asumir su finalidad.
- Una consulta posterior sobre planta baja conserva el interés comercial.
- «En realidad prefiero una vivienda» sí permite cambiar al grupo residencial; no elige por sí sola departamento, suite o penthouse.

## Luna e interpretación de voz

La [documentación oficial de GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) establece entrada de imágenes y texto, y no admite audio directo. Por tanto, no se configuró Luna en el endpoint de transcripción.

El recorrido de voz conserva dos tareas: el modelo especializado transcribe el archivo y Luna interpreta el significado del texto transcrito. La transcripción mantiene `OPENAI_TRANSCRIPTION_MODEL` y su valor predeterminado `whisper-1`, con los controles existentes de voz clara y confianza. No se presenta este cambio como una mejora comprobada del reconocimiento acústico ni como transcripción realizada por Luna.

Variables del cambio:

```dotenv
OPENAI_MODEL_MEDIA=gpt-6-luna
OPENAI_MEDIA_REASONING_EFFORT=low
OPENAI_MODEL_SCOPE=gpt-6-luna
OPENAI_SCOPE_REASONING_EFFORT=low
```

Estos son también los nuevos valores predeterminados del código. Una variable explícita de otro modelo en el entorno prevalece y debe revisarse al publicar. `OPENAI_MODEL` continúa controlando las llamadas auxiliares que ya dependían de ella; no reemplaza el modelo específico de medios.

## Validación y límites

El [registro de validación de esta intervención](./validacion-brochure-interes-y-multimedia-2026-10-17.json) contiene las cifras y los archivos de evidencia. Se ejecutaron pruebas específicas y del contrato actual. **La revisión individual de los 432 fallos históricos permanece pendiente; no se ejecutó su batería general ni se modifica su resultado anterior.**

| Comprobación | Resultado |
| --- | --- |
| Contrato actual y regresiones seleccionadas del controlador | **391/391**, sin fallos ni omisiones. |
| Conjunto relacionado de material, memoria, presentación y modelos | **106/106**, con cobertura solapada con el anterior; no se suman como pruebas únicas. |
| TypeScript | Aprobado. |
| ESLint | **15 archivos**, sin errores ni advertencias. |
| Compilación de producción | Aprobada, salida 0. |
| Proveedores reales | Dos secuencias de **8 turnos** y una imagen sintética, aprobadas. |

La compilación vuelve a registrar `test_contacts_action_failed / UNKNOWN` durante el prerender, ya observado en el cierre anterior. Su salida es satisfactoria, pero no certifica esa pantalla autenticada.

Dos pruebas de presentación relacionadas con estos cambios fallaban también en la revisión de partida. Exigían texto de una función histórica que ahora deja la redacción al escritor. Se comprobó ese antecedente usando las fuentes de `HEAD` sin modificar el checkout. Se actualizaron para comprobar el resumen aprobado, su transmisión al contrato del redactor, los datos autorizados y el tratamiento de una presentación desactivada. No se restauró un generador de prosa en el código para satisfacerlas.

Las evaluaciones con proveedores reales usan catálogo, perfil y operaciones ficticios; la red queda limitada a OpenAI. Se comprobaron dos secuencias, de cinco y tres turnos, y una lectura de imagen sintética mediante el procesamiento multimedia real. No acreditan entrega en WhatsApp, reserva, cita ni recepción de una alerta productiva. La primera ejecución del recorrido del brochure falló por una expectativa del evaluador —ausencia de pregunta representada como `undefined` frente a `null`—; se conservó ese intento y se volvió a ejecutar tras corregir el verificador. También se afinó la instrucción de redacción a partir de la redundancia observada.

La prueba de imagen comprobó el número «LOCAL COMERCIAL 05» y el área interior «70 m2». No certifica todos los formatos de documentos, imágenes borrosas ni exactitud de cualquier transcripción de voz futura.

## Publicación

Cambios locales, sin commit, push ni despliegue en esta intervención. No se creó ni se aplicó una migración SQL. La IA revisora sigue desactivada; las evaluaciones no la activan. La actualización local no corrige retroactivamente el texto ya enviado ni altera automáticamente la memoria de los casos productivos anteriores.
