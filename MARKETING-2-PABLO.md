# La Vilet — Atribución, CAPI y Reporte

**Para:** Pablo
**Alcance:** puntos 4, 5 y 9 del documento general. Lo demás ya está.

Lo que falta es el backend. Y son **dos caminos**, no uno.

---

## 1. La regla que ordena todo el diseño

Tu backend **nunca crea leads**. Solo escribe atribución contra un lead que ya existe, enlazado por número de teléfono.

Si llega la atribución y el lead todavía no existe, se guarda en espera y se enlaza cuando aparezca. Si el backend crea leads por su cuenta, el mismo cliente queda duplicado y el conteo no sirve desde la primera semana.

Punto de contacto único con Carlos: la base de datos. Carlos mantiene la temperatura del lead, tú la lees para decidir qué mandar a Meta. Nada más.

---

## 2. Los dos caminos

Son dos ramas distintas. Comparten la tabla de destino, pero **capturan cosas diferentes, en momentos diferentes, y van a datasets diferentes**. No las mezcles.

### Rama A — Click-to-WhatsApp (CTWA)

```
Anuncio CTWA → WhatsApp → primer mensaje trae referral.ctwa_clid
   ↓
Webhook de WhatsApp guarda el clic contra el teléfono
   ↓
Carlos califica → Tibio / Caliente
   ↓
Backend cruza por teléfono → CAPI → Dataset del WABA
```

Lo que capturas: `ctwa_clid` + `source_id` del anuncio, dentro del bloque `referral` del primer mensaje.

**Solo viene en el primer mensaje.** Si no se captura ahí, se pierde y Meta no lo vuelve a dar. Por eso el webhook tiene que estar vivo y respondiendo 200 **antes** de encender un solo dólar de presupuesto.

Qué necesitas:
- [ ] Webhook `GET` que responda el challenge con el verify token
- [ ] Webhook `POST` que responda **200 inmediato** y procese después
- [ ] Upsert del clic con PK = teléfono
- [ ] Vencimiento del clic a 28 días
- [ ] El evento va al **dataset del WABA**, no al Pixel

### Rama B — Anuncio → landing propia → WhatsApp

```
Anuncio → landing de La Vilet (URL con fbclid, Pixel deja _fbp y _fbc)
   ↓
La persona toca el botón de WhatsApp
   ↓
Se guarda fbclid/_fbp/_fbc contra el teléfono o contra la sesión
   ↓
Carlos califica → Tibio / Caliente
   ↓
Backend → CAPI → Pixel / Dataset web
```

Lo que capturas: `fbclid` de la URL, más las cookies `_fbp` y `_fbc` que deja el Pixel.

El punto frágil acá es distinto al de la rama A: el `fbclid` lo tienes al llegar a la landing, pero el **teléfono** recién lo tienes cuando la persona escribe. Necesitas un puente entre la sesión web y el teléfono. Resuélvelo antes de codear: o el botón de WhatsApp lleva un texto prellenado con un código de sesión, o guardas la sesión y la enlazas después. Dime cuál eliges y por qué.

### La diferencia que se olvida y rompe todo

**Son dos datasets.** CTWA va al dataset del WABA. La landing va al Pixel web. Si mandas el evento de WhatsApp al Pixel, Ads no atribuye — y no lo vas a notar hasta que el reporte esté vacío.

---

## 3. Estructura de datos

Tabla `lead_attribution`, relación 1:1 con `leads` por `lead_id`:

| Campo | Para qué |
|---|---|
| `lead_id` | Enlace al lead que ya existe |
| `phone` | Dígitos, con país (`5939…`). Único criterio de cruce |
| `source_type` | `whatsapp` o `web` — qué rama |
| `ctwa_clid` | Rama A |
| `fbclid` / `_fbp` / `_fbc` | Rama B |
| `source_id` | Qué anuncio |
| `campaign` | Qué campaña |
| `captured_at` | Cuándo entró el clic |
| `expires_at` | 28 días desde la captura |
| `sent_to_meta_at` | **Con fecha puesta, no se reenvía nunca** |
| `event_id` | El que se mandó, para deduplicar |

Y una tabla de log de envíos: `pending → sent / failed`, guardando la respuesta de Meta. Sin log no vas a poder depurar nada.

**Un solo criterio de teléfono en todo el sistema.** WhatsApp manda `5939…`. Si Kommo guarda `09…`, se normaliza a `593…` antes de comparar. Esa es la única comparación lead ↔ clic; si no coincide, no matchea nada.

---

## 4. Qué se manda a Meta y cuándo

| Evento | Cuándo |
|---|---|
| `Lead` | Se registra el lead |
| `LeadTibio` | El lead cruza a temperatura tibia |
| `LeadCaliente` | El lead cruza a temperatura caliente |

Dos eventos separados para tibio y caliente, para poder cambiar hacia cuál optimiza la campaña sin tocar el backend.

Arrancamos optimizando hacia **tibio**: con solo calientes no llegamos a los ~50 eventos semanales que Meta necesita para salir de fase de aprendizaje.

### Un solo envío por lead

Es el mismo cliente. Se manda **una vez**, con el estado más alto que alcanzó. Si el lead sube y baja de temperatura tres veces, no puede generar seis eventos. Eso lo controla `sent_to_meta_at`.

### Requisitos del payload

- [ ] Teléfono, email y nombre en **SHA-256**, nunca en claro
- [ ] `event_id` único por lead, generado en un solo lugar (no lo reinventes en el envío)
- [ ] Si hay clic CTWA: `ctwa_clid` + `action_source: business_messaging` + `messaging_channel: whatsapp` + el ID del WABA
- [ ] Si es rama web: `fbclid` / `_fbp` / `_fbc` y el `action_source` que corresponda
- [ ] Si no hay clic de ningún tipo: se manda igual, pero sin identificador — la atribución queda floja
- [ ] Deduplicación con el Pixel vía `event_id`. Sin esto Meta cuenta doble y el costo por lead que veas va a estar mal

**Decisión pendiente para ti:** los leads que llegan **sin** clic de anuncio, ¿los mandamos o no? Me dices tu criterio y lo cerramos.

---

## 5. Orden de ejecución

Cada paso se prueba antes de seguir.

1. Dataset del WABA y Pixel web identificados por separado, token guardado
2. Webhook CTWA verificado y respondiendo — **prueba: un clic real deja una fila**
3. Tabla `lead_attribution` + log + normalización de teléfono
4. Captura de la rama web (`fbclid` + puente sesión↔teléfono)
5. Endpoint que cruza por teléfono y pega a Graph
6. Prueba en vivo con la herramienta de eventos de prueba de Meta

**Cumplido cuando:** hacemos la prueba en vivo juntos y el evento aparece en pantalla en Events Manager, con calidad de coincidencia visible. No antes.

**No se enciende presupuesto publicitario antes del paso 6.** El identificador del clic solo se captura en el momento — todo lead que entre antes de que la atribución funcione es un lead que Meta nunca va a poder usar para optimizar. Ese dato no se recupera después.

---

## 6. Cómo se prueba todo esto sin campañas activas

Casi todo se valida sin gastar un dólar. No esperes a tener campañas para construir.

### Se puede probar sin campaña

| Qué | Cómo |
|---|---|
| Webhook de WhatsApp | Escribe al número desde tu celular. Verifica que llegue el payload, que respondas 200 y que hagas el upsert. Lo único que no vendrá es el bloque `referral` — ese solo aparece si el mensaje nació de un anuncio |
| Payload de CAPI | Con la **herramienta de eventos de prueba** de Meta (Test Events, en Events Manager). Mandas eventos a mano con `test_event_code` y los ves aparecer en segundos. Valida hash, `event_id`, `value`, dataset correcto y calidad de coincidencia |
| Cruce por teléfono | Inserta a mano una fila de atribución con un `ctwa_clid` inventado, luego mueve un lead a tibio. Si dispara y arma el evento, la lógica está |
| Rama web | Entra a la landing con `?fbclid=loquesea` pegado a mano en la URL. Verifica que se capture y que el Pixel deje `_fbp` y `_fbc` |
| Deduplicación | Dispara el mismo lead dos veces y confirma que el segundo no sale |

### Lo único que necesita campaña real

Que el `ctwa_clid` llegue de verdad dentro del `referral`: formato real, campaña real, `source_id` real. Eso no se simula.

**Cómo se resuelve:** una campaña CTWA mínima, con el presupuesto más bajo que Meta permita, corriendo un día. Haces clic tú mismo en tu propio anuncio, escribes, y confirmas que la fila cae con el `clid` real. Cuesta unos pocos dólares y es la única prueba que no tiene sustituto.

### Orden

1. Todo lo de la tabla de arriba, verificado con Test Events y datos inyectados a mano
2. Campaña de prueba de $1–3 para confirmar el `referral` real
3. Recién ahí, presupuesto de verdad

Lo que no puede pasar es lo contrario: encender campaña con tráfico real antes de que el webhook capture. Esos leads entran sin `clid` y Meta nunca los va a poder usar para optimizar.

---

## 7. Lo que tienes que investigar y confirmarme

Contra la documentación de Meta, no de memoria:

- [ ] Si un clic puede llegar a Kommo y a tu backend en paralelo, o si hace falta un intermediario
- [ ] Formato exacto del `ctwa_clid` y cuánto tiempo es válido para atribución
- [ ] Cómo se comporta el `fbclid` cuando el usuario pasa de la landing a WhatsApp — qué se pierde en el salto

Mi lectura, para que la contrastes: para inmobiliario de $200k+ la **landing propia** tiene ventaja, porque la persona ve renders, ubicación y amenidades antes de escribir, y eso filtra mejor. Pero CTWA tiene menos fricción y mejor tasa de contacto. Corremos las dos y comparamos cuál trae leads que se ponen calientes. Por eso la atribución soporta ambos formatos desde el inicio.

---

## 8. Lo que tengo que poder ver yo

Semanal, sin que te lo pida:

- Leads por campaña y por origen, separando rama A y rama B
- Costo por lead
- **Costo por lead caliente** — esta es la métrica que importa
- Calidad de coincidencia de eventos en Events Manager
- Cuántos eventos salieron `sent` y cuántos `failed`, y por qué fallaron
- Alcance e interacción por red, y qué contenido funcionó

---

## Checklist mental

- [ ] Dataset del WABA ≠ Pixel web, los dos identificados
- [ ] Token de System User guardado
- [ ] Webhook CTWA vivo y capturando el `ctwa_clid` del primer mensaje
- [ ] Captura de `fbclid` / `_fbp` / `_fbc` en la landing, con puente al teléfono
- [ ] Teléfono normalizado igual en los dos lados
- [ ] `lead_attribution` 1:1 con `leads`, sin crear leads nunca
- [ ] Hash + `event_id` + un solo envío por lead
- [ ] Prueba en vivo aprobada antes de encender presupuesto

Lo más frágil de todo esto no es el backend: es **teléfono igual, dataset correcto y webhook que capture el clic**. Si esas tres están, el resto es trabajo mecánico.
