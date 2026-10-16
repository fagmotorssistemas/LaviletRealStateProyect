# Contacto del showroom y análisis de conversaciones

**Fecha:** 15 de octubre de 2026.

Esta definición reúne el primer contacto por WhatsApp después de un registro en el showroom, la relación con el recorrido 360, el envío de renders y la evaluación de conversaciones. Las reglas y plantillas siguientes son propuestas para implementar; no activan contactos ni crean plantillas en Kommo. El ajuste de altura del embudo sí está aplicado localmente.

**Cierre posterior del 16/10/2026:** la [implementación local de contacto y análisis](diagnostico-continuidad-showroom-2026-10-16.md#cierre-de-implementación-local) concreta la entrada del showroom, autorización de WhatsApp, tiempo de unidad, dos Salesbots, respuestas y panel lateral. Requiere migraciones, despliegue y comprobar la configuración de las plantillas/botones. El envío de renders permanece aplazado; el texto histórico siguiente conserva la definición previa.

## Funcionamiento del showroom revisado

| Acción | Resultado actual en el código |
| --- | --- |
| Recorre ambientes y tipologías. | Registra eventos y tiempos del recorrido; el seguimiento principal no mide de forma inequívoca el tiempo de cada unidad numerada. |
| Se registra o guarda un espacio. | Identifica el contacto y vincula el contexto disponible, unidad cuando procede y datos de la sesión. |
| Envía una solicitud desde el formulario. | Guarda una solicitud con motivo y mensaje. La ruta revisada no programa el primer WhatsApp. |
| Pulsa el enlace de WhatsApp. | Prepara un mensaje con contexto. El visitante debe enviarlo para que llegue al chat. |
| Escribe «vi el 605 en el showroom». | La automatización puede buscar la referencia en el catálogo; eso no constituye elección de compra. |
| Escribe «el que vi en el cuarto piso». | No dispone de una memoria completa y fiable del recorrido como contexto estructurado del extractor; puede necesitar aclarar la unidad. |

La conexión actual entre showroom y automatización es parcial. El showroom conserva datos en el CRM y algunas señales llegan al contexto del bot. El recorrido no es todavía una memoria compartida que permita resolver automáticamente cualquier referencia a lo visto en la web.

`useTourSceneTracking` trabaja con ambiente, tipología, acabado y luz. Su selector interno considera un ambiente a partir de ocho segundos y el modal automático de captación está desactivado. Ese umbral no identifica interés comercial en una unidad, no equivale a los dos minutos propuestos y no dispara WhatsApp. Un modelo 360 puede representar varias unidades: una visita al modelo no permite asignar arbitrariamente el 605.

## Cómo identificar el espacio para personalizar el contacto

Debe distinguirse entre unidad observada, unidad guardada, consulta expresa y unidad elegida. Las tres primeras no sustituyen la elección comercial registrada en la ficha.

Orden de prioridad propuesto:

1. Consulta expresa sobre una unidad identificada: atender esa consulta.
2. Acción de guardar o marcar una unidad: permite referirse a ese espacio guardado, sin presentarlo como compra elegida.
3. Navegación destacada con tiempo y unidad exacta comprobables: permite mencionar que estuvo revisando ese espacio.
4. Navegación breve, ambigua o distribuida entre unidades: contacto genérico del proyecto.

### Regla inicial de navegación destacada

Los siguientes son valores iniciales propuestos y configurables, no reglas activas ni una certeza de intención:

- Al menos **120 segundos acumulados de actividad en una unidad exacta**, durante la sesión que se vincula con el registro.
- Esa unidad concentra al menos el **50 % del tiempo activo dedicado a unidades**.
- Su tiempo supera o iguala **1,5 veces** el de la segunda unidad. Si solo existe una unidad, se aplica el mínimo de tiempo.
- Existe correspondencia comprobable entre visitante, sesión, registro y unidad. Si no la hay, se usa el mensaje genérico.
- Se excluyen pestañas ocultas, espera en formularios y tiempo inactivo prolongado. Como punto inicial, dejar de contar tras 60 segundos sin interacción y reanudar al interactuar.
- El tiempo de áreas comunes, planos generales y recorrido compartido sin unidad identificada no se asigna a un inmueble concreto.

| Ejemplo hipotético | Resultado |
| --- | --- |
| 605 durante 180 s y 304 durante 60 s. | Contacto sobre el 605, si los tiempos son activos y están asociados a esas unidades. |
| 605 durante 130 s y 304 durante 120 s. | Genérico: la preferencia de navegación es ambigua. |
| Cinco unidades durante 30 s cada una. | Genérico. |
| 605 abierto cinco minutos en una pestaña oculta. | No acredita cinco minutos activos ni interés destacado. |
| Pregunta expresamente por el 605 tras veinte segundos. | La consulta expresa tiene prioridad; no hay que esperar dos minutos para atenderla. |

La medición necesita `unit_id`, identificador de sesión, instante de inicio y fin, segundos activos y un identificador de evento para deduplicar. Debe cerrar el tramo al cambiar de unidad, aunque se mantengan el mismo ambiente y la misma tipología. Los relojes de heartbeat, ambiente y sesión no deben sumarse como si fueran tres visitas diferentes. No se debe reconstruir tiempo por unidad con datos antiguos que no la identifican.

## Primer contacto después del registro

Propuesta inicial: preparar un contacto **cinco minutos después del registro**, dentro del horario configurado. Recalcular la referencia antes de enviarlo. Una consulta expresa requiere atención prioritaria y no espera ese saludo genérico.

Antes del envío se comprueba que exista teléfono válido, permiso de contacto por WhatsApp para ese propósito y plantilla aprobada cuando corresponda. El registro web no abre por sí mismo la ventana de atención de WhatsApp. La [política de WhatsApp](https://whatsappbusiness.com/policy/) exige consentimiento y plantillas aprobadas para iniciar contactos; la ventana de 24 horas se abre o renueva con mensajes del usuario en WhatsApp.

Las casillas actuales no tienen todas el mismo significado: el formulario de información menciona privacidad, la captación general autoriza contacto y otros accesos guardan un teléfono para continuar una función. Debe conservarse el texto y alcance aceptados; no convertir automáticamente una aceptación de privacidad en consentimiento para todos los contactos futuros.

Texto operativo propuesto para un permiso específico:

> Autorizo a La Vilet a contactarme por WhatsApp sobre el proyecto y los espacios que consulte. Puedo solicitar que no me contacten nuevamente.

Se cancela el saludo pendiente si el visitante ya escribió, el equipo está atendiendo la misma solicitud, ya se efectuó ese primer contacto o se retiró el permiso. No se dispara un WhatsApp por cada unidad vista ni por cada regreso al showroom. Los errores de resultado desconocido se concilian antes de reintentar.

La respuesta posterior debe conservar el propósito: si responde «sí» al mensaje sobre el 605, se continúa con información del 605; no se interpreta como reserva, autorización financiera ni elección nueva. Si responde «sí» al mensaje genérico, se pregunta qué desea conocer. «Más adelante» requiere aclarar el plazo y el acuerdo de contacto antes de activar nutrición.

## Las dos plantillas para Kommo

Estas plantillas cubren el registro sin pregunta concreta pendiente. Una solicitud expresa debe recibir una respuesta a su contenido, evitando volver a preguntar si desea información; su envío inicial también debe usar una plantilla apropiada cuando WhatsApp la exija.

Configuración propuesta: plantilla de **WhatsApp**, tipo personalizado de texto, idioma **Español**, categoría solicitada **Marketing** para este saludo comercial proactivo. La aprobación y categoría final corresponden a Meta. No sustituirla por una plantilla general de chat para iniciar un contacto fuera de la ventana de atención.

### Plantilla con un espacio identificado

**Nombre:** `lavilet_showroom_unidad_v1`.

**Cuerpo:**

> Hola, le saludamos de La Vilet. Gracias por visitar nuestro showroom virtual. Estuvo revisando {{1}} y nos gustaría ayudarle a conocer más detalles. ¿Le gustaría recibir información sobre este espacio o sobre el proyecto?

**Variable y ejemplo para revisión:**

| Variable | Campo de Kommo propuesto | Tipo | Ejemplo |
| --- | --- | --- | --- |
| `{{1}}` | Showroom · Espacio para contacto | Texto del lead | el penthouse 605 |

No se debe utilizar el campo Unidad elegida para rellenar una observación de navegación. La etiqueta combina tipo y número desde el catálogo, con procedencia comprobable. Cuando no existe evidencia suficiente para mencionar una unidad, no se envía esta plantilla.

### Plantilla general del proyecto

**Nombre:** `lavilet_showroom_general_v1`.

**Cuerpo:**

> Hola, le saludamos de La Vilet. Gracias por visitar nuestro showroom virtual. Nos gustaría ayudarle a conocer mejor el proyecto y resolver sus dudas. ¿Le gustaría recibir más información?

Esta plantilla no necesita variables. También sirve cuando solo se conoce el teléfono y el nombre guardado es artificial, como «WhatsApp ····1234».

Usar «Hola» permite mantener exactamente dos plantillas, sin depender de nombre, zona horaria o variantes de mañana, tarde y noche. La conversación posterior puede saludar y usar el nombre real con naturalidad. No se propone insertar todo el texto mediante una variable para eludir el contenido aprobado.

### Botones y campos de gestión

Botones de respuesta rápida propuestos para ambas:

- Sí, quiero información.
- Más adelante.
- No recibir mensajes.

El último botón debe registrar la baja y cancelar envíos pendientes aplicables. Los botones deben conservar el contexto del contacto y su plantilla; un «sí» no se resuelve por una coincidencia de palabras aislada.

Campos adicionales sugeridos en Kommo:

| Campo | Tipo | Uso |
| --- | --- | --- |
| Showroom · Origen del interés | Lista | Consulta expresa, espacio guardado, navegación destacada o general. |
| Showroom · Estado de primer contacto | Lista | Pendiente, aceptado por proveedor, entregado, cancelado, fallido o por comprobar. |

Los tiempos detallados, IDs de sesiones, evidencia de permiso y claves de deduplicación se guardan en la aplicación y se muestran en la ficha común. No es necesario crear otra ficha independiente con todos esos campos en Kommo.

El 16 de octubre se proporcionaron el campo «Unidad Observada Showroom» `538638` y los Salesbots `26428` (con unidad) y `26430` (genérico). Falta comprobar su configuración y habilitación; los IDs de Salesbot no acreditan aprobación de una plantilla por Meta. Véase el [tratamiento de variables y botones](diagnostico-continuidad-showroom-2026-10-16.md#entrada-del-showroom). En el editor se selecciona la variable del campo correspondiente y se agrega su ejemplo. Las [instrucciones de Kommo](https://support.kommo.com/docs/es/gestiona-plantillas-de-mensajes-de-whatsapp-business) explican creación, variables y revisión por Meta. Crear las plantillas no conecta por sí solo el disparador del showroom.

## Envío de renders como imágenes

**Aplazado expresamente el 16/10/2026.** Esta sección conserva la propuesta para retomarla después.

Los recursos revisados se preparan como WebP para la web. Las imágenes normales de WhatsApp admiten JPEG o PNG hasta 5 MB; WebP aparece como formato de sticker, no como sustituto de una fotografía adjunta. El límite y formatos constan en la [referencia de medios de Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3).

Se necesita generar una copia JPEG o PNG real, con su MIME correcto, conservando el original del showroom. Cambiar la extensión del nombre no convierte el archivo. Como objetivo propio de entrega, se propone una imagen de aproximadamente 1600 a 2000 píxeles y menor de 1 MB cuando conserve el detalle suficiente; los 5 MB son el límite de la plataforma, no el tamaño objetivo.

La copia debe asociarse a recurso, tipología, unidad cuando corresponda, ambiente, versión y etiqueta. Un render genérico de tipología no se presenta como una fotografía exacta del 605. Deben separarse las imágenes planas de los panoramas 360 y aclarar que son representaciones del proyecto.

### Meta y Kommo como vías de entrega

Meta Cloud API permite enviar la imagen. Kommo también puede entregar medios mediante su integración y las capacidades habilitadas. En el código existe una plantilla de seguimiento de dos semanas con imagen fija; eso no equivale a seleccionar y enviar renders distintos según la unidad consultada.

La entrega dinámica de renders sigue pendiente. La última comprobación documentada de Chats API de Kommo devolvió HTTP 403 por función no disponible para la cuenta; no se volvió a comprobar ni se habilitó en este turno. La [documentación de Chats API](https://developers.kommo.com/reference/chats-api-add-on) distingue los permisos para canales externos y la disponibilidad por cuenta.

La alternativa directa con Meta requiere acceso autorizado al número, WABA, token y webhooks. El acceso al token de Kommo o al Pixel no acredita ese acceso. Debe verificarse la sincronización con Kommo, la identificación del remitente bot y la deduplicación para evitar dos emisores independientes o respuestas del bot a sus propios envíos.

### Flujo técnico con Meta

1. Convertir y validar la copia de la imagen.
2. Subirla mediante `POST /{PHONE_NUMBER_ID}/media` con archivo, `type=image/jpeg` y `messaging_product=whatsapp`.
3. Guardar el identificador de medio devuelto y su asociación con el recurso.
4. Enviar mediante `POST /{PHONE_NUMBER_ID}/messages` usando ese medio.
5. Guardar el identificador del mensaje y actualizar su estado con los webhooks.

Ejemplo de cuerpo para una conversación que permita un mensaje libre de imagen:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "NUMERO_DEL_DESTINATARIO",
  "type": "image",
  "image": {
    "id": "ID_DEL_MEDIO_SUBIDO",
    "caption": "Render de referencia de la tipología del penthouse 605."
  }
}
```

La versión de Graph API se fija según la aplicación y su soporte vigente; los marcadores anteriores no son credenciales ni IDs reales. Meta describe el mecanismo de [subida y envío de medios](https://whatsappbusiness.com/blog/media-messages-via-app/). Su ejemplo histórico no determina la versión que debe configurarse hoy.

Fuera de la ventana de atención, el JSON de imagen libre no sustituye una plantilla aprobada. Las opciones son una plantilla multimedia apropiada y aprobada o esperar la respuesta del cliente para enviar el material solicitado dentro de la ventana correspondiente. Enviar una plantilla de texto no abre por sí solo la ventana para continuar con fotos libres.

## Reglas para combinar fotos y recorrido 360

| Solicitud o situación | Entrega propuesta |
| --- | --- |
| Primer contacto después del registro. | Texto de la plantilla; sin enviar automáticamente una colección de renders ni repetir el recorrido que acaba de visitar. |
| Pide fotografías, imágenes o renders de un espacio. | Una o dos imágenes pertinentes como primera entrega, con su identificación y aclaración de render. Si pide todo el material, respetar esa petición. |
| Pide recorrer o visualizar en 360. | Enlace al recorrido disponible y pertinente, conservando unidad y tipología correctas. |
| Pide ambas cosas. | Entregar imágenes y enlace en una respuesta coordinada, sin duplicaciones ni dos automatizaciones compitiendo. |
| Pregunta de forma ambigua cómo verlo. | Ofrecer las modalidades disponibles y aclarar qué desea si el contexto no basta. |
| Local comercial con galería pero sin 360. | Renders y/o planos disponibles; no prometer un recorrido inexistente. |
| Ya recibió el mismo recurso o enlace y no lo volvió a pedir. | Evitar repetición automática. Una petición expresa de reenvío permite repetirlo. |

Un único plan de entrega registra recursos, versión, propósito y estado real del envío. Un enlace compartido no cuenta como imagen adjunta. Las respuestas entrantes y solicitudes pendientes tienen prioridad sobre saludos proactivos y seguimientos programados.

## Evaluación de conversaciones con IA

La revisión actual por mensaje y los eventos de puntuación no constituyen todavía este diagnóstico retrospectivo de abandono. Se propone una evaluación de solo lectura de conversación, hechos comerciales, errores y estados de entrega. Su resultado no cambia automáticamente etapas, permisos ni dispara contactos.

### Cuándo evaluarla

- Por solicitud del asesor.
- Al registrar un cierre sin venta, para resumir lo expresado y lo ocurrido.
- Ante una interrupción técnica o consulta que quedó sin respuesta, identificándola como incidencia operativa y no como desinterés del cliente.
- Tras un periodo inicial propuesto de 24 horas sin nueva interacción, siempre que no sea una espera acordada, cita futura o gestión activa. Es un corte de análisis configurable, no una declaración de lead perdido.
- Cuando hay mensajes nuevos relevantes, actualizar la evaluación conservando las versiones anteriores. No evaluar repetidamente el mismo contenido.

### Criterios y datos a guardar

| Campo | Qué debe contener |
| --- | --- |
| Resumen | Necesidad, consultas, opciones y resultado de la conversación. |
| Último objetivo del cliente | Qué quería resolver antes de la pausa. |
| Punto de interrupción | Mensaje, fecha, etapa y turno concreto; quién tenía la respuesta pendiente. |
| Estado observado | Conversación activa, silencio sin motivo, espera acordada, pendiente del equipo, incidencia o cierre expreso. |
| Motivo declarado | Una razón que el propio lead expresó, con cita e identificador de mensaje. |
| Hipótesis | Explicación posible con evidencia, nivel de respaldo y alternativas. Puede quedar vacía. |
| Fallos de atención | Consulta omitida, pregunta repetida, pérdida de selección, presión comercial, respuesta excesiva o fallo técnico/entrega, únicamente cuando se puedan respaldar. |
| Objeciones | Precio, ubicación, tamaño, plazo, financiamiento u otras, diferenciando resuelta, pendiente o desconocida. |
| Información pendiente | Lo que falta responder o verificar, sin tratar cada campo comercial vacío como error. |
| Próxima acción sugerida | Atender una pregunta, corregir una incidencia, respetar una espera, consultar al asesor o posible retoma sujeta a criterios. |
| Trazabilidad | Lead, conversación, mensajes analizados, fecha de corte, versión de criterios/modelo, fecha de evaluación y revisión humana. |

La evaluación debe distinguir tres niveles: **expresado por el cliente**, **hipótesis respaldada** y **motivo desconocido**. Una objeción de precio antes del silencio no demuestra por sí sola que esa fuera la causa del abandono. Tampoco se debe confundir falta de entrega con falta de interés.

Ejemplo hipotético:

> **Observado:** el cliente pidió imágenes de un local. El sistema respondió enumerando códigos y el cliente no continuó.
>
> **Pendiente:** no recibió el material visual solicitado.
>
> **Motivo de la pausa:** desconocido; no lo explicó.
>
> **Hipótesis:** la solicitud visual no atendida pudo dificultar la continuidad. Respaldo medio.
>
> **Siguiente acción sugerida:** comprobar el material disponible y la entrega antes de proponer una retoma.

El evaluador debe fundamentar cada hallazgo en mensajes o registros identificables y admitir que no sabe. Los textos del chat se tratan como datos para analizar, no como instrucciones que puedan cambiar sus criterios o permisos. Los indicadores se calculan desde los datos guardados; no se le pide a la IA inventar cifras agregadas.

## Panel de análisis y gráficas

Ubicación acordada el 16 de octubre: **Análisis de conversaciones**, como entrada propia en la barra lateral cerca de Inicio, con acceso desde la ficha común. La sección de Marketing conserva adquisición, anuncios y gasto; ambas pueden compartir filtros y fuentes sin duplicar el expediente del lead. No se incorpora dentro del módulo de Automatización.

La lista de evaluaciones muestra lead, etapa, última interacción, estado observado, motivo declarado, hipótesis separada y próxima acción sugerida. Abrir un resultado permite ver sus citas y mensajes de origen. Una corrección del asesor conserva la evaluación original y la autoría de la revisión.

| Gráfica | Qué permite entender | Precaución de cálculo |
| --- | --- | --- |
| Países de residencia | Desde qué países declaran residir los leads. | Usar residencia del chat, no nacionalidad ni IP. |
| Ciudades de residencia | Ciudades más mencionadas como residencia actual. | Normalizar nombres sin inventar; incluir Sin confirmar. |
| Etapas comerciales | Distribución y avance observado. | Distinguir distribución actual de transiciones históricas registradas. |
| Objeciones | Qué preocupaciones aparecen y cuáles siguen pendientes. | Un lead puede tener varias; los porcentajes multirrespuesta pueden superar 100 %. |
| Motivos de cierre sin venta | Razones expresas de oportunidades cerradas. | Separar hipótesis de causa confirmada y mantener Motivo desconocido. |
| Consultas pendientes e incidencias | Dónde falló la atención: presupuesto repetido, selección perdida, fallback o envío. | No confundir errores del bot con rechazo del proyecto. |
| Continuidad por tema | Después de qué temas dejan de responder y cuáles mantienen el diálogo. | Mostrar asociación temporal; no afirmar causalidad automática. |
| Tiempo de respuesta | Esperas del cliente frente al bot o al equipo. | Distinguir registro, envío y entrega; separar pausas acordadas. |
| Inmuebles consultados | Tipo y unidades vistas, guardadas, consultadas y elegidas. | Mantener las categorías de señal separadas. |
| Showroom a conversación | Registro, contacto aceptado por proveedor, entregado y respuesta del lead. | Usar IDs y estados reales; no contar un intento como entrega. |
| Material visual | Imágenes o 360 solicitados y entregados; continuidad posterior. | Entregar un enlace no demuestra que el lead lo abrió. |
| Fuentes y campañas | Calidad de conversaciones y avance por origen. | Reutilizar atribución existente; no crear una segunda fuente de verdad. |

**Residencia declarada:** el bot ya conserva `residence_city`, `residence_country`, estado y evidencia del perfil. El showroom también puede rellenar `leads.city` y `leads.country` desde geolocalización. Esos campos generales no deben utilizarse indistintamente como residencia confirmada. La ubicación aproximada de navegación puede tener una gráfica separada y claramente identificada.

Se cuentan leads únicos y se utiliza la evaluación vigente por conversación o el último estado por lead, según el indicador. Las reevaluaciones no multiplican personas. Los filtros deben declarar el periodo y la fecha usada, además de origen, responsable, etapa y tipo de inmueble. Las primeras gráficas recomendadas son residencia, etapas, consultas pendientes, objeciones y motivos expresos de cierre.

## Alcance aplicado y trabajo posterior

Se retiró la altura fija y el desplazamiento vertical interno de las columnas del embudo. El tablero crece con las tarjetas de la página actual y conserva la paginación por columna. El desplazamiento vertical lo gestiona la página del CRM; el horizontal se mantiene para navegar entre etapas.

Pendientes de implementación: medición exacta por unidad, disparador y cola del primer contacto, plantillas y campos reales de Kommo, permisos de contacto por propósito, continuidad del contexto web-chat, conversión y transporte de imágenes, evaluación retrospectiva y panel analítico. Este documento no habilita campañas ni envíos a leads.

### Fuentes del código revisado

- Registro y solicitudes: `src/app/api/tour/lead/route.ts`.
- Tiempo y escenas: `src/hooks/useTourSceneTracking.ts`, `src/components/tour/TourViewer.tsx`, `src/app/api/tour/event/route.ts`.
- Contexto CRM del recorrido: `src/lib/tour/enrichTourLead.ts`.
- Mensajes preparados: `src/lib/tour/tourWhatsApp.ts`.
- Contexto del bot: `src/lib/integrations/automation/sdr.ts`, `src/lib/integrations/automation/turn-interpretation-input.ts`.
- Material visual: `src/lib/integrations/automation/visual-materials.ts`, `src/lib/tour/roomScene.ts`.
- Imagen fija de seguimiento: `src/lib/inmobiliaria/nutritionLater.ts`, `src/lib/integrations/automation/kommo.ts`.
- Marketing existente: `src/app/inmobiliaria/marketing/metricas/page.tsx`.
- Altura del tablero: `src/components/inmobiliaria/leads/LeadPipelineBoard.tsx`.
