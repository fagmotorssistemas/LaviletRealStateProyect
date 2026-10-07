# Cambio del extractor a GPT-4.1 mini y controles de automatización

Fecha: 7 de octubre de 2026. El código preparado cambia únicamente el modelo predeterminado del extractor de GPT-4.1 a GPT-4.1 mini. El redactor conserva su modelo. Se añaden controles para evitar que errores de extracción alteren las necesidades del lead, autoricen trámites o desvíen una continuación comercial. La publicación y las migraciones remotas están pendientes; guardar el código no modifica por sí solo la automatización desplegada.

**Estado: validado en las pruebas locales y sintéticas descritas abajo.** El uso de mini depende de conservar las validaciones del servidor: no se ha acreditado equivalencia universal de calidad ni aceptación del despliegue real. La [auditoría del 6 de octubre](auditoria-flujo-y-modelos-2026-10-06.md) describe el estado anterior y conserva su valor como corte histórico.

## Modelos y costo

| Función | Antes de este cambio | Código preparado | Configuración independiente |
| --- | --- | --- | --- |
| Extractor de intención y datos | GPT-4.1 | GPT-4.1 mini | OPENAI_MODEL_EXTRACTOR |
| Redactor y borradores | GPT-4.1 mini | GPT-4.1 mini | OPENAI_MODEL_WRITER |
| Revisor | GPT-5 mini | GPT-5 mini | OPENAI_MODEL_REVIEWER |
| Clasificador de alcance | GPT-4o mini | GPT-4o mini | OPENAI_MODEL_SCOPE |
| Interpretación auxiliar y multimedia | Configuración general | Se mantiene | OPENAI_MODEL |

El modelo se elige en el servidor por función. Cambiar el extractor no cambia el redactor, el revisor ni el procesamiento de audio. Una variable OPENAI_MODEL_EXTRACTOR definida en el despliegue prevalece sobre el nuevo valor predeterminado. Para revertir sólo el extractor, establecer OPENAI_MODEL_EXTRACTOR=gpt-4.1 y publicar esa configuración. Fuente: [ai-model-routing.ts](../../src/lib/integrations/automation/ai-model-routing.ts) y [.env.example](../../.env.example).

| Tarifa en USD por millón de tokens | GPT-4.1 | GPT-4.1 mini |
| --- | ---: | ---: |
| Entrada sin caché | 2,00 | 0,40 |
| Entrada en caché | 0,50 | 0,10 |
| Salida | 8,00 | 1,60 |

Con el mismo número de tokens, la misma proporción de caché y el mismo número de intentos, la tarifa del extractor baja un 80 %. Esto no significa un 80 % menos para toda la conversación: siguen existiendo redacción, revisión, clasificación, recuperación, embeddings cuando correspondan, transcripción y servicios externos. Referencias: [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) y [cálculo local del costo](../../src/components/inmobiliaria/automation/workflow/executionCost.ts).

Los tokens utilizados son datos devueltos por la API. Los dólares se calculan con esos tokens y las tarifas registradas; no son una factura de OpenAI ni el saldo de la cuenta. Un uso ausente no se cuenta como cero. Los caracteres de instrucciones, contexto, formato y prefijo se muestran por separado; caracteres y tokens son medidas distintas.

## Correcciones del extractor

| Situación | Fallo identificado | Comportamiento preparado |
| --- | --- | --- |
| Preguntar precios o dimensiones de opciones ya ofrecidas | El extractor podía repetir cinco dormitorios del historial como una restricción actual y provocar otra búsqueda o un rechazo | Se reconcilian sólo ecos comprobables de cantidades anteriores en una consulta de detalles o comparación sobre opciones conocidas. Una nueva restricción actual conserva su prioridad. Las citas sin procedencia conocida siguen requiriendo validación |
| Personas frente a dormitorios | Una familia de seis o una pregunta de capacidad podía convertirse en una búsqueda de seis dormitorios | Se conservan dimensiones y papeles separados: personas como contexto; dormitorios como requisito o evaluación. La evaluación no crea un filtro nuevo de búsqueda |
| Cantidad mínima de dormitorios | Una condición de al menos dos podía persistir como exactamente dos | Una condición actual validada del catálogo comparte su relación y evidencia con los filtros persistentes. Se conservan mínimo, máximo e intervalo; no se sustituyen por igualdad |
| Requisito indispensable | Un booleano sin cita duplicada podía borrar una exigencia explícita como cinco dormitorios obligatoriamente | La evidencia actual se comparte sólo cuando coincide el requisito de dormitorios del catálogo, la cantidad interpretada y una declaración explícita de rigidez. La fuerza requerida del catálogo, por sí sola, no vuelve inflexible una preferencia |
| Preferencia flexible | Una preferencia aproximada podía terminar imponiendo una cantidad indispensable | Se mantiene la diferencia entre cantidad deseada y rigidez. Negaciones, citas, evidencia histórica, otras dimensiones y números incompatibles no permiten heredar rigidez |
| Presupuesto aproximado o escrito con palabras | Un valor literal válido podía perderse, multiplicarse incorrectamente o confundirse con la entrada | Se comprueba el importe contra la cantidad literal actual y se conservan presupuesto total y capital inicial como conceptos distintos. Un dato inválido sigue requiriendo recuperación |
| Respuesta sin presupuesto definido | La pregunta anterior del bot podía copiarse como si fuese una consulta del lead | Se puede descartar un eco comprobable de esa pregunta cuando existe una respuesta actual de presupuesto válida. No se descartan consultas operativas, preguntas desconocidas ni importes inválidos por esa vía |
| Planta sin número exacto | El artículo un en un piso alto podía convertirse en primera planta | Un y una no se interpretan como números de planta. Los números reales, los ordinales y planta baja mantienen su significado |
| Elegir JEP o Banco Pichincha | Elegir una entidad podía interpretarse como autorización para iniciar la revisión financiera | La elección conserva la entidad como preferencia. La autorización para el trámite se comprueba por separado y no se crea por mencionar o elegir un banco |
| Aceptar alternativas comerciales | Un sí a revisar opciones podía dejar una aceptación o señal de visita | La aceptación se vincula a la pregunta comercial entregada. Una señal de visita necesita una solicitud actual independiente que la respalde |
| Reservar una unidad | El mismo fragmento podía activar además visita o asesor sin haberlo solicitado | La reserva se valida como acción propia. Las otras acciones necesitan evidencia independiente. Si el mensaje contiene solicitudes independientes válidas, se conservan |
| Solicitar asesor o rechazar comunicaciones | Podían sobrevivir señales operativas incompatibles con la intención real | Los indicadores operativos se contrastan con su evidencia actual. No basta con que una salida del modelo contenga un booleano o un evento |
| Residencia frente a finalidad de compra | Vivo en España o sólo quiero información podía convertirse en compra para vivir | La declaración del perfil se distingue del destino del inmueble. Un propósito necesita su propia declaración o una respuesta válida a la pregunta de finalidad |

Los controles se aplican a contratos y evidencia, no a respuestas completas escritas para cada ejemplo. La reparación parcial de cantidades recibe únicamente el fragmento y el contrato que debe corregir; no repite toda la extracción con el historial completo. Se conserva la evidencia larga que realmente pertenece al turno actual. Fuentes: [turn-interpretation.ts](../../src/lib/integrations/automation/turn-interpretation.ts), [turn-interpretation-input.ts](../../src/lib/integrations/automation/turn-interpretation-input.ts), [turn-semantics.ts](../../src/lib/integrations/automation/turn-semantics.ts), [interpretation-memory.ts](../../src/lib/integrations/automation/interpretation-memory.ts).

Los indicadores de asesor y seguimiento se contrastan con la voz del lead: las instrucciones que está citando o atribuyendo a terceros no autorizan una acción. La misma separación se aplica a los fragmentos operativos interpretados como solicitudes. Una frase que sólo rechaza un trámite, asesor o visita no se convierte en una solicitud positiva ni en un rechazo de todas las comunicaciones. Un rechazo global real conserva prioridad; una preferencia limitada a un tema o canal no silencia toda la conversación. Las solicitudes propias e independientes que sí sean válidas se conservan, incluidas las expresadas entre comillas como énfasis del propio lead. Un simple reconocimiento o interés comercial tampoco concede permiso de seguimiento; se necesita una solicitud explícita o una aceptación válida de la invitación correspondiente.

La elección de banco puede recuperar una respuesta de valor a la pregunta anterior únicamente cuando esa pregunta es financing_partner, la elección estructurada tiene certeza alta y evidencia actual, y el consumidor financiero valida la entidad elegida. Esto permite seguir con JEP o Banco Pichincha cuando el extractor omite la respuesta a la pregunta, sin transformar preguntas sobre requisitos, elecciones inciertas o menciones de banco en selección ni consentimiento. Solicitar un asesor tampoco basta para coordinar una visita: se conserva la coordinación cuando existe una petición propia de visita, atención presencial en oficina o una respuesta válida a la pregunta de visita; se descartan señales de coordinación sin ese permiso actual.

Una consulta sobre la distribución para la familia puede recuperar la referencia a las opciones ya ofrecidas aunque no repita sus dormitorios. Se exige una referencia actual explícita a esas opciones, contexto de personas con certeza alta y opciones anteriores identificadas; no debe haber nuevos requisitos, presupuesto declarado, selección, cambio incompatible de grupo ni una acción simultánea. Una evaluación exclusiva de capacidad se mantiene como información sobre las opciones, sin convertirla en consulta de precios ni en búsqueda nueva. Una pregunta real de precio conserva su objetivo. Cuando se descarta un fragmento operativo citado o de simple rechazo, la solicitud comercial positiva del propio lead puede recuperar el objetivo del turno; el código no inventa una pregunta si ese fragmento propio no existe.

Estos controles usan evidencia literal, significado tipado, pregunta pendiente y validación del consumidor juntos. La coincidencia literal por sí sola no prueba una interpretación correcta. El tratamiento de texto citado cubre delimitadores equilibrados y las atribuciones comprobadas; no acredita todas las formas posibles de cita incompleta o discurso indirecto. La aceptación del cambio sigue sujeta a los resultados del ensayo y de la reproducción final indicados más abajo.

## Reglas comerciales que se mantienen

La necesidad actual continúa siendo el objetivo principal. Los datos ya respondidos no se solicitan otra vez; las preguntas de perfil y los recordatorios limitados siguen sujetos al estado de presentación del lead. Rechazar dar el nombre no autoriza detener la conversación comercial. La entrega del brochure depende del contrato del turno y debe ser coherente con lo que afirma el mensaje; no puede condicionarlo a un dato y entregarlo como si esa condición se hubiese cumplido.

El recorrido residencial conserva el orden establecido:

1. Si no existe la cantidad solicitada y el requisito admite alternativas, explicar la limitación y proponer revisar opciones compatibles, con una pregunta explícita. No afirmar que garantizan cubrir la necesidad familiar.
2. Una vez aceptadas las alternativas, presentar todos los tipos compatibles, incluidos departamentos y penthouses cuando corresponda, y preguntar qué tipo prefiere.
3. Después de elegir el tipo, resumir superficies y plantas reales disponibles, y preguntar qué planta prefiere.
4. Con tipo y planta definidos, mostrar números y características de las unidades compatibles.
5. Preguntar por el presupuesto si sigue pendiente y corresponde hacerlo; conservar un presupuesto conocido o una decisión de no definirlo o posponerlo.
6. Comparar, continuar con la elección de una unidad y aplicar los pasos siguientes según el interés y las autorizaciones actuales.

Mostrar una opción no significa que el lead la eligió. No se piden números de unidad antes de presentarlos, no se inventan plantas intermedias ni una relación automática entre mayor altura y mayor precio. Un requisito indispensable que no tiene alternativas concretas requiere aclarar qué condición puede flexibilizar; un sí aislado no acepta opciones inexistentes. Fuente: [commercial-journey.ts](../../src/lib/integrations/automation/commercial-journey.ts).

Las consultas laterales se responden conservando una continuación acorde. Las preguntas sobre citas deben usar el destino ofrecido y su estado, sin repetir una restricción ya explicada que no responde a la consulta actual. La oficina ubicada en el lugar del proyecto y la visita a un edificio todavía no construido son destinos distintos. Los datos de obra, entrega, financiamiento, reservas y descuentos siguen procediendo de configuración o políticas autorizadas; no se añaden fechas, porcentajes ni garantías inventadas por cambiar de modelo.

Los embeddings siguen siendo una forma de seleccionar contexto de catálogo, no una obligación para todos los mensajes. Una consulta estructurada validada puede permitir la búsqueda o reducción; cuando no existe evidencia suficiente, se conserva una ruta de catálogo segura. Este cambio de modelo no demuestra por sí solo que un turno real haya utilizado embeddings ni aplica otro recorte agresivo a las reglas del prompt.

## Controles gratuitos del servidor y financiamiento

Desactivar la revisión con modelo deja activos los controles obligatorios de enlaces, continuidad, presentación del lead, reservas, intención y hechos del catálogo. Esa rama no llama al revisor ni intenta otra redacción para reparar metadatos. Puede rechazar una respuesta insegura; revisión desactivada no equivale a aprobación automática de cualquier texto. La auditoría distingue esa validación del servidor de una revisión semántica realizada por un modelo.

Aunque el revisor apruebe, el servidor exige presentar las unidades y características cuando el recorrido comercial lo requiere. Un aprobado no permite saltar directamente al presupuesto, sustituir una acción no realizada por una supuesta derivación ni eliminar obligaciones del turno. Fuente: [turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts).

La entidad financiera habilitada se comprueba tanto en la recopilación como antes del traspaso. Si se desactiva JEP o Banco Pichincha mientras existe un expediente anterior, los datos y el consentimiento ya registrados se conservan, pero se detiene la nueva captura o derivación para esa entidad hasta una elección válida. El indicador antiguo de listo para revisión no puede prevalecer sobre las entidades actualmente habilitadas. Fuentes: [financing-intake.ts](../../src/lib/integrations/automation/financing-intake.ts), [conversation.ts](../../src/lib/integrations/automation/conversation.ts) y la migración financiera indicada más abajo.

## Orden de mensajes y envíos

El orden usa la fecha con milisegundos y una secuencia persistida para resolver empates reales. Se mantiene el orden de cada conversación y se excluyen ejecuciones que comparten lead o contacto. El webhook despierta al worker con la identidad resuelta en la base de datos, y el límite de recepción es de 200 eventos por lote. Los distintos workers comparten una admisión de llamadas a Kommo con separación de 400 milisegundos; si falta la función SQL o su respuesta es inválida, el código falla antes de contactar al proveedor.

El mantenimiento dispone de su propio bloqueo para avanzar con el monitor, planificación y recuperación mientras se procesan conversaciones. Los envíos efectivos de recordatorios de citas y nutrición conservan la exclusión global. **Sigue pendiente comprobar cuándo Salesbot lee el campo compartido de respuesta después de aceptar su lanzamiento.** Por eso no se afirma que todos los carriles de envío puedan ejecutarse simultáneamente sin riesgo.

Un envío incierto bloquea otros envíos relacionados para evitar duplicados. La interfaz permite a un administrador registrar una revisión del envío con evidencia y resultado enviado o no enviado. Confirmar enviado requiere un identificador observado del mensaje y coincidencia de destinatario y momento. Confirmar no enviado cierra ese intento sin reenviarlo automáticamente. La conciliación no elimina un opt-out ni reconstruye por sí sola toda la memoria histórica.

Que Kommo acepte iniciar Salesbot no acredita entrega ni lectura en WhatsApp. Las pruebas locales tampoco verifican qué contenido leyó finalmente Salesbot. Fuentes: [inbound-order.ts](../../src/lib/integrations/automation/inbound-order.ts), [kommo-admission.ts](../../src/lib/integrations/automation/kommo-admission.ts), [delivery-state.ts](../../src/lib/integrations/automation/delivery-state.ts) y [AutomationDeliveryBanner.tsx](../../src/components/layout/AutomationDeliveryBanner.tsx).

## Pruebas y evidencia de costos

| Validación | Resultado final | Uso de créditos |
| --- | --- | --- |
| Contratos, conversación, catálogo, revisión, transporte y SQL en PGlite | **1.658/1.658 aprobadas**, 129 archivos únicos, sin canceladas ni omitidas | Cero llamadas a OpenAI |
| TypeScript y diferencias | **0 errores**, diferencias sin errores de espacios | Cero llamadas a OpenAI |
| ESLint de 73 fuentes y comprobaciones de las últimas ediciones | **0 errores**; quedan 2 advertencias previas de parámetros sin uso en delivery-health.test.cjs | Cero llamadas a OpenAI |
| Reproducción con fuentes y oráculos finales | **108/108 aprobadas**, 48 escenarios; cero faltantes o resultados inconclusos | Cero llamadas externas |
| Nueva inferencia real de los seis casos afectados, dos veces cada uno | **12/12 aprobadas**, 12 llamadas | USD 0,0280536 calculados |

Las suites se deduplicaron; no se sumaron resultados de scripts que comparten archivos. El hash de nueve fuentes relevantes se mantuvo idéntico antes y después del recorrido general; trece fuentes permanecieron estables durante la reproducción. La validación local usó Node 22.19.0, mientras que el proyecto declara Node 24.x. La prueba en el entorno de publicación sigue siendo necesaria. El manifiesto de 129 archivos cubre automatización: no es una afirmación de que todo el repositorio o toda frase posible esté libre de errores.

La cobertura sintética incluye seguimiento de opciones, aceptación y rechazo de alternativas, cambio de tema, personas frente a dormitorios, mínimos, rigidez, flexibilidad, capacidad familiar, categorías y plantas, presupuestos aproximados y corregidos, entrada frente a total, importes escritos con palabras, bancos, consentimiento financiero, perfil parcial, residencia, rechazo de nombre, solicitudes reales o negadas de asesor y visita, reservas hipotéticas frente a reales, citas de terceros, seguimiento explícito frente a mero interés y errores de escritura. Las entradas son textos y transcripciones sintéticas; no se prueba aquí reconocimiento de audio ni entrega real en WhatsApp.

Los nueve primeros lotes contienen **96 inferencias sobre 48 escenarios**, dos por escenario, y 104 llamadas porque ocho casos necesitaron recuperación. Se registraron **89 resultados correctos y 7 discrepancias** con los controles existentes en cada momento. Se conservaron esos fallos: elección bancaria sin respuesta a la pregunta pendiente (JEP y Pichincha), asesor confundido con visita, distribución para una familia sin referencia a ofertas (dos repeticiones), baja citada como segunda solicitud y restricción temática interpretada como consulta financiera. Se corrigieron sus reglas generales y se hicieron las 12 nuevas inferencias indicadas arriba.

La reproducción posterior alimentó el ensamblado actual con todas las salidas guardadas de los diez lotes: **108/108 resultados normalizados cumplen el oráculo final**. Sus 116 solicitudes tienen el mismo texto y formato que las peticiones originales; no faltó ninguna salida para recuperación. Esto comprueba los controles actuales sobre esas respuestas conocidas, no equivale a 108 nuevas inferencias ni demuestra calidad universal del modelo.

**La salida original del modelo necesita controles.** Al evaluar las 108 primeras salidas contra el contrato actual, 68 cumplían el oráculo y 40 necesitaban normalización, descarte de señales o recuperación. Este criterio revisa campos y permisos de extracción; no es una puntuación de estilo del redactor. No se presenta el resultado normalizado como si todas las extracciones originales fueran perfectas. El consumidor utiliza la interpretación canónica y conserva la intención original y las razones del ajuste en el diagnóstico.

| Métrica de los diez lotes, incluidos los reensayos | Registro |
| --- | ---: |
| Escenarios distintos | 48 |
| Ejecuciones de extracción | 108 |
| Llamadas reales con uso disponible | 116 |
| Entrada total | 1.320.810 tokens |
| Entrada en caché, incluida dentro de la entrada total | 1.248.512 tokens (94,53 %) |
| Salida | 74.595 tokens |
| Costo calculado de los diez lotes | USD 0,2731224 |
| Costo medio por ejecución de extractor en esta muestra | USD 0,0025289 |
| Mediana de duración del extractor, incluidas sus recuperaciones | 7,406 s |

La caché alta influye en esta muestra; el costo medio no predice cada ejecución futura ni todo el bot. El modelo devuelto por la API fue gpt-4.1-mini-2025-04-14. El ensayo usa el prompt del repositorio y el ensamblado de producción, sin consultar el prompt editable de la base de datos, sin operaciones de CRM ni envío de mensajes. Los diez lotes terminaron con completed=true, todos sus registros previstos y stopped_reason=null. Los ensayos intermedios incompletos se excluyeron de la aceptación y permanecen en el registro de costos.

En el comparativo exploratorio de 42 escenarios por modelo, mini registró USD 0,1200748 y GPT-4.1 USD 0,9762600. Las primeras peticiones tenían el mismo texto, pero la caché de entrada fue aproximadamente 91,83 % frente a 49,11 %, hubo recuperaciones diferentes y cambió el tamaño de salida. La diferencia observada no se atribuye íntegramente al modelo ni se extrapola a todo el bot. La mediana fue 6,020 segundos con mini y 5,5365 segundos con GPT-4.1: el ensayo no acredita mayor velocidad con mini y corresponde a código anterior a las últimas correcciones.

Los cinco archivos de exploración y aceptación previa registran **231 llamadas y USD 2,1504752**. Los diez lotes posteriores añaden **116 llamadas y USD 0,2731224**: el total conocido de estos ensayos es **347 llamadas con uso registrado y USD 2,4235976**. La última fase anunciada con límite de USD 0,40 registra USD 0,3620784, incluido el ensayo parcial previo de USD 0,088956. Las reproducciones y pruebas locales cuestan cero créditos.

Estos importes se calculan sobre el uso informado por la API; **no son factura, saldo, gasto de toda la cuenta ni consumo desde la última recarga**. Entre las llamadas guardadas no falta uso, pero un proceso terminado antes de guardar una respuesta podría omitir una llamada: ese límite no se interpreta como gasto cero. La latencia sintética del extractor no incluye agrupación, cola, redactor, revisor, Kommo ni entrega a WhatsApp.

La [evidencia resumida](cambio-extractor-mini-2026-10-07-evidencia.json) conserva métricas, huellas de fuentes, resultados por escenario, alcance y límites. Las salidas sintéticas completas y los logs quedan localmente en tmp/extractor-model-batches, tmp/extractor-model-replay.json y tmp/extractor-validation-final.json.

## Reproducir la validación

`npm run test:extractor-model` ejecuta las regresiones locales con respuestas simuladas. `npm run test:conversation-regression` comprueba el recorrido comercial; esas suites comparten archivos y sus totales no se deben sumar. La cifra general de este informe corresponde al manifiesto deduplicado de 129 archivos.

`npm run eval:extractor-model -- --models gpt-4.1-mini --out tmp/extractor-dry.json` enumera los escenarios sin consultar OpenAI. Una inferencia real exige añadir explícitamente `--live`; consume créditos y debe indicar límites `--max-calls` y `--max-usd`. El evaluador guarda uso, costo calculado, salida original, salida normalizada, versión del modelo y huellas de las fuentes.

Una repetición de un fallo usa `--case ID --repeat 2`, y debe conservar su resultado original. Cambiar un oráculo para aceptar un permiso ajeno o ignorar una consulta perdida no constituye una corrección. La reproducción local posterior con salidas guardadas se informa por separado; no equivale a volver a consultar el modelo.

## Publicación y migraciones

Estas migraciones están preparadas en el repositorio y **no se han aplicado remotamente durante este trabajo**:

1. [20261006220000_transport_reliability.sql](../../supabase/migrations/20261006220000_transport_reliability.sql): contrato de transporte, secuencia de recepción, exclusión de recursos compartidos, mantenimiento independiente, admisión de llamadas a Kommo y conciliación de envíos.
2. [20261007013000_financing_active_lender_intake.sql](../../supabase/migrations/20261007013000_financing_active_lender_intake.sql): reemplazo completo de la función de recopilación financiera y comprobación de entidades activas. Conserva datos y consentimiento existentes.

Aplicarlas en ese orden, sobre un esquema compatible con las migraciones anteriores, antes de publicar código que dependa de las nuevas funciones. Revisar las definiciones desplegadas y verificar el contrato de transporte. La admisión de Kommo requiere lv_app_reserve_kommo_call: publicar primero el código con esa función ausente provoca un bloqueo previo a la llamada, no un envío confirmado. Las migraciones reemplazan funciones completas; no dependen de sustituir un fragmento de texto de una definición antigua.

Después de publicar, confirmar el modelo registrado de cada función y realizar una prueba con un contacto autorizado. Verificar pregunta siguiente, referencias a opciones, datos de perfil, entidades activas y estados de entrega. Si la calidad empeora, revertir sólo OPENAI_MODEL_EXTRACTOR a gpt-4.1 conserva las correcciones del servidor y el modelo del redactor. La comparación posterior debe controlar el historial, estado del lead, catálogo, prompt activo y caché; repetir el mismo mensaje por sí solo no produce la misma ejecución.

No se ha realizado despliegue, commit, push ni envío a leads como parte de esta preparación. La validación sintética y local quedó registrada; la prueba posterior al despliegue debe registrarse con el prompt activo, el modelo efectivo y el estado de entrega observado.
