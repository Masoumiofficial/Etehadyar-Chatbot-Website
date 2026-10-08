import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startServer } from '../scripts/dev-server.mjs';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function fixture(options = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'etehadyar-tests-'));
  const root = path.join(temporary, 'site');
  const privateDir = path.join(temporary, 'private');
  await fs.mkdir(root); await fs.mkdir(privateDir);
  for (const entry of ['admin', 'assets', 'data', 'about', 'docs', 'changelog', 'scripts', 'index.html', '.htaccess', 'robots.txt', 'sitemap.xml', 'llms.txt', 'README-FA.md', 'CHANGELOG.md', 'AUDIT-FULL-REPORT.md', 'deploy']) {
    await fs.cp(path.join(repository, entry), path.join(root, entry), { recursive: true });
  }
  const app = await startServer({ root, privateDir, port: 0, ...options });
  return { ...app, temporary,
    async provision() {
      const username = 'fixture-admin';
      const password = crypto.randomBytes(18).toString('base64url');
      const response = await app.php.run({ code: '<?php echo password_hash(getenv("FIXTURE_PASSWORD"), PASSWORD_DEFAULT);', env: { FIXTURE_PASSWORD: password } });
      if (!response.text.startsWith('$2')) throw new Error('Fixture password hashing failed');
      await fs.writeFile(path.join(privateDir, 'credentials.json'), JSON.stringify({ username, passwordHash: response.text, revision: crypto.randomBytes(16).toString('hex') }), { mode: 0o600 });
      return { username, password };
    },
    async cleanup() { await app.close(); await fs.rm(temporary, { recursive: true, force: true }); }
  };
}

export class Client {
  constructor(url) { this.url = url; this.cookies = new Map(); this.csrf = ''; }
  async request(action, options = {}) {
    const method = options.method || (options.body === undefined ? 'GET' : 'POST');
    const headers = { Cookie: [...this.cookies].map(([name, value]) => name + '=' + value).join('; '), ...options.headers };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.csrf && options.csrf !== false) headers['X-CSRF-Token'] = this.csrf;
    const response = await fetch(this.url + '/admin/api.php?action=' + encodeURIComponent(action), {
      method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const cookies = response.headers.getSetCookie();
    for (const cookie of cookies) {
      const first = cookie.split(';')[0]; const index = first.indexOf('=');
      const name = first.slice(0, index), value = first.slice(index + 1);
      if (value && value !== 'deleted') this.cookies.set(name, value); else this.cookies.delete(name);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    let data;
    if (response.headers.get('content-type')?.includes('application/json')) data = JSON.parse(bytes.toString());
    if (data?.csrfToken) this.csrf = data.csrfToken;
    return { status: response.status, headers: response.headers, cookies, bytes, data };
  }
  async login(credentials) {
    await this.request('state');
    const result = await this.request('login', { body: credentials });
    if (result.status !== 200) throw new Error('Fixture login failed: ' + result.status + ' ' + result.data?.error);
    return result;
  }
}
