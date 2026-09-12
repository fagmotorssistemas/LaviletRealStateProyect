// Import only the reviewed self-contained export. Documents inside the ZIP are not executed.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')
const input = process.argv[2]
if (!input) throw Error('Use: node scripts/build-unit-model.cjs path/to/La-Vilet.html')
const original = fs.readFileSync(input, 'utf8')
const expected = 'bb1e3eb10e942799547dcde9239017dc414705cdcc0efa158e9a005ebe650acd'
if (crypto.createHash('sha256').update(original).digest('hex') !== expected) throw Error('Export changed: review the new geometry before importing')
const encoded = original.match(/data-srcdoc="([\s\S]*?)"/)[1]
const html = encoded.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, key) => key[0] === '#'
  ? String.fromCodePoint(key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : +key.slice(1))
  : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[key])
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
const engine = scripts[2][2]
let model = scripts[3][2]
function replaceOnce(from, to) {
  if (model.split(from).length !== 2) throw Error('Export marker changed: ' + from.slice(0, 70))
  model = model.replace(from, to)
}
const start = model.indexOf("const PLAN='")
const end = model.indexOf('const T=window.THREE')
if (start < 0 || end < start) throw Error('Model prelude missing')
model = model.slice(0, start) + `
const requestedUnit = new URLSearchParams(location.search).get('unidad') || '202';
if (!/^(?:20[1-9]|210|211)$/.test(requestedUnit)) {
  ui('title').textContent = 'Modelo no disponible';
  ui('stage').textContent = 'Este enlace no corresponde a una unidad con modelo 3D. Solicite el enlace de la unidad que le interesa.';
  root.querySelector('.lv-actions').hidden = true; return;
}
ui('title').textContent = (requestedUnit === '202' ? 'Departamento ' : 'Suite ') + requestedUnit;
if (!window.THREE) { ui('stage').textContent = 'No se pudo cargar el visor. Intente recargar la página.'; return; }
` + model.slice(end)
replaceOnce("ui('stage').textContent='Este dispositivo no ha podido iniciar el 3D. Aquí puede consultar el plano.';return;", "ui('stage').textContent='Este dispositivo no ha podido iniciar el 3D. Abra este enlace en Chrome, Edge o Safari actualizado.';root.querySelector('.lv-actions').hidden=true;return;")
const lightingStart = model.indexOf('// High precision shadows for the dwelling')
const lightingEnd = model.indexOf('// All coordinates below refer')
if (lightingStart < 0 || lightingEnd < lightingStart) throw Error('Lighting hook missing')
// Its foreground pass depends on the full-floor hover/intro controller being removed.
model = model.slice(0, lightingStart) + model.slice(lightingEnd)
const selection = "residential.sort((a,b)=>Number(a.id)-Number(b.id));ui('unit').replaceChildren();"
const selectionStart = model.indexOf(selection), selectionEnd = model.indexOf('// Ambient accessibility baked')
if (selectionStart < 0 || selectionEnd < selectionStart) throw Error('Model selection missing')
model = model.slice(0, selectionStart) + '\n' + model.slice(selectionEnd)
const runtimeStart = model.indexOf('// Original drawing below the sketch')
if (runtimeStart < 0) throw Error('Model runtime missing')
model = model.slice(0, runtimeStart) + fs.readFileSync(path.join(__dirname, 'model3d/viewer-runtime.js'), 'utf8') + '\n})();'
new vm.Script(engine); new vm.Script(model)
const output = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'">
<title>Recorrido 3D | La Vilet</title>
<style>
*{box-sizing:border-box}html,body{margin:0;background:#f6f5f1;color:#293b30;font:15px system-ui,-apple-system,sans-serif}button,canvas{outline-offset:4px}[hidden]{display:none!important}
#lavilet-terrazas-alineadas-v17{max-width:1200px;margin:20px auto;background:white;border:1px solid #e3e6dd;border-radius:18px;overflow:hidden}
.lv-top{padding:24px 28px;display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid #eceee7}.lv-brand{font:20px Georgia,serif;letter-spacing:.18em}.lv-sub{display:block;font:10px system-ui;letter-spacing:.12em;color:#737f73;margin-top:8px}h1{font:28px Georgia,serif;margin:0} .lv-area{font-size:13px;color:#71806e;text-align:right;margin-top:7px}
.lv-view{height:clamp(360px,66vh,660px);position:relative;background:white}canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}canvas:active{cursor:grabbing}.lv-stage{position:absolute;top:20px;left:28px;right:28px;pointer-events:none;color:#66745f;font-size:13px;line-height:1.5}
.lv-foot{padding:20px 28px;border-top:1px solid #eceee7}.lv-actions{display:flex;gap:10px;flex-wrap:wrap}button{font:inherit;color:#304334;background:#fff;border:1px solid #d9dfd3;border-radius:9px;min-height:44px;padding:10px 17px;cursor:pointer}button:hover{background:#f2f4ed}button[aria-pressed=true]{background:#304b3b;color:#fff}button:disabled{opacity:.45;cursor:default}.lv-note{color:#798171;font-size:12px;line-height:1.65;margin:14px 0 0}.lv-note a{color:inherit}
@media(max-width:600px){#lavilet-terrazas-alineadas-v17{margin:0;border:0;border-radius:0}.lv-top{padding:18px;align-items:flex-start}.lv-brand{font-size:15px}h1{font-size:24px}.lv-sub{font-size:9px;letter-spacing:.06em}.lv-area{font-size:12px}.lv-stage{left:18px;right:18px}.lv-foot{padding:18px}.lv-view{height:58svh;min-height:350px}.lv-actions{gap:8px}button{font-size:13px;padding:10px 12px}}
</style></head><body>
<main id="lavilet-terrazas-alineadas-v17">
<header class="lv-top"><div class="lv-brand">LA VILET<span class="lv-sub">DESCUBRA SUS ESPACIOS</span></div><div><h1 data-ui="title">Recorrido 3D</h1><div class="lv-area" data-ui="area"></div></div></header>
<div class="lv-view"><canvas tabindex="0" aria-label="Modelo 3D interactivo"></canvas><div class="lv-stage" data-ui="stage" role="status">Preparando su recorrido…</div></div>
<footer class="lv-foot"><div class="lv-actions"><button data-ui="replay">Repetir recorrido</button><button data-ui="plan" aria-pressed="false">Vista superior</button><button data-ui="spin" aria-pressed="false">Girar modelo</button><button data-ui="zoom-in" aria-label="Acercar modelo">＋</button><button data-ui="zoom-out" aria-label="Alejar modelo">−</button></div>
<p class="lv-note">Arrastre para girar. Pellizque o use los botones para acercarse.<br>Representación ilustrativa basada en el plano. Distribución y acabados referenciales. <a href="./LICENSE-Three.txt">Licencia del visor</a></p></footer>
</main><noscript>Active JavaScript para explorar el departamento en 3D.</noscript>
<script>${engine}</script><script>${model}</script></body></html>`
const directory = path.join(__dirname, '../public/tour/modelo-3d')
fs.mkdirSync(directory, { recursive: true })
fs.writeFileSync(path.join(directory, 'segunda-planta.html'), output)
console.log('Reviewed model built:', Buffer.byteLength(output), 'bytes; units 201–211, default 202')
