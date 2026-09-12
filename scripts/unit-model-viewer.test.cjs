const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const html = fs.readFileSync(path.join(__dirname, '../public/tour/modelo-3d/segunda-planta.html'), 'utf8')
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])

// Exercise the imported geometry and production controller, without a GPU/browser dependency.
// The renderer is the only Three.js class replaced; scene, geometry and camera are real.
function environment(query, reduced = false) {
  const elements = new Map(), frames = []
  function element(key) {
    if (!elements.has(key)) elements.set(key, { textContent:'', hidden:false, dataset:{}, style:{}, listeners:{},
      addEventListener(name, fn) { this.listeners[name]=fn }, setAttribute(name,value) { this[name]=value },
      getBoundingClientRect: () => ({width:390,height:500}), setPointerCapture() {} })
    return elements.get(key)
  }
  const root = element('root')
  root.querySelector = key => element(key.match(/data-ui="([^"]+)"/)?.[1] || key)
  const context2d = new Proxy({ createImageData: (w,h) => ({data:new Uint8ClampedArray(w*h*4)}),
    createLinearGradient:()=>({addColorStop(){}}), createRadialGradient:()=>({addColorStop(){}}),
  }, {get:(target,key)=>key in target?target[key]:()=>{}})
  const document = {hidden:false,getElementById:()=>root,createElement:()=>({width:0,height:0,getContext:()=>context2d})}
  const context = vm.createContext({ document, window:{addEventListener(){}}, location:{search:query}, URLSearchParams,
    console, Uint8ClampedArray, atob, devicePixelRatio:1, matchMedia:()=>({matches:reduced}),
    ResizeObserver:class{observe(){} disconnect(){}}, IntersectionObserver:class{observe(){} disconnect(){}},
    requestAnimationFrame:fn=>frames.push(fn) })
  vm.runInContext(scripts[0],context)
  const renderings=[]
  context.window.THREE.WebGLRenderer=class {
    shadowMap={}; setPixelRatio(){} setClearColor(){} setSize(){} dispose(){}
    render(scene,camera) {renderings.push({scene,camera})}
  }
  return {context,element,root,frames,renderings,
    tick(at) {const callback=frames.shift();assert.ok(callback,'render frame scheduled');callback(at)} }
}

test('unknown and malicious unit parameters never fall back to a different home',()=>{
  for(const query of ['?unidad=302','?unidad=999','?unidad=common','?unidad=%3Cscript%3E']) {
    const env=environment(query); vm.runInContext(scripts[1],env.context)
    assert.equal(env.element('title').textContent,'Modelo no disponible')
    assert.equal(env.frames.length,0)
    assert.equal(env.root.dataset.unit,undefined)
  }
})

test('exported 202 geometry runs and stays isolated during replay, top view, zoom and rotation',()=>{
  const env=environment('?unidad=202');vm.runInContext(scripts[1],env.context,{timeout:30000})
  assert.equal(env.root.dataset.unit,'202')
  assert.equal(env.element('title').textContent,'Departamento 202')
  for(let n=0;n<45;n++)env.tick(100+n*100)
  const scene=env.renderings.at(-1).scene
  const homes=()=>scene.children.filter(o=>o.isGroup&&o.visible)
  assert.equal(homes().length,1)
  const home=homes()[0], meshes=home.children[0].children
  assert.ok(meshes.length>10,'actual imported geometry was constructed')
  assert.ok(meshes.every(mesh=>mesh.userData.unit?.id==='202'))
  env.element('plan').onclick();env.tick(4700)
  assert.equal(env.element('plan')['aria-pressed'],'true')
  const camera=env.renderings.at(-1).camera
  assert.ok(camera.position.y>84,'top view above selected home')
  const before=camera.right
  env.element('zoom-in').onclick();env.tick(4800)
  assert.ok(camera.right<before)
  env.element('replay').onclick();env.tick(4900)
  env.element('spin').onclick();env.tick(5000)
  assert.equal(homes().length,1)
  assert.equal(homes()[0],home)
  assert.equal(env.element('title').textContent,'Departamento 202')
})

test('another supported link loads its own geometry and reduced motion is respected',()=>{
  const env=environment('?unidad=209',true);vm.runInContext(scripts[1],env.context,{timeout:30000});env.tick(100)
  assert.equal(env.element('title').textContent,'Suite 209')
  assert.equal(env.element('stage').textContent,'Explore a su ritmo')
  const home=env.renderings[0].scene.children.find(o=>o.isGroup&&o.visible)
  assert.ok(home.children[0].children.every(mesh=>mesh.userData.unit?.id==='209'))
  env.element('replay').onclick();env.tick(200)
  assert.equal(env.element('stage').textContent,'Explore a su ritmo')
})
