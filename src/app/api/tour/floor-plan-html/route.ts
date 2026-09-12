import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { FLOOR_PLAN_SCOPE, isFloorPlanLevel } from '@/lib/tour/floorPlanHotspots'
import {
  floorPlanImagePath,
  listFloorPlanMediaPaths,
  loadFloorPlanZones,
  withFloorPlanVariants,
} from '@/lib/tour/floorPlanZones'
import {
  floorPlanHtmlMemoryKey,
  getFloorPlanHtmlMemory,
  setFloorPlanHtmlMemory,
} from '@/lib/tour/floorPlanHtmlMemory'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Proxy del HTML interactivo del plano.
 * Supabase Storage fuerza text/plain + CSP sandbox en .html (no corre Three.js en iframe).
 * Servimos el archivo desde nuestra API como text/html.
 */
export async function GET(request: Request) {
  const admin = tryCreateAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Storage no configurado' }, { status: 503 })
  }

  const url = new URL(request.url)
  const typologyCode = url.searchParams.get('typology_code')?.trim() || FLOOR_PLAN_SCOPE
  const floor = Number(url.searchParams.get('floor') ?? '')
  const version = url.searchParams.get('v')?.trim() || ''
  const fresh =
    url.searchParams.get('fresh') === '1' || url.searchParams.get('fresh') === 'true'
  if (!isFloorPlanLevel(floor)) {
    return NextResponse.json({ error: 'Falta floor válido' }, { status: 400 })
  }

  // Con ?v= estable podemos servir desde memoria, salvo fresh=1 (post-upload CRM).
  if (version && !fresh) {
    const versionedKey = floorPlanHtmlMemoryKey(typologyCode, floor, version)
    const cachedVersioned = getFloorPlanHtmlMemory(versionedKey)
    if (cachedVersioned) {
      return htmlResponse(cachedVersioned.html, cachedVersioned.etag, true)
    }
  }

  const doc = await loadFloorPlanZones(admin, typologyCode, floor)
  const normalized = doc ? withFloorPlanVariants(doc) : null
  const htmlUrl = normalized?.variants['3d']?.htmlUrl ?? null
  const resolvedVersion =
    version || normalized?.updatedAt || doc?.updatedAt || `t${Date.now()}`
  const resolvedKey = floorPlanHtmlMemoryKey(typologyCode, floor, resolvedVersion)
  if (!fresh) {
    const cachedResolved = getFloorPlanHtmlMemory(resolvedKey)
    if (cachedResolved) {
      return htmlResponse(cachedResolved.html, cachedResolved.etag, true)
    }
  }

  let path = floorPlanImagePath(typologyCode, floor, 'html', '3d')
  if (htmlUrl) {
    const fromUrl = storagePathFromPublicUrl(htmlUrl)
    if (fromUrl) path = fromUrl
  }

  let data: Blob | null = null
  let error: { message?: string } | null = null
  {
    const first = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).download(path)
    data = first.data
    error = first.error
  }

  // Fallback: el JSON puede apuntar a un path borrado (caché / canónico viejo).
  // Buscar el HTML versionado más reciente en storage.
  if (error || !data) {
    const htmlPaths = (await listFloorPlanMediaPaths(admin, typologyCode, floor, '3d')).filter(
      (item) => /\.html$/i.test(item),
    )
    htmlPaths.sort((a, b) => versionStampFromPath(b) - versionStampFromPath(a))
    for (const candidate of htmlPaths) {
      if (candidate === path) continue
      const retry = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).download(candidate)
      if (!retry.error && retry.data) {
        path = candidate
        data = retry.data
        error = null
        break
      }
    }
  }

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || 'No hay HTML interactivo para este piso', path },
      { status: 404 },
    )
  }

  let html = await data.text()
  // Solo CSS/bridge: NO tocar canvas.width/height (rompe WebGL).
  // No forzar aspect-ratio fijo: PB es 2048×988, P2/P3 2048×970.
  const inject = `<style id="lv-floor-html-embed">
.tools,.loading{display:none!important}
html,body{
  margin:0!important;padding:0!important;width:100%!important;height:100%!important;
  background:#14110e!important;overflow:hidden!important;
}
#lavilet-p2-interactiva,[id^="lavilet-"]{
  position:absolute!important;inset:0!important;width:100%!important;height:100%!important;
  max-width:none!important;margin:0!important;background:#14110e!important;
  display:flex!important;align-items:center!important;justify-content:center!important;
}
.lv-view{
  position:relative!important;width:100%!important;height:auto!important;
  max-width:100%!important;max-height:100%!important;margin:0!important;
  background:#14110e!important;
}
canvas,.lv-fallback,.lv-labels{
  position:absolute!important;inset:0!important;
  width:100%!important;height:100%!important;display:block!important;
}
.lv-fallback{z-index:0!important;object-fit:fill!important;opacity:1!important}
canvas{z-index:1!important;pointer-events:auto!important}
.lv-view{pointer-events:auto!important}
/* Labels nativos off: el showroom pone el número clickeable en el centro de cada zona. */
.lv-labels{z-index:2!important;pointer-events:none!important;opacity:0!important}
svg.lv-labels,.unit-label{pointer-events:none!important}
</style>
<script id="lv-floor-html-bridge">
(function () {
  var booted = false;
  function api() {
    return window.LaViletPlanta || null;
  }
  function skipIntroOnce() {
    try {
      api()?.terminarPresentacion?.();
    } catch (e) {}
  }
  function post(type, detail) {
    try {
      parent.postMessage(
        Object.assign({ source: "lavilet-floor-html", type: type }, detail || {}),
        "*"
      );
    } catch (e) {}
  }
  function ensureHover() {
    var a = api();
    if (!a) return;
    var estado = typeof a.estado === "function" ? a.estado() : null;
    var view = document.querySelector(".lv-view");
    if (!view) return;
    // PB hover nativo: solo sincronizamos el id para el click / botón Abrir.
    if (estado && estado.modo === "hover") {
      if (view.getAttribute("data-lv-hover-sync") === "1") return;
      view.setAttribute("data-lv-hover-sync", "1");
      var lastNative = undefined;
      view.addEventListener(
        "pointermove",
        function (e) {
          if (e.pointerType === "touch" || e.buttons > 0) return;
          try {
            var r = view.getBoundingClientRect();
            if (!r.width || !r.height) return;
            var x = ((e.clientX - r.left) * (a.width || 2048)) / r.width;
            var y = ((e.clientY - r.top) * (a.height || 970)) / r.height;
            var id =
              (typeof a.identificar === "function" && a.identificar(x, y)) ||
              (typeof a.estado === "function" && a.estado() && a.estado().departamento) ||
              null;
            if (id === lastNative) return;
            lastNative = id;
            window.__lvLastHoverId = id || null;
            // No postMessage de hover: el parent re-renderizaba y mataba el FPS del WebGL.
            // El click (ficha) sí avisa al showroom.
          } catch (err) {}
        },
        { passive: true }
      );
      view.addEventListener(
        "pointerleave",
        function () {
          lastNative = null;
          window.__lvLastHoverId = null;
          // sin post hover (FPS)
        },
        { passive: true }
      );
      return;
    }
    if (view.getAttribute("data-lv-hover") === "1") return;
    view.setAttribute("data-lv-hover", "1");
    var lastId = undefined;
    var clear = function () {
      if (lastId == null) return;
      lastId = null;
      window.__lvLastHoverId = null;
      try {
        a.restablecer && a.restablecer({ animate: true });
      } catch (e) {}
    };
    var move = function (e) {
      if (e.pointerType === "touch" || e.buttons > 0) return;
      try {
        var r = view.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var x = ((e.clientX - r.left) * (a.width || 2048)) / r.width;
        var y = ((e.clientY - r.top) * (a.height || 970)) / r.height;
        var id = typeof a.identificar === "function" ? a.identificar(x, y) : null;
        if (id === lastId) return;
        lastId = id;
        window.__lvLastHoverId = id || null;
        if (id) {
          a.seleccionar(id);
          // sin post hover (FPS)
        } else if (typeof a.restablecer === "function") {
          a.restablecer({ animate: true });
        }
      } catch (err) {}
    };
    view.addEventListener("pointermove", move, { passive: true });
    view.addEventListener("pointerleave", clear, { passive: true });
  }
  function ensureClick() {
    var a = api();
    var view = document.querySelector(".lv-view");
    if (!a || !view || view.getAttribute("data-lv-click") === "1") return;
    view.setAttribute("data-lv-click", "1");
    var openFromPoint = function (clientX, clientY) {
      try {
        var r = view.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var xPct = ((clientX - r.left) / r.width) * 100;
        var yPct = ((clientY - r.top) / r.height) * 100;
        if (xPct < -2 || xPct > 102 || yPct < -2 || yPct > 102) return;
        var x = ((clientX - r.left) * (a.width || 2048)) / r.width;
        var y = ((clientY - r.top) * (a.height || 970)) / r.height;
        var id =
          window.__lvLastHoverId ||
          (typeof a.identificar === "function" && a.identificar(x, y)) ||
          (typeof a.estado === "function" && a.estado() && a.estado().departamento) ||
          null;
        // Siempre avisamos al showroom (con coords) para abrir ficha aunque el id no matchee.
        post("ficha", {
          departamento: id ? String(id) : null,
          xPercent: xPct,
          yPercent: yPct,
        });
      } catch (err) {}
    };
    view.addEventListener("click", function (e) {
      openFromPoint(e.clientX, e.clientY);
    });
    // Móvil: el elevate a veces mueve la malla y el click pierde el hit.
    view.addEventListener(
      "pointerup",
      function (e) {
        if (e.pointerType !== "touch") return;
        openFromPoint(e.clientX, e.clientY);
      },
      { passive: true }
    );
  }
  function boot() {
    if (!api() || booted) return;
    booted = true;
    skipIntroOnce();
    ensureHover();
    ensureClick();
  }
  document.addEventListener("lavilet:listo", boot);
  var n = 0;
  var t = setInterval(function () {
    boot();
    n += 1;
    if (booted || n > 100) clearInterval(t);
  }, 50);
})();
</script>`
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${inject}</head>`)
  } else {
    html = `${inject}${html}`
  }

  const etag = `"${resolvedVersion.replace(/"/g, '')}-${html.length}"`
  if (!fresh) {
    setFloorPlanHtmlMemory(resolvedKey, { html, etag })
  }

  return htmlResponse(html, etag, !fresh && Boolean(version || resolvedVersion))
}

function htmlResponse(html: string, etag: string, versioned: boolean) {
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ETag: etag,
      'Cache-Control': versioned
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' https:; media-src 'self' data: blob: https:",
    },
  })
}

function storagePathFromPublicUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const markers = [
      `/object/public/${TYPOLOGY_ASSETS_BUCKET}/`,
      `/object/sign/${TYPOLOGY_ASSETS_BUCKET}/`,
      `/object/authenticated/${TYPOLOGY_ASSETS_BUCKET}/`,
    ]
    for (const marker of markers) {
      const idx = parsed.pathname.indexOf(marker)
      if (idx >= 0) {
        return decodeURIComponent(parsed.pathname.slice(idx + marker.length))
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function versionStampFromPath(path: string): number {
  const match = path.match(/-v(\d+)\.(?:html|webp|jpe?g|png|gif)$/i)
  return match ? Number(match[1]) || 0 : 0
}
