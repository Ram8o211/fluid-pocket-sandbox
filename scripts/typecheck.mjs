import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Fail clearly if dev dependencies are missing; syntax lint is not a type check.
const compiler = require.resolve('typescript/bin/tsc');
const result = spawnSync(process.execPath, [compiler, '-p', 'jsconfig.json'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
