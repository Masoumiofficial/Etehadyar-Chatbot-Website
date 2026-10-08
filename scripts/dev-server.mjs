// Development-only HTTP + PHP-WASM server. Production uses Apache/Nginx + PHP.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHP } from '@php-wasm/universal';
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';

export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
};
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
let processId = process.pid * 100;

export async function startServer(options = {}) {
  const root = path.resolve(options.root || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const privateDir = path.resolve(options.privateDir || process.env.ETEHADYAR_PRIVATE_DIR || path.join(path.dirname(root), '.etehadyar-private'));
  if (privateDir === root || privateDir.startsWith(root + path.sep)) throw new Error('Private CMS storage must be outside the public root.');
  await fs.mkdir(privateDir, { recursive: true, mode: 0o700 });
  const php = new PHP(await loadNodeRuntime(options.phpVersion || '8.3', { emscriptenOptions: { processId: ++processId } }));
  php.mkdirTree('/site'); php.mkdirTree('/private');
  await php.mount('/site', createNodeFsMountHandler(root));
  await php.mount('/private', createNodeFsMountHandler(privateDir));
  const environment = { ETEHADYAR_PRIVATE_DIR: '/private', ETEHADYAR_TRUST_PROXY: '0',
    ETEHADYAR_ADMIN_USERNAME: process.env.ETEHADYAR_ADMIN_USERNAME || '',
    ETEHADYAR_ADMIN_PASSWORD_HASH: process.env.ETEHADYAR_ADMIN_PASSWORD_HASH || '', ...(options.env || {}) };

  const server = http.createServer(async (request, response) => {
    for (const [key, value] of Object.entries(securityHeaders)) response.setHeader(key, value);
    const finish = (status, message) => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(message); };
    try {
      const url = new URL(request.url, 'http://development.invalid');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(part => part.startsWith('.') || part === '..')) return finish(403, 'Forbidden');
      if (pathname === '/admin/api.php') {
        const chunks = []; let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 2097152) { finish(413, 'Request too large'); return; }
          chunks.push(chunk);
        }
        const result = await php.run({
          scriptPath: '/site/admin/api.php', relativeUri: url.pathname + url.search, method: request.method,
          protocol: request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http',
          headers: Object.fromEntries(Object.entries(request.headers).filter(([, value]) => typeof value === 'string')),
          body: new Uint8Array(Buffer.concat(chunks)), env: environment,
          $_SERVER: { DOCUMENT_ROOT: '/site', SCRIPT_NAME: '/admin/api.php', SCRIPT_FILENAME: '/site/admin/api.php',
            REMOTE_ADDR: request.socket.remoteAddress || '127.0.0.1',
            HTTPS: request.headers['x-forwarded-proto'] === 'https' ? 'on' : '' }
        });
        if (result.errors) console.error('PHP diagnostic:', result.errors);
        for (const [name, value] of Object.entries(result.headers)) {
          if (!['transfer-encoding', 'connection'].includes(name.toLowerCase())) response.setHeader(name, value);
        }
        response.statusCode = result.httpStatusCode;
        response.end(Buffer.from(result.bytes));
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD'); return finish(405, 'Method not allowed'); }
      if (/^\/(?:scripts|tests|deploy|node_modules)(?:\/|$)/.test(pathname) || /\.(?:php|md|mjs|zip)$/.test(pathname)
          || /^\/package(?:-lock)?\.json$/.test(pathname) || pathname.startsWith('/data/') && pathname !== '/data/site_data.json') return finish(403, 'Forbidden');
      let file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep) && file !== root) return finish(403, 'Forbidden');
      let stat;
      try { stat = await fs.stat(file); } catch (_) { return finish(404, 'Not found'); }
      if (stat.isDirectory()) {
        if (!pathname.endsWith('/')) { response.writeHead(308, { Location: pathname + '/' + url.search }); response.end(); return; }
        file = path.join(file, 'index.html');
        try { stat = await fs.stat(file); } catch (_) { return finish(403, 'Directory listing disabled'); }
      }
      const real = await fs.realpath(file);
      if (!real.startsWith(root + path.sep)) return finish(403, 'Forbidden');
      const extension = path.extname(file);
      if (!types[extension]) return finish(403, 'Forbidden');
      const bytes = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': types[extension], 'Content-Length': bytes.length,
        'Cache-Control': ['.html', '.json', '.js', '.css'].includes(extension) ? 'no-cache' : 'public, max-age=86400' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      console.error('Development server:', error.message);
      if (!response.headersSent) finish(error instanceof URIError ? 400 : 500, 'Request failed'); else response.end();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? Number(process.env.PORT || 8080), '0.0.0.0', resolve); });
  return { server, php, root, privateDir, url: 'http://127.0.0.1:' + server.address().port,
    async close() { await new Promise(resolve => server.close(resolve)); php.exit(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startServer();
  console.log('Etehadyar development preview listening on 0.0.0.0:' + app.server.address().port);
  console.log('Production requires PHP hosting; Node is only development tooling.');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
