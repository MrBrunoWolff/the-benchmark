import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createActions } from './actions.mjs';
import { RunManager } from './lib/runner.mjs';
import { ROOT, safeRelative } from './lib/config.mjs';

export async function startServer({ port = Number(process.env.BENCHMARK_PORT || 4310), manager = new RunManager(), production = process.argv.includes('--production') } = {}) {
  const actions = createActions(manager);
  const studio = join(ROOT, 'studio');
  const vite = production ? null : await createViteServer({ root: studio, configFile: false,
    server: { middlewareMode: true }, appType: 'spa' });
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  const server = createServer(async (req, res) => {
    const host = req.headers.host || '';
    const allowedHosts = [`localhost:${server.address()?.port}`, `127.0.0.1:${server.address()?.port}`];
    if (!allowedHosts.includes(host)) return json(res, 403, { error: 'Localhost access only' });
    const path = new URL(req.url, `http://${host}`).pathname;
    if (path.startsWith('/api/')) {
      if (req.headers.origin && !allowedHosts.map(h => `http://${h}`).includes(req.headers.origin)) return json(res, 403, { error: 'Cross-origin requests are disabled' });
      if (req.headers['x-benchmark-studio'] !== '1') return json(res, 403, { error: 'Missing local API header' });
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
      try {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 64000) throw new Error('Request too large'); }
        const input = JSON.parse(raw || '{}');
        if (path === '/api/suite') return json(res, 200, JSON.parse(readFileSync(join(ROOT, 'tasks/local-v1/suite.json'), 'utf8')));
        const name = path.slice('/api/'.length);
        if (!Object.hasOwn(actions, name)) return json(res, 404, { error: 'Unknown action' });
        return json(res, 200, await actions[name].run(input, { caller: 'frontend' }));
      } catch (error) { return json(res, 400, { error: error.message }); }
    }
    if (vite) return vite.middlewares(req, res);
    try {
      const base = join(studio, 'dist');
      let file = path === '/' ? join(base, 'index.html') : safeRelative(base, decodeURIComponent(path).replace(/^\/+/, ''));
      if (!existsSync(file)) file = join(base, 'index.html');
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const stop = async () => { manager.close(); await vite?.close(); server.close(); };
  return { server, stop, manager, port: server.address().port };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const app = await startServer();
  console.log(`\n  the-benchmark studio  →  http://localhost:${app.port}\n  Runs are saved under out/studio. Ctrl+C stops the UI and cancels active work.\n`);
  process.once('SIGINT', async () => { await app.stop(); });
  process.once('SIGTERM', async () => { await app.stop(); });
}
