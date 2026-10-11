import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const p of ['index.html', 'styles.css', 'src', 'public']) {
  await cp(p, p === 'public' ? 'dist' : 'dist/' + p, { recursive: true });
}
// All URLs must resolve relative to the project directory on GitHub Pages.
async function patch(path, transform) {
  const source = await readFile(path, 'utf8');
  await writeFile(path, transform(source));
}
await patch('dist/index.html', s => s.replace(/(href|src)="\/(?!\/)/g, '$1="./'));
await patch('dist/styles.css', s => s.replace(/url\(['"]\//g, "url('./"));
await patch('dist/src/app/main.mjs', s => s.replace("navigator.serviceWorker.register('/sw.js')", "navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url))"));
await patch('dist/manifest.webmanifest', s => {
  const manifest = JSON.parse(s);
  manifest.start_url = './';
  manifest.scope = './';
  for (const icon of manifest.icons || []) icon.src = icon.src.replace(/^\//, './');
  return JSON.stringify(manifest);
});
await patch('dist/sw.js', s => s.replace("const CORE=['/','/index.html','/styles.css','/base.css','/desktop.css','/fixes.css','/src/app/main.mjs','/manifest.webmanifest','/icons/icon.svg'];", "const CORE=['./','./index.html','./styles.css','./base.css','./desktop.css','./fixes.css','./src/app/main.mjs','./manifest.webmanifest','./icons/icon.svg'].map(path=>new URL(path,self.registration.scope).href);"));
console.log('Built static dist/ with project-relative asset paths.');
