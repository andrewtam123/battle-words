import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.PORT || 4173);
const base = process.argv.includes('--project-path') ? '/battle-words/' : '/';
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(base)) {
      response.writeHead(302, { Location: base }); response.end(); return;
    }
    let path = resolve(root, pathname.slice(base.length) || 'index.html');
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': `${types[extname(path)] || 'application/octet-stream'}${extname(path) === '.png' ? '' : '; charset=utf-8'}`, 'Cache-Control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}${base}`));
