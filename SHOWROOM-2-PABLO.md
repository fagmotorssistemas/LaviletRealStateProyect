# La Vilet — Seguimiento y captación de leads
**Para: Pablo**
**Entrega: 04-09-2026**

## La Vilet — Criterios de trabajo

### El punto de partida

Cumplir la tarea no es el estándar. Que el código corra y la pantalla se vea bien quiere decir que terminaste de escribirlo, no que esté bien resuelto.

La revisión la haces tú, antes que nadie. No que alguien más te encuentre lo que falla: que lo encuentres tú.

Cuando termines algo, párate encima y búscale el error. Qué no es lógico, qué se va a caer, qué hiciste rápido porque funcionaba. Si no le encuentras nada, no lo buscaste — siempre hay algo.

Eso es lo que quiero que se vuelva costumbre. Lo demás de este documento son los lugares donde suele estar.

---

## Casos vacíos

Una unidad sin renders cargados. Una tipología sin precio. Un acabado que existe en la tabla pero no tiene imagen.

Va a pasar seguido, sobre todo mientras el arquitecto entrega por partes. Que la pantalla resuelva el vacío sola, sin quedarse en blanco ni tirar error.

## Móvil real

Por ahí va a entrar casi todo el tráfico. Probarlo con datos móviles y no con wifi cambia bastante el resultado, sobre todo con panorámicas de 4096 px o más.

Si en tu máquina vuela y en el celular tarda quince segundos, el que manda es el celular.

## Escala

Hoy son dos o tres imágenes de prueba. Cuando estén los renders reales son seis tipologías por varios ambientes, por dos acabados, por dos luces. Cientos de archivos.

Lo que se resuelve a mano ahora, después no se puede.

## Las decisiones que quedan escondidas

En cada pieza hay una o dos decisiones que se toman rápido y después cuestan caro: cómo se nombran los archivos, cómo se pide una variante, dónde vive el estado de la unidad.

Anótalas mientras las tomas, con el motivo. A la semana nadie se acuerda de por qué se hizo así, y ahí es cuando se rompe.

## Lo que no termina de cuadrar

Cuando algo te deje con la sensación de que hay una forma mejor, dilo aunque funcione. Esa sensación casi siempre tiene razón.

Prefiero que llegues con algo a medias y tres dudas buenas, que con algo completo y ninguna. Lo segundo casi nunca es que esté todo bien; es que no se revisó.

---

Lo que estás armando sostiene lo que viene después: el tracking, los leads, la preventa. El código se corrige en una tarde. Un modelo mal planteado obliga a rehacer y a perder lo que ya se acumuló.

Esta es la parte que quedó fuera del documento anterior. Ya tienes el visor andando y las tablas de inventario ordenadas, así que ahora toca lo que convierte el recorrido en una herramienta de venta y no en una demo bonita.

Igual que la vez pasada: esto es por dónde arrancar, no un instructivo cerrado. Si encuentras algo mejor, dilo.

---

## Qué es y qué no es

El showroom hoy no deja rastro. Alguien entra desde Instagram, pasa cuatro minutos en la tipología B, se va, y no nos enteramos de nada.

Lo que tiene que poder hacer el sistema:

- Reconocer al mismo visitante aunque vuelva días después, sin que se haya identificado
- Saber en qué tipología y en qué ambiente estuvo, y cuánto tiempo
- Pedirle los datos en el momento correcto, no al entrar
- Cuando por fin deja los datos, **recuperar todo lo que hizo antes**
- Saber de dónde vino: canal, campaña, dispositivo, ciudad, y qué vendedor lo trajo

Lo que no es: Google Analytics. GA te dice cuánta gente entró. Esto tiene que decirnos *quién* es Juan, *qué* miró y *cuándo* lo llamamos.

---

## El orden importa

Va en este orden y no en otro, porque cada pieza desbloquea la siguiente. Si te trabas en la tres, quiero la uno y la dos terminadas igual.

### 1. Identificar al visitante

Cookie generada **desde el servidor**, en el middleware de Next.js, no desde JavaScript.

Esto no es capricho. Safari borra a los siete días las cookies escritas por JS. Nuestra secuencia de seguimiento dura más de un mes, así que con la versión fácil perdemos a la mitad de los que vuelven. Desde el middleware la cookie nace en el primer request y aguanta.

Espejo en `localStorage` como respaldo, pero la fuente de verdad es la cookie de servidor.

### 2. Guardar de dónde vino

Tabla `sesiones`, una fila por sesión, no por evento. Lo que hay que capturar:

**Origen:** UTM (source, medium, campaign), referrer real, landing page.
**Vendedor:** un parámetro tipo `lavilett.com/?b=juan` guardado aparte. Así sabemos qué leads trajo cada vendedora y cada aliado, y nadie discute comisiones después.
**Dispositivo:** móvil / escritorio / tablet, sistema, ancho de pantalla.
**Ubicación:** ciudad y país. **Ciudad, no IP completa.** Guardar IPs nos mete en un problema de protección de datos y para lo que necesitamos no aporta nada.

Estamos en Vercel, así que la geo te llega ya resuelta en el request. No instales nada.

**Un detalle que se pasa por alto:** el `utm_source` de la **primera** sesión hay que copiarlo al lead y no volver a tocarlo. Si guardas el de la última, Google se va a llevar el crédito de leads que trajo Instagram y vamos a tomar decisiones de pauta con datos falsos.

### 3. Eventos del recorrido

Instrumentar el visor que ya tienes. Como mínimo: entrada y salida de escena, con tipología, ambiente y duración en segundos.

Para detectar la salida usa `visibilitychange`, no `beforeunload`. En móvil el segundo no dispara de forma confiable y el móvil es por donde va a entrar casi todo el tráfico.

Con esto sabemos que la gente se queda cuarenta segundos en la cocina y ocho en el baño. Eso nos dice dónde poner mejor render, y es un dato que hoy no tiene nadie.

### 4. El gate

Modal a los veinticinco o treinta segundos de recorrido, o al intentar entrar a la tercera escena, lo que pase primero. Nombre, correo y WhatsApp.

No al entrar. Si lo pones al entrar, la gente se va. La idea es que ya esté enganchado cuando se lo pidamos.

### 5. Unir el pasado anónimo

Esta es la pieza central y la que quiero ver bien resuelta.

Cuando llena el formulario, en una sola transacción hay que: buscar si ya existe por correo o teléfono, crear el lead si no existe, registrar este navegador como suyo, y **adoptar todos los eventos anónimos previos** de ese visitante.

Hazlo en una función de Postgres, no en tres llamadas desde el frontend. Si se cae a la mitad quedan eventos huérfanos y datos a medias.

**La relación que tienes que resolver:** una persona entra desde el celular por Instagram, después desde la laptop de la oficina, después desde la tablet en la casa. Son tres identificadores distintos para un solo cliente. Si guardas el identificador como una columna del lead, pierdes dos de los tres. Piensa cómo lo modelas y explícame por qué.

---

## Dos aclaraciones

**El puntaje del lead no lo metas todavía.** Primero que los datos entren limpios y completos. Definir los pesos del score con datos falsos de prueba no sirve de nada; eso lo calibramos cuando tengamos tráfico real.

**El aviso automático a las vendedoras tampoco.** Eso va por n8n y lo veo yo. Tú deja el evento bien guardado en la base y con eso me basta para engancharlo.

---

## Aparte, y no es opcional

Desde el momento en que esto entra en producción estamos guardando comportamiento de gente que no ha aceptado nada. Hace falta banner de cookies y política de privacidad diciendo que registramos navegación y que al dejar los datos se asocia el historial previo.

Eso no lo haces tú, pero avísame apenas el tracking esté listo para no publicarlo sin la política puesta.

---

## Qué me entregas

**El sistema andando, probado en mi celular.** Entro desde un link con UTM, recorro dos ambientes, dejo mis datos, y quiero ver en la base mi lead con los eventos de **antes** de haberme identificado.

**La prueba de que la cookie aguanta.** Entras, cierras el navegador, vuelves después, y sigue siendo el mismo visitante con su sesión original intacta.

**Media página explicando cómo quedó:** qué guarda cada tabla, cómo modelaste lo de varios dispositivos por persona y por qué, y qué pasa exactamente en el momento en que alguien llena el formulario.

El punto tres es el entregable real. El código se arregla; un modelo mal pensado nos obliga a rehacer y a perder los datos que ya se hayan acumulado.
