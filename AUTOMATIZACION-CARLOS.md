# La Vilet — Especificación de la automatización

**Para:** Carlos

Esto no es una guía ni una sugerencia. Es lo que tiene que estar construido y funcionando antes de que entre el primer lead real. Cada punto tiene un criterio de cumplido: si no se puede demostrar con una query o una conversación en vivo, no está hecho.

---

## 0. Decisiones ya tomadas — no se discuten

Antes de escribir nada, esto ya está definido:

- **Fuente de verdad de los leads: Supabase.** Kommo es la vista para las vendedoras. Todo lead, toda conversación y todo cambio de estado se escribe primero en Supabase.
- **Estamos en etapa de LANZAMIENTO.** El bot capta datos y crea expectativa. No vende.
- **Un solo workflow en n8n con dos modos**, no dos workflows. Lo que cambia entre lanzamiento y venta es el prompt y las herramientas conectadas, no la estructura.
- **El tono es formal.** El bot representa a La Vilet.
- **Base: la automatización de KsiNuevos.** Se copia la estructura técnica, se reescribe la lógica comercial. Vendemos departamentos y suites, no vehículos.

---

## 1. La etapa vive en la base de datos

El estado del embudo se guarda en la tabla `leads`, no en la lógica del workflow.

Las 5 etapas son:

```
LANZAMIENTO → PRECALIFICACIÓN → NUTRICIÓN → PREVENTA → RESERVA/VENTA
```

**Debe cumplir:**
- Cada lead tiene su etapa guardada en una columna
- Si el lead deja de escribir y vuelve en 3 días, el bot retoma en la etapa donde iba
- Cada cambio de etapa queda registrado con fecha y motivo

**Se verifica con:**
```sql
select stage, count(*)
from leads
group by 1
order by 1;
```
Si todos los leads salen en la misma etapa, la automatización guarda pero no clasifica. No está cumplido.

---

## 2. Temperatura: puntaje, no criterio del bot

La temperatura no la decide el LLM "según le parezca". Es un puntaje acumulado con reglas fijas.

### Qué suma

| Acción del lead | Puntos |
|---|---|
| Responde el primer mensaje | +5 |
| Dice qué le interesa (depto / suite) | +10 |
| Dice si es para vivir o invertir | +10 |
| Pregunta por ubicación o características | +10 |
| Pregunta por fecha de entrega | +15 |
| **Pregunta por precio** | **+25** |
| **Pregunta por financiamiento** | **+30** |
| **Solicita visita o showroom** | **+40** |
| Pregunta cómo reservar | +40 |
| Responde una campaña de nutrición | +5 |

### Cortes

| Temperatura | Puntaje |
|---|---|
| 🔵 Frío | 0 – 24 |
| 🟡 Tibio | 25 – 59 |
| 🔴 Caliente | 60 o más |

### Decaimiento — obligatorio

Un lead que preguntó precio hace tres semanas y desapareció **no sigue caliente**.

- Sin interacción por 7 días: −10 puntos
- Sin interacción por 14 días: −20 adicionales
- Si cae de Caliente a Tibio, vuelve a nutrición automáticamente
- Nunca baja de 0

**Debe cumplir:**
- Cada cambio de temperatura se escribe en `lead_temperature_history` con el motivo que lo disparó
- El motivo dice qué pasó ("preguntó financiamiento"), no "actualizado"

**Se verifica con:**
```sql
select lead_id, from_temperature, to_temperature, reason, created_at
from lead_temperature_history
order by created_at desc
limit 20;
```
Motivo vacío o genérico = no cumplido.

---

## 3. Dónde termina el bot y empieza el vendedor

Esta es la regla más importante del sistema.

**El bot deja de responder y entrega el lead cuando:**
- El lead llega a Caliente (60+), **o**
- Pide hablar con un asesor, **o**
- Pregunta cómo reservar, **o**
- Solicita una visita

**Al entregarlo:**
- Se asigna a una de las dos vendedoras, alternando (una y una)
- La vendedora recibe la notificación con el resumen de la conversación y el motivo del traspaso
- El bot avisa al cliente que un asesor lo va a contactar, y se calla

**Fuera de horario:**
- El bot responde que un asesor lo contacta en horario de oficina
- El lead queda en cola y se asigna al abrir

**Si la vendedora no responde en 2 horas hábiles:**
- Se notifica al ADMIN
- Un lead caliente sin respuesta es el peor error posible del sistema

---

## 4. Lo que el bot NO puede decir — nunca

En lanzamiento el bot **no tiene conectadas** estas herramientas. No basta con instruirlo en el prompt: si la herramienta no está conectada, no la puede usar aunque el cliente insista.

- ❌ Precios de unidades
- ❌ Disponibilidad de unidades
- ❌ Reservas
- ❌ Fechas de entrega
- ❌ Descuentos, promociones o negociación
- ❌ Garantías o compromisos legales
- ❌ Condiciones de financiamiento concretas

**Y en ninguna etapa puede inventar.** Si no sabe, responde que un asesor lo confirma y sube el lead. Estamos vendiendo unidades sobre los $200.000 — una respuesta inventada es un problema comercial y legal, no un detalle.

**Se verifica en vivo:** yo le pregunto el precio al bot desde un número cualquiera y veo qué contesta.

---

## 5. Nutrición

Es la etapa más fácil de saltarse porque es la más aburrida de construir. Tiene que existir.

- Secuencia de 4 semanas, disparada por tiempo, no por mensaje del lead
- Semana 1: presentación del proyecto
- Semana 2: qué tendrá La Vilet
- Semana 3: avance de obra
- Semana 4: un espacio del proyecto
- Un lead que ya está en Preventa o entregado a vendedora **no recibe nutrición**
- Un lead que cae de Caliente a Tibio vuelve a entrar a la secuencia

**Dependencia que hay que resolver ya:** la nutrición fuera de la ventana de 24 horas de WhatsApp solo funciona con **plantillas aprobadas por Meta**. Si no están enviadas a aprobación, la nutrición no existe por más que el workflow esté bien. Esto se gestiona esta semana.

---

## 6. Datos que se guardan sí o sí

- **Origen del lead** (Facebook, Instagram, WhatsApp directo, Google Ads, campaña específica). Sin esto no sabemos qué campaña de Pablo funcionó y el presupuesto de Ads es gasto ciego.
- **Consentimiento de seguimiento.** El lead aceptó recibir novedades, con fecha. Y la salida ("no quiero más mensajes") tiene que funcionar y quedar registrada.
- **Interés declarado** (departamento / suite) en `lead_units`.
- **Uso previsto**: vivienda o inversión. Es la variable que más define el discurso comercial.

### Duplicados

El mismo teléfono que entra por Facebook y por WhatsApp es **un solo lead**, no dos. La deduplicación es por número. Si esto no está resuelto, el conteo de leads no sirve desde la primera semana.

---

## 7. El prompt vive en la base

- El texto del agente se lee de `agent_prompts`, no está escrito dentro de un nodo de n8n
- Cambiar el tono debe ser un `UPDATE`, no abrir el workflow
- Se usa `valid_from` / `valid_until` para que el cambio de lanzamiento a preventa sea una fecha, no una reescritura

---

## 8. Que no se caiga

- Si el LLM falla o no responde, el lead **no puede quedar en silencio**. Respuesta de respaldo y notificación.
- Todo mensaje entrante se guarda antes de procesarse. Si algo falla después, el lead no se pierde.
- Número de pruebas separado. No se prueba con leads reales.

---

## 9. Qué tengo que poder ver yo

Un tablero o una query, me da igual, pero semanal:

- Leads nuevos por origen
- Leads por etapa
- Leads por temperatura
- Cuántos llegaron a Caliente
- Cuántos se entregaron a vendedora
- Cuántos agendaron visita
- Tiempo promedio de respuesta de las vendedoras

Sin esto no sabemos si el sistema sirve.

---

## Entrega

Cuando esté listo, la demostración es así: agarras un número de prueba y haces el recorrido completo delante mío — entra frío, dice qué le interesa, pregunta precio, pide visita. Y al terminar abrimos Supabase y vemos las filas que se crearon solas en `leads`, `lead_units`, `lead_temperature_history` y `appointments`.

**Si el flujo de conversación funciona pero las tablas están vacías o con una sola etapa: se construyó el chat, no el embudo.** Es la mitad del trabajo, y es la mitad que se ve.
