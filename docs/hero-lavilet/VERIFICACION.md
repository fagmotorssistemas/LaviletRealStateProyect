# Hero La Vilet: verificacion del porte final

Fuente: `PROMPT_CODEX.md` y `referencia.html` del paquete final de 15 imagenes. Ambos documentos y las 15 imagenes se conservan byte por byte. `state` conserva todos sus valores y comentarios. No se incluyen los ajustes de encuadre de entregas anteriores.

## Comportamiento e integracion

- La pagina `/inicio` usa `HeroLaVilet`; las secciones siguientes mantienen su implementacion de `main`.
- No se eliminan archivos ni se modifica el hero compartido por otras paginas.
- Lenis existente se reutiliza; solo `/inicio` usa `lerp: 0.07` y `wheelMultiplier: 0.85`.
- El navbar conserva sus enlaces, medidas y menu movil. La linea de tiempo controla su entrada de escritorio mientras se ve el hero. En movil se mantiene disponible desde el inicio.
- Las lineas horizontal/vertical se unen en el borde inferior real del navbar. El subrayado busca `/proyectos` si esta visible; como el navbar actual filtra ese enlace, se alinea con el primer enlace visible (`Showroom 360`).
- Movimiento reducido: noche final, sin sticky ni recorrido extra, carro y peaton ocultos.
- Los listeners, RAF, temporizadores, observadores y estilos temporales del navbar se limpian al desmontar.

## Validacion

- `node --test scripts/hero-lavilet.ui.test.cjs`: 6 pruebas correctas en Chromium.
- Comparacion de geometria (tolerancia 2 px), opacidades, letras, palabras, capas e imagenes renderizadas con la referencia original en 1329x942, 1920x963 y 390x844.
- Cinco puntos identicos de scroll en cada comparacion: progreso 0 (dia), 0.5 (tarde), 0.6799 (peaton), 0.7539 (carro), 1 (noche). El script comprueba que las posiciones de scroll absolutas coinciden.
- El carro y el peaton permanecen inmoviles al detener el scroll y recuperan exactamente la posicion anterior al retroceder. La estela del carro se apaga al detenerse.
- Entrada escalonada del navbar comprobada contra los valores conocidos de la referencia; lineas y subrayado alineados con error menor de 1 px. Menu movil y navegacion a `/contacto` y regreso comprobados sin errores de JavaScript.
- Capturas comparadas pixel a pixel fuera de la franja superior modificada por la integracion autorizada del navbar. El indicador de desarrollo de Next se oculta solo en las capturas de prueba.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: correcto.
- `node node_modules/next/dist/bin/next build --webpack`: correcto (77 paginas generadas).
- La misma comparacion de los 15 estados tambien pasa contra `next start` con la compilacion de produccion (`HERO_TEST_URL=http://127.0.0.1:3103`).
- ESLint: los archivos nuevos y `FullLanding`/`SmoothScrollProvider` pasan. `SiteHeader` conserva dos errores preexistentes de `react-hooks/set-state-in-effect` en efectos ajenos a este cambio; las mismas instrucciones estan en `origin/main`.

La prueba en iPhone fisico con Safari queda a cargo del usuario, con la vista previa de Vercel, segun lo acordado.

## Reproducir

1. Instalar las dependencias del repositorio y el navegador Chromium de Playwright.
2. Ejecutar la aplicacion: `npm run dev -- --port 3102`.
3. Ejecutar `node --test scripts/hero-lavilet.ui.test.cjs`.
4. Para usar otro servidor, establecer `HERO_TEST_URL` con su URL antes de ejecutar las pruebas.

El script sirve la referencia original y sus imagenes mediante un servidor local de solo lectura. Las capturas se guardan en una carpeta temporal cuya ruta imprime cada ejecucion.

## Archivos de esta entrega

- `src/components/marketing/FullLanding.tsx`
- `src/components/marketing/SiteHeader.tsx`
- `src/components/marketing/SmoothScrollProvider.tsx`
- `src/components/marketing/hero/HeroLaVilet.tsx`
- `src/components/marketing/hero/HeroLaVilet.module.css`
- `src/components/marketing/hero/heroAnimation.js`
- `src/components/marketing/hero/heroNavbarAnimation.js`
- `src/components/marketing/hero/HeroNavbar.module.css`
- `scripts/hero-lavilet.ui.test.cjs`
- `docs/hero-lavilet/PROMPT_CODEX.md`
- `docs/hero-lavilet/referencia.html`
- `docs/hero-lavilet/VERIFICACION.md`
- `public/hero/fondo-dia.webp`
- `public/hero/fondo-tarde.webp`
- `public/hero/fondo-noche.webp`
- `public/hero/calle-dia.webp`
- `public/hero/calle-tarde.webp`
- `public/hero/calle-noche.webp`
- `public/hero/edificio-dia.webp`
- `public/hero/edificio-tarde.webp`
- `public/hero/edificio-noche.webp`
- `public/hero/personas-tarde.webp`
- `public/hero/personas-noche.webp`
- `public/hero/carro.webp`
- `public/hero/peaton-a.webp`
- `public/hero/peaton-p.webp`
- `public/hero/peaton-b.webp`
