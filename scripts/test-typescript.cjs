// Compile TypeScript test imports using the same extension resolution as CommonJS.
// Supports extensionless imports in application modules on Node 20 and later.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) {
    return originalLoad.call(this, path.join(root, 'src', id.slice(2)), parent, main)
  }
  return originalLoad.call(this, id, parent, main)
}

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename)
