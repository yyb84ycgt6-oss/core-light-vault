// Minimal static server for public/ (localhost is a secure context, so
// WebCrypto, IndexedDB, OPFS and the service worker all work).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';

const dir = new URL('../public/', import.meta.url).pathname;
const port = Number(process.env.PORT || 8642);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(dir, path.endsWith('/') ? 'index.html' : path);
  if (!file.startsWith(dir)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`MEADOW EYE OS on http://localhost:${port}`));
