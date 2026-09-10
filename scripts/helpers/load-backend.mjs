import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

// Executes the actual handler with injected dependencies; no SDK/network access.
export async function loadBackend(path, dependencies = {}, environment = {}) {
  const source = await readFile(new URL('../../' + path, import.meta.url), 'utf8');
  const exports = {};
  let handler;
  const context = {
    exports, Response, Request, URL, Date, JSON, console, Blob, CompressionStream, DecompressionStream,
    crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob,
    Deno: { env: { get: (key) => environment[key] }, serve: (fn) => { handler = fn; } },
    require: (name) => {
      if (!(name in dependencies)) throw new Error('Unmocked dependency: ' + name);
      return dependencies[name];
    },
  };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context, { timeout: 2000, filename: path });
  return { handler, exports };
}
