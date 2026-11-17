/**
 * Minimal in-process "bundler" for e2e helpers that must run INSIDE the browser page and use the real source files
 * (the web twins), without the app and without Metro.
 *
 * It transpiles a TypeScript entry and everything it imports through relative paths with the `typescript` compiler
 * (CommonJS output), and wraps the modules in a tiny CommonJS loader. Only relative imports of repository files are
 * supported (that is all the twins use); type-only imports are elided by the compiler.
 *
 * Used by e2e/twins.spec.ts to drive WebLinkTransport + the web MediaEngine in real Chromium. Test tooling only.
 */
import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.json'];

function resolveFile(fromFile: string, specifier: string): string {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...EXTENSIONS.map((extension) => base + extension),
    ...EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`pageBundle: cannot resolve "${specifier}" from ${fromFile}`);
}

interface CompiledModule {
  code: string;
  dependencies: Record<string, string>;
}

function compile(file: string): CompiledModule {
  if (file.endsWith('.json')) {
    return { code: `module.exports = ${fs.readFileSync(file, 'utf8')};`, dependencies: {} };
  }
  const source = fs.readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      verbatimModuleSyntax: false,
    },
  });
  const dependencies: Record<string, string> = {};
  for (const match of outputText.matchAll(/require\((['"])(.+?)\1\)/g)) {
    const specifier = match[2] as string;
    if (!specifier.startsWith('.')) {
      throw new Error(`pageBundle: ${file} imports "${specifier}"; only relative imports are supported`);
    }
    dependencies[specifier] = resolveFile(file, specifier);
  }
  return { code: outputText, dependencies };
}

/** Returns a script (string) that defines every module reachable from `entry` and runs the entry. */
export function buildPageBundle(entry: string): string {
  const entryFile = path.resolve(entry);
  const modules = new Map<string, CompiledModule>();
  const visit = (file: string) => {
    if (modules.has(file)) return;
    const compiled = compile(file);
    modules.set(file, compiled);
    for (const dependency of Object.values(compiled.dependencies)) visit(dependency);
  };
  visit(entryFile);

  const table = [...modules]
    .map(
      ([file, { code, dependencies }]) =>
        `${JSON.stringify(file)}: { deps: ${JSON.stringify(dependencies)}, run: function (exports, require, module) {\n${code}\n} }`,
    )
    .join(',\n');

  return `(function () {
  var modules = {\n${table}\n};
  var cache = {};
  function load(file) {
    if (cache[file]) return cache[file].exports;
    var module = { exports: {} };
    cache[file] = module;
    var definition = modules[file];
    definition.run.call(module.exports, module.exports, function (specifier) { return load(definition.deps[specifier]); }, module);
    return module.exports;
  }
  load(${JSON.stringify(entryFile)});
})();`;
}
