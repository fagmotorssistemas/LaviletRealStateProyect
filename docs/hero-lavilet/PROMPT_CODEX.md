# Hero de La Vilet: instrucciones para Codex

## Qué hay que hacer

Reemplazar el hero de la página principal por el hero animado de La Vilet. Todo va **atado al scroll**: mientras el usuario baja, la escena pasa de día a tarde y a noche, las líneas doradas se dibujan, las letras de "LA VILET" viajan desde el logo centrado arriba hasta el título grande de la izquierda, un peatón cruza la vereda y un carro pasa por la calle. Si el usuario detiene el scroll, todo se detiene en ese punto. Si sube, todo retrocede.

**La fuente de verdad es `docs/hero-lavilet/referencia.html`.** Es la implementación completa, aprobada y probada. El componente en Next.js tiene que verse y comportarse exactamente igual. **Porta la lógica literalmente**: mismas capas, mismos números, mismas curvas, mismos tiempos y los mismos valores del objeto `state`. No rediseñes, no "mejores" valores ni simplifiques el cálculo de la geometría.

Este documento y sus imágenes **reemplazan cualquier entrega anterior del hero**.

## Archivos

`public/hero/` contiene 15 imágenes WebP, ya optimizadas, alineadas entre sí y con fondo transparente cuando corresponde.

| Capa | Día | Tarde | Noche |
|---|---|---|---|
| Cielo y ciudad | `fondo-dia.webp` | `fondo-tarde.webp` | `fondo-noche.webp` |
| Calle y vereda | `calle-dia.webp` | `calle-tarde.webp` | `calle-noche.webp` |
| Edificio (1356×585) | `edificio-dia.webp` | `edificio-tarde.webp` | `edificio-noche.webp` |

Personas en las terrazas, del mismo tamaño que el edificio y casi todo transparentes. Van encima del edificio, en el mismo marco:
- `personas-tarde.webp`: la pareja del techo y la pareja de la torre izquierda. `opacity = clamp(1 − |tod − 1|, 0, 1)`: aparecen con la tarde y se van con la noche.
- `personas-noche.webp`: la persona del techo de noche. `opacity = clamp(tod − 1, 0, 1)`.

Las personas de los balcones y de la plaza comercial **ya vienen dentro de las imágenes de tarde y de noche**.

Animados:
- `carro.webp`: de perfil, mirando a la derecha.
- `peaton-a.webp`, `peaton-p.webp`, `peaton-b.webp`: ciclo de caminata (zancada, piernas juntas, otra zancada), alineados por los pies y la cabeza.

**No modifiques las imágenes.** Los bordes del edificio se igualaron a mano entre las tres horas para que no se vean dobles.

Para ver la referencia, ejecuta `npx serve .` desde la raíz del repo y abre `/docs/hero-lavilet/referencia.html`. Usa las imágenes de `public/hero/`.

## Reglas de trabajo

1. Trabaja en una **rama nueva** y abre un PR. No subas directo a producción.
2. **No borres archivos, componentes ni el navbar actual sin preguntarme antes.**
3. No toques otras secciones de la página.
4. Si existe un hero anterior a medio portar de una entrega pasada, reemplázalo por este. Antes de borrar sus archivos o imágenes viejas (por ejemplo `public/hero/fondo.webp`, `calle.webp`, `edificio.webp`), pregúntame.
5. Al terminar, dame el enlace de la vista previa de Vercel y la lista de archivos que cambiaste.

## Cómo implementarlo en Next.js

- **Componente cliente** (`"use client"`), por ejemplo `components/hero/HeroLaVilet.tsx`, usado en la página principal. Sigue la estructura de carpetas que ya tenga el proyecto.
- **Estilos:** pasa el CSS de la referencia a un CSS Module del componente. Si el proyecto usa Tailwind, revisa que su CSS base (preflight) no altere `img` ni `svg` dentro del hero, porque las capas se posicionan en píxeles.
- **Fuentes** con `next/font/google`: **Italiana** (400) y **Archivo** (pesos 100 a 500). Exponlas como las variables CSS `--font-display` y `--font-body` que usa la referencia.
- **Scroll suave:** instala el paquete `lenis` y úsalo con `{ lerp: 0.07, wheelMultiplier: 0.85 }`, como en la referencia. Si el proyecto ya tiene scroll suave, reutilízalo. Destrúyelo al desmontar.
- **Imágenes:** usa `<img>` normales, no `next/image`. Las capas se apilan y se dimensionan en píxeles desde JavaScript, y el envoltorio de `next/image` rompe esa geometría. Pon `fetchPriority="high"` en `fondo-dia.webp` y `edificio-dia.webp`. Las rutas pasan de `../../public/hero/x.webp` a `/hero/x.webp`, incluida la de `mask-image` del CSS.
- **Lógica:** todo el JavaScript de la referencia (`layout`, `fitComp`, `render`, `applyTod`, `todForScroll`, `nightPhase`, `streetLife`, el bucle de `requestAnimationFrame` y el armado de las letras) va en un `useEffect` con `refs`. Limpia los listeners, los `requestAnimationFrame` y los `setTimeout` al desmontar. Calcula la geometría inicial en `useLayoutEffect` para que no haya un salto en el primer cuadro, y vuelve a calcularla cuando carguen las fuentes y las imágenes, como hace la referencia.
- **Valores:** deja el objeto `state` congelado al inicio del componente, con sus comentarios, como una constante. Son los valores aprobados.
- **La sección de relleno** que está debajo del hero en la referencia (`<section class="after">`) **no se porta**. Solo está para poder hacer scroll.

## Menú

Se queda el navbar existente, con sus enlaces y su versión móvil. Quita del hero su copia del menú: los tres textos dentro del lienzo de diseño. Solo en la página principal, mientras se ve el hero, la línea de tiempo del hero controla la entrada del navbar: opacity de 0 a 1 y sube 10 px, en `T = 0.16 + 0.20`, escalonado 0.05, igual que en la referencia. En las demás páginas el navbar se comporta como siempre.

La línea horizontal y el subrayado de "El proyecto" siguen siendo del hero y deben calzar con la posición real del navbar. Si no coinciden, ajusta las líneas, no el navbar. En celular el navbar se muestra normal desde el inicio, sin animación.

## Resumen de la especificación

La referencia manda. Esto es solo para orientarte.

- **Estructura:** un contenedor de `100svh + 240svh` con el hero `position: sticky; top: 0; height: 100svh; overflow: hidden`. El progreso `p` va de 0 a 1 y se suaviza con un filtro exponencial independiente de los fps.
- **Capas, de atrás hacia adelante:** cielo y ciudad, calle, edificio (con las capas de personas de las terrazas y el peatón dentro de su contenedor), carro, velo oscuro (`multiply`) y un lienzo de diseño de 1672×941 con las líneas en SVG, el menú y los textos. El lienzo se escala con `min(ancho/1672, alto/941)` y se ancla arriba al centro. En vertical (ancho/alto < 1.25) se escala con `min(ancho/720, alto/1100)`, se ancla arriba a la izquierda y se oculta el menú.
- **Día, tarde y noche:** `tod = smoothstep(0.08, 0.50, p) + smoothstep(0.58, 0.95, p)`. Las capas de día van abajo. Encima van las de tarde, con `opacity = clamp(tod, 0, 1)`, y encima las de noche, con `opacity = clamp(tod − 1, 0, 1)`. Esto aplica al cielo, la calle y el edificio.
- **Cielo:** pasa de `scale(1.40)` a `scale(1)` desde el horizonte, con easeOutCubic.
- **Textos y líneas:** línea de tiempo `T = p × 0.95`. Los inicios, duraciones y curvas exactos están en `render()`.
- **Peatón:** cruza la vereda en un tramo corto del paso de la tarde a la noche y alterna las tres poses según la distancia recorrida.
- **Carro:** cruza la pantalla de izquierda a derecha, más adelante en ese mismo tramo. La estela roja y el desenfoque crecen con la velocidad del scroll y se apagan cuando el scroll se detiene.
- **`prefers-reduced-motion`:** sin sticky ni scroll extra, todo en su estado final (de noche), sin carro ni peatón.

## Cómo comprobar que quedó igual

Abre la referencia y tu versión lado a lado, con el mismo tamaño de ventana, y compáralas en cinco puntos del scroll: arriba (día, logo centrado), a la mitad (tarde), cuando pasa el peatón, cuando pasa el carro y al final (noche, texto completo). Hazlo en tres tamaños:
- **1329×942**
- **1920×963**
- **390×844** (celular)

Prueba además en un iPhone real con Safari: la barra del navegador cambia la altura de la pantalla, y el hero no debe saltar.

Son aceptables diferencias de uno o dos píxeles por las fuentes. Cualquier otra diferencia es un error del porte.
