/* Preferences and decorative depth are independent of CMS/network/authentication. */
(function () {
  'use strict';
  const doc = document;
  const root = doc.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = window.matchMedia('(forced-colors: active)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const wide = window.matchMedia('(min-width: 901px)');
  let toolbar;
  let themeButton;
  let depthButton;
  let sceneVisible = true;
  let frame = 0;
  let position = { x: 0, y: 0 };
  function read(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } }
  function write(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* Optional preferences; functionality must not depend on storage. */ } }
  const en = () => root.lang === 'en';
  function label(fa, english) { return en() ? english : fa; }
  function svg(paths) {
    const element = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    [['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.6'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true'], ['focusable', 'false']].forEach(([key, value]) => element.setAttribute(key, value));
    paths.forEach(d => { const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); element.append(path); });
    return element;
  }
  function resetMotion() {
    cancelAnimationFrame(frame); frame = 0;
    root.style.removeProperty('--depth-x'); root.style.removeProperty('--depth-y');
  }
  function refreshMotion() {
    const enabled = root.dataset.depth === 'on' && !reduced.matches && !forcedColors.matches && finePointer.matches && wide.matches && !doc.hidden;
    root.dataset.motion = enabled ? 'on' : 'off';
    if (!enabled) resetMotion();
    refreshControls();
  }
  function refreshControls() {
    if (!themeButton || !depthButton) return;
    const dark = root.dataset.theme === 'dark';
    themeButton.setAttribute('aria-pressed', String(dark));
    const themeLabel = label(dark ? 'فعال‌کردن تم روشن' : 'فعال‌کردن تم تیره', dark ? 'Switch to light theme' : 'Switch to dark theme');
    themeButton.setAttribute('aria-label', themeLabel); themeButton.title = themeLabel;
    themeButton.replaceChildren(svg(dark ? ['M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4', 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'] : ['M20.2 14A8.5 8.5 0 0 1 10 3.8 8.5 8.5 0 1 0 20.2 14Z']));
    const depth = root.dataset.depth === 'on';
    depthButton.setAttribute('aria-pressed', String(depth));
    const depthLabel = label(depth ? 'خاموش‌کردن جلوه‌های عمق' : 'روشن‌کردن جلوه‌های عمق', depth ? 'Turn depth effects off' : 'Turn depth effects on');
    depthButton.setAttribute('aria-label', depthLabel);
    depthButton.title = depthLabel + (root.dataset.motion === 'off' && depth ? label('؛ نمایش ثابت برای این دستگاه یا تنظیم کاهش حرکت', '; static appearance on this device or with reduced motion') : '');
  }
  function setTheme(value, persist = true) {
    root.dataset.theme = value === 'dark' ? 'dark' : 'light';
    const scheme = doc.querySelector('meta[name="color-scheme"]');
    const color = doc.querySelector('meta[name="theme-color"]');
    if (scheme) scheme.content = root.dataset.theme;
    if (color) color.content = root.dataset.theme === 'dark' ? '#090e1b' : '#f7f9fd';
    if (persist) write('etehadyar-theme', root.dataset.theme);
    refreshControls();
  }
  function setDepth(value, persist = true) {
    root.dataset.depth = value === 'off' ? 'off' : 'on';
    if (persist) write('etehadyar-depth', root.dataset.depth);
    refreshMotion();
  }
  setTheme(read('etehadyar-theme', 'light'), false);
  setDepth(read('etehadyar-depth', 'on'), false);

  function mount() {
    toolbar = doc.createElement('div'); toolbar.className = 'appearance-controls';
    toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', label('تنظیمات ظاهر', 'Appearance settings'));
    themeButton = doc.createElement('button'); themeButton.type = 'button'; themeButton.className = 'appearance-button'; themeButton.dataset.appearance = 'theme';
    depthButton = doc.createElement('button'); depthButton.type = 'button'; depthButton.className = 'appearance-button'; depthButton.dataset.appearance = 'depth';
    depthButton.append(svg(['m12 3 9 5-9 5-9-5 9-5Z', 'm3 12 9 5 9-5M3 16l9 5 9-5']));
    toolbar.append(themeButton, depthButton);
    const actions = doc.querySelector('.nav-actions');
    const app = doc.getElementById('admin-app');
    if (actions) actions.prepend(toolbar);
    else if (app) {
      const placeToolbar = () => {
        toolbar.classList.toggle('admin-appearance', app.hidden);
        if (app.hidden) doc.body.append(toolbar); else doc.querySelector('.topbar-right')?.prepend(toolbar);
      };
      placeToolbar();
      new MutationObserver(placeToolbar).observe(app, { attributes: true, attributeFilter: ['hidden'] });
    } else return;
    themeButton.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
    depthButton.addEventListener('click', () => setDepth(root.dataset.depth === 'on' ? 'off' : 'on'));
    doc.addEventListener('etehadyar:language-change', () => {
      toolbar.setAttribute('aria-label', label('تنظیمات ظاهر', 'Appearance settings')); refreshControls();
    });
    refreshMotion();
    const hero = doc.querySelector('.hero, .changelog-hero');
    if (!hero) return;
    const scene = doc.createElement('div'); scene.className = 'depth-scene'; scene.setAttribute('aria-hidden', 'true');
    for (const name of ['depth-orbit back', 'depth-orbit front', 'depth-glow blue', 'depth-glow violet']) {
      const layer = doc.createElement('span'); layer.className = name; scene.append(layer);
    }
    for (const [name, paths] of [['code', ['m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16']], ['spark', ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z']]]) {
      const tile = doc.createElement('span'); tile.className = 'depth-tile ' + name; tile.append(svg(paths)); scene.append(tile);
    }
    hero.prepend(scene);
    if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
      sceneVisible = entries[0].isIntersecting;
      if (!sceneVisible) resetMotion();
    }).observe(hero);
    hero.addEventListener('pointermove', event => {
      if (root.dataset.motion !== 'on' || !sceneVisible || event.pointerType === 'touch') return;
      position = { x: Math.max(-12, Math.min(12, (event.clientX / innerWidth - 0.5) * 24)), y: Math.max(-10, Math.min(10, (event.clientY / innerHeight - 0.5) * 20)) };
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (root.dataset.motion !== 'on' || !sceneVisible) return;
        root.style.setProperty('--depth-x', position.x.toFixed(2) + 'px');
        root.style.setProperty('--depth-y', position.y.toFixed(2) + 'px');
      });
    }, { passive: true });
    hero.addEventListener('pointerleave', resetMotion);
  }
  [reduced, forcedColors, finePointer, wide].forEach(query => {
    if (query.addEventListener) query.addEventListener('change', refreshMotion); else query.addListener(refreshMotion);
  });
  doc.addEventListener('visibilitychange', refreshMotion);
  window.addEventListener('pagehide', resetMotion);
  window.addEventListener('pageshow', refreshMotion);
  window.addEventListener('storage', event => {
    if (event.key === 'etehadyar-theme') setTheme(event.newValue, false);
    if (event.key === 'etehadyar-depth') setDepth(event.newValue, false);
  });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
