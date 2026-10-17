// La ventana de vidrio con LaVilēt y la rueda de palabras, encima del hero aprobado.
// Portado del artefacto "Hero LaVilet rueda". La escena (día, tarde, noche, personas y carro) sigue en heroAnimation.js;
// este módulo solo agrega sus propias capas dentro de la sección del hero y las pinta en cada render(p).
//
//  - Entrada al cargar (por tiempo, una vez): el vidrio aparece y las letras del logo llegan una a una, se enfocan,
//    cae el punto de la i y se traza la raya de la ē. Luego un brillo cruza el nombre cada pocos segundos.
//  - En reposo: la ventana flota despacio y se inclina hacia el cursor (solo con mouse). El vidrio del marco deforma
//    lo que hay detrás (Chrome y Edge); el centro es limpio.
//  - Con el scroll: la ventana se desliza a la izquierda, aparece "Apartments · Suites · Retail" y la rueda de la
//    derecha gira de palabra en palabra.

var GLYPHS = [
  /* nombre, x, y, ancho, alto en el dibujo de 1540 x 628 del logotipo */
  ['L', 4, 4, 171, 612], ['a', 158, 110, 342, 511], ['V', 462, 5, 322, 611], ['idot', 794, 5, 89, 87], ['i', 800, 118, 72, 498],
  ['l', 922, 5, 69, 611], ['e', 1040, 110, 269, 514], ['macron', 1063, 35, 226, 37], ['t', 1306, 5, 230, 619]
];
var ORDER = [0, 1, 2, 3, 3, 4, 5, 6, 6];   /* orden de lectura; el punto va con la i y la raya con la e */
var WORDS = ['Seguridad', 'Exclusividad', 'Comodidad', 'Elegancia'];
var LOGO_DIR = '/hero/logo/';
var LET_AR = 1540 / 628;
var STEP = 27 * Math.PI / 180;
var NS = 'http://www.w3.org/2000/svg';

export function createHeroWindow(pin, hero, isMotionOn) {
  var clamp = function (v, a, b) { return Math.min(Math.max(v, a), b); };
  var seg01 = function (v, a, b) { return clamp((v - a) / (b - a), 0, 1); };
  var eo = function (t) { return 1 - Math.pow(1 - t, 4); };
  var eio = function (t) { return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2; };
  var p2io = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };

  /* ---------- capas (se insertan antes de la capa de diseño "comp") ---------- */
  var nodes = [];
  function el(tag, part, parent) {
    var n = document.createElement(tag);
    n.setAttribute('data-part', part);
    (parent || frag).appendChild(n);
    return n;
  }
  function svgEl(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    parent.appendChild(n);
    return n;
  }
  var frag = document.createDocumentFragment();
  var filterId = 'lavilet-glass-' + Math.random().toString(36).slice(2, 8);
  var defs = svgEl('svg', { width: '0', height: '0', 'aria-hidden': 'true', focusable: 'false', style: 'position:absolute' }, frag);
  var filter = svgEl('filter', { id: filterId, x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' }, defs);
  var noise = svgEl('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.009 0.022', numOctaves: '2', seed: '5', result: 'n' }, filter);
  var disp = svgEl('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: '0', xChannelSelector: 'R', yChannelSelector: 'G' }, filter);

  var winF = el('span', 'winF'), winI = el('span', 'winI'), winR = el('span', 'winR');
  [winF, winI, winR].forEach(function (n) { n.setAttribute('aria-hidden', 'true'); });
  var winT = el('div', 'winT');
  winT.setAttribute('role', 'img'); winT.setAttribute('aria-label', 'La Vilet');
  var glyphs = GLYPHS.map(function (g) {
    var im = document.createElement('img');
    im.setAttribute('data-part', 'winGl');
    im.src = LOGO_DIR + g[0] + '.webp'; im.alt = ''; im.width = g[3]; im.height = g[4]; im.decoding = 'async';
    im.style.left = (g[1] / 1540 * 100) + '%'; im.style.top = (g[2] / 628 * 100) + '%'; im.style.width = (g[3] / 1540 * 100) + '%';
    winT.appendChild(im);
    return im;
  });
  var glint = el('span', 'winGlint', winT);
  var winS = el('p', 'winS', winT);
  winS.textContent = 'Apartments · Suites · Retail';

  var wheel = el('div', 'wheel');
  wheel.setAttribute('role', 'list'); wheel.setAttribute('aria-label', WORDS.join(', '));
  var whSvg = svgEl('svg', { 'data-part': 'whSvg', 'aria-hidden': 'true' }, wheel);
  var whArc = svgEl('circle', { 'data-part': 'whArc' }, whSvg);
  var whTicks = WORDS.map(function () { return svgEl('circle', { 'data-part': 'whTick' }, whSvg); });
  var whNow = svgEl('circle', { 'data-part': 'whNow', r: '3.5' }, whSvg);
  var whWords = WORDS.map(function (w) { var p = el('p', 'whWord', wheel); p.setAttribute('role', 'listitem'); p.textContent = w; return p; });

  nodes = Array.prototype.slice.call(frag.childNodes);
  hero.insertBefore(frag, hero.querySelector('[data-part="comp"]'));

  /* el vidrio deforma lo de atrás donde el navegador lo permite (Chrome, Edge); en los demás queda transparente */
  var BEND = false;
  try { BEND = !!window.chrome && CSS.supports('backdrop-filter', 'url(#' + filterId + ')'); } catch (e) { BEND = false; }

  /* ---------- medidas ---------- */
  var G = { w: 0, h: 0 }, WIN = {}, WH = {};
  function layout(w, h) {
    G.w = w; G.h = h;
    var portrait = w / h < 1, W, H, L, T;
    if (portrait) { W = w * 0.56; H = Math.min(h * 0.32, W * 1.25); L = w * 0.12; T = h * 0.22; }
    else { W = clamp(w * 0.2, 230, 400); H = Math.min(h * 0.5, W * 1.25); L = w * 0.11; T = h * 0.47 - H / 2; }
    var tw = W * (portrait ? 0.98 : 1.08), th = tw / LET_AR;
    W *= 0.68;   /* un vidrio esbelto */
    WIN = { W: W, H: H, L0: L, L1: Math.max(16, w * 0.035), T: T, iL: W * 0.24, iT: H * 0.12, iR: W * 0.91, iB: H * 0.965, tw: tw, th: th };
    WIN.dx = WIN.iL + W * 0.04; WIN.dy = H * 0.52 - th / 2;
    [winF, winR].forEach(function (n) { n.style.width = W.toFixed(1) + 'px'; n.style.height = H.toFixed(1) + 'px'; });
    winI.style.width = (WIN.iR - WIN.iL).toFixed(1) + 'px'; winI.style.height = (WIN.iB - WIN.iT).toFixed(1) + 'px';
    winT.style.width = tw.toFixed(1) + 'px';
    /* el marco es el vidrio menos su hueco (la costura entra y sale por el mismo borde, así no suma nada) */
    var px = function (a, b) { return a.toFixed(1) + 'px ' + b.toFixed(1) + 'px'; };
    winF.style.clipPath = winR.style.clipPath = 'polygon(evenodd,' + [px(0, 0), px(W, 0), px(W, H), px(0, H), px(0, 0),
      px(WIN.iL, WIN.iT), px(WIN.iR, WIN.iT), px(WIN.iR, WIN.iB), px(WIN.iL, WIN.iB), px(WIN.iL, WIN.iT)].join(',') + ')';
    /* todas las piezas giran alrededor del mismo punto: el centro del vidrio */
    winF.style.transformOrigin = winR.style.transformOrigin = '50% 50%';
    winI.style.transformOrigin = (W / 2 - WIN.iL).toFixed(1) + 'px ' + (H / 2 - WIN.iT).toFixed(1) + 'px';
    winT.style.transformOrigin = (W / 2 - WIN.dx).toFixed(1) + 'px ' + (H / 2 - WIN.dy).toFixed(1) + 'px';
    /* la línea bajo el nombre: como mucho, tan ancha como el nombre */
    winS.style.fontSize = Math.max(9, tw * 0.042).toFixed(2) + 'px';
    var sw = winS.scrollWidth;
    if (sw > tw * 0.98) winS.style.fontSize = (parseFloat(winS.style.fontSize) * tw * 0.98 / sw).toFixed(2) + 'px';
    /* la rueda: el centro del círculo queda fuera de la pantalla a la derecha; solo se ve su lado izquierdo */
    var R = portrait ? Math.min(h * 0.3, w * 0.75) : h * 0.46;
    var fs = portrait ? clamp(w * 0.058, 17, 26) : clamp(h * 0.042, 24, 46);
    WH = { R: R, cx: w + R * (portrait ? 0.7 : 0.62), cy: portrait ? h * 0.66 : h * 0.5, gap: fs * 0.7, C: 2 * Math.PI * R };
    whSvg.setAttribute('width', w); whSvg.setAttribute('height', h);
    whArc.setAttribute('cx', WH.cx.toFixed(1)); whArc.setAttribute('cy', WH.cy.toFixed(1)); whArc.setAttribute('r', R.toFixed(1));
    whArc.style.strokeDasharray = WH.C.toFixed(1);
    whWords.forEach(function (n) { n.style.fontSize = fs.toFixed(1) + 'px'; });
    cache = {};
    paint();
  }

  /* ---------- estado de movimiento ---------- */
  var A = { t0: 0, now: 0, rx: 0, ry: 0, mx: 0, my: 0, raf: 0, last: 0 }, cache = {}, current = 0, disposed = false, keyN = 0;
  function key(n) { return n.__lvk || (n.__lvk = 'k' + (++keyN)); }
  function setS(n, k, v) { var id = key(n) + k; if (cache[id] !== v) { cache[id] = v; n.style[k] = v; } }
  function setA(n, k, v) { var id = key(n) + '@' + k; if (cache[id] !== v) { cache[id] = v; n.setAttribute(k, v); } }

  function paint() {
    if (!G.w || disposed) return;
    var motionOn = isMotionOn(), p = current, h = G.h;
    var t = motionOn ? (A.t0 ? (A.now - A.t0) / 1000 : -1) : 99;   /* segundos desde que empezó la entrada */
    var cond = motionOn ? eo(seg01(t, 0, 1.4)) : 1;
    var grow = 1 + 0.035 * (1 - cond);
    var sec = A.now / 1000, idle = motionOn ? cond : 0;
    /* nunca queda quieta: flota con dos ritmos distintos (no se nota que se repite) y además sigue al cursor */
    var irx = 2.2 * Math.sin(sec * 2 * Math.PI / 6.3) * idle, iry = 3.2 * Math.sin(sec * 2 * Math.PI / 8.9 + 1.1) * idle;
    var fy = 5 * Math.sin(sec * 2 * Math.PI / 5.2 + 0.4) * idle;
    var rx = A.rx + irx, ry = A.ry + iry;
    var tilt = ' perspective(1300px) rotateX(' + rx.toFixed(3) + 'deg) rotateY(' + ry.toFixed(3) + 'deg)';
    /* con el scroll la ventana se desliza a la izquierda y se detiene antes del borde */
    var mv = motionOn ? eio(seg01(p, 0, 0.16)) : 1;
    var L = WIN.L0 + (WIN.L1 - WIN.L0) * mv, y = WIN.T + fy;
    /* el vidrio: sin escarcha; deforma lo de atrás y la deformación se mueve (más mientras la ventana viaja) */
    var bf = (BEND ? 'url(#' + filterId + ') ' : '') + 'brightness(' + (1 + 0.08 * cond).toFixed(3) + ') saturate(' + (1 + 0.08 * cond).toFixed(3) + ')';
    if (BEND) {
      setA(noise, 'baseFrequency', (0.009 + 0.0022 * Math.sin(sec * 2 * Math.PI / 7.3)).toFixed(5) + ' ' + (0.022 + 0.0045 * Math.sin(sec * 2 * Math.PI / 5.9 + 1)).toFixed(5));
      setA(disp, 'scale', (cond * (26 + 14 * Math.sin(Math.PI * mv))).toFixed(2));
    }
    setS(winF, 'backdropFilter', bf); setS(winF, 'webkitBackdropFilter', bf);
    var op = cond.toFixed(3);
    setS(winF, 'opacity', op); setS(winI, 'opacity', op); setS(winR, 'opacity', op);
    var at = function (x, yy) { return 'translate3d(' + x.toFixed(1) + 'px,' + yy.toFixed(1) + 'px,0)' + tilt; };
    setS(winF, 'transform', at(L, y) + ' scale(' + grow.toFixed(4) + ')');
    setS(winR, 'transform', at(L, y) + ' scale(' + grow.toFixed(4) + ')');
    /* el hueco va un poco más hundido que el marco: al inclinarse se nota el grosor del vidrio */
    setS(winI, 'transform', at(L + WIN.iL, y + WIN.iT) + ' translateZ(-16px) scale(' + grow.toFixed(4) + ')');
    setS(winR, 'backgroundPosition', ((0.55 - ry * 0.045) * 100).toFixed(2) + '% 0');
    /* el nombre flota un poco delante del vidrio */
    setS(winT, 'opacity', '1');
    setS(winT, 'transform', at(L + WIN.dx, y + WIN.dy) + ' translateZ(34px)');
    glyphs.forEach(function (g, j) {
      var i = ORDER[j], isDot = j === 3, isMac = j === 7, slot = isMac ? 5 : i;
      /* cada letra llega borrosa, un poco baja y separada, y se enfoca al llegar; el punto cae y la raya se traza al final */
      var st = 0.55 + i * 0.11 + (isDot ? 0.22 : 0) + (isMac ? 0.55 : 0);
      var k = motionOn ? eo(seg01(t, st, st + 1.25)) : 1;
      var spread = isMac ? 0 : (slot - 3) * 0.045 * WIN.tw * (1 - k);
      var dy = (isDot ? -0.5 : isMac ? 0 : 0.2) * WIN.th * (1 - k);
      var b = 14 * (1 - k), sIn = isMac ? 1 : 1.07 - 0.07 * k;
      if (isMac) g.style.transformOrigin = '0 50%';
      setS(g, 'transform', 'translate3d(' + spread.toFixed(2) + 'px,' + dy.toFixed(2) + 'px,0)' + (isMac ? ' scaleX(' + k.toFixed(4) + ')' : ' scale(' + sIn.toFixed(4) + ')'));
      setS(g, 'opacity', (isMac ? seg01(k, 0, 0.3) : k).toFixed(3));
      setS(g, 'filter', b > 0.05 ? 'blur(' + b.toFixed(2) + 'px)' : 'none');
    });
    /* un brillo cruza el nombre cuando ya llegó, y luego cada 7,5 s */
    var gl = 0;
    if (motionOn && t > 2.35) { var ph = ((t - 2.35) % 7.5) / 1.1; if (ph < 1) gl = ph; }
    setS(glint, 'opacity', gl > 0 && gl < 1 ? '0.9' : '0');
    setS(glint, 'backgroundPosition', ((1 - gl) * 100).toFixed(2) + '% 0');
    /* la línea bajo el nombre entra con el primer scroll */
    var ks = motionOn ? eo(seg01(p, 0.03, 0.13)) : 1;
    setS(winS, 'opacity', ks.toFixed(3));
    setS(winS, 'transform', 'translate3d(0,' + ((1 - ks) * 10).toFixed(1) + 'px,0)');
    setS(winS, 'letterSpacing', (0.26 + 0.12 * (1 - ks)).toFixed(3) + 'em');
    paintWheel(p, t, motionOn);
  }

  function paintWheel(p, t, motionOn) {
    /* entra al final de la entrada: el círculo se dibuja y luego aparecen las palabras */
    var draw = motionOn ? eo(seg01(t, 1.5, 3.0)) : 1, show = motionOn ? eo(seg01(t, 2.1, 3.0)) : 1;
    setS(whArc, 'strokeDashoffset', (WH.C * (1 - draw)).toFixed(1));
    /* el scroll la gira palabra por palabra, con una pausa corta en cada una */
    var pp = motionOn ? seg01(p, 0.12, 0.9) * 3 : 3, sIx = Math.min(2, Math.floor(pp)), f = pp - sIx;
    var pos = pp >= 3 ? 3 : sIx + p2io(clamp((f - 0.18) / 0.64, 0, 1));
    whWords.forEach(function (n, i) {
      var d = (i - pos) * STEP, th = Math.PI - d;                     /* la siguiente espera abajo y sube a su lugar */
      var x = WH.cx + WH.R * Math.cos(th), y = WH.cy + WH.R * Math.sin(th);
      var near = Math.max(0, 1 - Math.abs(d) / STEP);
      var sc = 0.5 + 0.5 * near, a = (th - Math.PI) * 180 / Math.PI, far = Math.abs(d) / (Math.PI * 0.47);
      setS(n, 'opacity', (far >= 1 ? 0 : (0.4 + 0.6 * near) * (1 - far * far) * show).toFixed(3));
      setS(n, 'transform', 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + a.toFixed(2) + 'deg) translateX(' + (-WH.gap).toFixed(1) + 'px) scale(' + sc.toFixed(4) + ') translate(-100%,-50%)');
      var tk = whTicks[i];
      setA(tk, 'cx', x.toFixed(1)); setA(tk, 'cy', y.toFixed(1)); setA(tk, 'r', (1.8 + 0.6 * near).toFixed(2));
      setS(tk, 'opacity', (far >= 1 ? 0 : (1 - far) * draw).toFixed(3));
    });
    /* el punto que marca el lugar activo queda quieto sobre el arco */
    setA(whNow, 'cx', (WH.cx - WH.R).toFixed(1)); setA(whNow, 'cy', WH.cy.toFixed(1));
    setS(whNow, 'opacity', show.toFixed(3));
  }

  /* ---------- bucle de tiempo y cursor: solo corre mientras el hero está en pantalla ---------- */
  function heroOn() { return pin.getBoundingClientRect().bottom > 0; }
  function loop(now) {
    A.raf = 0;
    if (disposed) return;
    var dt = A.last ? Math.min(now - A.last, 64) : 16; A.last = now; A.now = now;
    var k = 1 - Math.exp(-dt / 220);
    A.rx += (-A.my * 6 - A.rx) * k; A.ry += (A.mx * 8.5 - A.ry) * k;
    paint();
    if (isMotionOn() && heroOn()) A.raf = requestAnimationFrame(loop); else A.last = 0;
  }
  function wake() { if (!A.raf && !disposed && isMotionOn() && heroOn()) A.raf = requestAnimationFrame(loop); }
  var finePtr = window.matchMedia('(hover: hover) and (pointer: fine)');
  function onMove(e) {
    if (!finePtr.matches || !G.w) return;
    A.mx = clamp(e.clientX / G.w * 2 - 1, -1, 1); A.my = clamp(e.clientY / G.h * 2 - 1, -1, 1);
    wake();
  }
  function onLeave() { A.mx = A.my = 0; wake(); }

  return {
    layout: layout,
    /* lo llama render(p) de heroAnimation.js con el mismo p suavizado */
    render: function (p) { current = p; paint(); wake(); },
    start: function () {
      window.addEventListener('mousemove', onMove, { passive: true });
      document.documentElement.addEventListener('mouseleave', onLeave);
      /* la entrada empieza cuando las letras del logo están listas */
      Promise.all(glyphs.map(function (g) { return g.decode ? g.decode().catch(function () {}) : Promise.resolve(); })).then(function () {
        if (disposed) return;
        setTimeout(function () { if (disposed) return; A.t0 = performance.now(); A.now = A.t0; cache = {}; wake(); paint(); }, 250);
      });
    },
    destroy: function () {
      disposed = true;
      cancelAnimationFrame(A.raf);
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    }
  };
}
