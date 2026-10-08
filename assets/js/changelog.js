(window.ETEHADYAR_READY || Promise.resolve()).then(function () {
  'use strict';
  const doc = document;
  const search = doc.getElementById('release-search');
  const filterButtons = [...doc.querySelectorAll('[data-filter]')];
  const cards = [...doc.querySelectorAll('.release-card')];
  const groups = [...doc.querySelectorAll('.release-group')];
  const resultCount = doc.getElementById('result-count');
  const noResults = doc.getElementById('no-results');
  const expandButton = doc.getElementById('expand-all');
  const header = doc.getElementById('doc-header');
  const progress = doc.querySelector('.scroll-progress');
  let activeFilter = 'all';
  const faNumber = value => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  function normalize(value) {
    return String(value || '').toLowerCase().trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک')
      .replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)).replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)).replace(/\s+/g, ' ');
  }
  function applyFilters() {
    const term = normalize(search?.value);
    let visible = 0;
    cards.forEach(card => {
      const show = (activeFilter === 'all' || card.dataset.major === activeFilter) && (!term || normalize(card.dataset.search).includes(term));
      card.classList.toggle('is-filtered', !show);
      if (show) { visible++; if (term) card.open = true; }
    });
    groups.forEach(group => group.classList.toggle('is-filtered', !group.querySelector('.release-card:not(.is-filtered)')));
    filterButtons.forEach(button => {
      const selected = button.dataset.filter === activeFilter;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    });
    const stable = cards.filter(card => card.dataset.major !== 'alpha').length;
    const alpha = cards.length - stable;
    if (resultCount) resultCount.textContent = activeFilter === 'all' && !term ? faNumber(stable) + ' نسخه اصلی + ' + faNumber(alpha) + ' Alpha' : faNumber(visible) + ' نتیجه';
    if (noResults) noResults.hidden = visible !== 0;
    if (expandButton) expandButton.disabled = visible === 0;
  }
  filterButtons.forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; applyFilters(); }));
  search?.addEventListener('input', applyFilters);
  search?.addEventListener('search', applyFilters);
  doc.getElementById('clear-search')?.addEventListener('click', () => { search.value = ''; activeFilter = 'all'; applyFilters(); search.focus(); });
  expandButton?.addEventListener('click', () => {
    const visible = cards.filter(card => !card.classList.contains('is-filtered'));
    const open = !visible.every(card => card.open);
    visible.forEach(card => { card.open = open; });
    expandButton.textContent = open ? 'بستن همه' : 'بازکردن همه';
  });
  doc.addEventListener('keydown', event => {
    const editing = event.target.matches('input, textarea, [contenteditable="true"]');
    if (event.key === '/' && !editing && search) { event.preventDefault(); search.focus(); }
    if (event.key === 'Escape' && doc.activeElement === search) { search.value = ''; search.blur(); applyFilters(); }
  });
  function openHash() {
    if (!location.hash) return;
    let target;
    try { target = doc.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (_) { return; }
    if (!target || !target.matches('details')) return;
    if (target.classList.contains('is-filtered')) { activeFilter = 'all'; if (search) search.value = ''; applyFilters(); }
    target.open = true;
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }
  applyFilters(); openHash(); window.addEventListener('hashchange', openHash);
  function onScroll() {
    const y = window.scrollY;
    header?.classList.toggle('scrolled', y > 20);
    const height = doc.documentElement.scrollHeight - innerHeight;
    progress?.style.setProperty('--scroll', (height > 0 ? Math.min(100, y / height * 100) : 0) + '%');
  }
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
  if (header && 'ResizeObserver' in window) new ResizeObserver(() => doc.documentElement.style.setProperty('--header-height', header.getBoundingClientRect().height + 'px')).observe(header);
  if ('IntersectionObserver' in window) {
    const links = [...doc.querySelectorAll('.index-card a')];
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) links.forEach(link => link.classList.toggle('active', link.hash === '#' + entry.target.id));
    }), { rootMargin: '-28% 0px -65%', threshold: 0 });
    groups.forEach(group => observer.observe(group));
  }
});
