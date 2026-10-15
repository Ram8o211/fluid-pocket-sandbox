import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
const required = ['index.html', 'sandbox.html', 'public/game.css', 'public/icons/alchemist.svg', 'public/manifest.webmanifest', 'src/game/main.mjs', 'src/game/brewing.mjs', 'src/game/effects.mjs', 'src/game/gathering.mjs', 'src/game/experiments.mjs', 'src/simulation/GasDensitySolver.mjs', 'src/simulation/PowderSolver.mjs', 'src/app/main.mjs', 'styles.css', 'public/base.css', 'public/desktop.css', 'public/fixes.css', 'sw.js', 'public/sw.js'];
const server = spawn(process.execPath, ['scripts/dev-server.mjs'], { stdio: 'ignore', env: { ...process.env, PORT: '4175', BASE_PATH: '/fluid-pocket-sandbox' } });
try {
  await sleep(250);
  const base = 'http://127.0.0.1:4175/fluid-pocket-sandbox/';
  const response = await fetch(base); if (!response.ok) throw new Error('App shell HTTP ' + response.status);
  const html = await response.text();
  for (const marker of ['menu', 'newWorldBtn', 'labCanvas', 'orderPanel', 'pourBtn', 'stirBtn', 'bottleBtn', 'inventoryBtn', 'bookBtn', 'upgradesBtn', 'sandboxBtn', 'natureBtn', 'experimentsBtn', 'grindBtn']) if (!html.includes(`id="${marker}"`)) throw new Error('Missing game control ' + marker);
  if (!html.includes('href="./public/game.css') || !html.includes('src="./src/game/main.mjs')) throw new Error('Game entries must use project-relative URLs');
  const sandbox = await (await fetch(base + 'sandbox.html')).text();
  for (const marker of ['scene', 'scene2d', 'view2dBtn', 'view3dBtn', 'materialSelect', 'brushToolBtn', 'eraserToolBtn', 'inspectToolBtn', 'cameraToolBtn', 'toolSize', 'sheetToggleBtn', 'motionBtn', 'manualPad', 'graphicsPreset', 'renderRepresentation', 'combustionTemperature', 'combustionRate', 'desktopHelp', 'saveInspectionBtn', 'exportBtn']) if (!sandbox.includes(`id="${marker}"`)) throw new Error('Missing sandbox control ' + marker);
  for (const file of ['index.html', 'sandbox.html']) {
    const source = await readFile(file, 'utf8'); if (/(?:src|href)="\/(?!\/)/.test(source)) throw new Error('Root-relative asset in ' + file);
  }
  const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
  if (manifest.start_url !== '../' || manifest.scope !== '../') throw new Error('PWA paths must stay project-relative');
  for (const file of [...required, 'src/game/rabbits.mjs', 'src/game/RabbitRenderer.mjs', 'src/game/RabbitMotion.mjs', 'public/toon.css', 'public/fonts/guild-pixel.woff']) { const result = await fetch(base + file); if (!result.ok) throw new Error('Missing asset ' + file); await access('dist/' + file); }
  console.log('Static smoke OK: game, original sandbox, and source/dist assets work under a Pages project path.');
} finally { server.kill('SIGTERM'); }
