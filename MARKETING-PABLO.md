# La Vilet — Marketing, Meta, CAPI y Atribución

**Para:** Pablo

Esto es lo que tiene que estar hecho y funcionando. Cada punto tiene un criterio de cumplido: si no se puede demostrar en pantalla con un evento llegando o un lead entrando, no está hecho.

---

## 0. Contexto — dónde estamos parados

- La Vilet está en **etapa de lanzamiento**. El edificio está en construcción.
- El objetivo de esta etapa **no es vender**. Es crear expectativa y construir base de interesados.
- El tono de toda la comunicación es **formal**. La Vilet es un producto sobre los $200.000, no un clasificado.
- **Ningún anuncio, publicación o mensaje puede mencionar precios, disponibilidad ni fechas de entrega.** Eso todavía no está definido y comprometerlo públicamente es un problema comercial.

### Reparto de responsabilidades

| Pablo | Carlos |
|---|---|
| Redes, contenido, posicionamiento | Conversación del bot |
| Business Manager, Pixel, CAPI | Clasificación y temperatura |
| **Mini backend de atribución** | Traspaso a vendedora |
| **Captura del click (WhatsApp y página)** | Kommo, n8n, WhatsApp API |
| Envío de eventos calificados a Meta | |

**Carlos no toca atribución. Pablo no toca la lógica de conversación.** El único punto de contacto es la base de datos: Carlos mantiene la temperatura del lead, Pablo la lee para decidir qué mandar a Meta.

---

## 1. Redes sociales

Crear y dejar configuradas:

- [ ] Página de Facebook
- [ ] Instagram (vinculado al Business Manager)
- [ ] TikTok

Cada una con:
- [ ] Nombre de usuario reservado y consistente en las tres plataformas
- [ ] Foto de perfil y portada
- [ ] Descripción del proyecto
- [ ] Datos de contacto y ubicación
- [ ] Botón / enlace a WhatsApp — al número de La Vilet

**Cumplido cuando:** las tres cuentas existen, están vinculadas al Business Manager, y el botón de WhatsApp abre conversación al número correcto.

---

## 2. Documento de posicionamiento

Esto no es "hacer posicionamiento". El entregable es un documento con estos puntos resueltos:

- [ ] Identidad y nombre — cómo se escribe La Vilet, siempre igual
- [ ] Descripción del proyecto en una frase
- [ ] Público objetivo, separado entre **vivienda** e **inversión** (son dos discursos distintos)
- [ ] Propuesta de valor — qué tiene La Vilet que el resto del sector no
- [ ] Qué se comunica en lanzamiento y qué se guarda para preventa
- [ ] Plan de contenido de las primeras 4 semanas

**Insumo que te doy yo:** ya tenemos el análisis de mercado con 42 unidades verificadas de 6 proyectos de la zona. La Vilet está 29% sobre el promedio real, y eso se sostiene con piscina, gimnasio, seguridad 24h y áreas comunales — exactamente lo que Ager II, Kira II y Samaní no tienen. **Ese es el eje del posicionamiento.** No inventes uno nuevo.

---

## 3. Business Manager y activos

- [ ] Business Manager con los accesos correctos
- [ ] Página, Instagram y cuenta publicitaria dentro del mismo Business Manager
- [ ] Pixel / Dataset **propio de La Vilet** — no reutilizado de KsiNuevos
- [ ] Events Manager configurado
- [ ] Token de acceso de CAPI generado y guardado de forma segura

---

## 4. Atribución — el mini backend

Esta es la parte central de tu trabajo y la que más consecuencias tiene si sale mal.

### La idea

```
Click en anuncio
   ↓
Se guarda el identificador del click en NUESTRA base
   ↓
El lead conversa y se califica (esto lo maneja Carlos)
   ↓
Cuando llega a Tibio o Caliente
   ↓
Tu backend → CAPI → Meta
   ↓
Meta aprende a traer gente que se vuelve caliente
```

**Por qué así:** si le mandas a Meta todos los leads, Meta te trae volumen. Si le mandas solo los que califican, Meta aprende a traerte gente que compra. Es la diferencia entre 200 curiosos y 20 interesados reales.

### Dos orígenes, los dos son tuyos

**A) Click-to-WhatsApp**
El identificador es el `ctwa_clid`. Llega dentro del payload del primer mensaje de WhatsApp, en el bloque de referral, junto con el `source_id` del anuncio. **Solo viene en el primer mensaje** — si no se captura ahí, se pierde y no se recupera.

**B) Anuncio → página propia → WhatsApp**
El identificador es el `fbclid` de la URL, más las cookies `_fbp` y `_fbc` que deja el Pixel.

Los dos casos son tuyos. La tabla de atribución tiene que soportar ambos, con un campo que indique por dónde entró.

### Regla que no se negocia

**Tu backend NUNCA crea leads.** Solo escribe atribución contra un lead que ya existe, enlazado por número de teléfono.

Si llega la atribución y el lead todavía no existe, se guarda en espera y se enlaza cuando aparezca. Si tu backend crea leads por su cuenta, vamos a terminar con el mismo cliente duplicado y el conteo no sirve desde la primera semana.

### Estructura

Una tabla `lead_attribution` relacionada 1:1 con `leads` por `lead_id`:

- `ctwa_clid` / `fbclid` / `_fbp` / `_fbc`
- `source_id` — qué anuncio
- `source_type` — WhatsApp o página
- `campaign` — qué campaña
- `captured_at`
- `sent_to_meta_at` — **si tiene fecha, no se vuelve a enviar nunca**

---

## 5. Qué se manda a Meta y cuándo

### Eventos

| Evento | Cuándo |
|---|---|
| `Lead` | Se registra el lead |
| `LeadTibio` | El lead cruza a temperatura tibia |
| `LeadCaliente` | El lead cruza a temperatura caliente |

Dos eventos separados para tibio y caliente, para que puedas decidir en la campaña hacia cuál optimizar sin tocar el backend. Arrancamos optimizando hacia tibio: con solo calientes no llegamos a los ~50 eventos semanales que Meta necesita para salir de fase de aprendizaje.

### Un solo envío por lead

Es el mismo cliente. Se manda **una vez**, con el estado más alto que alcanzó. Si el lead sube y baja de temperatura tres veces, no puede generar seis eventos.

Eso lo controla el campo `sent_to_meta_at`. Con fecha puesta, no se reenvía.

### Requisitos técnicos

- [ ] Los eventos llevan `event_id` para deduplicación con el Pixel. Sin esto Meta cuenta doble y el costo por lead que veas va a estar mal.
- [ ] Teléfono y email van hasheados
- [ ] Se ve la calidad de coincidencia en Events Manager

**Cumplido cuando:** hacemos una prueba en vivo con la herramienta de eventos de prueba de Meta y el evento aparece en pantalla.

---

## 6. Lo que tienes que investigar y confirmar

No lo des por hecho — verifícalo contra la documentación de Meta y me dices qué encontraste:

- [ ] Si un click puede llegar a Kommo y a tu backend en paralelo, o si hace falta un intermediario
- [ ] En qué formato exacto llega el `ctwa_clid` y cuánto tiempo es válido para atribución
- [ ] Si conviene Click-to-WhatsApp o landing propia, y si podemos correr las dos para comparar

Sobre lo último, mi lectura: para inmobiliario de $200k+ la **landing propia** tiene ventaja, porque la persona ve renders, ubicación y amenidades antes de escribir, y eso filtra mejor. Pero CTWA tiene menos fricción y mejor tasa de contacto. Corramos las dos y comparemos cuál trae leads que se ponen calientes — para eso la atribución tiene que soportar ambos formatos desde el inicio.

---

## 7. Google

- [ ] Ficha de Google Business con ubicación exacta del proyecto, fotos y contacto
- [ ] Google Ads: cuenta creada y vinculada, **sin campañas activas todavía**

---

## 8. Contenido de lanzamiento

- [ ] Video de expectativa — sin precios, sin fechas, sin unidades
- [ ] Piezas de las primeras 4 semanas, alineadas con la secuencia de nutrición de Carlos (presentación → qué tendrá → avance de obra → un espacio del proyecto)
- [ ] Brochure digital que el bot pueda enviar

Lo que publiques y lo que mande el bot tienen que decir lo mismo. Si el anuncio promete algo que el bot no puede responder, el lead se cae ahí.

---

## 9. Lo que tengo que poder ver yo

Semanal, sin que te lo pida:

- Leads por campaña y por origen
- Costo por lead
- **Costo por lead caliente** — esta es la métrica que importa
- Calidad de coincidencia de eventos en Meta
- Alcance e interacción por red
- Qué contenido funcionó y qué no

---

## Orden de ejecución

1. Redes creadas y vinculadas al Business Manager
2. Pixel, Dataset y token de CAPI listos
3. Documento de posicionamiento
4. Backend de atribución funcionando y probado con un click real
5. Recién ahí, contenido y presupuesto

**No se enciende presupuesto publicitario antes del paso 4.** El identificador del click solo se captura en el momento — todo lead que entre antes de que la atribución funcione es un lead que Meta nunca va a poder usar para optimizar. Ese dato no se recupera después.
