// Appended inside the reviewed model's IIFE; shares its scene, units and materials.
const target = lookup[requestedUnit];
if (!target || target.id === 'common') throw new Error('MODEL_UNIT_NOT_FOUND');
const [lightX, lightZ] = target.center, shadowHalf = Math.max(...target.size) * .76 + 2.8;
sun.position.set(lightX - 22, 40, lightZ + 25); sun.target.position.set(lightX, 0, lightZ);
sun.target.updateMatrixWorld();
Object.assign(sun.shadow.camera, { left: -shadowHalf, right: shadowHalf, top: shadowHalf, bottom: -shadowHalf });
sun.shadow.camera.updateProjectionMatrix();
// The exported floor contains eleven homes. Only this one may enter the scene.
for (const unit of units) {
  unit.group.visible = unit === target;
  if (unit !== target) scene.remove(unit.group);
  else unit.wire.visible = false;
}
document.title = target.name + ' · Recorrido 3D | La Vilet';
ui('title').textContent = target.name;
ui('area').textContent = target.area.toLocaleString('es-EC', { minimumFractionDigits: 2 }) + ' m² interiores';
canvas.setAttribute('aria-label', 'Modelo 3D de ' + target.name + '. Arrastre para girar; use más y menos para acercarse.');
root.dataset.unit = target.id;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let yaw = -.16, elevation = .97, zoom = 1, spinning = false, topView = false;
let elapsed = reducedMotion ? 4 : 0, playing = !reducedMotion, last = 0, visible = true;
let width = 800, height = 570, drag = null, pinch = 0, disposed = false;
const touches = new Map();

function sync() {
  ui('spin').textContent = spinning ? 'Pausar giro' : 'Girar modelo';
  ui('spin').setAttribute('aria-pressed', String(spinning));
  ui('plan').textContent = topView ? 'Volver al 3D' : 'Vista superior';
  ui('plan').setAttribute('aria-pressed', String(topView));
  ui('spin').disabled = topView;
  ui('stage').textContent = playing ? 'Descubra sus espacios' : topView ? 'Distribución de ' + target.name.toLowerCase() : 'Explore a su ritmo';
}
function resize() {
  const box = view.getBoundingClientRect();
  width = Math.max(1, box.width); height = Math.max(1, box.height);
  renderer.setSize(width, height, false);
}
const sizeObserver = new ResizeObserver(resize); sizeObserver.observe(view); resize();
function finish() { playing = false; elapsed = 4; sync(); }
function reset() {
  yaw = -.16; elevation = .97; zoom = 1; topView = false; spinning = false;
  elapsed = reducedMotion ? 4 : 0; playing = !reducedMotion; last = 0; sync();
}
function changeZoom(factor) { finish(); zoom = Math.max(.65, Math.min(4, zoom * factor)); }
function render(now) {
  if (disposed) return;
  requestAnimationFrame(render);
  if (!visible || document.hidden) { last = 0; return; }
  const dt = last ? Math.min(.1, Math.max(0, (now - last) / 1000)) : 0; last = now;
  if (playing) { elapsed = Math.min(4, elapsed + dt); if (elapsed === 4) finish(); }
  const progress = ease(elapsed / 4);
  const angle = playing ? mix(.65, -.16, progress) : yaw;
  const tilt = topView ? PI / 2 - .0001 : elevation;
  if (spinning && !topView && !playing) yaw += dt * .25;
  // A short orbit of the chosen home, without revealing the rest of the floor.
  const span = Math.max(target.size[0] * 1.42, target.size[1] * 1.65, 14) * (playing ? mix(1.15, 1, progress) : 1) / zoom;
  const fit = Math.max(span, span * .72 / (width / height));
  camera.left = -fit / 2; camera.right = fit / 2;
  camera.top = fit * height / width / 2; camera.bottom = -camera.top;
  camera.updateProjectionMatrix();
  const [cx, cz] = target.center, distance = 85;
  camera.position.set(cx + Math.sin(angle) * Math.cos(tilt) * distance, Math.sin(tilt) * distance, cz + Math.cos(angle) * Math.cos(tilt) * distance);
  camera.lookAt(cx, .1, cz);
  renderer.render(scene, camera);
}
ui('replay').onclick = reset;
ui('plan').onclick = () => { finish(); topView = !topView; spinning = false; sync(); };
ui('spin').onclick = () => { finish(); spinning = !spinning; sync(); };
ui('zoom-in').onclick = () => changeZoom(1.2);
ui('zoom-out').onclick = () => changeZoom(1 / 1.2);
canvas.addEventListener('pointerdown', event => {
  finish(); spinning = false; sync(); canvas.setPointerCapture(event.pointerId);
  touches.set(event.pointerId, [event.clientX, event.clientY]); drag = [event.clientX, event.clientY];
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
});
canvas.addEventListener('pointermove', event => {
  if (!touches.has(event.pointerId)) return;
  touches.set(event.pointerId, [event.clientX, event.clientY]);
  if (touches.size === 2) {
    const [a, b] = [...touches.values()], next = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch) changeZoom(next / pinch);
    pinch = next; drag = null;
  } else if (drag && !topView) {
    yaw -= (event.clientX - drag[0]) * .006;
    elevation = Math.max(.16, Math.min(1.54, elevation + (event.clientY - drag[1]) * .006));
    drag = [event.clientX, event.clientY];
  }
});
function release(event) { touches.delete(event.pointerId); drag = null; pinch = 0; }
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', release);
canvas.addEventListener('wheel', event => { event.preventDefault(); changeZoom(Math.exp(-event.deltaY * .001)); }, { passive: false });
canvas.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) return;
  event.preventDefault(); finish(); spinning = false;
  if (event.key === 'Home') reset();
  else if (['+', '='].includes(event.key)) changeZoom(1.2);
  else if (event.key === '-') changeZoom(1 / 1.2);
  else if (!topView) {
    yaw += event.key === 'ArrowLeft' ? .12 : event.key === 'ArrowRight' ? -.12 : 0;
    elevation = Math.max(.16, Math.min(1.54, elevation + (event.key === 'ArrowUp' ? .08 : event.key === 'ArrowDown' ? -.08 : 0)));
  }
  sync();
});
const visibilityObserver = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; last = 0; });
visibilityObserver.observe(root);
// Context loss can happen on low-memory phones; never substitute another apartment's plan.
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); ui('stage').textContent = 'El visor se interrumpió. Recargue esta página para continuar.'; disposed = true; });
window.addEventListener('pagehide', event => { if (!event.persisted) { disposed = true; sizeObserver.disconnect(); visibilityObserver.disconnect(); renderer.dispose(); } });
sync(); requestAnimationFrame(render);
