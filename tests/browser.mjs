import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import chromium, { inflate, setupLambdaEnvironment } from '@sparticuz/chromium';
import { chromium as playwright } from 'playwright';
import { fixture, Client } from './helpers.mjs';

const require = createRequire(import.meta.url);
const chromiumDirectory = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..');
await inflate(path.join(chromiumDirectory, 'bin/al2023.tar.br'));
setupLambdaEnvironment('/tmp/al2023/lib');
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(argument => argument !== '--single-process'), headless: true });
const app = await fixture();
const credentials = await app.provision();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await context.route('**/*', route => route.request().url().startsWith(app.url) ? route.continue() : route.abort());
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
const axe = await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const results = [];
let preservedSections;
async function check(name, action) {
  try { await action(); results.push({ name, passed: true }); console.log('PASS', name); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL', name, error.message); }
}
async function navigate(route) {
  const response = await page.goto(app.url + route, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  await page.evaluate(() => document.fonts.ready);
  if (route !== '/admin/') await page.waitForFunction(() => !!window.ETEHADYAR_DATA);
}
async function accessibility() {
  await page.evaluate(axe);
  return page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(violation => ({ id: violation.id, count: violation.nodes.length, targets: violation.nodes.slice(0, 6).map(node => ({ target: node.target, summary: node.failureSummary })) })));
}
try {
  for (const route of ['/', '/docs/', '/about/', '/changelog/', '/admin/']) {
    await check('Loads and passes automated accessibility checks: ' + route, async () => {
      await navigate(route);
      assert.deepEqual(await accessibility(), []);
    });
  }
  for (const route of ['/', '/docs/', '/about/', '/changelog/', '/admin/']) {
    for (const width of [320, 390, 768, 1440]) {
      await check('No horizontal page overflow: ' + route + ' at ' + width + 'px', async () => {
        await page.setViewportSize({ width, height: 900 }); await navigate(route);
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        assert.ok(dimensions.document <= width + 1 && dimensions.body <= width + 1, JSON.stringify(dimensions));
        if (route === '/docs/') {
          const rect = await page.locator('#doc-install').boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1, JSON.stringify(rect));
        }
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await navigate('/');
  await check('Light is the default; theme and depth controls persist across pages without changing content', async () => {
    await navigate('/'); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    const title = await page.title();
    await page.locator('[data-appearance="theme"]').press('Enter');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('[data-appearance="theme"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.title(), title);
    await page.locator('[data-appearance="depth"]').click();
    assert.equal(await page.locator('html').getAttribute('data-depth'), 'off');
    await navigate('/docs/');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('html').getAttribute('data-depth'), 'off');
    await page.locator('[data-appearance="theme"]').click(); await page.locator('[data-appearance="depth"]').click();
    await navigate('/'); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.locator('meta[name="color-scheme"]').getAttribute('content'), 'light');
    assert.equal(await page.locator('html').getAttribute('data-motion'), 'off');
    assert.equal(await page.locator('.depth-scene').getAttribute('aria-hidden'), 'true');
  });
  for (const route of ['/', '/docs/', '/about/', '/changelog/', '/admin/']) {
    await check('Dark appearance also passes automated accessibility checks: ' + route, async () => {
      await navigate(route); await page.locator('[data-appearance="theme"]').click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      assert.deepEqual(await accessibility(), []);
      await page.locator('[data-appearance="theme"]').click();
    });
  }
  await navigate('/');
  await check('Public navigation and changelog search work before a slow CMS request completes', async () => {
    const slow = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const tab = await slow.newPage(); let resume;
    try {
      const blocked = new Promise(resolve => { resume = resolve; });
      await tab.route('**/data/site_data.json', async route => { await blocked; await route.continue(); });
      await tab.goto(app.url + '/', { waitUntil: 'domcontentloaded' });
      assert.equal(await tab.evaluate(() => !!window.ETEHADYAR_DATA), false);
      await tab.locator('#menu-toggle').click(); assert.equal(await tab.locator('#mobile-menu').isVisible(), true);
      await tab.keyboard.press('Escape'); assert.equal(await tab.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
      await tab.locator('[data-appearance="theme"]').click();
      assert.equal(await tab.locator('html').getAttribute('data-theme'), 'dark');
      resume(); await tab.waitForFunction(() => !!window.ETEHADYAR_DATA); await tab.unroute('**/data/site_data.json');
      const next = new Promise(resolve => { resume = resolve; });
      await tab.route('**/data/site_data.json', async route => { await next; await route.continue(); });
      await tab.goto(app.url + '/changelog/', { waitUntil: 'domcontentloaded' });
      await tab.locator('#release-search').fill('۶.۱۲.۰');
      assert.equal(await tab.locator('.release-card:not(.is-filtered)').count(), 1);
      await tab.locator('#menu-toggle').click(); assert.equal(await tab.locator('#mobile-menu').isVisible(), true);
      resume(); await tab.waitForFunction(() => !!window.ETEHADYAR_DATA); await tab.unroute('**/data/site_data.json');
      assert.equal(await tab.locator('.release-card:not(.is-filtered)').count(), 1);
    } finally { resume?.(); await slow.close(); }
  });
  await check('Subtle parallax runs only when allowed and stops for reduced motion, mobile or the effects switch', async () => {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
    const tab = await desktop.newPage();
    try {
      await tab.goto(app.url + '/', { waitUntil: 'networkidle' });
      assert.equal(await tab.locator('html').getAttribute('data-motion'), 'on');
      await tab.mouse.move(950, 420);
      await tab.waitForFunction(() => !!document.documentElement.style.getPropertyValue('--depth-x'));
      const x = await tab.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue('--depth-x'))); assert.ok(Math.abs(x) <= 12);
      await tab.locator('[data-appearance="depth"]').click();
      assert.equal(await tab.locator('html').getAttribute('data-motion'), 'off');
      assert.equal(await tab.evaluate(() => document.documentElement.style.getPropertyValue('--depth-x')), '');
      await tab.locator('[data-appearance="depth"]').click(); await tab.emulateMedia({ reducedMotion: 'reduce' });
      await tab.waitForFunction(() => document.documentElement.dataset.motion === 'off');
      await tab.mouse.move(800, 380); assert.equal(await tab.evaluate(() => document.documentElement.style.getPropertyValue('--depth-x')), '');
      await tab.emulateMedia({ reducedMotion: 'no-preference' }); await tab.setViewportSize({ width: 390, height: 844 });
      await tab.waitForFunction(() => document.documentElement.dataset.motion === 'off');
      assert.ok(await tab.evaluate(() => document.body.scrollWidth <= innerWidth + 1));
    } finally { await desktop.close(); }
  });
  await check('Light appearance and core interactions survive blocked preference storage', async () => {
    const isolated = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    try {
      await isolated.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } }); });
      const tab = await isolated.newPage(); const problems = []; tab.on('pageerror', error => problems.push(error.message));
      await tab.goto(app.url + '/', { waitUntil: 'networkidle' });
      assert.equal(await tab.locator('html').getAttribute('data-theme'), 'light');
      await tab.locator('[data-appearance="theme"]').click(); assert.equal(await tab.locator('html').getAttribute('data-theme'), 'dark');
      await tab.locator('#menu-toggle').click(); assert.equal(await tab.locator('#mobile-menu').isVisible(), true);
      assert.deepEqual(problems, []);
    } finally { await isolated.close(); }
  });
  await check('Static fallback without JavaScript is light, readable and does not enable checkout', async () => {
    const isolated = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    try {
      const tab = await isolated.newPage(); await tab.goto(app.url + '/', { waitUntil: 'networkidle' });
      assert.equal(await tab.locator('meta[name="color-scheme"]').getAttribute('content'), 'light');
      assert.equal(await tab.locator('h1').isVisible(), true);
      assert.equal(await tab.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(247, 249, 253)');
      assert.ok((await tab.locator('[data-buy]').evaluateAll(nodes => nodes.map(node => node.hasAttribute('href')))).every(value => !value));
      assert.ok(await tab.evaluate(() => document.body.scrollWidth <= innerWidth + 1));
    } finally { await isolated.close(); }
  });
  await check('High contrast keeps headings visible and disables decorative motion', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1440, height: 900 }, forcedColors: 'active', reducedMotion: 'no-preference' });
    try {
      const tab = await isolated.newPage(); await tab.goto(app.url + '/', { waitUntil: 'networkidle' });
      assert.equal(await tab.locator('html').getAttribute('data-motion'), 'off');
      assert.equal(await tab.locator('.depth-scene').isVisible(), false);
      assert.notEqual(await tab.locator('.hero-gradient').first().evaluate(node => getComputedStyle(node).color), 'rgba(0, 0, 0, 0)');
    } finally { await isolated.close(); }
  });
  await check('Unconfigured checkout is disabled and no offer points to the homepage', async () => {
    const links = await page.locator('[data-buy]').evaluateAll(nodes => nodes.map(node => ({ disabled: node.getAttribute('aria-disabled'), href: node.getAttribute('href') })));
    assert.ok(links.length > 0 && links.every(link => link.disabled === 'true' && link.href === null));
    assert.ok(!JSON.parse(await page.locator('#software-schema').textContent()).offers);
    await page.locator('[data-currency="usd"][role="tab"]').click();
    assert.equal(await page.locator('#price-usd').isVisible(), true);
  });
  await check('Language and currency controls work without changing documentation titles', async () => {
    await page.locator('#lang-toggle').click(); assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
    assert.match(await page.locator('h1:visible').innerText(), /Supercharge/);
    assert.match(await page.locator('#pricing').innerText(), /transparent lifetime/);
    await navigate('/docs/'); assert.equal(await page.locator('html').getAttribute('lang'), 'fa'); assert.match(await page.title(), /مستندات/);
    await navigate('/about/'); assert.match(await page.title(), /درباره/);
    await navigate('/'); await page.locator('#lang-toggle').click();
  });
  await check('Workspace tabs and lightbox return focus correctly', async () => {
    await page.locator('[data-tour="video"]').click(); assert.equal(await page.locator('#tour-video').isVisible(), true);
    const zoom = page.locator('#tour-video [data-lightbox]'); await zoom.click();
    assert.equal(await page.locator('#lightbox').isVisible(), true); await page.keyboard.press('Tab');
    assert.equal(await page.locator('.lightbox-close').evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#lightbox').isVisible(), false);
    assert.equal(await zoom.evaluate(node => node === document.activeElement), true);
  });
  await check('ROI sliders recalculate; voice demo is labeled and stops', async () => {
    const before = await page.locator('#res-hours').innerText();
    await page.locator('#calc-articles').evaluate(node => { node.value = '100'; node.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.notEqual(await page.locator('#res-hours').innerText(), before);
    await page.locator('[data-voice-prompt="p2"]').click();
    await page.waitForFunction(() => document.querySelector('#voice-reply-box').classList.contains('is-active'));
    assert.match(await page.locator('#voice-reply-text').innerText(), /فرضی/);
    await page.locator('#stop-voice-btn').click(); assert.match(await page.locator('#voice-status-label').innerText(), /متوقف/);
    await page.locator('#btn-run-live-demo').click(); await page.waitForFunction(() => !document.querySelector('#btn-run-live-demo').disabled);
  });
  await check('Zero activity is supported without an infinite or misleading ROI estimate', async () => {
    for (const id of ['calc-articles', 'calc-videos', 'calc-support']) {
      await page.locator('#' + id).evaluate(node => { node.value = '0'; node.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    assert.equal(await page.locator('#res-hours').innerText(), '۰');
    assert.equal(await page.locator('#res-roi-days').innerText(), 'قابل محاسبه نیست');
    assert.ok(!(await page.locator('.calc-card').innerText()).includes('Infinity'));
  });
  await check('Mobile menus remain usable on the homepage and docs', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ['/', '/docs/', '/about/', '/changelog/']) {
      await navigate(route); await page.locator('#menu-toggle').click();
      assert.equal(await page.locator('#mobile-menu').isVisible(), true); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
    }
  });
  await check('Changelog searches Persian digits and handles empty results', async () => {
    await navigate('/changelog/'); await page.locator('#release-search').fill('۶.۱۲.۰');
    assert.equal(await page.locator('.release-card:not(.is-filtered)').count(), 1);
    await page.locator('#release-search').fill('fixture-no-result-zzzz'); assert.equal(await page.locator('#no-results').isVisible(), true);
    await page.locator('#clear-search').click(); assert.equal(await page.locator('.release-card:not(.is-filtered)').count(), 113);
  });
  await check('Browser storage cannot bypass the server login', async () => {
    await navigate('/admin/');
    await page.evaluate(() => { sessionStorage.setItem('etehadyar_admin_logged', 'true'); localStorage.setItem('etehadyar_admin_p', 'fixture-only'); });
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#admin-app').isVisible(), false); assert.equal(await page.locator('#auth-screen').isVisible(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('etehadyar_admin_p')), null);
  });
  await check('Real login and FAQ/release editors work, including their missing English fields', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#login-user').fill(credentials.username); await page.locator('#login-pass').fill(credentials.password);
    await page.locator('#btn-login-submit').click(); await page.waitForFunction(() => !document.querySelector('#btn-save-all').disabled);
    await page.locator('[data-tab="tab-faqs"]').click(); await page.locator('#btn-open-add-faq').click();
    await page.locator('#faq-q-fa').fill('پرسش ذخیره‌شده آزمون'); await page.locator('#faq-a-fa').fill('<img src=x onerror=window.fixtureXss=1>');
    await page.locator('#faq-q-en').fill('Saved fixture question'); await page.locator('#faq-a-en').fill('Saved fixture answer');
    await page.locator('#form-faq button[type="submit"]').click();
    assert.match(await page.locator('#admin-faqs-list').innerText(), /پرسش ذخیره‌شده/);
    await page.locator('[data-tab="tab-changelog"]').click();
    preservedSections = JSON.parse(await fs.readFile(path.join(app.root, 'data/site_data.json'), 'utf8')).releases.find(release => release.version === '6.12.0').subsections;
    await page.locator('#admin-search-releases').fill('6.12.0');
    await page.locator('#admin-releases-tbody tr').first().getByRole('button', { name: 'ویرایش', exact: true }).click();
    await page.locator('#rel-title').fill('عنوان ویرایش‌شده با حفظ بخش‌بندی');
    await page.locator('#form-release button[type="submit"]').click();
    await page.locator('#admin-search-releases').fill('');
    await page.locator('#btn-open-add-release').click();
    await page.locator('#rel-version').fill('6.13.0'); await page.locator('#rel-title').fill('نسخه آزمون ذخیره‌شده'); await page.locator('#rel-items').fill('تغییر آزمایشی ذخیره‌شده');
    await page.locator('#form-release button[type="submit"]').click();
    await page.locator('[data-tab="tab-landing"]').click(); await page.locator('#hero-headline-fa').fill('تیتر آزمون ذخیره‌شده');
    await page.locator('[data-tab="tab-config"]').click(); await page.locator('#cfg-price-usd').fill('151');
    await page.locator('#cfg-tagline-fa').fill('شعار ذخیره‌شده در CMS');
    await page.locator('#cfg-url-ir').fill('https://payment.invalid/checkout/iran'); await page.locator('#cfg-url-intl').fill('https://payment.invalid/checkout/usd');
    const published = page.waitForResponse(response => response.url().includes('action=save_data') && response.request().method() === 'POST');
    await page.locator('#btn-save-all').click();
    const publishResponse = await published;
    assert.equal(publishResponse.status(), 200, await publishResponse.text());
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('آخرین داده'));
    const storedRelease = JSON.parse(await fs.readFile(path.join(app.root, 'data/site_data.json'), 'utf8')).releases.find(release => release.version === '6.12.0');
    assert.equal(storedRelease.title, 'عنوان ویرایش‌شده با حفظ بخش‌بندی');
    assert.deepEqual(storedRelease.subsections, preservedSections);
  });
  await check('Published CMS edits reach public pages and schema without stored XSS', async () => {
    await navigate('/'); assert.equal(await page.locator('h1:visible').innerText(), 'تیتر آزمون ذخیره‌شده');
    assert.equal(await page.locator('[data-tagline-fa]').innerText(), 'شعار ذخیره‌شده در CMS');
    assert.match(await page.locator('[data-faq-list]').innerText(), /پرسش ذخیره‌شده آزمون/);
    assert.equal(await page.locator('[data-faq-list] img').count(), 0); assert.equal(await page.evaluate(() => window.fixtureXss), undefined);
    await page.locator('[data-currency="irr"][role="tab"]').click();
    assert.equal(await page.locator('[data-buy]').first().getAttribute('href'), 'https://payment.invalid/checkout/iran');
    await page.locator('[data-currency="usd"][role="tab"]').click();
    assert.equal(await page.locator('[data-buy]').first().getAttribute('href'), 'https://payment.invalid/checkout/usd');
    assert.equal(await page.locator('[data-price-usd]').innerText(), '151');
    const schema = JSON.parse(await page.locator('#software-schema').textContent()); assert.equal(schema.offers[1].price, '151');
    const faq = JSON.parse(await page.locator('#faq-schema').textContent()); assert.equal(faq.mainEntity.length, 7);
    await navigate('/changelog/'); await page.locator('#release-search').fill('6.13.0');
    assert.equal(await page.locator('.release-card:not(.is-filtered)').count(), 1); assert.match(await page.locator('#v6-13-0').innerText(), /تغییر آزمایشی ذخیره‌شده/);
  });
  await check('Admin refuses fake success when the server rejects a save', async () => {
    await navigate('/admin/'); await page.waitForFunction(() => !document.querySelector('#btn-save-all').disabled);
    await page.locator('[data-tab="tab-config"]').click(); await page.locator('#cfg-price-usd').fill('999');
    const original = await fs.readFile(path.join(app.root, 'data/site_data.json'), 'utf8');
    await page.route('**/admin/api.php?action=save_data', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'ذخیره انجام نشد — آزمون' }) }));
    await page.locator('#btn-save-all').click();
    await page.waitForFunction(() => document.querySelector('#admin-toast').classList.contains('is-error'));
    assert.match(await page.locator('#admin-toast').innerText(), /ذخیره انجام نشد/);
    assert.equal(await fs.readFile(path.join(app.root, 'data/site_data.json'), 'utf8'), original);
    await page.unroute('**/admin/api.php?action=save_data'); await page.locator('#btn-revert').click();
  });
  await check('Authenticated admin is accessible and navigation remains usable on mobile', async () => {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.locator('[data-tab="tab-dashboard"]').click();
    assert.deepEqual(await accessibility(), []);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.locator('.sidebar-nav').isVisible(), true); assert.equal(await page.locator('#btn-logout').isVisible(), true);
      assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth + 1));
      if (width === 320) assert.deepEqual(await accessibility(), []);
    }
  });
  await check('Expired server sessions refresh CSRF and preserve an exportable in-memory draft for reauthentication', async () => {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.locator('[data-tab="tab-config"]').click();
    await page.locator('#cfg-price-usd').fill('177');
    const published = await fs.readFile(path.join(app.root, 'data/site_data.json'), 'utf8');
    const sessions = path.join(app.temporary, 'private/sessions');
    for (const name of await fs.readdir(sessions)) if (name.startsWith('sess_')) await fs.rm(path.join(sessions, name));
    const denied = page.waitForResponse(response => response.url().includes('action=save_data') && response.request().method() === 'POST');
    await page.locator('#btn-save-all').click(); assert.equal((await denied).status(), 401);
    await page.waitForFunction(() => !document.querySelector('#recovery-notice').hidden && !document.querySelector('#btn-login-submit').disabled);
    const downloadPromise = page.waitForEvent('download'); await page.locator('#btn-export-recovery').click();
    const backup = JSON.parse(await fs.readFile(await (await downloadPromise).path(), 'utf8')); assert.equal(backup.config.priceUSD, '177');
    await page.locator('#login-user').fill(credentials.username); await page.locator('#login-pass').fill(credentials.password);
    const login = page.waitForResponse(response => response.url().includes('action=login'));
    await page.locator('#btn-login-submit').click(); assert.equal((await login).status(), 200);
    await page.waitForFunction(() => !document.querySelector('#btn-save-all').disabled);
    assert.equal(await page.locator('#cfg-price-usd').inputValue(), '177');
    assert.match(await page.locator('#save-status').textContent(), /منتشرنشده/);
    assert.equal(await fs.readFile(path.join(app.root, 'data/site_data.json'), 'utf8'), published);
    assert.equal(await page.locator('#current-admin-pass').inputValue(), '');
    await page.locator('#btn-revert').click(); assert.equal(await page.locator('#cfg-price-usd').inputValue(), '151');
  });
  await check('Recovered drafts retain their original revision and cannot overwrite concurrent server changes', async () => {
    await page.locator('[data-tab="tab-config"]').click(); await page.locator('#cfg-price-usd').fill('178');
    const sessions = path.join(app.temporary, 'private/sessions');
    for (const name of await fs.readdir(sessions)) if (name.startsWith('sess_')) await fs.rm(path.join(sessions, name));
    await page.locator('#btn-save-all').click();
    await page.waitForFunction(() => !document.querySelector('#recovery-notice').hidden && !document.querySelector('#btn-login-submit').disabled);
    const other = new Client(app.url); await other.login(credentials);
    const current = (await other.request('get_data')).data; current.data.config.priceUSD = '152';
    assert.equal((await other.request('save_data', { body: current })).status, 200);
    await page.locator('#login-user').fill(credentials.username); await page.locator('#login-pass').fill(credentials.password);
    await page.locator('#btn-login-submit').click(); await page.waitForFunction(() => !document.querySelector('#btn-save-all').disabled);
    const conflict = page.waitForResponse(response => response.url().includes('action=save_data') && response.request().method() === 'POST');
    await page.locator('#btn-save-all').click(); assert.equal((await conflict).status(), 409);
    assert.equal((await other.request('get_data')).data.data.config.priceUSD, '152');
    await page.locator('#btn-revert').click(); assert.equal(await page.locator('#cfg-price-usd').inputValue(), '152');
    const saved = page.waitForResponse(response => response.url().includes('action=save_data') && response.request().method() === 'POST');
    await page.locator('#btn-save-all').click(); assert.equal((await saved).status(), 200);
  });
  await check('A recovered draft remains downloadable if server content fails after reauthentication', async () => {
    await page.locator('[data-tab="tab-config"]').click(); await page.locator('#cfg-price-usd').fill('179');
    const published = await fs.readFile(path.join(app.root, 'data/site_data.json'), 'utf8');
    const sessions = path.join(app.temporary, 'private/sessions');
    for (const name of await fs.readdir(sessions)) if (name.startsWith('sess_')) await fs.rm(path.join(sessions, name));
    await page.locator('#btn-save-all').click();
    await page.waitForFunction(() => !document.querySelector('#recovery-notice').hidden && !document.querySelector('#btn-login-submit').disabled);
    await page.route('**/admin/api.php?action=get_data', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'خطای خواندن داده — آزمون' }) }));
    await page.locator('#login-user').fill(credentials.username); await page.locator('#login-pass').fill(credentials.password);
    await page.locator('#btn-login-submit').click();
    await page.waitForFunction(() => !document.querySelector('#recovery-notice').hidden && !document.querySelector('#btn-refresh-session').hidden);
    const downloaded = page.waitForEvent('download'); await page.locator('#btn-export-recovery').click();
    const draft = JSON.parse(await fs.readFile(await (await downloaded).path(), 'utf8')); assert.equal(draft.config.priceUSD, '179');
    await page.unroute('**/admin/api.php?action=get_data'); await page.locator('#btn-refresh-session').click();
    await page.waitForFunction(() => !document.querySelector('#btn-save-all').disabled);
    assert.equal(await page.locator('#cfg-price-usd').inputValue(), '179');
    assert.equal(await fs.readFile(path.join(app.root, 'data/site_data.json'), 'utf8'), published);
    await page.locator('#btn-revert').click();
  });
  await check('Draft deletion, JSON export/import, rejection and revert never publish implicitly', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const published = await fs.readFile(path.join(app.root, 'data/site_data.json'), 'utf8');
    await page.locator('[data-tab="tab-faqs"]').click();
    const before = await page.locator('.faq-editor-card').count();
    await page.locator('.faq-editor-card').last().getByRole('button', { name: 'حذف', exact: true }).click();
    assert.equal(await page.locator('.faq-editor-card').count(), before - 1);
    assert.equal(await fs.readFile(path.join(app.root, 'data/site_data.json'), 'utf8'), published);
    await page.locator('#btn-revert').click();
    assert.equal(await page.locator('.faq-editor-card').count(), before);
    await page.locator('[data-tab="tab-export"]').click();
    const downloadPromise = page.waitForEvent('download'); await page.locator('#btn-export-json').click();
    const backup = JSON.parse(await fs.readFile(await (await downloadPromise).path(), 'utf8'));
    assert.deepEqual(backup, JSON.parse(published));
    backup.hero.headlineFa = 'پیش‌نویس واردشده، هنوز منتشر نشده';
    await page.locator('#btn-import-json').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(() => document.querySelector('#hero-headline-fa').value.includes('پیش‌نویس واردشده'));
    assert.match(await page.locator('#save-status').innerText(), /منتشرنشده/);
    assert.equal(await fs.readFile(path.join(app.root, 'data/site_data.json'), 'utf8'), published);
    await page.locator('#btn-import-json').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"config":[]}') });
    await page.waitForFunction(() => document.querySelector('#admin-toast').textContent.includes('ساختار فایل'));
    assert.equal(await page.locator('#hero-headline-fa').inputValue(), backup.hero.headlineFa);
    await page.locator('#btn-revert').click();
    assert.equal(await page.locator('#hero-headline-fa').inputValue(), JSON.parse(published).hero.headlineFa);
  });
  await check('Password UI verifies the current password, keeps its session and invalidates other sessions', async () => {
    const other = new Client(app.url); await other.login(credentials);
    await page.locator('[data-tab="tab-export"]').click();
    const replacement = crypto.randomBytes(18).toString('base64url');
    await page.locator('#current-admin-pass').fill('wrong-fixture-password');
    await page.locator('#new-admin-pass').fill(replacement); await page.locator('#confirm-admin-pass').fill(replacement);
    await page.locator('#form-change-password button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#admin-toast').textContent.includes('رمز فعلی نامعتبر'));
    assert.equal(await page.locator('#admin-app').isVisible(), true);
    await page.locator('#current-admin-pass').fill(credentials.password);
    await page.locator('#new-admin-user').fill('fixture-renamed');
    await page.locator('#new-admin-pass').fill(replacement); await page.locator('#confirm-admin-pass').fill(replacement);
    const responsePromise = page.waitForResponse(response => response.url().includes('action=change_password') && response.request().method() === 'POST');
    await page.locator('#form-change-password button[type="submit"]').click();
    assert.equal((await responsePromise).status(), 200);
    await page.waitForFunction(() => document.querySelector('#admin-toast').textContent.includes('نشست‌های دیگر باطل'));
    assert.equal(await page.locator('#current-admin-pass').inputValue(), '');
    assert.equal(await page.locator('#new-admin-pass').inputValue(), '');
    assert.equal((await other.request('get_data')).status, 401);
    credentials.username = 'fixture-renamed'; credentials.password = replacement;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.querySelector('#btn-save-all').disabled);
    assert.equal(await page.locator('#admin-app').isVisible(), true);
  });
  await check('Protected ZIP download and logout work through the UI', async () => {
    await page.locator('[data-tab="tab-export"]').click();
    const downloadPromise = page.waitForEvent('download'); await page.locator('#btn-download-zip').click();
    const download = await downloadPromise; assert.equal(download.suggestedFilename(), 'etehadyar-site-backup.zip'); assert.equal(await download.failure(), null);
    await page.locator('#btn-logout').click(); await page.waitForFunction(() => document.querySelector('#admin-app').hidden);
    await page.reload({ waitUntil: 'networkidle' }); assert.equal(await page.locator('#auth-screen').isVisible(), true);
  });
  await check('Public content failure degrades safely and leaves checkout disabled', async () => {
    await page.route('**/data/site_data.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.goto(app.url + '/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.classList.contains('js-ready'));
    assert.equal(await page.locator('[data-content-status]').isVisible(), true);
    assert.ok((await page.locator('[data-buy]').evaluateAll(nodes => nodes.map(node => node.hasAttribute('href')))).every(value => !value));
    await page.unroute('**/data/site_data.json');
  });
  assert.deepEqual(errors, [], 'No unhandled JavaScript errors should occur');
} finally {
  await context.close(); await browser.close(); await app.cleanup();
}
const failures = results.filter(result => !result.passed);
console.log('\nBrowser checks:', results.length - failures.length + '/' + results.length, 'passed');
if (failures.length) process.exitCode = 1;
