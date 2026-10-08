(function () {
  'use strict';
  const doc = document;
  const byId = id => doc.getElementById(id);
  let csrfToken = '';
  let siteData = null;
  let originalData = null;
  let revision = '';
  let dirty = false;
  let toastTimer;
  let modalTrigger = null;
  const clone = value => JSON.parse(JSON.stringify(value));
  const faNumber = value => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  const configFields = {
    siteName: 'cfg-sitename-fa', siteNameEn: 'cfg-sitename-en', currentVersion: 'cfg-version',
    tagline: 'cfg-tagline-fa', taglineEn: 'cfg-tagline-en', priceToman: 'cfg-price-irr', priceUSD: 'cfg-price-usd',
    purchaseUrlIR: 'cfg-url-ir', purchaseUrlInternational: 'cfg-url-intl', contactUrl: 'cfg-url-contact', productUrl: 'cfg-url-product'
  };
  const heroFields = {
    liveBadgeFa: 'hero-badge-fa', liveBadgeEn: 'hero-badge-en', headlineFa: 'hero-headline-fa', headlineEn: 'hero-headline-en',
    descriptionFa: 'hero-desc-fa', descriptionEn: 'hero-desc-en', buttonPrimaryFa: 'hero-primary-fa', buttonPrimaryEn: 'hero-primary-en',
    buttonGhostFa: 'hero-ghost-fa', buttonGhostEn: 'hero-ghost-en'
  };

  // Remove the obsolete client-side login credentials; they are never used as authentication.
  try {
    ['etehadyar_admin_u', 'etehadyar_admin_p', 'etehadyar_admin_fails', 'etehadyar_admin_lock'].forEach(key => localStorage.removeItem(key));
    sessionStorage.removeItem('etehadyar_admin_logged');
  } catch (_) { /* Cookie-backed authentication works even if browser storage is unavailable. */ }

  function toast(message, error = false) {
    const element = byId('admin-toast');
    element.textContent = message;
    element.classList.toggle('is-error', error);
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), error ? 8000 : 4000);
  }

  function setDirty(value) {
    dirty = value;
    const status = byId('save-status');
    if (status) status.textContent = value ? 'تغییرات منتشرنشده دارید.' : 'آخرین داده‌های ذخیره‌شده بارگذاری شد.';
  }

  function showLogin(message = '') {
    byId('auth-screen').hidden = false;
    byId('admin-app').hidden = true;
    byId('login-pass').value = '';
    byId('login-error').textContent = message;
    byId('login-error').hidden = !message;
    siteData = null;
    revision = '';
    setDirty(false);
  }

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function api(action, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const headers = { Accept: 'application/json' };
      if (payload !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = csrfToken; }
      const response = await fetch('api.php?action=' + encodeURIComponent(action), {
        method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers,
        signal: controller.signal, body: payload === undefined ? undefined : JSON.stringify(payload)
      });
      let result;
      try { result = await response.json(); }
      catch (_) { throw new ApiError(response.status, 'پاسخ سرور معتبر نیست. این پنل به یک هاست PHP نیاز دارد.'); }
      if (!response.ok || result.success !== true) {
        if (response.status === 401 && action !== 'login' && action !== 'change_password') showLogin('نشست شما پایان یافته است؛ دوباره وارد شوید.');
        throw new ApiError(response.status, result.error || 'درخواست انجام نشد.');
      }
      if (result.csrfToken) csrfToken = result.csrfToken;
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new ApiError(0, 'پاسخ سرور طول کشید. تغییرات را دوباره بارگذاری کنید تا وضعیت ذخیره مشخص شود.');
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, 'ارتباط با سرور برقرار نشد. تغییرات منتشر نشده‌اند.');
    } finally { clearTimeout(timer); }
  }

  async function loadData() {
    byId('btn-save-all').disabled = true;
    try {
      const result = await api('get_data');
      if (!validShape(result.data) || typeof result.revision !== 'string') throw new Error('داده‌های دریافتی معتبر نیستند.');
      siteData = result.data;
      originalData = clone(siteData);
      revision = result.revision;
      populate();
      setDirty(false);
      byId('btn-save-all').disabled = false;
    } catch (error) { toast(error.message, true); }
  }

  async function refreshState() {
    byId('btn-login-submit').disabled = true;
    try {
      const state = await api('state');
      byId('setup-notice').hidden = !state.setupRequired;
      byId('btn-login-submit').disabled = state.setupRequired;
      if (state.authenticated) {
        byId('auth-screen').hidden = true;
        byId('admin-app').hidden = false;
        byId('new-admin-user').value = state.username || '';
        await loadData();
      } else showLogin();
    } catch (error) { showLogin(error.message); }
  }

  function validShape(value) {
    return value && typeof value === 'object' && value.config && typeof value.config === 'object' && !Array.isArray(value.config)
      && value.hero && typeof value.hero === 'object' && !Array.isArray(value.hero) && Array.isArray(value.faqs) && value.faqs.length <= 100
      && Array.isArray(value.releases) && value.releases.length <= 1000
      && value.faqs.every(faq => faq && typeof faq.questionFa === 'string' && typeof faq.answerFa === 'string')
      && value.releases.every(release => release && typeof release.version === 'string' && typeof release.title === 'string' && Array.isArray(release.items));
  }

  function populate() {
    if (!siteData) return;
    Object.entries(configFields).forEach(([key, id]) => { if (byId(id)) byId(id).value = siteData.config[key] || ''; });
    Object.entries(heroFields).forEach(([key, id]) => { if (byId(id)) byId(id).value = siteData.hero[key] || ''; });
    byId('kpi-version').textContent = siteData.config.currentVersion;
    byId('kpi-price').textContent = siteData.config.priceToman + ' ت';
    byId('kpi-releases').textContent = faNumber(siteData.releases.filter(release => !release.is_alpha).length) + ' نسخه';
    byId('kpi-faqs').textContent = faNumber(siteData.faqs.length) + ' مورد';
    byId('badge-releases-count').textContent = faNumber(siteData.releases.length);
    renderReleases();
    renderFaqs();
  }

  function collect() {
    if (!siteData) throw new Error('ابتدا داده‌های سایت را بارگذاری کنید.');
    Object.entries(configFields).forEach(([key, id]) => { if (byId(id)) siteData.config[key] = byId(id).value.trim(); });
    Object.entries(heroFields).forEach(([key, id]) => { if (byId(id)) siteData.hero[key] = byId(id).value.trim(); });
  }

  function element(tag, text, className) {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function actionButton(text, className, callback) {
    const button = element('button', text, 'btn btn-small ' + className);
    button.type = 'button';
    button.addEventListener('click', callback);
    return button;
  }

  function releaseMajor(release) {
    if (release.is_alpha || release.version.includes('-')) return 'alpha';
    return 'v' + release.version.replace(/^v/i, '').split('.')[0];
  }

  function renderReleases() {
    if (!siteData) return;
    const body = byId('admin-releases-tbody');
    const term = byId('admin-search-releases').value.toLowerCase().trim();
    const filter = byId('admin-filter-major').value;
    const fragment = doc.createDocumentFragment();
    siteData.releases.forEach((release, index) => {
      if (filter !== 'all' && releaseMajor(release) !== filter) return;
      if (term && !(release.version + ' ' + release.title).toLowerCase().includes(term)) return;
      const row = element('tr');
      const versionCell = element('td');
      versionCell.append(element('span', release.version === siteData.config.currentVersion ? 'نسخه فعلی' : release.version, 'badge-tag primary'));
      const titleCell = element('td');
      titleCell.append(element('strong', release.title));
      const countCell = element('td', faNumber(release.items.length) + ' مورد');
      const actions = element('td');
      actions.append(actionButton('ویرایش', 'btn-secondary', () => editRelease(index)), actionButton('حذف', 'btn-danger', () => {
        if (release.version === siteData.config.currentVersion) return toast('نسخه فعلی قابل حذف نیست؛ ابتدا نسخه فعلی را تغییر دهید.', true);
        if (!confirm('نسخه ' + release.version + ' حذف شود؟')) return;
        collect(); siteData.releases.splice(index, 1); populate(); setDirty(true);
      }));
      row.append(versionCell, titleCell, countCell, actions);
      fragment.append(row);
    });
    if (!fragment.childNodes.length) {
      const cell = element('td', 'نسخه‌ای یافت نشد.'); cell.colSpan = 4;
      const row = element('tr'); row.append(cell); fragment.append(row);
    }
    body.replaceChildren(fragment);
  }

  function renderFaqs() {
    if (!siteData) return;
    const fragment = doc.createDocumentFragment();
    siteData.faqs.forEach((faq, index) => {
      const card = element('div', undefined, 'admin-card faq-editor-card');
      const text = element('div');
      text.append(element('strong', faNumber(index + 1) + '. ' + faq.questionFa), element('p', faq.answerFa));
      const actions = element('div', undefined, 'editor-actions');
      actions.append(actionButton('ویرایش', 'btn-secondary', () => editFaq(index)), actionButton('حذف', 'btn-danger', () => {
        if (!confirm('این سوال حذف شود؟')) return;
        collect(); siteData.faqs.splice(index, 1); populate(); setDirty(true);
      }));
      card.append(text, actions); fragment.append(card);
    });
    if (!fragment.childNodes.length) fragment.append(element('p', 'هنوز سوالی ثبت نشده است.'));
    byId('admin-faqs-list').replaceChildren(fragment);
  }

  function openModal(id) {
    modalTrigger = doc.activeElement;
    byId(id).hidden = false;
    byId(id).querySelector('input:not([type="hidden"]), textarea, button')?.focus();
  }
  function closeModal(id) {
    byId(id).hidden = true;
    if (modalTrigger?.isConnected) modalTrigger.focus();
  }
  function editRelease(index = -1) {
    if (!siteData) return;
    const release = siteData.releases[index];
    byId('modal-release-title').textContent = release ? 'ویرایش نسخه ' + release.version : 'افزودن نسخه جدید';
    byId('rel-edit-index').value = String(index);
    byId('rel-version').value = release?.version || '';
    byId('rel-title').value = release?.title || '';
    byId('rel-items').value = release ? release.items.join('\n') : '';
    byId('rel-alpha').checked = !!release?.is_alpha;
    openModal('modal-release');
  }
  function editFaq(index = -1) {
    if (!siteData) return;
    const faq = siteData.faqs[index];
    byId('modal-faq-title').textContent = faq ? 'ویرایش سوال متداول' : 'افزودن سوال متداول';
    byId('faq-edit-index').value = String(index);
    ['q-fa', 'a-fa', 'q-en', 'a-en'].forEach((suffix, i) => {
      byId('faq-' + suffix).value = faq?.[['questionFa', 'answerFa', 'questionEn', 'answerEn'][i]] || '';
    });
    openModal('modal-faq');
  }

  byId('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = byId('btn-login-submit'); button.disabled = true;
    byId('login-error').hidden = true;
    try {
      const state = await api('login', { username: byId('login-user').value.trim(), password: byId('login-pass').value });
      byId('login-pass').value = '';
      byId('new-admin-user').value = state.username || '';
      byId('auth-screen').hidden = true; byId('admin-app').hidden = false;
      await loadData();
    } catch (error) { byId('login-error').textContent = error.message; byId('login-error').hidden = false; }
    finally { button.disabled = false; }
  });
  byId('btn-logout').addEventListener('click', async () => {
    if (dirty && !confirm('تغییرات منتشرنشده از دست می‌رود. خارج شوید؟')) return;
    try { await api('logout', {}); showLogin(); await refreshState(); }
    catch (error) { toast(error.message, true); }
  });
  doc.querySelectorAll('.sidebar-nav .nav-item').forEach(button => button.addEventListener('click', () => {
    doc.querySelectorAll('.sidebar-nav .nav-item').forEach(item => item.classList.toggle('active', item === button));
    doc.querySelectorAll('.admin-tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === button.dataset.tab));
    byId('tab-title').textContent = button.querySelector('span')?.textContent || 'پیشخوان';
  }));
  doc.querySelectorAll('[data-open-tab]').forEach(button => button.addEventListener('click', () => {
    doc.querySelector('.nav-item[data-tab="' + button.dataset.openTab + '"]')?.click();
    if (button.hasAttribute('data-add-release')) editRelease();
  }));
  Object.values(configFields).concat(Object.values(heroFields)).forEach(id => byId(id)?.addEventListener('input', () => setDirty(true)));
  byId('admin-search-releases').addEventListener('input', renderReleases);
  byId('admin-filter-major').addEventListener('change', renderReleases);
  byId('btn-open-add-release').addEventListener('click', () => editRelease());
  byId('btn-open-add-faq').addEventListener('click', () => editFaq());
  doc.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
  doc.querySelectorAll('.admin-modal').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal.id); }));
  doc.addEventListener('keydown', event => {
    const modal = doc.querySelector('.admin-modal:not([hidden])');
    if (!modal) return;
    if (event.key === 'Escape') closeModal(modal.id);
    if (event.key === 'Tab') {
      const items = [...modal.querySelectorAll('button, input:not([type="hidden"]), textarea, select')].filter(item => !item.disabled);
      if (event.shiftKey && doc.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && doc.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    }
  });
  byId('form-release').addEventListener('submit', event => {
    event.preventDefault(); if (!siteData) return;
    const index = Number(byId('rel-edit-index').value);
    const version = byId('rel-version').value.trim().replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+(?:-[a-z\d.-]+)?$/i.test(version)) return toast('قالب شماره نسخه معتبر نیست.', true);
    if (siteData.releases.some((release, i) => i !== index && release.version.replace(/^v/i, '') === version)) return toast('شماره نسخه تکراری است.', true);
    collect();
    const release = { version, title: byId('rel-title').value.trim(), is_alpha: byId('rel-alpha').checked || version.includes('-'),
      items: byId('rel-items').value.split('\n').map(item => item.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean), subsections: index >= 0 ? clone(siteData.releases[index].subsections || []) : [] };
    if (index >= 0) siteData.releases[index] = release; else siteData.releases.unshift(release);
    closeModal('modal-release'); populate(); setDirty(true); toast('نسخه در پیش‌نویس ثبت شد؛ برای انتشار، ذخیره کنید.');
  });
  byId('form-faq').addEventListener('submit', event => {
    event.preventDefault(); if (!siteData) return;
    collect();
    const index = Number(byId('faq-edit-index').value);
    const faq = { id: 'faq-' + (index >= 0 ? index + 1 : siteData.faqs.length + 1),
      questionFa: byId('faq-q-fa').value.trim(), answerFa: byId('faq-a-fa').value.trim(),
      questionEn: byId('faq-q-en').value.trim(), answerEn: byId('faq-a-en').value.trim() };
    if (index >= 0) siteData.faqs[index] = faq; else siteData.faqs.push(faq);
    closeModal('modal-faq'); populate(); setDirty(true); toast('سوال در پیش‌نویس ثبت شد؛ برای انتشار، ذخیره کنید.');
  });
  byId('btn-save-all').addEventListener('click', async () => {
    if (!siteData) return;
    const button = byId('btn-save-all'); button.disabled = true;
    try {
      collect();
      const result = await api('save_data', { data: siteData, revision });
      siteData = result.data; originalData = clone(siteData); revision = result.revision;
      populate(); setDirty(false); toast('✓ تغییرات با موفقیت در سرور ذخیره و منتشر شد.');
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = !siteData; }
  });
  byId('btn-revert').addEventListener('click', () => {
    if (!originalData || !confirm('تغییرات منتشرنشده بازگردانی شوند؟')) return;
    siteData = clone(originalData); populate(); setDirty(false);
  });
  byId('btn-reload-data').addEventListener('click', async () => {
    if (dirty && !confirm('تغییرات منتشرنشده کنار گذاشته و اطلاعات سرور بارگذاری شود؟')) return;
    await loadData();
  });
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement('a'); anchor.href = url; anchor.download = name;
    doc.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  byId('btn-export-json').addEventListener('click', () => {
    if (!siteData) return;
    collect(); download(new Blob([JSON.stringify(siteData, null, 2)], { type: 'application/json' }), 'site_data_backup.json');
  });
  byId('btn-import-json').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 2097152) throw new Error('فایل پشتیبان باید کمتر از ۲ مگابایت باشد.');
      const parsed = JSON.parse(await file.text());
      if (!validShape(parsed)) throw new Error('ساختار فایل پشتیبان معتبر نیست.');
      if (!confirm('اطلاعات پشتیبان در پیش‌نویس جایگزین شود؟ برای انتشار باید ذخیره کنید.')) return;
      siteData = parsed; populate(); setDirty(true); toast('پشتیبان به‌عنوان پیش‌نویس بارگذاری شد؛ هنوز منتشر نشده است.');
    } catch (error) { toast(error.message, true); }
    finally { event.target.value = ''; }
  });
  byId('btn-download-zip').addEventListener('click', async () => {
    if (dirty && !confirm('بسته فقط شامل تغییرات ذخیره‌شده سرور است. ادامه دهید؟')) return;
    const button = byId('btn-download-zip'); button.disabled = true;
    try {
      const response = await fetch('api.php?action=download_zip', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        const result = await response.json(); throw new Error(result.error || 'دریافت بسته انجام نشد.');
      }
      if (!response.headers.get('Content-Type')?.includes('application/zip')) throw new Error('پاسخ سرور یک بسته ZIP معتبر نیست.');
      download(await response.blob(), 'etehadyar-site-backup.zip');
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
  });
  byId('form-change-password').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      if (byId('new-admin-pass').value !== byId('confirm-admin-pass').value) throw new Error('رمز جدید و تکرار آن یکسان نیستند.');
      const result = await api('change_password', { username: byId('new-admin-user').value.trim(),
        password: byId('new-admin-pass').value, currentPassword: byId('current-admin-pass').value });
      form.reset(); byId('new-admin-user').value = result.username;
      toast('✓ رمز با هش امن ذخیره شد؛ نشست‌های دیگر باطل شدند.');
    } catch (error) { toast(error.message, true); }
    finally {
      ['current-admin-pass', 'new-admin-pass', 'confirm-admin-pass'].forEach(id => { byId(id).value = ''; });
      button.disabled = false;
    }
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  if (window.self !== window.top) byId('frame-notice').hidden = false;
  refreshState();
})();
