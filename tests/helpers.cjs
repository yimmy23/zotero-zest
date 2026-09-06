const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const console = require("node:console");
const { URL } = require("node:url");
const {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
} = require("node:timers");
const ts = require("typescript");

const root = path.resolve(path.dirname(module.filename), "..");
const compiled = new Map();

/** Execute real source modules with isolated host/transport substitutes. */
function createHarness({ mocks = {}, globals = {} } = {}) {
  const modules = new Map();
  const context = vm.createContext({
    console,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ztoolkit: { log() {} },
    addon: { data: { alive: true } },
    ...globals,
  });

  function load(name) {
    const filename = path.resolve(root, name);
    const key = path.relative(root, filename).split(path.sep).join("/");
    if (Object.hasOwn(mocks, key)) return mocks[key];
    if (modules.has(filename)) return modules.get(filename).exports;
    if (filename.endsWith(".json")) {
      return JSON.parse(fs.readFileSync(filename, "utf8"));
    }
    const source = fs.readFileSync(filename, "utf8");
    let entry = compiled.get(filename);
    if (!entry || entry.source !== source) {
      entry = {
        source,
        code: ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
          },
          fileName: filename,
        }).outputText,
      };
      compiled.set(filename, entry);
    }
    const module = { exports: {} };
    modules.set(filename, module);
    const localRequire = (request) => {
      if (Object.hasOwn(mocks, request)) return mocks[request];
      if (!request.startsWith(".")) {
        throw new Error(`Missing test substitute for ${request} in ${key}`);
      }
      const base = path.resolve(path.dirname(filename), request);
      const target = [base, `${base}.ts`, path.join(base, "index.ts")].find(
        (candidate) =>
          fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
      );
      if (!target) throw new Error(`Cannot resolve ${request} in ${key}`);
      return load(target);
    };
    const run = vm.runInContext(
      `(function(require, module, exports) {${entry.code}\n})`,
      context,
      { filename },
    );
    run(localRequire, module, module.exports);
    return module.exports;
  }

  return { load, context, mocks };
}

module.exports = { createHarness };
