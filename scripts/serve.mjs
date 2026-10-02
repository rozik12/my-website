#!/usr/bin/env node
/* Локальный статический сервер без зависимостей: node scripts/serve.mjs [папка] [порт] */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'dist');
const port = +(process.argv[3] || process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

export function startServer(root = dir, p = port) {
  const server = createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.join(root, rel);
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      let s = await stat(file).catch(() => null);
      if (s && s.isDirectory()) {
        if (!rel.endsWith('/')) { res.writeHead(301, { Location: rel + '/' }).end(); return; }
        file = path.join(file, 'index.html'); s = await stat(file).catch(() => null);
      }
      if (!s) { res.writeHead(404, { 'Content-Type': types['.html'] }).end(await readFile(path.join(root, '404.html')).catch(() => 'Not found')); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise(r => server.listen(p, () => r(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().then(() => console.log(`→ http://localhost:${port}  (папка ${path.relative(process.cwd(), dir) || '.'})`));
}
