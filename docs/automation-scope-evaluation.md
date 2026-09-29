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
