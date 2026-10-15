# Hero de La Vilet: instrucciones para Codex

## Qué hay que hacer

Reemplazar el hero de la página principal por el hero animado de La Vilet. Todo el efecto va **atado al scroll**: mientras el usuario baja, el cielo se acomoda, la escena pasa de día a atardecer y a noche, las líneas doradas se dibujan y las letras de "LA VILET" viajan desde un logo centrado arriba hasta el título grande de la izquierda.

**La fuente de verdad es `docs/hero-lavilet/referencia.html`.** Es una implementación completa y funcionando. El componente en Next.js tiene que verse y comportarse igual. **Porta la lógica literalmente**: mismas capas, mismos números, mismas curvas y mismos tiempos. No rediseñes, no "mejores" los valores y no cambies la estructura de capas.

## Archivos

- `public/hero/`: las 8 imágenes, ya optimizadas en WebP.
  - Cielo y ciudad: `fondo-dia.webp`, `fondo.webp` (atardecer), `fondo-noche.webp`
  - Calle y vereda: `calle-dia.webp`, `calle.webp` (atardecer), `calle-noche.webp`
  - Edificio con fondo transparente: `edificio.webp` (día) y `edificio-noche.webp`
- `docs/hero-lavilet/referencia.html`: la implementación de referencia. Usa las imágenes de `public/hero/`.

Para verla: desde la raíz del repo ejecuta `npx serve .` y abre `/docs/hero-lavilet/referencia.html`.

## Reglas de trabajo

1. Trabaja en una **rama nueva** y abre un PR. No subas directo a producción.
2. **No borres archivos, componentes ni el navbar actual sin preguntarme antes.**
3. No toques otras secciones de la página.
4. Al terminar, dame el enlace de la vista previa de Vercel y la lista de archivos que cambiaste.

## Cómo implementarlo en Next.js

- **Componente cliente** (`"use client"`), por ejemplo `components/hero/HeroLaVilet.tsx`, usado en la página principal. Sigue la estructura de carpetas que ya tenga el proyecto.
- **Estilos:** pasa el CSS de la referencia a un CSS Module del componente. Si el proyecto usa Tailwind, revisa que su CSS base no altere `img` ni `svg` dentro del hero, porque las capas se posicionan en píxeles.
- **Fuentes** con `next/font/google`: **Italiana** (400) y **Archivo** (pesos 100 a 500). Expónlas como las variables CSS `--font-display` y `--font-body` que usa la referencia.
- **Scroll suave:** instala el paquete `lenis` con npm y úsalo con `lerp: 0.085`. Si el proyecto ya tiene scroll suave, reutilízalo en vez de crear otro. Destrúyelo al desmontar.
- **Imágenes:** usa `<img>` normales, no `next/image`. Las capas se apilan y se dimensionan en píxeles desde JavaScript, y el envoltorio de `next/image` rompe esa geometría. Pon `fetchPriority="high"` en `fondo-dia.webp` y `edificio.webp`. La máscara del tono atardecer apunta a `/hero/edificio.webp`.
- **Lógica:** todo el JavaScript de la referencia (`layout`, `render`, `timeOfDay`, el bucle de `requestAnimationFrame`) va en un `useEffect` con `refs`, limpiando los listeners y el `requestAnimationFrame` al desmontar. Calcula la geometría inicial en `useLayoutEffect` para que no haya un salto en el primer cuadro.
- **Constantes:** deja el objeto `CONFIG` de la referencia igual, al inicio del componente, con sus comentarios. Son los valores que ajustamos.

## Menú

El hero trae su propio menú (El proyecto · Espacios · Ubicación), que aparece con la animación. Si el sitio ya tiene un navbar global, **pregúntame antes** si se oculta en la página principal mientras se ve el hero o si se conecta la animación al navbar existente. No lo elimines.

## Resumen de la especificación

La referencia manda. Esto es solo para orientarte.

**Estructura**
- Contenedor de altura `100svh + 160svh`. Dentro va el hero con `position: sticky; top: 0; height: 100svh; overflow: hidden`.
- Progreso `p` de 0 a 1 = scroll dentro del contenedor / (alto del contenedor − alto del hero), con un suavizado corto independiente de los fps.
- Capas, de atrás hacia adelante: cielo y ciudad, calle, edificio, velo oscuro (`mix-blend-mode: multiply`) y un lienzo de diseño de **1672×941** con las líneas en SVG, el menú y los textos.
- El lienzo se escala con `min(ancho/1672, alto/941)` y se ancla arriba al centro. En pantallas verticales (ancho/alto < 1.25) se escala con `min(ancho/720, alto/1100)`, se ancla arriba a la izquierda y el menú se oculta.

**Encuadre de la escena**
- Base del edificio y borde de la vereda al **88% del alto de pantalla**.
- Edificio a **99% del ancho de pantalla** (125% en vertical), centrado. En pantallas muy anchas lo limita el alto, y como máximo puede quedar fuera por arriba un **6% del techo** (`topCropMax`; con 0 nunca se corta).
- Calle: su borde superior en la base del edificio. Cubre todo el ancho y llega hasta el borde inferior.
- Cielo y ciudad: el horizonte (77.47% de la imagen) queda un **12% del alto de pantalla por debajo de la vereda**, con la escala mínima que cubre la pantalla.

**Animación con el scroll**
- Cielo: `scale(1.40)` → `scale(1)` desde el horizonte, con curva easeOutCubic sobre `p`.
- Edificio: sin desplazamiento (`buildingRise: 0`).
- Día → atardecer → noche: `tod = smoothstep(0.08, 0.50, p) + smoothstep(0.58, 0.95, p)`. Las capas de día van abajo; encima van las de atardecer con `opacity = clamp(tod, 0, 1)` y luego las de noche con `opacity = clamp(tod − 1, 0, 1)`. Lo mismo para la calle y el edificio de noche. El tono atardecer del edificio de día es `0.60 × (1 − |tod − 1|)`.
- Textos y líneas, con `T = p × 0.95` (inicio + duración):
  - Velo 0.04 + 0.42.
  - Flecha de scroll 0 + 0.10.
  - Letras de LA VILET desde su gemela en el logo inicial (Italiana, 85% del tamaño del título, centrado arriba): 0.05 + i×0.042, duración 0.44, power2.inOut. VILET pasa de #f1eada a #fcb988.
  - Línea vertical 0.06 + 0.34; línea horizontal 0.10 + 0.30 (`stroke-dashoffset`).
  - Menú 0.16 + 0.20, escalonado 0.05; subrayado 0.26 + 0.16.
  - Corchete 0.30 + 0.26; su rombo 0.54 + 0.10 con back.out(2.2).
  - "Suites & Apartments" 0.36 + 0.24.
  - Regla 0.46 + 0.18; su rombo 0.62 + 0.10.
  - "El arte de vivir bien." palabra por palabra 0.52 + 0.26, escalonado 0.045.
  - Subtítulo línea por línea 0.66 + 0.22, escalonado 0.07.
- Con `prefers-reduced-motion`: sin sticky ni scroll extra, todo en su estado final (de noche).

## Cómo comprobar que quedó igual

Abre la referencia y tu versión lado a lado, con el mismo tamaño de ventana, y compara en cuatro puntos del scroll: arriba (día, logo centrado), a la mitad (atardecer), a tres cuartos (anocheciendo) y al final (noche, texto completo). Hazlo en estos tamaños:
- **1329×942**: el edificio ocupa casi todo el ancho y su base queda sobre la vereda.
- **1920×963**: el edificio ocupa cerca del 80% del ancho.
- **390×844**: celular; el texto queda arriba y el edificio abajo.

Prueba además en un iPhone real con Safari: la barra del navegador cambia la altura de la pantalla y el hero no debe saltar. Las diferencias aceptables son de uno o dos píxeles por las fuentes; cualquier otra diferencia es un error del porte.
