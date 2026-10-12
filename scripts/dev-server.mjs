import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), port = Number(process.env.PORT || 4173), mount = (process.env.BASE_PATH || '').replace(/\/$/, '');
const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (mount) { if (p !== mount && !p.startsWith(mount + '/')) throw new Error('Outside mount'); p = p.slice(mount.length) || '/'; }
    if (p === '/') p = '/index.html';
    let file = path.resolve(root, '.' + p);
    if (!file.startsWith(root + path.sep)) throw new Error('Outside root');
    const st = await stat(file); if (st.isDirectory()) file = path.join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '0.0.0.0', () => console.log(`Alchemy dev server http://0.0.0.0:${port}${mount}/`));
