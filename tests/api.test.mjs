import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fixture, Client } from './helpers.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
test('CMS API: authentication, validation, atomic publication and private backups', async t => {
  const app = await fixture(); t.after(() => app.cleanup());
  const guest = new Client(app.url);
  await t.test('starts unconfigured and rejects every protected endpoint', async () => {
    const state = await guest.request('state');
    assert.equal(state.status, 200); assert.equal(state.data.setupRequired, true); assert.equal(state.data.authenticated, false);
    assert.match(state.cookies[0], /HttpOnly/i); assert.match(state.cookies[0], /SameSite=Strict/i);
    assert.match(state.cookies[0], /path=\/admin\//i);
    assert.doesNotMatch(state.cookies[0], /;\s*Secure/i);
    assert.equal(state.headers.get('x-powered-by'), null);
    const secureState = await new Client(app.url).request('state', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.match(secureState.cookies[0], /;\s*Secure/i);
    assert.match(secureState.cookies[0], /HttpOnly/i);
    for (const action of ['get_data', 'save_data', 'change_password', 'download_zip']) {
      const r = await guest.request(action, { body: ['save_data', 'change_password'].includes(action) ? {} : undefined });
      assert.equal(r.status, 401, action); assert.equal(r.data.success, false);
    }
    assert.equal((await guest.request('login', { body: { username: 'unknown', password: 'not-a-real-password' } })).status, 503);
  });
  const credentials = await app.provision();
  const admin = new Client(app.url);
  await t.test('requires login CSRF, uses the correct methods, and rotates the session', async () => {
    await admin.request('state');
    assert.equal((await admin.request('login', { body: credentials, csrf: false })).status, 403);
    assert.equal((await admin.request('login')).status, 405);
    assert.equal((await admin.request('not_an_action')).status, 404);
    const before = admin.cookies.get('etehadyar_admin_session');
    assert.equal((await admin.request('login', { body: credentials })).status, 200);
    assert.notEqual(admin.cookies.get('etehadyar_admin_session'), before);
    assert.equal((await admin.request('state')).data.authenticated, true);
    assert.equal((await admin.request('save_data', { body: {}, csrf: false })).status, 403);
  });
  let current;
  await t.test('loads server content with a revision and never exposes a credential', async () => {
    current = (await admin.request('get_data')).data;
    assert.ok(current.data.hero); assert.match(current.revision, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(current).includes(credentials.password));
    await fs.writeFile(path.join(app.root, 'data/admin_creds.json'), '{"legacy":"fixture-only"}');
    for (const uri of ['/data/admin_creds.json', '/admin/lib.php', '/scripts/setup-admin.php', '/package.json', '/.git/config', '/ehehadyar-chat-theme.zip']) {
      const r = await fetch(app.url + uri); assert.equal(r.status, 403, uri);
    }
    assert.equal((await fetch(app.url + '/data/site_data.json')).status, 200);
  });
  await t.test('rejects malformed data, unsafe URLs, duplicate versions and mismatched current versions', async () => {
    const mutations = [
      data => { data.config.purchaseUrlIR = 'javascript:alert(1)'; },
      data => { data.config.purchaseUrlIR = data.config.productUrl; },
      data => { data.config.purchaseUrlInternational = 'http://payment.example/checkout'; },
      data => { data.config.priceUSD = '-1'; },
      data => { data.releases.push(copy(data.releases[0])); },
      data => { data.config.currentVersion = '99.0.0'; },
      data => { data.hero.headlineFa = {}; },
      data => { data.faqs = null; }
    ];
    const original = await fs.readFile(path.join(app.root, 'data/site_data.json'));
    for (const mutate of mutations) {
      const data = copy(current.data); mutate(data);
      const r = await admin.request('save_data', { body: { data, revision: current.revision } });
      assert.equal(r.status, 400, JSON.stringify(r.data));
      assert.deepEqual(await fs.readFile(path.join(app.root, 'data/site_data.json')), original);
    }
  });
  await t.test('publishes edits, computes stable counts, and prevents lost updates', async () => {
    const stale = current.revision;
    const data = copy(current.data); data.hero.headlineFa = 'تیتر ذخیره‌شده در آزمون'; data.config.priceUSD = '151';
    data.releases.find(release => release.is_alpha).is_alpha = false;
    const saved = await admin.request('save_data', { body: { data, revision: stale } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data)); assert.equal(saved.data.success, true);
    current = saved.data;
    const raw = await fs.readFile(path.join(app.root, 'data/site_data.json'));
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), current.revision);
    assert.equal(current.data.config.totalReleases, String(current.data.releases.filter(release => !release.is_alpha).length));
    assert.equal(current.data.releases.find(release => release.version.includes('-')).is_alpha, true);
    const publicData = await (await fetch(app.url + '/data/site_data.json')).json();
    assert.equal(publicData.hero.headlineFa, data.hero.headlineFa); assert.equal(publicData.config.priceUSD, '151');
    assert.equal((await admin.request('save_data', { body: { data, revision: stale } })).status, 409);
    assert.deepEqual(await fs.readFile(path.join(app.root, 'data/site_data.json')), raw);
  });
  await t.test('storage failure returns an error without publishing a partial file', async () => {
    const file = path.join(app.root, 'data/site_data.json');
    const before = await fs.readFile(file);
    // NodeFS/WASM permission caching differs from native PHP. Inject a failing
    // atomic rename in this isolated fixture; no production fault switch exists.
    const library = path.join(app.root, 'admin/lib.php');
    const source = await fs.readFile(library, 'utf8');
    await fs.writeFile(library, source.replace('@rename($temporary, $path)', '@rename($temporary, $path . "/blocked")'));
    try {
      const changed = copy(current.data); changed.hero.headlineFa = 'این تیتر نباید منتشر شود';
      const r = await admin.request('save_data', { body: { data: changed, revision: current.revision } });
      assert.equal(r.status, 503, r.data.error || 'Unexpected successful response'); assert.equal(r.data.success, false);
      assert.deepEqual(await fs.readFile(file), before);
    } finally { await fs.writeFile(library, source); }
  });
  await t.test('ZIP is valid, includes saved data and excludes private/legacy credentials', async () => {
    const r = await admin.request('download_zip'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /application\/zip/);
    const zip = path.join(app.temporary, 'backup.zip'); await fs.writeFile(zip, r.bytes);
    execFileSync('python', ['-c', 'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert "admin/api.php" in z.namelist(); assert "admin/lib.php" in z.namelist(); assert "scripts/setup-admin.php" in z.namelist(); assert json.loads(z.read("data/site_data.json"))["config"]["priceUSD"] == "151"; assert not any("creds" in n or "credentials" in n or "sessions" in n or "login-rate" in n for n in z.namelist())', zip]);
  });
  const second = new Client(app.url); await second.login(credentials);
  let replacement;
  await t.test('changing a password requires the current password and invalidates other sessions', async () => {
    replacement = crypto.randomBytes(18).toString('base64url');
    assert.equal((await admin.request('change_password', { body: { username: credentials.username, currentPassword: 'wrong-password', password: replacement } })).status, 401);
    assert.equal((await admin.request('change_password', { body: { username: credentials.username, currentPassword: credentials.password, password: 'too-short' } })).status, 400);
    const r = await admin.request('change_password', { body: { username: credentials.username, currentPassword: credentials.password, password: replacement } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const stored = JSON.parse(await fs.readFile(path.join(app.privateDir, 'credentials.json'), 'utf8'));
    assert.ok(stored.passwordHash.startsWith('$2')); assert.ok(!('password' in stored)); assert.ok(!JSON.stringify(stored).includes(replacement));
    assert.equal((await second.request('get_data')).status, 401);
    const fresh = new Client(app.url); await fresh.login({ username: credentials.username, password: replacement });
    assert.equal((await fresh.request('logout', { body: {} })).status, 200);
    assert.equal((await fresh.request('get_data')).status, 401);
  });
  await t.test('rate limiting survives cleared cookies and recovers after expiry', async () => {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const fresh = new Client(app.url); await fresh.request('state');
      const r = await fresh.request('login', { body: { username: credentials.username, password: 'incorrect-fixture-password' } });
      assert.equal(r.status, attempt < 5 ? 401 : 429, 'attempt ' + attempt);
      if (attempt >= 5) assert.ok(Number(r.headers.get('retry-after')) > 0);
    }
    const ratePath = path.join(app.privateDir, 'login-rate.json');
    const rates = JSON.parse(await fs.readFile(ratePath, 'utf8'));
    Object.values(rates).forEach(rate => { rate.until = 1; }); await fs.writeFile(ratePath, JSON.stringify(rates));
    const fresh = new Client(app.url); await fresh.login({ username: credentials.username, password: replacement });
  });
});

test('private storage cannot be configured under the public web root', async t => {
  const app = await fixture({ env: { ETEHADYAR_PRIVATE_DIR: '/site/data/private' } }); t.after(() => app.cleanup());
  const r = await new Client(app.url).request('state'); assert.equal(r.status, 503);
  assert.equal(await fs.access(path.join(app.root, 'data/private')).then(() => true, () => false), false);
});
