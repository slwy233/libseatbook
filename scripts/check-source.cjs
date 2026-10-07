const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []);
}
const sources = [path.join(root, 'App.js'), ...files(path.join(root, 'src'))];
const asts = new Map(sources.map(file => [file, parser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })]));
const names = new Map();
for (const [file, ast] of asts) {
  const exported = new Set();
  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') exported.add('default');
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.id) exported.add(node.declaration.id.name);
      for (const decl of node.declaration?.declarations || []) exported.add(decl.id.name);
      for (const spec of node.specifiers || []) exported.add(spec.exported.name);
    }
  }
  names.set(file, exported);
}
for (const [file, ast] of asts) {
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), node.source.value + '.js');
    if (!asts.has(target)) throw new Error('Missing module: ' + node.source.value + ' in ' + file);
    for (const spec of node.specifiers) {
      const name = spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.imported?.name;
      if (name && !names.get(target).has(name)) throw new Error('Missing export: ' + name + ' in ' + target);
    }
  }
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
for (const type of ['dependencies', 'devDependencies']) {
  if (JSON.stringify(pkg[type]) !== JSON.stringify(lock.packages[''][type])) throw new Error(type + ' disagrees with package-lock');
}
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'))).expo;
for (const asset of [app.icon, app.splash.image, app.android.adaptiveIcon.foregroundImage]) {
  if (!fs.existsSync(path.resolve(root, asset))) throw new Error('Missing app asset: ' + asset);
}
console.log('Validated ' + sources.length + ' JS/JSX sources, local imports, dependency lock and app assets.');
