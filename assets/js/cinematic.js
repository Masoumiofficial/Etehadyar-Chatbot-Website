/* Public-only cinematic presentation. Local Lenis, native fallback, event-driven RAF. */
(function () {
  'use strict';
  const doc = document;
  const root = doc.documentElement;
  const body = doc.body;
  if (!body.hasAttribute('data-cinematic')) return;
  const scenes = [...doc.querySelectorAll('[data-cinema-scene]')];
  const visibleScenes = new Set();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const forced = window.matchMedia('(forced-colors: active)');
  const tools = doc.querySelector('.changelog-tools');
  const meters = [...doc.querySelectorAll('.reading-track')];
  let lenis = null;
  let smoothFrame = 0;
  let shotFrame = 0;
  let pointerFrame = 0;
  let clock = 0;
  let lastStamp = 0;
  let activeCard = null;
  let revealObserver;
  let locked = false;
  const motion = () => root.dataset.motion === 'on' && !doc.hidden;
  const english = () => root.lang === 'en';
  const faNumber = value => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  function offsetFor(target) {
    const header = parseFloat(getComputedStyle(root).getPropertyValue('--header-height')) || 90;
    const toolbar = tools && innerWidth > 900 && target?.closest?.('.changelog-stream') ? tools.getBoundingClientRect().height + 24 : 0;
    return header + toolbar + 20;
  }
  function pump(time) {
    smoothFrame = 0;
    if (!lenis || !motion() || locked) { root.dataset.scrollActivity = 'idle'; lastStamp = 0; return; }
    // A paused virtual clock prevents a large first delta after a long idle interval.
    clock += lastStamp ? Math.min(40, Math.max(0, time - lastStamp)) : 16;
    lastStamp = time;
    lenis.raf(clock);
    if (lenis.isScrolling === 'smooth') {
      root.dataset.scrollActivity = 'active'; smoothFrame = requestAnimationFrame(pump);
    } else { root.dataset.scrollActivity = 'idle'; lastStamp = 0; }
  }
  function startPump() {
    if (lenis && motion() && !locked && !smoothFrame && lenis.isScrolling === 'smooth') {
      root.dataset.scrollActivity = 'active'; smoothFrame = requestAnimationFrame(pump);
    }
  }
  function destroySmooth() {
    cancelAnimationFrame(smoothFrame); smoothFrame = 0; lastStamp = 0; clock = 0;
    if (lenis) { lenis.destroy(); lenis = null; }
    root.dataset.smoothScroll = 'native'; root.dataset.scrollActivity = 'idle';
  }
  function refreshLock() {
    locked = body.classList.contains('lightbox-open') || body.classList.contains('menu-open');
    root.dataset.scrollLock = locked ? 'on' : 'off';
    if (lenis) { if (locked) { lenis.stop(); cancelAnimationFrame(smoothFrame); smoothFrame = 0; lastStamp = 0; } else lenis.start(); }
  }
  function refreshEffects() {
    if (motion() && typeof window.Lenis === 'function' && !lenis) {
      try {
        lenis = new window.Lenis({ autoRaf: false, smoothWheel: true, syncTouch: false, lerp: .1, wheelMultiplier: .95,
          anchors: false, overscroll: true, respectReducedMotion: true, stopInertiaOnNavigate: true,
          virtualScroll: ({ event }) => !event.ctrlKey && !event.shiftKey,
          prevent: node => !!node.closest?.('[data-lenis-prevent]') });
        lenis.on('scroll', scheduleShots);
        // Start the clock after the library has initialized the input animation.
        lenis.on('virtual-scroll', () => queueMicrotask(startPump));
        root.dataset.smoothScroll = 'on';
      } catch (_) { destroySmooth(); }
    } else if (!motion()) destroySmooth();
    if (!lenis) root.dataset.smoothScroll = 'native';
    if (!motion()) {
      resetCard();
      scenes.forEach(scene => { scene.style.removeProperty('--scene-rx'); scene.style.removeProperty('--scene-ry'); scene.style.removeProperty('--scene-lift'); });
      doc.querySelectorAll('.cine-pending').forEach(node => node.classList.remove('cine-pending'));
    }
    refreshLock(); scheduleShots();
  }
  function scrollTo(target, options = {}) {
    const destination = typeof target === 'number' ? target : target.getBoundingClientRect().top + scrollY - offsetFor(target);
    if (lenis && !locked) { lenis.scrollTo(destination, { onComplete: options.onComplete }); startPump(); }
    else { window.scrollTo({ top: Math.max(0, destination), behavior: !reduced.matches && !forced.matches && root.dataset.depth !== 'off' ? 'smooth' : 'instant' }); options.onComplete?.(); }
  }
  function updateShots() {
    shotFrame = 0;
    const extent = root.scrollHeight - innerHeight;
    const progress = extent > 0 ? Math.max(0, Math.min(1, scrollY / extent)) : 0;
    meters.forEach(meter => { meter.style.setProperty('--reading', (progress * 100).toFixed(2) + '%'); meter.setAttribute('aria-valuenow', String(Math.round(progress * 100))); });
    doc.querySelectorAll('[data-reading-percent]').forEach(node => { node.textContent = faNumber(Math.round(progress * 100)) + '٪'; });
    topButton.hidden = scrollY < innerHeight * .8;
    if (!motion()) return;
    visibleScenes.forEach(scene => {
      const hero = scene.closest('.hero, .changelog-hero');
      const bounds = hero?.getBoundingClientRect();
      if (!bounds) return;
      const phase = Math.max(-.2, Math.min(1, -bounds.top / Math.max(1, bounds.height)));
      scene.style.setProperty('--scene-lift', (phase * -40).toFixed(2) + 'px');
    });
  }
  function scheduleShots() { if (!shotFrame && !doc.hidden) shotFrame = requestAnimationFrame(updateShots); }
  function resetCard() {
    if (activeCard) { ['--card-rx', '--card-ry', '--shine-x', '--shine-y'].forEach(key => activeCard.style.removeProperty(key)); activeCard = null; }
  }
  scenes.forEach(scene => {
    scene.addEventListener('pointermove', event => {
      if (!motion() || !visibleScenes.has(scene) || event.pointerType === 'touch') return;
      const bounds = scene.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
      const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
      if (!pointerFrame) pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        if (!motion() || !scene.matches(':hover')) return;
        scene.style.setProperty('--scene-rx', (-y * 7).toFixed(2) + 'deg'); scene.style.setProperty('--scene-ry', (x * 9).toFixed(2) + 'deg');
      });
    }, { passive: true });
    scene.addEventListener('pointerleave', () => { scene.style.removeProperty('--scene-rx'); scene.style.removeProperty('--scene-ry'); });
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      entries.forEach(entry => {
        entry.target.classList.toggle('cine-visible', entry.isIntersecting);
        if (entry.isIntersecting) visibleScenes.add(entry.target); else visibleScenes.delete(entry.target);
      }); scheduleShots();
    }, { threshold: .03 }).observe(scenes[0] || doc.querySelector('main'));
    // Other pages currently have no scene; reveal remains independent of it.
  } else scenes.forEach(scene => { visibleScenes.add(scene); scene.classList.add('cine-visible'); });
  function registerShots() {
    revealObserver?.disconnect();
    const targets = [...doc.querySelectorAll('.section-head, .release-group, .bento-grid > .bento-card, .calc-card, .pricing-card, .summary-box')];
    targets.forEach(node => { node.classList.add('cine-shot'); node.classList.remove('cine-pending'); });
    doc.querySelectorAll('.bento-card, .highlight-item, .release-card').forEach(node => node.classList.add('cine-hover'));
    if (!motion() || !('IntersectionObserver' in window)) return;
    revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.remove('cine-pending'); entry.target.classList.add('cine-entered'); revealObserver.unobserve(entry.target); }
    }), { threshold: .035, rootMargin: '0px 0px -25px' });
    targets.forEach(node => { if (node.getBoundingClientRect().top > innerHeight + 32) node.classList.add('cine-pending'); revealObserver.observe(node); });
  }
  doc.addEventListener('pointermove', event => {
    if (!motion() || event.pointerType === 'touch') return;
    const card = event.target.closest?.('.cine-hover');
    if (card !== activeCard) { resetCard(); activeCard = card; }
    if (!card || pointerFrame) return;
    const bounds = card.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      if (!motion() || activeCard !== card) return;
      card.style.setProperty('--card-rx', ((.5 - y) * 1.5).toFixed(2) + 'deg'); card.style.setProperty('--card-ry', ((x - .5) * 1.5).toFixed(2) + 'deg');
      card.style.setProperty('--shine-x', (x * 100).toFixed(1) + '%'); card.style.setProperty('--shine-y', (y * 100).toFixed(1) + '%');
    });
  }, { passive: true });
  doc.querySelectorAll('.mobile-menu, .tour-tabs, .ui-table-wrap, .lightbox, .docs-sidebar, .sidebar-sticky').forEach(node => node.setAttribute('data-lenis-prevent', ''));
  const topButton = doc.createElement('button'); topButton.type = 'button'; topButton.className = 'back-to-top'; topButton.hidden = true;
  topButton.setAttribute('aria-label', english() ? 'Back to top' : 'بازگشت به بالای صفحه'); topButton.title = topButton.getAttribute('aria-label');
  const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('fill', 'none'); icon.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M12 20V4m-6 6 6-6 6 6'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.8'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); icon.append(path); topButton.append(icon); body.append(topButton);
  topButton.addEventListener('click', () => scrollTo(0, { onComplete: () => {
    const heading = doc.querySelector('h1'); if (heading) { const old = heading.getAttribute('tabindex'); heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); heading.addEventListener('blur', () => { if (old === null) heading.removeAttribute('tabindex'); else heading.setAttribute('tabindex', old); }, { once: true }); }
  } }));
  doc.addEventListener('etehadyar:language-change', () => { topButton.setAttribute('aria-label', english() ? 'Back to top' : 'بازگشت به بالای صفحه'); topButton.title = topButton.getAttribute('aria-label'); });
  doc.addEventListener('click', event => {
    if (!lenis || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.classList.contains('skip-link') || link.hasAttribute('download') || link.target && link.target !== '_self') return;
    let url; let target;
    try { url = new URL(link.href); if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return; target = doc.getElementById(decodeURIComponent(url.hash.slice(1))); } catch (_) { return; }
    if (!target) return;
    event.preventDefault();
    if (location.hash !== url.hash) history.pushState(null, '', url.hash);
    if (body.classList.contains('changelog-page') && target.matches('.release-group, details')) {
      window.dispatchEvent(new CustomEvent('etehadyar:archive-link', { detail: { keyboard: event.detail === 0 } })); return;
    }
    queueMicrotask(() => { refreshLock(); scrollTo(target, { onComplete: event.detail === 0 ? () => {
      const old = target.getAttribute('tabindex'); target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); target.addEventListener('blur', () => { if (old === null) target.removeAttribute('tabindex'); else target.setAttribute('tabindex', old); }, { once: true });
    } : undefined }); });
  });
  window.addEventListener('wheel', startPump, { passive: true });
  window.addEventListener('scroll', scheduleShots, { passive: true });
  window.addEventListener('resize', scheduleShots, { passive: true });
  new MutationObserver(refreshEffects).observe(root, { attributes: true, attributeFilter: ['data-motion', 'data-depth'] });
  new MutationObserver(refreshLock).observe(body, { attributes: true, attributeFilter: ['class'] });
  if (tools && 'ResizeObserver' in window) new ResizeObserver(() => { root.style.setProperty('--cine-tools-height', tools.getBoundingClientRect().height + 'px'); }).observe(tools);
  window.addEventListener('pagehide', () => { destroySmooth(); cancelAnimationFrame(shotFrame); shotFrame = 0; cancelAnimationFrame(pointerFrame); pointerFrame = 0; resetCard(); });
  window.addEventListener('pageshow', refreshEffects);
  doc.addEventListener('visibilitychange', refreshEffects);
  window.ETEHADYAR_CINEMA = Object.freeze({ scrollTo, status: () => ({ smooth: !!lenis, locked, scrolling: !!smoothFrame }) });
  refreshEffects(); registerShots(); scheduleShots();
  (window.ETEHADYAR_READY || Promise.resolve()).then(() => { registerShots(); lenis?.resize(); scheduleShots(); });
})();
