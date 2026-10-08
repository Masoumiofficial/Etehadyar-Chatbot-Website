/* Public CMS hydration. All editable content is rendered as text, never as HTML. */
(function () {
  'use strict';
  const doc = document;
  const source = doc.currentScript.src;
  const defaults = window.ETEHADYAR_CONFIG || {};
  const faNumber = value => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  let data = null;
  let config = defaults;

  function node(tag, text, className) {
    const element = doc.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function bilingual(tag, fa, en, className) {
    const element = node(tag, undefined, className);
    const persian = node('span', fa, 'lang-fa'); persian.lang = 'fa';
    const english = node('span', en || fa, 'lang-en'); english.lang = en ? 'en' : 'fa';
    if (!en) english.dir = 'rtl';
    element.append(persian, english);
    return element;
  }
  function safeCheckout(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      if (url.href.replace(/\/$/, '') === String(config.productUrl || '').replace(/\/$/, '')) return '';
      return url.href;
    } catch (_) { return ''; }
  }

  function updateCheckout(language = 'fa', currency = 'irr') {
    const chosen = currency === 'usd' ? 'usd' : 'irr';
    const url = safeCheckout(chosen === 'usd' ? config.purchaseUrlInternational : config.purchaseUrlIR);
    doc.querySelectorAll('[data-buy]').forEach(link => {
      const hero = link.dataset.buyKind === 'hero';
      const fa = url ? (hero ? data?.hero.buttonPrimaryFa : null) || 'خرید لایسنس ' + config.siteName : 'خرید به‌زودی؛ درگاه تنظیم نشده';
      const en = url ? (hero ? data?.hero.buttonPrimaryEn : null) || 'Get ' + config.siteNameEn : 'Checkout not configured yet';
      const faText = node('span', fa, 'lang-fa');
      const enText = node('span', en, 'lang-en');
      link.replaceChildren(faText, enText);
      link.classList.toggle('button-disabled', !url);
      link.setAttribute('aria-disabled', String(!url));
      if (url) {
        link.href = url; link.removeAttribute('tabindex'); link.removeAttribute('role'); link.removeAttribute('title');
        link.target = '_blank'; link.rel = 'noopener noreferrer';
      } else {
        link.removeAttribute('href'); link.removeAttribute('target'); link.tabIndex = -1; link.setAttribute('role', 'link');
        link.title = language === 'en' ? 'The administrator must configure a real payment URL.' : 'مدیر باید آدرس واقعی پرداخت را تنظیم کند.';
      }
    });
    const notice = doc.getElementById('checkout-status');
    if (notice) notice.hidden = !!url;
  }
  doc.addEventListener('click', event => {
    if (event.target.closest('[data-buy][aria-disabled="true"]')) event.preventDefault();
  });

  function updateSchemas(language = 'fa') {
    const app = doc.getElementById('software-schema');
    if (app) {
      try {
        const schema = JSON.parse(app.textContent);
        schema.name = language === 'en' ? config.siteNameEn : config.siteName;
        schema.softwareVersion = config.currentVersion;
        schema.url = config.productUrl;
        if (data) schema.description = language === 'en' ? data.hero.descriptionEn || data.hero.descriptionFa : data.hero.descriptionFa;
        const offers = [];
        const local = safeCheckout(config.purchaseUrlIR);
        const international = safeCheckout(config.purchaseUrlInternational);
        const digits = String(config.priceToman).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[,٬\s]/g, '');
        if (local) offers.push({ '@type': 'Offer', price: String(Number(digits) * 10), priceCurrency: 'IRR', url: local });
        if (international) offers.push({ '@type': 'Offer', price: String(config.priceUSD), priceCurrency: 'USD', url: international });
        if (offers.length) schema.offers = offers; else delete schema.offers;
        app.textContent = JSON.stringify(schema).replace(/</g, '\\u003c');
      } catch (_) { /* A malformed optional schema must not break the page. */ }
    }
    const faqSchema = doc.getElementById('faq-schema');
    if (faqSchema && data) {
      const suffix = language === 'en' ? 'En' : 'Fa';
      faqSchema.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: data.faqs.map(faq => ({
        '@type': 'Question', name: faq['question' + suffix] || faq.questionFa,
        acceptedAnswer: { '@type': 'Answer', text: faq['answer' + suffix] || faq.answerFa }
      })) }).replace(/</g, '\\u003c');
    }
  }

  function renderContent() {
    doc.querySelectorAll('[data-content]').forEach(element => {
      const value = data.hero[element.dataset.content];
      if (typeof value === 'string') element.textContent = value;
    });
    doc.querySelectorAll('[data-site-name-fa]').forEach(element => { element.textContent = config.siteName; });
    doc.querySelectorAll('[data-site-name-en]').forEach(element => { element.textContent = config.siteNameEn; });
    doc.querySelectorAll('[data-tagline-fa]').forEach(element => { element.textContent = config.tagline; });
    doc.querySelectorAll('[data-tagline-en]').forEach(element => { element.textContent = config.taglineEn; });
    doc.querySelectorAll('[data-price-irr]').forEach(element => { element.textContent = config.priceToman; });
    doc.querySelectorAll('[data-price-usd]').forEach(element => { element.textContent = config.priceUSD; });
    doc.querySelectorAll('[data-version]').forEach(element => {
      element.textContent = element.dataset.versionLocale === 'fa' ? faNumber(config.currentVersion) : config.currentVersion;
    });
    const stable = data.releases.filter(release => !release.is_alpha).length;
    config.totalReleases = String(stable);
    doc.querySelectorAll('[data-release-count]').forEach(element => { element.textContent = faNumber(stable); });
    const container = doc.querySelector('[data-faq-list]');
    if (container) {
      const fragment = doc.createDocumentFragment();
      data.faqs.forEach((faq, index) => {
        const detail = node('details'); detail.id = 'faq-' + (index + 1); detail.open = index === 0;
        detail.append(bilingual('summary', faq.questionFa, faq.questionEn), bilingual('p', faq.answerFa, faq.answerEn));
        fragment.append(detail);
      });
      container.replaceChildren(fragment);
    }
    renderReleases();
  }

  function releaseMajor(release) {
    return release.is_alpha || release.version.includes('-') ? 'alpha' : 'v' + release.version.replace(/^v/i, '').split('.')[0];
  }
  function releaseCard(release) {
    const version = release.version.replace(/^v/i, '');
    const id = 'v' + version.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const card = node('details', undefined, 'release-card');
    card.id = id; card.dataset.major = releaseMajor(release);
    card.dataset.search = [version, release.title, ...release.items, ...(release.subsections || []).map(section => section.title || '')].join(' ');
    card.open = version === config.currentVersion;
    const summary = node('summary');
    const heading = node('span', undefined, 'release-heading');
    heading.append(node('b', release.title), node('small', faNumber(release.items.length) + ' تغییر ثبت‌شده'));
    const tags = node('span', undefined, 'release-tags');
    if (version === config.currentVersion) tags.append(node('span', 'نسخه فعلی', 'release-tag latest-tag'));
    if (release.is_alpha) tags.append(node('span', 'Alpha', 'release-tag'));
    const toggle = node('span', '+', 'release-toggle'); toggle.setAttribute('aria-hidden', 'true');
    summary.append(node('span', 'v' + version, 'release-version'), heading, tags, toggle);
    const body = node('div', undefined, 'release-body');
    let sections = release.subsections || [];
    const flattened = sections.flatMap(section => section.items || []);
    if (!sections.length || JSON.stringify(flattened) !== JSON.stringify(release.items)) sections = [{ title: '', items: release.items }];
    sections.forEach(section => {
      if (!section.items?.length) return;
      if (section.title) body.append(node('h3', section.title, 'sub-heading'));
      const list = node('ul', undefined, 'release-list');
      section.items.forEach(text => {
        const item = node('li'); const mark = node('i', '✓'); mark.setAttribute('aria-hidden', 'true');
        item.append(mark, node('span', text)); list.append(item);
      });
      body.append(list);
    });
    const anchor = node('a', '# v' + version, 'release-anchor'); anchor.href = '#' + id;
    anchor.setAttribute('aria-label', 'لینک مستقیم به نسخه ' + version);
    body.append(anchor); card.append(summary, body); return card;
  }
  function renderReleases() {
    const stream = doc.getElementById('release-stream');
    if (!stream) return;
    const groups = new Map();
    data.releases.forEach(release => {
      const major = releaseMajor(release);
      if (!groups.has(major)) groups.set(major, []);
      groups.get(major).push(release);
    });
    stream.querySelectorAll('.release-group').forEach(group => group.remove());
    const fragment = doc.createDocumentFragment();
    [...groups.keys()].sort((a, b) => a === 'alpha' ? 1 : b === 'alpha' ? -1 : Number(b.slice(1)) - Number(a.slice(1))).forEach(major => {
      const releases = groups.get(major);
      const group = node('section', undefined, 'release-group'); group.id = 'group-' + major; group.dataset.major = major;
      const header = node('header', undefined, 'group-header');
      const title = major === 'alpha' ? 'مسیر آزمایشی Alpha' : 'نسل ' + faNumber(major.slice(1));
      const badge = node('div', undefined, 'group-badge'); badge.append(node('span', title), node('b', faNumber(releases.length) + ' نسخه'));
      header.append(badge, node('h2', title + ' — تاریخچه تغییرات محصول'));
      const cards = node('div', undefined, 'group-cards'); releases.forEach(release => cards.append(releaseCard(release)));
      group.append(header, cards); fragment.append(group);
      const filters = doc.querySelector('.filter-pills');
      if (filters) {
        let button = [...filters.querySelectorAll('[data-filter]')].find(item => item.dataset.filter === major);
        if (!button) { button = node('button', undefined, 'filter-pill'); button.type = 'button'; button.dataset.filter = major; filters.append(button); }
        button.textContent = title + ' (' + faNumber(releases.length) + ')';
        button.setAttribute('aria-pressed', 'false');
      }
    });
    stream.append(fragment);
    const all = doc.querySelector('[data-filter="all"]');
    if (all) all.textContent = 'همه نسخه‌ها (' + faNumber(data.releases.length) + ')';
    doc.querySelectorAll('.index-card a').forEach(link => {
      const major = link.hash.replace('#group-', '');
      const releases = groups.get(major) || [];
      const badge = link.querySelector('b'); if (badge) badge.textContent = faNumber(releases.length);
      link.hidden = !releases.length;
    });
  }

  window.ETEHADYAR_PUBLIC = { updateCheckout, updateSchemas };
  // Even without JS hydration, an unconfigured checkout never becomes a homepage link.
  updateCheckout();
  window.ETEHADYAR_READY = (async function () {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(new URL('../../data/site_data.json', source), { cache: 'no-cache', credentials: 'omit', signal: controller.signal });
      if (!response.ok) throw new Error('Public content request failed');
      const value = await response.json();
      if (!value || !value.config || !value.hero || !Array.isArray(value.faqs) || !Array.isArray(value.releases)
          || !value.faqs.every(faq => typeof faq.questionFa === 'string' && typeof faq.answerFa === 'string')
          || !value.releases.every(release => typeof release.version === 'string' && typeof release.title === 'string' && Array.isArray(release.items))) {
        throw new Error('Invalid public content');
      }
      data = value; config = Object.assign({}, defaults);
      Object.keys(defaults).forEach(key => { if (typeof data.config[key] === 'string') config[key] = data.config[key]; });
      renderContent();
      window.ETEHADYAR_DATA = data;
      window.ETEHADYAR_CONFIG = Object.freeze(config);
    } catch (_) {
      config = Object.assign({}, defaults, { purchaseUrlIR: '', purchaseUrlInternational: '' });
      window.ETEHADYAR_CONFIG = Object.freeze(config);
      doc.querySelectorAll('[data-content-status]').forEach(element => { element.hidden = false; });
    } finally {
      clearTimeout(timer);
      updateCheckout(doc.documentElement.dataset.lang || 'fa', doc.documentElement.dataset.currency || 'irr');
      updateSchemas(doc.documentElement.dataset.lang || 'fa');
    }
  })();
})();
