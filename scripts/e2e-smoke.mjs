import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const required = [
  'index.html',
  'styles.css',
  'public/base.css',
  'public/desktop.css',
  'public/fixes.css',
  'public/manifest.webmanifest',
  'public/icons/icon.svg',
  'src/app/main.mjs',
  'sw.js',
  'public/sw.js'
];
const server = spawn(process.execPath, ['scripts/dev-server.mjs'], { stdio: 'ignore' });
try {
  await sleep(250);
  const base = 'http://127.0.0.1:4173/';
  const response = await fetch(base);
  if (!response.ok) throw new Error('App shell HTTP ' + response.status);
  const html = await response.text();
  for (const marker of [
    'scene','scene2d','view2dBtn','view3dBtn','materialSelect',
    'brushToolBtn','eraserToolBtn','inspectToolBtn','cameraToolBtn',
    'toolSize','sheetToggleBtn','motionBtn','manualPad','graphicsPreset',
    'renderRepresentation','combustionTemperature','combustionRate',
    'desktopHelp','saveInspectionBtn','exportBtn'
  ]) {
    if (!html.includes(marker)) throw new Error('Missing UI marker ' + marker);
  }
  if (/(?:src|href)="\/(?!\/)/.test(html)) throw new Error('Root-relative HTML asset breaks project Pages');
  if (!html.includes('id="embedded-pages-fallback"')) throw new Error('Missing inline CSS fallback');
  const style = await readFile('styles.css', 'utf8');
  if (/url\(['"]?\//.test(style)) throw new Error('Root-relative CSS import breaks project Pages');
  if (!html.includes('href="./styles.css) || !html.includes('src="./src/app/main.mjs))
    throw new Error('App entry points do not use project-relative URLs');
  const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
  if (manifest.start_url !== '../' || manifest.scope !== '../')
    throw new Error('PWA start URL must point to project root');
  for (const file of required) {
    const result = await fetch(base + file);
    if (!result.ok) throw new Error('Missing source asset ' + file + ': HTTP ' + result.status);
    await access('dist/' + file);
  }
  console.log('E2E static smoke OK: controls, source assets and dist assets are Pages-ready');
} finally {
  server.kill('SIGTERM');
}
