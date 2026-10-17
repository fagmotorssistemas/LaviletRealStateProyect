# La Vilet — hero de /inicio: ventana de vidrio con LaVilēt y rueda de palabras

Aplica al hero de `/inicio` la versión aprobada "ventana y rueda". Abre primero `docs/hero-lavilet/rueda/referencia-rueda.html` en el navegador, desde su carpeta: así debe verse y moverse.

Trabaja en una rama nueva (`feat/hero-ventana-rueda`) y abre un PR. No borres archivos sin preguntarme. Dentro de los archivos listados abajo sí se quitan bloques de código, como se indica.

## Qué NO se toca

- La escena del hero y su lógica: cielo, edificio, calle, día → tarde → noche, personas, peatón, carro, velo, scroll fijado, Lenis, `state` con los valores aprobados.
  - En `heroAnimation.js` deben quedar idénticos: `layout()` (salvo una línea nueva), `progress()`, `applyTod()`, `todForScroll()`, `nightPhase()`, `streetLife()`, `tick()` y el arranque y la limpieza.
- `heroNavbarAnimation.js`, `HeroNavbar.module.css`, `SiteHeader.tsx`, `FullLanding.tsx` y las imágenes que ya existen en `public/hero/`.
- Ninguna otra sección de la página.

## Archivos del paquete (copiar tal cual)

| Archivo | Qué es |
|---|---|
| `src/components/marketing/hero/heroWindow.js` | **Nuevo.** Módulo con la ventana de vidrio, las letras del logo, "Apartments · Suites · Retail" y la rueda. Úsalo sin cambiar la lógica. |
| `public/hero/logo/L.webp`, `a.webp`, `V.webp`, `idot.webp`, `i.webp`, `l.webp`, `e.webp`, `macron.webp`, `t.webp` | **Nuevos.** Las piezas del logotipo en crema (#f1eada), recortadas del logo original sin cambiar su forma. |
| `public/hero/logo/lavilet-crema.webp` | **Nuevo.** El logotipo completo en crema. Se usa como máscara del brillo. |
| `docs/hero-lavilet/rueda/ventana-y-rueda.css` | Estilos para pegar al final de `HeroLaVilet.module.css`. |
| `docs/hero-lavilet/rueda/referencia-rueda.html` | Referencia visual. Es la referencia aprobada con el módulo montado. No se porta. |

## Cambios

### 1. `HeroLaVilet.module.css`
- Pega al final todo el contenido de `docs/hero-lavilet/rueda/ventana-y-rueda.css`.
- Borra las reglas de las piezas que se eliminan:
  - `[data-part="lines"]`, `[data-part="lines2"]` y sus `path`.
  - `[data-part="blk"]`, `eye`, `t` (con `span` y `.sp`), `gh` (con `span` y `.sp`).
  - `claim` (con `.w` e `i`), `sub` (con `span` e `i`), `sd` (con `svg`).
- No cambies nada más.

### 2. `HeroLaVilet.tsx`
- Dentro de `<div className={styles['comp']} data-part="comp">` borra todo su contenido:
  - el `<svg data-part="lines">` (con su `linearGradient` y los paths `pH`, `pV`, `pU`);
  - el `<div data-part="blk">` completo;
  - `<div data-part="gh">` y `<div data-part="sd">`.
- El `div` de `comp` **se queda, vacío**: `heroNavbarAnimation.js` lo busca.
- No cambies nada más: las capas de la escena, el `noscript`, `state` y las fuentes quedan iguales.

### 3. `heroAnimation.js`
**Agregar:**
- Arriba: `import { createHeroWindow } from './heroWindow'`.
- Justo después de `var navbar = createHeroNavbar(root, geoForNavbar);`:
  `var win = createHeroWindow(pin, hero, function () { return motionOn; });`
- En `layout()`, justo después de `fitComp(w, h);`: `win.layout(w, h);`
- Al final de `render(p)`: `win.render(p);`
- En `start()`, al principio: `win.start();`
- En `destroy()`: `win.destroy();`

**Quitar (son del bloque de texto y de las líneas del marco, que ya no existen):**
- El bloque "build the text": `real`, `ghosts`, el `forEach` de `"LA VILET"`, `claim`, `claimW`, `subL`.
- `paths` (el `forEach` de `pH`, `pV`, `pB`, `pR`, `pU`), `dias`, `INK`, `ACC` y las funciones `draw()` y `pop()`.
- En `fitComp()`:
  - todo lo que toca `gh`, `sd` y `blk`, y el cálculo de `F`;
  - se quedan: el `toggle` de `classes.portrait`, el cálculo de `s`, las transformaciones de `comp` y `geo.s = s`.
- En `render(p)`:
  - el bloque de `sd`, el `forEach` de `real` y `navbar.align(paths)`;
  - todos los `draw(...)` y `pop(...)`, y los bloques de `eye`, `claimW` y `subL`;
  - se quedan: la escena, `T`, el `veil` y `navbar.render(T)`.
- En `destroy()`: la línea `["t", "gh", "claim"].forEach(...)`.
- Si queda alguna variable sin uso por estos cambios (por ejemplo `F`), quítala. No toques nada más.

### 4. `scripts/hero-lavilet.ui.test.cjs`
- El test espera el título de 8 letras y las piezas `eye`, `claim`, `sub`, `sd`, `pH` y `pU`, que ya no existen. Ajústalo:
  - la espera de "listo" en la app: que haya 9 `[data-part="winGl"]`, en lugar de `[data-part="t"]` con 8 hijos;
  - en `snapshot()`: quita `eye`, `claim`, `sub`, `sd`, `letters`, `words` y `subLines`;
  - quita o adapta las aserciones sobre `pH` y `pU`.
- La comparación de la escena contra `docs/hero-lavilet/referencia.html` (edificio, calle, cielo, día, tarde, noche, peatón, carro) se mantiene igual.
- Agrega una prueba simple: en 1329×942, con p = 0, se ven `[data-part="winT"]` y `[data-part="wheel"]`. Con p = 1, la palabra más opaca de la rueda es "Elegancia".

## Cómo debe verse (lo hace `heroWindow.js`)

- **Al cargar:**
  - aparece un vidrio esbelto a la izquierda, con el marco medio transparente y el centro limpio;
  - las letras de LaVilēt llegan una a una, borrosas, y se enfocan;
  - cae el punto de la i y se traza la raya de la ē;
  - luego un brillo cruza el nombre cada 7,5 s.
- **En reposo:** la ventana flota despacio y se inclina hacia el cursor (solo con mouse). En Chrome y Edge el marco deforma lo que hay detrás; en Safari y Firefox queda transparente, sin deformar.
- **Con el scroll:**
  - la ventana se desliza a la izquierda y se detiene antes del borde;
  - aparece "APARTMENTS · SUITES · RETAIL" bajo el nombre;
  - la rueda de la derecha gira palabra por palabra: SEGURIDAD → EXCLUSIVIDAD → COMODIDAD → ELEGANCIA;
  - la tarde, la noche, las personas y el carro siguen igual que hoy.
- **Celular:** la ventana va arriba, sobre el cielo, y la rueda va más pequeña y más abajo.
- **Movimiento reducido:** todo aparece directo en su estado final, sin entrada, sin flotar, con la rueda en "Elegancia".

## Comprobar

1. `/inicio` en 1440×900, 1920×1080 y 390×844: coincide con `referencia-rueda.html` al inicio, a la mitad del scroll y de noche.
2. La escena es idéntica a `main`: mismos encuadres, día, tarde, noche, peatón, carro y velo.
3. La barra del sitio sigue igual: aparece con el cursor en escritorio y se ve normal en el celular.
4. Sin errores en la consola. Al salir de `/inicio` y volver, no quedan capas duplicadas: `destroy()` las quita.
5. `npx tsc --noEmit`, `npm run lint`, `npm run build` y el test del hero, sin errores nuevos.
6. `git diff --stat` contra `main` muestra solo:
   - `heroWindow.js` (nuevo) y los 10 archivos de `public/hero/logo/` (nuevos);
   - `HeroLaVilet.module.css`, `HeroLaVilet.tsx`, `heroAnimation.js` y `scripts/hero-lavilet.ui.test.cjs`;
   - los archivos de `docs/hero-lavilet/rueda/`.

Entrega: la lista de archivos tocados y el enlace de la vista previa de Vercel.
