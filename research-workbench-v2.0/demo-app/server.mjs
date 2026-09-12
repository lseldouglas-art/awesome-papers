import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { startServer } from '../demo-api/src/server.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const production = process.argv.includes('--production');
let vite;
const handler = async (req, res) => {
  if (!production) return vite.middlewares(req, res);
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const dist = resolve(root, 'dist');
    const filename = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filename.startsWith(`${dist}${sep}`)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(filename);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs':'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(filename)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }); res.end(body);
  } catch { res.writeHead(404); res.end('没有找到页面，请先构建前端。'); }
};
if (!production) {
  const { createServer } = await import('vite');
  vite = await createServer({ configFile: resolve(root, 'vite.config.mjs'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'spa' });
}
let app;
try { app = await startServer({ port: Number(process.env.RW_DEMO_PORT ?? 4318), ...(process.env.RW_DEMO_DATA_DIR ? { directory: process.env.RW_DEMO_DATA_DIR } : {}), frontend: handler }); }
catch (error) { await vite?.close(); throw error; }
console.log(`科研工作台 v2.0：${app.url}（本机保存，模型按本机配置启用）`);
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { if (closing) return; closing = true; await vite?.close(); await app.close(); process.exit(0); });
