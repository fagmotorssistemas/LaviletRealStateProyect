// Reference logic; only component scoping, lifecycle cleanup and the approved navbar integration differ.
import { createHeroNavbar } from './heroNavbarAnimation'

export function createHeroAnimation(root, classes, state) {
  var AR = 1672 / 941, BASE = 0.86, BLD_AR = 1356 / 585, TL_END = 0.95;
  var $ = function (id) { return id === "pin" ? root : root.querySelector(`[data-part="${id}"]`); };
  var pin = $("pin"), hero = $("hero"), bgInner = $("bgInner"), bld = $("bld"), comp = $("comp"), veil = $("veil");

  var GROUND_AR = 1672 / 492;
  var reduced = false;
  try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
  var motionOn = !reduced;

  var clamp = function (v, a, b) { return Math.min(Math.max(v, a), b); };
  var EASE = {
    none: function (t) { return t; },
    p2io: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    p2o: function (t) { return 1 - (1 - t) * (1 - t); },
    p3o: function (t) { return 1 - Math.pow(1 - t, 3); },
    back: function (t) { var c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  };
  function seg(T, start, dur, ease) { return EASE[ease](clamp((T - start) / dur, 0, 1)); }

  /* ---------- build the text ---------- */
  var real = [], ghosts = [];
  "LA VILET".split("").forEach(function (ch, i) {
    var a = document.createElement("span"), b = document.createElement("span");
    if (ch === " ") { a.className = b.className = classes.sp; a.innerHTML = b.innerHTML = "&nbsp;"; }
    else { a.textContent = b.textContent = ch; a.setAttribute("aria-hidden", "true"); if (i >= 3) a.dataset.v = "1"; real.push(a); ghosts.push(b); }
    $("t").appendChild(a); $("gh").appendChild(b);
  });
  var claim = $("claim");
  "El arte de vivir bien.".split(" ").forEach(function (w, i, arr) {
    var s = document.createElement("span"); s.className = classes.w; s.setAttribute("aria-hidden", "true");
    var it = document.createElement("i"); it.textContent = w; s.appendChild(it); claim.appendChild(s);
    if (i < arr.length - 1) claim.appendChild(document.createTextNode(" "));
  });
  var claimW = [].slice.call(claim.querySelectorAll("i"));
  var subL = [].slice.call($("sub").querySelectorAll("i"));
  var navbar = createHeroNavbar(root, geoForNavbar);
  function geoForNavbar() { return geo; }
  var paths = {};
  ["pH", "pV", "pB", "pR", "pU"].forEach(function (id) {
    var el = $(id), L = el.getTotalLength();
    el.style.strokeDasharray = L;
    paths[id] = { el: el, L: L };
  });
  var dias = { dB: { el: $("dB"), cx: 334, cy: 231 }, dR: { el: $("dR"), cx: 295, cy: 522 } };
  var INK = [241, 234, 218], ACC = [252, 185, 136];

  /* ---------- geometry ---------- */
  var geo = { bh: 0, h: 0, s: 1 }, F = [];
  function fitComp(w, h) {
    var portrait = w / h < 1.25;
    hero.classList.toggle(classes.portrait, portrait);
    var s;
    if (portrait) {
      s = Math.min(w / 720, h / 1100);
      comp.style.left = "0px"; comp.style.top = "0px";
      comp.style.transformOrigin = "0 0";
      comp.style.transform = "scale(" + s + ")";
      $("gh").style.left = (w / 2 / s + 5) + "px";
      $("sd").style.left = (w / 2 / s) + "px";
      $("sd").style.top = ((h - 34) / s) + "px";
    } else {
      s = Math.min(w / 1672, h / 941);
      comp.style.left = "50%"; comp.style.top = "0px"; /* pinned to the top edge so the menu sits at the top */
      comp.style.transformOrigin = "50% 0";
      comp.style.transform = "translate(-50%, 0) scale(" + s + ")";
      $("gh").style.left = "841px";
      $("sd").style.left = "836px";
      $("sd").style.top = "900px";
    }
    $("sd").style.marginLeft = "-11px";
    geo.s = s;
    /* user offsets, set in % of the screen and converted to canvas units */
    $("gh").style.left = (parseFloat($("gh").style.left) + state.logoX / 100 * w / s).toFixed(1) + "px";
    $("gh").style.top = (30 + state.logoY / 100 * h / s).toFixed(1) + "px";
    $("blk").style.transform = "translate(" + (state.txtX / 100 * w / s).toFixed(1) + "px," + (state.txtY / 100 * h / s).toFixed(1) + "px)";
    /* starting logo size, kept inside the screen width */
    var gh = $("gh"), fs = 97.5 * state.logo / 100;
    gh.style.fontSize = fs + "px";
    var gw = gh.getBoundingClientRect().width;
    if (gw > w * 0.94) gh.style.fontSize = (fs * w * 0.94 / gw).toFixed(2) + "px";
    /* where each letter starts: its twin in the centered logo */
    real.forEach(function (el) { el.style.transform = "none"; });
    F = real.map(function (el, i) {
      var a = ghosts[i].getBoundingClientRect(), b = el.getBoundingClientRect();
      return { x: (a.left + a.width / 2 - b.left - b.width / 2) / s, y: (a.top + a.height / 2 - b.top - b.height / 2) / s, k: a.height / b.height };
    });
  }

  function layout() {
    var w = hero.clientWidth, h = hero.clientHeight;
    var sw = Math.max(w, h * AR), sh = sw / AR, st = h - sh;
    var desk = w / h >= 1.25;
    var baseY = st + sh * BASE;
    var maxH = baseY - (desk ? 96 : 40);
    /* this render is wider (side walls and gardens), so it may run a bit past the screen edges */
    var bw = Math.min(sw * 0.95, w * (desk ? 1.15 : 1.4), maxH * BLD_AR) * state.size / 100;
    var bh = bw / BLD_AR;
    var bl = w / 2 + w * state.x / 100 - bw / 2;
    var lift = state.y / 100 * h;
    var seamY = st + sh * 0.7747;
    /* street and sidewalk layer: moves freely, never leaves a gap at the bottom of the screen */
    var gdx = state.stX / 100 * w;
    var gz = Math.max(1, (w + 2 * Math.abs(gdx)) / sw);
    var gw = sw * gz, gh = gw / GROUND_AR;
    var gt = seamY + state.stY / 100 * h;
    gt = Math.max(gt, h - gh + 2);
    /* sky and city layer: its horizon stays at or below the street edge, and it always covers the screen */
    var dy = state.bgY / 100 * h, dx = state.bgX / 100 * w;
    /* the city may rise a little above the street edge: what shows in between is the far part of the same
       paved plaza (the background photo has 5.5% of its height of paving before its own curb) */
    var horizon = Math.max(seamY + dy, gt - 0.05 * sh);
    var z = Math.max(state.bgZ / 100, horizon / (0.7747 * sh), (w + 2 * Math.abs(dx)) / sw);
    var fw = sw * z, fh = sh * z;
    var s = hero.style;
    s.setProperty("--gw", gw.toFixed(1) + "px");
    s.setProperty("--gl", ((w - gw) / 2 + gdx).toFixed(1) + "px");
    s.setProperty("--gt", gt.toFixed(1) + "px");
    s.setProperty("--fw", fw.toFixed(1) + "px");
    s.setProperty("--fh", fh.toFixed(1) + "px");
    s.setProperty("--fl", ((w - fw) / 2 + dx).toFixed(1) + "px");
    s.setProperty("--ft", (horizon - fh * 0.7747).toFixed(1) + "px");
    s.setProperty("--sw", sw.toFixed(1) + "px");
    s.setProperty("--sh", sh.toFixed(1) + "px");
    s.setProperty("--st", st.toFixed(1) + "px");
    s.setProperty("--bw", bw.toFixed(1) + "px");
    s.setProperty("--bl", bl.toFixed(1) + "px");
    s.setProperty("--bt", (baseY - bh - lift).toFixed(1) + "px");
    pin.style.setProperty("--travel", motionOn ? (state.travel / 100 * h).toFixed(0) + "px" : "0px");
    geo.bh = bh; geo.h = h; geo.w = w; geo.bw = bw;
    /* car: drives in the near lane of the street layer */
    var cw = 0.25 * bw * state.carSize / 100, ch = cw * 332 / 1100;   /* this render is wider, so a smaller share of it */
    var wheelY = gt + gw * 165 / 1672 + state.carY / 100 * h;
    s.setProperty("--cw", cw.toFixed(1) + "px");
    s.setProperty("--cy", (wheelY - ch).toFixed(1) + "px");
    geo.cw = cw;
    /* man walking along the front of the plaza */
    var mh = bh * 0.09 * state.walkSize / 100, mw = mh * 370 / 560;
    var walker = $("walker").style;
    walker.width = mw.toFixed(1) + "px"; walker.height = mh.toFixed(1) + "px";
    walker.top = (bh * 0.995 - mh).toFixed(1) + "px";
    geo.mh = mh; geo.mw = mw;
    fitComp(w, h);
    target = progress();
    render(current = target);
  }

  /* ---------- one scroll timeline for everything ---------- */
  function progress() {
    var dist = pin.offsetHeight - hero.offsetHeight;
    if (!motionOn || dist <= 0) return 1;
    return clamp(-pin.getBoundingClientRect().top / dist, 0, 1);
  }
  function draw(id, k) { var p = paths[id]; p.el.style.strokeDashoffset = (p.L * (1 - k)).toFixed(2); }
  function pop(id, k) {
    var d = dias[id];
    d.el.setAttribute("transform", "translate(" + d.cx + " " + d.cy + ") scale(" + Math.max(k, 0.0001).toFixed(4) + ") translate(" + (-d.cx) + " " + (-d.cy) + ")");
    d.el.style.opacity = clamp(k, 0, 1).toFixed(3);
  }
  function render(p) {
    /* scene */
    var pb = EASE.p3o(clamp(p / 0.85, 0, 1));
    bld.style.transform = "translate3d(0," + ((1 - pb) * state.rise / 100 * geo.bh).toFixed(1) + "px,0)";
    var scale = 1 + (state.sky / 100) * (1 - EASE.p3o(p));
    bgInner.style.transform = "scale(" + scale.toFixed(4) + ")";
    applyTod(todForScroll(p));
    streetLife(p);

    /* text and frame, timed like the Portada La Vilet timeline */
    var T = p * TL_END;
    veil.style.opacity = seg(T, 0.04, 0.42, "none").toFixed(3);
    var sd = seg(T, 0, 0.1, "none");
    $("sd").style.opacity = (1 - sd).toFixed(3);
    $("sd").style.transform = "translateY(" + (12 * sd).toFixed(1) + "px)";

    real.forEach(function (el, i) {
      var k = seg(T, 0.05 + i * 0.042, 0.44, "p2io"), f = F[i] || { x: 0, y: 0, k: 1 };
      el.style.transform = "translate(" + (f.x * (1 - k)).toFixed(2) + "px," + (f.y * (1 - k)).toFixed(2) + "px) scale(" + (f.k + (1 - f.k) * k).toFixed(4) + ")";
      if (el.dataset.v) {
        el.style.color = "rgb(" + INK.map(function (c, j) { return Math.round(c + (ACC[j] - c) * k); }).join(",") + ")";
      }
    });

    navbar.align(paths);
    draw("pV", seg(T, 0.06, 0.34, "p2io"));
    draw("pH", seg(T, 0.10, 0.30, "p2io"));
    navbar.render(T);
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

  /* ---------- day / sunset / night ----------
     tod goes from 0 (day) through 1 (sunset) to 2 (night). The day layers sit at the bottom,
     sunset and night layers fade in on top, so going from day to night always passes through sunset. */
  var L = {
    sun: [$("imgBgS"), $("imgGroundS"), $("imgBldS")],
    night: [$("imgBgN"), $("imgGroundN"), $("imgBldN")]
  };
  function applyTod(t) {
    var sun = clamp(t, 0, 1), night = clamp(t - 1, 0, 1);
    L.sun.forEach(function (el) { el.style.opacity = sun.toFixed(4); });
    L.night.forEach(function (el) { el.style.opacity = night.toFixed(4); });
    /* the warm sunset grade on the day building only applies around sunset */
    var sunsetWeight = clamp(1 - Math.abs(t - 1), 0, 1);
    hero.style.setProperty("--tint", (state.tint / 100 * sunsetWeight).toFixed(3));
    hero.style.setProperty("--night", night.toFixed(3));
    $("imgBldX").style.opacity = sunsetWeight.toFixed(4);
    $("imgBldY").style.opacity = night.toFixed(4);
  }
  /* scroll → time of day: a short stretch of day, a slow slide into sunset, a brief pause, then a slow slide into night */
  function todForScroll(p) {
    var sm = function (a, b, x) { var t = clamp((x - a) / Math.max(b - a, 0.001), 0, 1); return t * t * (3 - 2 * t); };
    var s = state.sunsetAt / 100, n = Math.max(state.nightAt / 100, s + 0.12);
    var dayEnd = Math.min(0.08, s * 0.4), hold = Math.min(0.08, (n - s) * 0.3);
    return sm(dayEnd, s, p) + sm(s + hold, n, p);
  }
  /* 0 → 1 across the sunset → night stretch of the scroll */
  function nightPhase(p) {
    var s = state.sunsetAt / 100, n = Math.max(state.nightAt / 100, s + 0.12);
    var hold = Math.min(0.08, (n - s) * 0.3);
    return clamp((p - (s + hold)) / Math.max(n - (s + hold), 0.001), 0, 1);
  }

  /* ---------- street life, entirely driven by the scroll ----------
     Each one owns a short stretch of the sunset → night part of the scroll. Inside that stretch its
     position is a direct function of the scroll, so it stops exactly where the scroll stops. */
  var carEl = $("car"), walkerEl = $("walker");
  var trailEl = carEl.querySelector("." + classes.trail), carBody = carEl.querySelector("." + classes.body);
  var walkFrames = [].slice.call(walkerEl.querySelectorAll("img"));   /* stride, legs together, other stride */
  var WALK_CYCLE = [0, 1, 2, 1];
  var last = { carX: null, walkX: null };
  function stretch(N, center, span) { return (N - (center - span / 2)) / span; }
  function streetLife(p) {
    var N = nightPhase(p);
    /* car: crosses the whole screen within its stretch; the light trail and blur grow with scroll speed */
    var tc = stretch(N, 0.47, state.carSpan / 100);
    if (motionOn && tc > 0 && tc < 1) {
      var x = -geo.cw * 1.8 + (geo.w + geo.cw * 2.7) * tc;
      var v = last.carX === null ? 0 : Math.abs(x - last.carX);
      last.carX = x;
      var speed = clamp(v / (geo.cw * 0.04), 0, 1);
      carEl.style.transform = "translate3d(" + x.toFixed(1) + "px,0,0)";
      carEl.style.opacity = "1";
      trailEl.style.opacity = speed.toFixed(3);
      /* always a little soft and graded down to the dusk light of the scene */
      carBody.style.filter = "blur(" + (0.6 + speed * 1.0).toFixed(2) + "px) brightness(0.86) contrast(0.9) saturate(0.88)";
    } else { carEl.style.opacity = "0"; last.carX = null; }

    /* man: a quick pass along the front of the plaza; his steps follow the distance walked */
    var tw = stretch(N, 0.27, state.walkSpan / 100);
    if (motionOn && tw > 0 && tw < 1) {
      var dist = geo.bw * 0.5 * tw;
      var wx = geo.bw * 0.85 - dist - geo.mw / 2;
      /* walk cycle: stride → legs together → other stride → legs together, one frame every 0.21 body heights walked */
      var frame = WALK_CYCLE[Math.floor(dist / (geo.mh * 0.21)) % 4];
      walkFrames.forEach(function (im, i) { im.style.opacity = i === frame ? "1" : "0"; });
      var vw = last.walkX === null ? 0 : Math.abs(wx - last.walkX);
      last.walkX = wx;
      walkerEl.style.transform = "translate(" + wx.toFixed(1) + "px,0)";
      walkerEl.style.filter = "blur(" + (clamp(vw / (geo.mw * 0.06), 0, 1) * 1.0).toFixed(2) + "px)";
      walkerEl.style.opacity = clamp(Math.min(tw / 0.12, (1 - tw) / 0.12), 0, 1).toFixed(3);
    } else { walkerEl.style.opacity = "0"; last.walkX = null; }
  }

  var target = 0, current = 0, rafId = 0;
  var lenis = motionOn, disposed = false, settleTimer = 0;
  var lastTick = 0;
  function tick(now) {
    /* frame-rate independent smoothing: settles in roughly a quarter second (Lenis already smooths the page itself) */
    var dt = lastTick ? Math.min(now - lastTick, 100) : 16;
    lastTick = now;
    var k = 1 - Math.exp(-dt / (lenis ? 50 : 90));
    current += (target - current) * k;
    if (Math.abs(target - current) < 0.0004) current = target;
    render(current);
    rafId = current === target ? 0 : requestAnimationFrame(tick);
    if (!rafId) lastTick = 0;
    /* once the scroll settles, render again so motion blur and light trails fade on a stopped car */
    if (!rafId) { clearTimeout(settleTimer); settleTimer = setTimeout(function () { if (!disposed && !rafId) render(current); }, 90); }
  }
  function onScroll() {
    target = progress();
    if (!rafId) rafId = requestAnimationFrame(tick);
  }
  var rz;
  function onResize() { clearTimeout(rz); rz = setTimeout(layout, 120); }
  var media = window.matchMedia("(prefers-reduced-motion: reduce)");
  function onMotionChange() { reduced = media.matches; motionOn = !reduced; lenis = motionOn; layout(); }
  layout();
  return {
    start() {
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onResize);
      media.addEventListener("change", onMotionChange);
      navbar.start(onScroll);
      var critical = ["imgBg", "imgGround", "imgBld"].map(function (id) {
        var im = $(id);
        return im && im.decode ? im.decode().catch(function () {}) : Promise.resolve();
      });
      if (document.fonts && document.fonts.ready) critical.push(document.fonts.ready);
      Promise.all(critical).then(function () { if (!disposed) layout(); });
    },
    destroy() {
      disposed = true;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      media.removeEventListener("change", onMotionChange);
      clearTimeout(rz);
      clearTimeout(settleTimer);
      cancelAnimationFrame(rafId);
      navbar.destroy();
      ["t", "gh", "claim"].forEach(function (id) { $(id).replaceChildren(); });
    }
  };
}
