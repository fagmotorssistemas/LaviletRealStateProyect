# Evaluación del clasificador de alcance

El clasificador conserva `gpt-4o-mini` por defecto. Solo devuelve alcance,
certeza y evidencia; el redactor genera el texto. Una exclusión incierta puede
resolverse usando la extracción del mismo turno, sin otra llamada de IA.
La evidencia confirmada de un negocio ajeno sigue bloqueando acciones inmobiliarias.

## Regresiones locales, sin consumo de API

```text
node --test scripts/business-scope.test.cjs
node --test --test-name-pattern="scope|mixed|unrelated business|bare first price" scripts/integrations.test.cjs
```

Estas pruebas reproducen salidas equivocadas observadas y verifican la reacción
del sistema. Incluyen `PRECIO`, `preico`, `departametnos`, incertidumbre con
extracción válida, servicios ajenos, solicitudes mixtas y referencias de precio
arrastradas del historial. No miden la precisión real de ningún modelo.

## Comparación de modelos antes de cambiar producción

1. Preparar un conjunto anonimizado de turnos registrados: mensaje, historial,
   límite previo y resultado esperado revisado por una persona. Incluir casos
   inmobiliarios, ajenos, mixtos y ambiguos, además de faltas ortográficas y cambios
   de tema. Separar casos de evaluación de los usados para ajustar el prompt.
2. Reproducir exactamente el mismo JSON, instrucciones y esquema con cada modelo
   candidato —por ejemplo, el mini actual y un modelo alternativo autorizado—
   en un ejecutor aislado, sin webhooks, CRM, acciones ni envíos. Registrar la
   versión del prompt, el modelo y sus parámetros. Las llamadas reales consumen
   API; no forman parte de las pruebas locales anteriores.
3. Medir por separado la clasificación original y la decisión reconciliada:
   exclusiones inmobiliarias incorrectas, solicitudes ajenas admitidas, fragmentos
   mixtos mal separados y solicitudes que quedan inciertas. Registrar también
   tokens de entrada/salida, costo total y latencias mediana y percentil 95.
4. Comparar el costo por turno resuelto, incluyendo reparaciones y llamadas
   posteriores. Un menor precio por token no garantiza menor costo de una
   conversación completa. No interpretar un único acierto como una tasa de calidad.
5. Cambiar `OPENAI_MODEL_SCOPE` solo tras revisar los resultados y probar el
   candidato en un entorno de prueba. El extractor y el redactor conservan su
   configuración independiente; no hace falta cambiar todos los roles juntos.

Los campos `scope`, `confidence`, `reason` y `outside_evidence` en la traza muestran
la decisión; `scope_reconciliation` registra cuando la extracción resuelve una
incertidumbre. Las salidas antiguas pueden contener `reply`, pero ese campo ya
no se utiliza como mensaje para el lead.

## Revisor focalizado: contrato y evaluación

El contrato `focused-review-v1` asigna al revisor IA tres responsabilidades:

1. Contrastar hechos y políticas del negocio con sus fuentes.
2. Contrastar promesas y gestiones comerciales con resultados operativos.
3. Comprobar las obligaciones de la etapa comercial vigente.

El redactor conserva el estilo, la explicación y la continuación de la conversación.
El extractor conserva la interpretación del perfil. Reconocer el nombre o la
residencia declarados no equivale a confirmar una cita o reserva. Las obligaciones
de pedir nombre, residencia, ofrecer el brochure y evitar tipos de inmuebles en
la presentación inicial permanecen activas cuando corresponden a esa etapa.

El sistema compara cantidades, unidades, atributos, relaciones y fuentes exactas.
No acepta redondeos ni una tolerancia numérica. La IA determina qué significa
cada expresión numérica: dato comercial, identificador de unidad, dato del lead,
orientación general o uso sin cantidad. El código enumera las referencias y
comprueba sus enlaces y cantidades; no interpreta estilo mediante palabras clave.
Una afirmación narrativa no sustituye la extracción de un precio, superficie o
planta. Los rangos del conjunto se distinguen de afirmaciones sobre cada unidad.

Se retiraron del nuevo contrato las cinco puntuaciones globales de calidad, el
veto `factual_inventory_complete`, la segunda ficha de preguntas y el inventario
duplicado de solicitudes. El tono del redactor no se añade al prompt de revisión.
Las trazas históricas conservan su lectura compatible.

Una revisión incompleta permanece pendiente; no significa que el mensaje sea falso
ni autoriza su envío. Se permite una reparación de la ficha, acotada a los hechos
o las obligaciones afectados, conservando las comprobaciones restantes. Eliminar
una afirmación previa exige una decisión explícita de la IA. La corrección de un
borrador tiene un intento; si devuelve exactamente el mismo texto rechazado, no
se vuelve a sortear otra aprobación. La interfaz muestra el responsable del fallo
y de su reparación, los borradores y los motivos de cada decisión.

El revisor predeterminado es `gpt-5-mini` con razonamiento `low`.
`OPENAI_MODEL_REVIEWER` permite cambiar solo ese rol y
`OPENAI_REVIEW_REASONING_EFFORT` controla su esfuerzo en esa familia de modelos.
El clasificador conserva su configuración independiente. La traza registra
modelo, esfuerzo, consumo y presupuesto; los tokens de razonamiento ya forman
parte de los tokens de salida y no se suman dos veces.

Las evaluaciones aisladas no acceden a la base de datos ni envían mensajes:

```text
npm run test:review-contracts
npm run test:message-trace
npm run eval:review -- --out tmp/review-dry.json
npm run eval:review -- --live --repeat 1 --max-calls 75 --max-usd 0.75 --out tmp/review-live.json
```

`--live` consume API. Por defecto utiliza borradores fijos etiquetados y llamadas
reales al revisor a través de la misma función de revisión del producto. Comprueba
la fidelidad de las fuentes y atributos, además de la aceptación o rechazo. El
modo `--live-writer` requiere seleccionar explícitamente casos compatibles y
también llama al redactor, con el tono predeterminado de las pruebas. No sustituye
una prueba del webhook completo o del despliegue. La latencia de transporte del
evaluador tiene un límite distinto al de producción; no se debe extrapolar como
latencia de WhatsApp. Los resultados miden este conjunto, no garantizan ausencia
de errores de interpretación en conversaciones nuevas.

### Resultado medido el 1 de octubre de 2026

Con `gpt-5-mini` y esfuerzo `low`, la batería final de 22 borradores etiquetados
obtuvo 22 resultados correctos, incluyendo tres casos adicionales que no se
utilizaron para ajustar el prompt. Se aceptaron las respuestas respaldadas y se
bloquearon datos redondeados, precios y plantas incorrectos, generalizaciones de
rangos, gestiones no realizadas, políticas sin fuente y ofertas fuera del proyecto.
Los criterios de aceptación comprobaron también las fuentes y atributos extraídos.

Fueron 28 llamadas de revisión, 257.176 tokens totales y un coste estimado de
USD 0,1206743 para el conjunto: aproximadamente USD 0,0055 por turno evaluado,
incluyendo las reparaciones del revisor. No es el coste de toda la automatización.

En tres pruebas separadas con redactor real GPT-4.1 y revisor GPT-5 mini se
aprobaron las tres respuestas generadas: presentación inicial, precio de penthouse
y orientación a una familia de seis personas. Su coste combinado fue USD 0,0811635
(aproximadamente USD 0,0271 por caso). Se inspeccionaron los textos y sus hechos;
esa prueba no usa las expectativas de texto fijo. No incluye clasificador,
extractor, consultas reales al CRM ni transporte de WhatsApp.

Las iteraciones anteriores descubrieron rechazos falsos, aprobaciones con fichas
numéricas vacías y salidas truncadas; se conservaron como evidencia de diagnóstico,
no se contabilizan como aciertos finales. El presupuesto se ajustó a la salida
requerida y se redujeron las explicaciones duplicadas. El límite de tokens es un
máximo de generación, no un consumo que se facture íntegramente por reservarlo.
Las tarifas estimadas tienen su versión y fuente en cada reporte; el uso real y
el estado de la caché modifican el coste de cada turno.

La última protección de conservación de comprobaciones pendientes se añadió
después de la matriz de 22 casos. Tras incorporarla, se repitieron cuatro casos
con IA real (4/4 correctos) y se comprobaron sus invariantes con pruebas locales.
El conjunto de contratos pasó 308/308 pruebas; la interfaz 59/59 y las pruebas
de presentación inicial 142/142. No se deben sumar esas suites como casos únicos,
porque algunas comparten pruebas.

Los resultados por caso, costes y hashes están en
[review-evaluation-2026-10-01.json](review-evaluation-2026-10-01.json).
Los reportes completos y las iteraciones de diagnóstico se conservan localmente
en `tmp/review-evaluations/`, fuera de los archivos de despliegue.
