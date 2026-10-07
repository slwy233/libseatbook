const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.resolve(__dirname, '../..');
let babel;
for (const location of [process.env.CODEX_TEST_MODULES, path.join(project, 'node_modules'), 'C:/lsb/node_modules'].filter(Boolean)) {
  try { babel = require(path.join(location, '@babel/core')); break; } catch (_) {}
}
if (!babel) throw new Error('Tests require @babel/core in local node_modules or CODEX_TEST_MODULES.');

// Minimal CommonJS lowering for these plain JavaScript modules; no production transformation.
const modulePlugin = ({ types: t }) => ({ visitor: {
  ImportDeclaration(p) {
    const required = t.callExpression(t.identifier('require'), [p.node.source]);
    if (!p.node.specifiers.length) { p.replaceWith(t.expressionStatement(required)); return; }
    const name = p.scope.generateUidIdentifier('module');
    const nodes = [t.variableDeclaration('const', [t.variableDeclarator(name, required)])];
    for (const spec of p.node.specifiers) {
      let value = name;
      if (t.isImportDefaultSpecifier(spec)) value = t.logicalExpression('||', t.memberExpression(name, t.identifier('default')), name);
      if (t.isImportSpecifier(spec)) {
        // Preserve live lookup across the client/authManager import cycle.
        const binding = p.scope.getBinding(spec.local.name);
        for (const reference of binding.referencePaths) reference.replaceWith(t.memberExpression(t.cloneNode(name), t.cloneNode(spec.imported)));
        continue;
      }
      nodes.push(t.variableDeclaration('const', [t.variableDeclarator(spec.local, value)]));
    }
    p.replaceWithMultiple(nodes);
  },
  ExportNamedDeclaration(p) {
    const declaration = p.node.declaration;
    const names = declaration
      ? (declaration.id ? [declaration.id.name] : declaration.declarations.map(d => d.id.name))
      : p.node.specifiers.map(s => s.local.name);
    const nodes = declaration ? [declaration] : [];
    for (let i = 0; i < names.length; i++) {
      const exported = declaration ? names[i] : p.node.specifiers[i].exported.name;
      nodes.push(t.expressionStatement(t.assignmentExpression('=', t.memberExpression(t.identifier('exports'), t.identifier(exported)), t.identifier(names[i]))));
    }
    p.replaceWithMultiple(nodes);
  },
} });

function response(body, status = 200) { return { status, ok: status >= 200 && status < 300, json: async () => body }; }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function createHarness() {
  const memory = new Map();
  const calls = [];
  const cache = new Map();
  const environment = { fetch: async () => { throw new Error('Unexpected network call: network is mocked'); }, xhr: null };
  const asyncStorage = {
    async getItem(key) { return memory.get(key) ?? null; },
    async setItem(key, value) { if (typeof value !== 'string') throw new Error('setItem requires a string'); memory.set(key, value); },
    async removeItem(key) { memory.delete(key); },
    async multiRemove(keys) { for (const key of keys) memory.delete(key); },
  };
  class XHR {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send() {
      calls.push({ xhr: true, url: this.url });
      queueMicrotask(() => {
        if (environment.xhr) { environment.xhr(this); return; }
        this.status = 200; this.readyState = 4;
        this.responseText = JSON.stringify({ status: true, data: { captchaId: 'captcha-id', captchaText: 'image' } });
        this.onreadystatechange();
      });
    }
  }
  function load(relative) {
    const file = path.resolve(project, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const entry = { exports: {} };
    cache.set(file, entry);
    const code = babel.transformSync(fs.readFileSync(file, 'utf8'), {
      babelrc: false, configFile: false, plugins: [modulePlugin], filename: file,
    }).code;
    const context = {
      exports: entry.exports, module: entry, require: spec => {
        if (spec === 'react-native') return { Platform: { OS: 'android' } };
        if (spec === '@react-native-async-storage/async-storage') return asyncStorage;
        if (spec.endsWith('/crypto')) return { encrypt: value => `encrypted:${value}`, makeHmacHeaders: () => ({ signature: 'mock' }) };
        if (!spec.startsWith('.')) throw new Error(`Unsupported dependency ${spec}`);
        return load(path.relative(project, path.resolve(path.dirname(file), `${spec}.js`)));
      },
      fetch: async (...args) => { calls.push({ url: args[0], options: args[1] }); return environment.fetch(...args); },
      XMLHttpRequest: XHR, AbortController, setTimeout, clearTimeout, console, Date, Promise,
    };
    vm.runInNewContext(code, context, { filename: file });
    return entry.exports;
  }
  return { load, memory, calls, environment, asyncStorage };
}
module.exports = { createHarness, deferred, response };
