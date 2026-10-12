import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

// Keep identical relative paths for branch-root GitHub Pages and Actions artifact builds.
for (const path of ['index.html', 'sandbox.html', 'styles.css', 'src', 'public', 'sw.js', '.nojekyll']) {
  await cp(path, 'dist/' + path, { recursive: true });
}
console.log('Built static dist/ with source-compatible GitHub Pages paths.');

