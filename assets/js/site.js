(function () {
  'use strict';
  const scriptUrl = document.currentScript.src;
  (function initializeInteractions() {
    const doc = document;
    const root = doc.documentElement;
    const body = doc.body;
    let cfg = window.ETEHADYAR_CONFIG || {};
    const byId = id => doc.getElementById(id);
    const initialTitle = doc.title;
    const langButton = byId('lang-toggle');
    const menuButton = byId('menu-toggle');
    const menu = byId('mobile-menu');
    const header = byId('site-header');
    const currencies = [...doc.querySelectorAll('button[data-currency]')];
    const pricePanels = [...doc.querySelectorAll('[data-price-panel]')];
    const tourButtons = [...doc.querySelectorAll('[data-tour]')];
    const tourPanels = [...doc.querySelectorAll('[data-tour-panel]')];
    const lightbox = byId('lightbox');
    const lightboxImage = byId('lightbox-image');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let currencyTouched = false;
    let lightboxTrigger = null;
    let inertElements = [];
    const faNumber = value => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
    function stored(key, fallback = '') { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } }
    function store(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* Optional preferences only. */ } }
    function isEnglish() { return root.dataset.lang === 'en'; }
    function label(fa, en) { return isEnglish() ? en : fa; }

    function setCurrency(currency, persist = false) {
      const selected = currency === 'usd' ? 'usd' : 'irr';
      root.dataset.currency = selected;
      currencies.forEach(button => { const active = button.dataset.currency === selected; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
      pricePanels.forEach(panel => { panel.hidden = panel.dataset.pricePanel !== selected; });
      window.ETEHADYAR_PUBLIC?.updateCheckout(root.dataset.lang || 'fa', selected);
      if (persist) store('etehadyar-currency', selected);
    }
    function updateTitle() {
      if (langButton) doc.title = isEnglish() ? cfg.siteNameEn + ' ' + cfg.currentVersion + ' — AI WordPress Automation' : cfg.siteName + ' ' + cfg.currentVersion + ' — هوش مصنوعی و اتوماسیون وردپرس';
      else doc.title = initialTitle;
    }
    function setLanguage(language, initial = false) {
      // Documentation/about are Persian-only: a stored English preference must not flip their direction or titles.
      const en = !!langButton && language === 'en';
      root.lang = root.dataset.lang = en ? 'en' : 'fa'; root.dir = en ? 'ltr' : 'rtl';
      if (langButton) {
        store('etehadyar-lang', root.lang);
        langButton.setAttribute('aria-label', en ? 'تغییر زبان به فارسی' : 'Switch to English overview');
        updateTitle();
      } else doc.title = initialTitle;
      if (menuButton) menuButton.setAttribute('aria-label', label('باز کردن منو', 'Open menu'));
      if (!currencyTouched) setCurrency(initial ? stored('etehadyar-currency', en ? 'usd' : 'irr') : en ? 'usd' : 'irr');
      else window.ETEHADYAR_PUBLIC?.updateCheckout(root.lang, root.dataset.currency);
      window.ETEHADYAR_PUBLIC?.updateSchemas(root.lang);
      updateCalculator();
      const currentTour = tourButtons.find(button => button.getAttribute('aria-selected') === 'true');
      if (currentTour) activateTour(currentTour.dataset.tour);
      doc.dispatchEvent(new CustomEvent('etehadyar:language-change'));
    }
    langButton?.addEventListener('click', () => setLanguage(isEnglish() ? 'fa' : 'en'));
    currencies.forEach((button, index) => {
      button.addEventListener('click', () => { currencyTouched = true; setCurrency(button.dataset.currency, true); });
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let next = event.key === 'Home' ? 0 : event.key === 'End' ? currencies.length - 1 : (index + 1) % currencies.length;
        currencyTouched = true; setCurrency(currencies[next].dataset.currency, true); currencies[next].focus();
      });
    });
    function closeMenu(focus = false) {
      const wasOpen = menu?.classList.contains('open'); menu?.classList.remove('open');
      menuButton?.setAttribute('aria-expanded', 'false');
      menuButton?.setAttribute('aria-label', label('باز کردن منو', 'Open menu')); body.classList.remove('menu-open');
      if (focus && wasOpen) menuButton.focus();
    }
    menuButton?.addEventListener('click', () => {
      const open = !menu.classList.contains('open'); menu.classList.toggle('open', open);
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', label(open ? 'بستن منو' : 'باز کردن منو', open ? 'Close menu' : 'Open menu')); body.classList.toggle('menu-open', open);
    });
    menu?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => closeMenu()));
    doc.addEventListener('click', event => { if (!event.target.closest('.nav-shell, .doc-nav')) closeMenu(); });

    function activateTour(name) {
      tourButtons.forEach(button => { const active = button.dataset.tour === name; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
      tourPanels.forEach(panel => { panel.hidden = panel.dataset.tourPanel !== name; });
      const title = byId('device-title');
      const active = tourButtons.find(button => button.dataset.tour === name);
      if (title && active) title.textContent = (isEnglish() ? cfg.siteNameEn : cfg.siteName) + ' ' + cfg.currentVersion + ' — ' + active.querySelector('b').innerText;
    }
    tourButtons.forEach((button, index) => {
      button.addEventListener('click', () => activateTour(button.dataset.tour));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const direction = (event.key === 'ArrowRight' ? 1 : -1) * (root.dir === 'rtl' ? -1 : 1);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tourButtons.length - 1 : (index + direction + tourButtons.length) % tourButtons.length;
        activateTour(tourButtons[next].dataset.tour); tourButtons[next].focus();
      });
    });
    if (tourButtons.length) activateTour(tourButtons[0].dataset.tour);
    function closeLightbox() {
      if (!lightbox || lightbox.hidden) return;
      lightbox.hidden = true; lightboxImage.removeAttribute('src'); body.classList.remove('lightbox-open');
      inertElements.forEach(element => element.removeAttribute('inert')); inertElements = [];
      if (lightboxTrigger?.isConnected) lightboxTrigger.focus();
    }
    doc.querySelectorAll('[data-lightbox]').forEach(button => button.addEventListener('click', () => {
      if (!lightbox) return;
      lightboxTrigger = button; lightboxImage.src = button.dataset.lightbox; lightboxImage.alt = button.querySelector('img')?.alt || '';
      lightbox.hidden = false; body.classList.add('lightbox-open');
      inertElements = [...body.children].filter(element => element !== lightbox && element.tagName !== 'SCRIPT' && !element.hasAttribute('inert'));
      inertElements.forEach(element => element.setAttribute('inert', '')); lightbox.querySelector('button').focus();
    }));
    lightbox?.addEventListener('click', event => { if (event.target === lightbox || event.target.closest('.lightbox-close')) closeLightbox(); });
    doc.addEventListener('keydown', event => {
      if (event.key === 'Escape') { closeMenu(true); closeLightbox(); }
      if (event.key === 'Tab' && lightbox && !lightbox.hidden) { event.preventDefault(); lightbox.querySelector('button').focus(); }
    });

    body.classList.add('js-ready');
    if (!reduced && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
      }), { threshold: 0.08, rootMargin: '0px 0px -28px' });
      doc.querySelectorAll('.reveal').forEach(element => observer.observe(element));
    } else doc.querySelectorAll('.reveal').forEach(element => element.classList.add('is-visible'));
    function onScroll() {
      header?.classList.toggle('scrolled', scrollY > 32);
      const height = root.scrollHeight - innerHeight;
      doc.querySelector('.scroll-progress')?.style.setProperty('--scroll', (height > 0 ? Math.min(100, scrollY / height * 100) : 0) + '%');
    }
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
    if (header && 'ResizeObserver' in window) new ResizeObserver(() => root.style.setProperty('--header-height', header.getBoundingClientRect().height + 'px')).observe(header);

    // Voice playground: explicitly a prerecorded demonstration, not a live model or health monitor.
    const mic = byId('voice-mic-btn');
    const waveform = byId('voice-waveform');
    const transcript = byId('voice-transcript');
    const replyBox = byId('voice-reply-box');
    const reply = byId('voice-reply-text');
    const status = byId('voice-status-label');
    let generation = 0;
    let timer;
    let audio;
    let audioContext;
    let recognition;
    let active = false;
    let rate = 1;
    const samples = {
      p1: { user: 'برای پنج محصول ساعت هوشمند توضیحات و سناریوی ریلز آماده کن.', ai: 'پاسخ نمایشی: توضیحات محصول و سناریوی ویدیو در این مثال آماده شده‌اند. هیچ محتوایی از این وب‌سایت در وردپرس ذخیره نمی‌شود.' },
      p2: { user: 'یک نمونه گزارش سلامت و صف کارها را نشان بده.', ai: 'پاسخ نمونه: اعداد داخل این سناریو فرضی‌اند. این دمو به OpenAI، Gemini، پایگاه داده یا صف واقعی متصل نیست.' },
      p3: { user: 'یک پاسخ نمونه به سوال ارسال سفارش پخش کن.', ai: 'این پاسخ صرفاً یک سناریوی از پیش ضبط‌شده برای نمایش تجربه پشتیبانی است؛ زمان ارسال و درصد اطمینان، داده واقعی فروشگاه نیستند.' },
      p4: { user: 'نمونه سناریوی تولید مقاله سئو با تصویر را پخش کن.', ai: 'در این سناریوی نمایشی، مراحل تولید مقاله و تصویر توضیح داده می‌شود؛ در این سایت هیچ مقاله یا تصویر جدیدی تولید نمی‌شود.' }
    };
    function voiceStatus(text) { if (status) status.textContent = text; }
    function tone(frequency = 660) {
      try {
        const Context = window.AudioContext || window.webkitAudioContext; if (!Context) return;
        if (!audioContext) audioContext = new Context();
        audioContext.resume().catch(() => {});
        const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain();
        oscillator.frequency.value = frequency; gain.gain.setValueAtTime(0.04, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.12);
        oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + 0.12);
      } catch (_) { /* Visual/text feedback remains available. */ }
    }
    function stopVoice(announce = true) {
      generation++; clearTimeout(timer); active = false;
      if (audio) { audio.pause(); audio = null; }
      if (recognition) { const old = recognition; recognition = null; try { old.abort(); } catch (_) {} }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      mic?.classList.remove('is-recording'); waveform?.classList.remove('is-speaking', 'is-pulsing');
      if (announce) voiceStatus(label('پخش متوقف شد. یک سناریوی آماده انتخاب کنید.', 'Playback stopped. Choose a prerecorded scenario.'));
    }
    function simulate(key) {
      if (!transcript || !reply) return;
      stopVoice(false); active = true; const ticket = generation; const sample = samples[key] || samples.p1;
      transcript.textContent = sample.user; replyBox.classList.remove('is-active'); waveform?.classList.add('is-pulsing');
      voiceStatus(label('در حال آماده‌سازی سناریوی ضبط‌شده؛ میکروفون فعال نیست.', 'Preparing prerecorded audio. The microphone is not active.')); tone();
      timer = setTimeout(() => {
        if (ticket !== generation) return;
        reply.textContent = sample.ai; replyBox.classList.add('is-active'); waveform?.classList.remove('is-pulsing');
        audio = new Audio(new URL('../audio/' + key + '_response.mp3', scriptUrl)); audio.playbackRate = rate;
        audio.onplay = () => { if (ticket === generation) { waveform?.classList.add('is-speaking'); voiceStatus(label('پخش پاسخ از پیش ضبط‌شده؛ شاخص‌ها و نتایج نمایشی‌اند.', 'Playing prerecorded audio; metrics and results are illustrative.')); } };
        audio.onended = () => { if (ticket === generation) { active = false; audio = null; waveform?.classList.remove('is-speaking'); voiceStatus(label('سناریوی آماده پایان یافت.', 'Prerecorded scenario finished.')); } };
        audio.onerror = () => { if (ticket === generation) { active = false; waveform?.classList.remove('is-speaking'); voiceStatus(label('فایل صوتی در دسترس نیست؛ پاسخ متنی نمایش داده شد.', 'Audio unavailable. The text example is still visible.')); } };
        audio.play().catch(() => { if (ticket === generation) { active = false; waveform?.classList.remove('is-speaking'); voiceStatus(label('مرورگر اجازه پخش نداد؛ دوباره سناریو را انتخاب کنید.', 'Your browser blocked audio. Select the scenario again.')); } });
      }, 600);
    }
    mic?.addEventListener('click', () => {
      if (active) { stopVoice(); return; }
      const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Speech) { voiceStatus(label('تشخیص گفتار در این مرورگر پشتیبانی نمی‌شود؛ از سناریوهای آماده استفاده کنید.', 'Speech recognition is unsupported. Use a prerecorded scenario.')); return; }
      stopVoice(false); active = true; const ticket = generation;
      recognition = new Speech(); recognition.lang = 'fa-IR'; recognition.continuous = false; recognition.interimResults = true;
      let heard = '';
      recognition.onstart = () => { if (ticket === generation) { mic.classList.add('is-recording'); waveform?.classList.add('is-pulsing'); voiceStatus(label('میکروفون با اجازه شما فعال است؛ این فقط تشخیص گفتار مرورگر است.', 'Microphone active with your permission. This is browser speech recognition only.')); } };
      recognition.onresult = event => { if (ticket === generation) { heard = [...event.results].map(result => result[0].transcript).join(''); transcript.textContent = heard; } };
      recognition.onerror = event => {
        if (ticket !== generation) return;
        stopVoice(false);
        voiceStatus(event.error === 'not-allowed' ? label('دسترسی میکروفون مجاز نیست؛ یک سناریوی آماده انتخاب کنید.', 'Microphone permission denied. Choose a prerecorded scenario.') : label('تشخیص گفتار انجام نشد؛ سناریوهای آماده همچنان در دسترس‌اند.', 'Speech recognition failed. Prerecorded scenarios remain available.'));
      };
      recognition.onend = () => {
        if (ticket !== generation) return;
        active = false; recognition = null; mic.classList.remove('is-recording'); waveform?.classList.remove('is-pulsing');
        if (heard) {
          reply.textContent = 'متن گفتار شما در مرورگر دریافت شد: «' + heard + '». این دمو به مدل هوش مصنوعی متصل نیست و هیچ عملیاتی در وردپرس اجرا نمی‌کند.';
          replyBox.classList.add('is-active'); voiceStatus(label('گفتار تشخیص داده شد؛ دستور اجرا نشده است.', 'Speech recognized. No WordPress task was executed.'));
        } else voiceStatus(label('گفتاری دریافت نشد. یک سناریوی آماده انتخاب کنید.', 'No speech detected. Choose a prerecorded scenario.'));
      };
      try { recognition.start(); } catch (_) { stopVoice(false); voiceStatus(label('فعال‌سازی میکروفون انجام نشد.', 'The microphone could not be started.')); }
    });
    doc.querySelectorAll('[data-voice-prompt]').forEach(button => button.addEventListener('click', () => {
      doc.querySelectorAll('[data-voice-prompt]').forEach(item => item.classList.toggle('active', item === button)); simulate(button.dataset.voicePrompt);
    }));
    byId('stop-voice-btn')?.addEventListener('click', () => stopVoice());
    doc.querySelectorAll('[data-voice-speed]').forEach(button => button.addEventListener('click', () => {
      rate = Number(button.dataset.voiceSpeed); if (audio) audio.playbackRate = rate;
      doc.querySelectorAll('[data-voice-speed]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
    }));
    window.addEventListener('pagehide', () => { stopVoice(false); audioContext?.close().catch(() => {}); });

    const articles = byId('calc-articles'); const videos = byId('calc-videos'); const support = byId('calc-support');
    function updateCalculator() {
      if (!articles || !videos || !support) return;
      const hours = Math.round(Number(articles.value) * 4.5 + Number(videos.value) * 5.5 + Number(support.value) * 0.25);
      const savedCost = hours * 160000;
      const license = Number(String(cfg.priceToman).replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)).replace(/[,٬\s]/g, ''));
      const days = savedCost > 0 && Number.isFinite(license) && license > 0 ? Math.max(1, Math.ceil(license / (savedCost / 30))) : null;
      const number = value => isEnglish() ? String(value) : faNumber(value);
      [['calc-val-articles', articles.value], ['calc-val-videos', videos.value], ['calc-val-support', support.value], ['res-hours', hours]].forEach(([id, value]) => { if (byId(id)) byId(id).textContent = number(value); });
      byId('res-cost').textContent = savedCost.toLocaleString(isEnglish() ? 'en-US' : 'fa-IR') + label(' تومان', ' Toman');
      byId('res-roi-days').textContent = days === null ? label('قابل محاسبه نیست', 'Not applicable') : number(days) + label(' روز', ' days');
    }
    [articles, videos, support].forEach(input => input?.addEventListener('input', updateCalculator));
    const pipeline = byId('btn-run-live-demo');
    pipeline?.addEventListener('click', () => {
      pipeline.disabled = true; pipeline.textContent = label('⏳ اجرای سناریوی نمایشی…', '⏳ Running a demonstration…'); tone();
      setTimeout(() => { pipeline.textContent = label('✓ نمایش مراحل پایان یافت؛ کاری در سرور اجرا نشد.', '✓ Demo finished; no server task was executed.');
        setTimeout(() => { pipeline.disabled = false; pipeline.textContent = label('▶ اجرای دوباره دمو', '▶ Replay the demo'); }, 1200);
      }, 1000);
    });
    setLanguage(stored('etehadyar-lang', 'fa'), true);
    (window.ETEHADYAR_READY || Promise.resolve()).then(() => {
      cfg = window.ETEHADYAR_CONFIG || cfg;
      updateTitle(); updateCalculator();
      const currentTour = tourButtons.find(button => button.getAttribute('aria-selected') === 'true');
      if (currentTour) activateTour(currentTour.dataset.tour);
    });
  })();
})();
