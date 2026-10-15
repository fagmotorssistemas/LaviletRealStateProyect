// Literal reference animation; DOM queries are scoped to the component ref.
export function createHeroAnimation(root, classes, CONFIG) {
  var BLD_AR = 1553 / 909, STREET_AR = 1672 / 492, HORIZON = 0.7747, TL_END = 0.95;
  var $ = function (id) { return id === "pin" ? root : root.querySelector(`[data-part="${id}"]`); };
  var pin = $("pin"), hero = $("hero"), sky = $("sky"), bld = $("bld"), comp = $("comp"), veil = $("veil");
  var reduced = false;
  try { reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}

  var clamp = function (v, a, b) { return Math.min(Math.max(v, a), b); };
  var smooth = function (a, b, x) { var t = clamp((x - a) / Math.max(b - a, 0.001), 0, 1); return t * t * (3 - 2 * t); };
  var EASE = {
    none: function (t) { return t; },
    p2io: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },  // power2.inOut
    p2o: function (t) { return 1 - (1 - t) * (1 - t); },                                    // power2.out
    p3o: function (t) { return 1 - Math.pow(1 - t, 3); },                                   // power3.out / easeOutCubic
    back: function (t) { var c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); } // back.out(2.2)
  };
  function seg(T, start, dur, ease) { return EASE[ease](clamp((T - start) / dur, 0, 1)); }

  /* ---------- textos ---------- */
  var real = Array.from($("t").querySelectorAll("[data-letter]"));
  var ghosts = Array.from($("gh").querySelectorAll("[data-letter]"));
  var claimW = Array.from($("claim").querySelectorAll("i"));
  var subL = Array.from($("sub").querySelectorAll("i"));
  var navs = [$("na"), $("nb"), $("nc")];
  var paths = {};
  ["pH", "pV", "pB", "pR", "pU"].forEach(function (id) {
    var el = $(id), len = el.getTotalLength();
    el.style.strokeDasharray = len;
    paths[id] = { el: el, len: len };
  });
  var dias = { dB: { el: $("dB"), cx: 334, cy: 231 }, dR: { el: $("dR"), cx: 295, cy: 522 } };
  var INK = [241, 234, 218], ACC = [252, 185, 136];
  var sunLayers = [].slice.call(root.querySelectorAll("." + classes.sun));
  var nightLayers = [].slice.call(root.querySelectorAll("." + classes.night));

  /* ---------- geometría ---------- */
  var geo = { bh: 0, h: 0 }, F = [];
  function fitComp(w, h, portrait) {
    var s;
    if (portrait) {
      s = Math.min(w / 720, h / 1100);
      comp.style.left = "0px";
      comp.style.transformOrigin = "0 0";
      comp.style.transform = "scale(" + s + ")";
      $("gh").style.left = (w / 2 / s + 5) + "px";
      $("sd").style.left = (w / 2 / s) + "px";
      $("sd").style.top = ((h - 34) / s) + "px";
    } else {
      s = Math.min(w / 1672, h / 941);
      comp.style.left = "50%";
      comp.style.transformOrigin = "50% 0";
      comp.style.transform = "translate(-50%, 0) scale(" + s + ")";
      $("gh").style.left = "841px";
      $("sd").style.left = "836px";
      $("sd").style.top = "900px";
    }
    /* logo inicial, sin salirse del ancho de pantalla */
    var fs = 97.5 * CONFIG.logoSize;
    $("gh").style.fontSize = fs + "px";
    var gw = $("gh").getBoundingClientRect().width;
    if (gw > w * 0.94) $("gh").style.fontSize = (fs * w * 0.94 / gw).toFixed(2) + "px";
    /* de dónde sale cada letra: su gemela en el logo inicial */
    real.forEach(function (el) { el.style.transform = "none"; });
    F = real.map(function (el, i) {
      var a = ghosts[i].getBoundingClientRect(), b = el.getBoundingClientRect();
      return { x: (a.left + a.width / 2 - b.left - b.width / 2) / s, y: (a.top + a.height / 2 - b.top - b.height / 2) / s, k: a.height / b.height };
    });
  }

  function layout() {
    var w = hero.clientWidth, h = hero.clientHeight;
    var portrait = w / h < 1.25;
    hero.classList.toggle(classes.portrait, portrait);
    var B = h * CONFIG.baseLine;                         // base del edificio = borde de la vereda

    /* edificio: casi todo el ancho; en pantallas muy anchas lo limita el alto (con un poco de techo fuera, como máximo topCropMax) */
    var bh = Math.min(w * (portrait ? CONFIG.buildingWidthPortrait : CONFIG.buildingWidth) / BLD_AR, B / (1 - CONFIG.topCropMax));
    var bw = bh * BLD_AR;

    /* calle: su borde superior en la base del edificio, cubre todo el ancho y hasta abajo */
    var gw = Math.max(w, (h - B + 2) * STREET_AR);

    /* cielo y ciudad: horizonte skyDrop por debajo de la vereda; escala mínima que cubre la pantalla */
    var horizonY = B + CONFIG.skyDrop * h;
    var sc = Math.max(w / 1672, horizonY / (HORIZON * 941));
    var fw = 1672 * sc, fh = 941 * sc;

    var st = hero.style;
    st.setProperty("--bw", bw.toFixed(1) + "px");
    st.setProperty("--bl", ((w - bw) / 2).toFixed(1) + "px");
    st.setProperty("--bt", (B - bh).toFixed(1) + "px");
    st.setProperty("--gw", gw.toFixed(1) + "px");
    st.setProperty("--gl", ((w - gw) / 2).toFixed(1) + "px");
    st.setProperty("--gt", B.toFixed(1) + "px");
    st.setProperty("--fw", fw.toFixed(1) + "px");
    st.setProperty("--fh", fh.toFixed(1) + "px");
    st.setProperty("--fl", ((w - fw) / 2).toFixed(1) + "px");
    st.setProperty("--ft", (horizonY - fh * HORIZON).toFixed(1) + "px");
    pin.style.setProperty("--travel", reduced ? "0px" : (CONFIG.travel * h).toFixed(0) + "px");
    geo.bh = bh; geo.h = h;
    fitComp(w, h, portrait);
    target = progress();
    render(current = target);
  }

  /* ---------- progreso del scroll ---------- */
  function progress() {
    var dist = pin.offsetHeight - hero.offsetHeight;
    if (reduced || dist <= 0) return 1;
    return clamp(-pin.getBoundingClientRect().top / dist, 0, 1);
  }

  /* día (0) → atardecer (1) → noche (2) */
  function timeOfDay(p) {
    var s = CONFIG.sunsetAt, n = Math.max(CONFIG.nightAt, s + 0.12);
    var dayEnd = Math.min(0.08, s * 0.4), hold = Math.min(0.08, (n - s) * 0.3);
    return smooth(dayEnd, s, p) + smooth(s + hold, n, p);
  }
  function applyTimeOfDay(t) {
    var sun = clamp(t, 0, 1), night = clamp(t - 1, 0, 1);
    sunLayers.forEach(function (el) { el.style.opacity = sun.toFixed(4); });
    nightLayers.forEach(function (el) { el.style.opacity = night.toFixed(4); });
    hero.style.setProperty("--tint", (CONFIG.sunsetTint * clamp(1 - Math.abs(t - 1), 0, 1)).toFixed(3));
  }

  function draw(id, k) { var p = paths[id]; p.el.style.strokeDashoffset = (p.len * (1 - k)).toFixed(2); }
  function pop(id, k) {
    var d = dias[id];
    d.el.setAttribute("transform", "translate(" + d.cx + " " + d.cy + ") scale(" + Math.max(k, 0.0001).toFixed(4) + ") translate(" + (-d.cx) + " " + (-d.cy) + ")");
    d.el.style.opacity = clamp(k, 0, 1).toFixed(3);
  }

  function render(p) {
    /* escena */
    var pb = EASE.p3o(clamp(p / 0.85, 0, 1));
    bld.style.transform = "translate3d(0," + ((1 - pb) * CONFIG.buildingRise * geo.bh).toFixed(1) + "px,0)";
    sky.style.transform = "scale(" + (1 + (CONFIG.skyZoomStart - 1) * (1 - EASE.p3o(p))).toFixed(4) + ")";
    applyTimeOfDay(timeOfDay(p));

    /* textos y líneas: T va de 0 a 0.95 */
    var T = p * TL_END;
    veil.style.opacity = seg(T, 0.04, 0.42, "none").toFixed(3);
    var sd = seg(T, 0, 0.1, "none");
    $("sd").style.opacity = (1 - sd).toFixed(3);
    $("sd").style.transform = "translateY(" + (12 * sd).toFixed(1) + "px)";

    real.forEach(function (el, i) {
      var k = seg(T, 0.05 + i * 0.042, 0.44, "p2io"), f = F[i] || { x: 0, y: 0, k: 1 };
      el.style.transform = "translate(" + (f.x * (1 - k)).toFixed(2) + "px," + (f.y * (1 - k)).toFixed(2) + "px) scale(" + (f.k + (1 - f.k) * k).toFixed(4) + ")";
      if (el.dataset.v) el.style.color = "rgb(" + INK.map(function (c, j) { return Math.round(c + (ACC[j] - c) * k); }).join(",") + ")";
    });
    draw("pV", seg(T, 0.06, 0.34, "p2io"));
    draw("pH", seg(T, 0.10, 0.30, "p2io"));
    navs.forEach(function (el, i) {
      var k = seg(T, 0.16 + i * 0.05, 0.2, "p2o");
      el.style.opacity = k.toFixed(3);
      el.style.transform = "translateY(" + (-10 * (1 - k)).toFixed(1) + "px)";
    });
    draw("pU", seg(T, 0.26, 0.16, "p2o"));
    draw("pB", seg(T, 0.30, 0.26, "p2io"));
    pop("dB", seg(T, 0.54, 0.10, "back"));
    var ke = seg(T, 0.36, 0.24, "p3o");
    $("eye").style.opacity = ke.toFixed(3);
    $("eye").style.transform = "translateX(" + (-56 * (1 - ke)).toFixed(1) + "px)";
    draw("pR", seg(T, 0.46, 0.18, "p2io"));
    pop("dR", seg(T, 0.62, 0.10, "back"));
    claimW.forEach(function (el, i) {
      var k = seg(T, 0.52 + i * 0.045, 0.26, "p3o");
      el.style.transform = "translateY(" + (108 * (1 - k)).toFixed(1) + "%)";
    });
    subL.forEach(function (el, i) {
      var k = seg(T, 0.66 + i * 0.07, 0.22, "p3o");
      el.style.transform = "translate(" + (-34 * (1 - k)).toFixed(1) + "px," + (108 * (1 - k)).toFixed(1) + "%)";
    });
  }

  /* ---------- bucle: suavizado corto e independiente de los fps (Lenis ya suaviza la página) ---------- */
  var target = 0, current = 0, rafId = 0, lastTick = 0, lenis = null;
  function tick(now) {
    var dt = lastTick ? Math.min(now - lastTick, 100) : 16;
    lastTick = now;
    current += (target - current) * (1 - Math.exp(-dt / (lenis ? 50 : 90)));
    if (Math.abs(target - current) < 0.0004) current = target;
    render(current);
    rafId = current === target ? 0 : requestAnimationFrame(tick);
    if (!rafId) lastTick = 0;
  }
  var rz, disposed = false;
  function onScroll() { target = progress(); if (!rafId) rafId = requestAnimationFrame(tick); }
  function onResize() { clearTimeout(rz); rz = setTimeout(layout, 120); }
  // The surrounding SmoothScrollProvider owns Lenis (lerp: 0.085).
  lenis = !reduced;
  layout();
  return {
    start() {
      addEventListener("scroll", onScroll, { passive: true });
      addEventListener("resize", onResize);
      var waits = Array.from(root.querySelectorAll("img"), im => im.decode ? im.decode().catch(function () {}) : Promise.resolve());
      if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready);
      Promise.all(waits).then(function () { if (!disposed) layout(); });
    },
    destroy() {
      disposed = true;
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
      clearTimeout(rz);
      cancelAnimationFrame(rafId);
    }
  };
}
