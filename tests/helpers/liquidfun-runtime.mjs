import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// Exercise the vendored C++/Emscripten engine, not a ballistic JS mock.
export function liquidFunRuntime() {
  const runtime = createContext({ console, print() {}, printErr() {}, setTimeout, clearTimeout });
  runInContext(readFileSync(new URL('../../public/vendor/liquidfun.js', import.meta.url), 'utf8'), runtime);
  return runtime;
}
