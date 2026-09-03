# La Vilet — Showroom virtual 360°

**Para:** Pablo

Tu trabajo no es esperar a que lleguen: es dejar armada la estructura para que el día que caigan los archivos, sea cargarlos y nada más.

Esto es una guía de por dónde arrancar, no un instructivo cerrado. Si encuentras algo mejor, dilo.

---

## Qué es y qué no es

El edificio está en construcción, así que el recorrido no sale de fotos: sale de renders panorámicos del modelo 3D del arquitecto.

Lo que el cliente tiene que poder hacer:

- Girar 360° dentro de un ambiente
- Saltar de sala a cocina a dormitorio tocando puntos en la escena
- Cambiar el paquete de acabados y ver el mismo ambiente distinto
- Cambiar entre día y noche
- Ver en un plano pequeño dónde está parado

Lo que **no** es: una galería de imágenes planas. Si termina siendo eso, no sirve — el cliente ya vio renders en el anuncio.

---

## Con qué construirlo

**Photo Sphere Viewer.** Es la recomendación, no Pannellum. Las dos son gratuitas y con licencia MIT, pero PSV está pensado justo para esto: tiene plugins de marcadores, recorrido virtual, brújula y plano, así que los hotspots y la navegación entre escenas ya vienen resueltos. Pannellum es más liviano pero está pensado para mostrar una panorámica suelta, y además no soporta video — y nosotros vamos a querer las transiciones en MP4 entre ambientes.

Se autohospeda dentro de nuestra web. **No contrates Matterport ni CloudPano**: eso tiene sentido cuando exista un departamento modelo físico para escanear, no ahora que todo sale de renders.

Va sobre Three.js por debajo, así que si más adelante queremos algo más pesado, no hay que tirar el trabajo.

---

## Móntalo directo en la web

La web sigue en desarrollo, así que trabájalo ahí mismo. No hace falta un proyecto aparte: probarlo dentro del sitio desde el inicio te ahorra la integración después y te muestra los problemas reales de carga y de móvil, que en un proyecto suelto no aparecen.

Bajas panorámicas equirectangulares de internet — hay bancos gratuitos con interiores — y trabajas con esas. **Usa dos o tres ambientes distintos, no uno solo**: con uno no aparecen los problemas de navegación entre espacios, que es donde está la dificultad real.

Aparte, pídele al arquitecto un par de renders de prueba cuanto antes, aunque sean borradores sin acabados finales. Un archivo real suyo te dice cosas que una imagen de internet no: qué tan pesado viene, si la proyección está bien, si el horizonte queda derecho. Mejor descubrir eso ahora que cuando entregue todo.

---

## Cómo se organiza

Esta es la parte que importa y la que quiero ver resuelta.

**Los archivos.** Nombres en minúscula con guion bajo, siguiendo `tipologia_ambiente_acabado_luz`. Por ejemplo `tipo_a_sala_nogal_dia.jpg`. Suena a detalle y no lo es: con esa convención un script los carga solos; sin ella, alguien renombra cientos de imágenes a mano.

**Las tablas ya existen en Supabase.** `unit_types`, `tour_panoramas`, `tour_transitions`, `finish_packages`. Están vacías pero con la estructura definida — revísalas antes de inventar nada, y si algo no te cuadra, dilo en vez de crear tablas nuevas.

**La relación que tienes que resolver.** Un mismo ambiente existe en varias versiones: sala con acabado nogal de día, sala con acabado nogal de noche, sala con el otro acabado de día, y así. La pregunta de diseño es cómo se pide una versión concreta y qué pasa en pantalla cuando el cliente cambia de acabado. ¿Carga otra imagen y se ve el salto? ¿Se precargan las variantes del ambiente actual? Eso decídelo tú y explícame por qué.

**El peso.** Una panorámica de 8192 px pesa mucho. La recomendación técnica es no pasar de 4096 px de ancho si quieres compatibilidad con todos los dispositivos; 8192 anda en la mayoría, pero no en todos. Al arquitecto se le pide 8192 para tener el original en buena calidad, pero en la web hay que servir una versión reducida en móvil. Si el tour tarda quince segundos en cargar con datos móviles, nadie lo va a ver — y por ahí va a entrar casi todo el tráfico.

---

## Dos aclaraciones

**Constrúyelo completo, con unidad, precio y disponibilidad.** La web está en desarrollo y no es pública, así que arma la pieza entera — que el recorrido pueda mostrar de qué unidad se trata, su precio y si está libre. Lo que se controla no es lo que construyes, es lo que se publica: cuando salgamos a lanzamiento decidimos qué queda visible y qué se apaga. Si lo dejas para después, vamos a estar rehaciendo la pantalla en preventa.

**No metas todavía la parte de seguimiento.** Sesiones, eventos, puntaje del lead: eso es una tarea aparte y la vemos después. Ahora concéntrate en que el recorrido funcione y esté bien organizado.

---

## Qué me entregas

1. **El visor andando con imágenes de prueba**, abierto en mi celular, girando y saltando entre al menos dos ambientes.

2. **Media página explicando cómo quedó organizado**: dónde viven los archivos y con qué nombre, qué guarda cada tabla, cómo se pide una panorámica concreta, y qué pasa cuando alguien cambia de acabado.

3. **Tu criterio sobre el peso de las imágenes**: qué vas a servir en móvil y cómo.

El punto 2 es el entregable real. Si está bien pensado, cargar los renders después es trámite. Si está improvisado, lo vamos a rehacer cuando lleguen los archivos.
