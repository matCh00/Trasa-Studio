/* Trasa Studio Aurora layer: theme, ambient particles, route diagnostics and shortcuts. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  const canvas = $('ambientCanvas');
  const ctx = canvas?.getContext?.('2d');
  let particles = [];
  let rafId = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let pointer = { x: -1000, y: -1000 };

  function toast(message, error = false) {
    const node = $('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error-toast', error);
    node.classList.add('visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('visible'), 3000);
  }

  function setTheme(theme) {
    const light = theme === 'light';
    body.dataset.theme = light ? 'light' : 'dark';
    try { localStorage.setItem('trasaStudio.theme', light ? 'light' : 'dark'); } catch (_) { /* Private mode may block storage. */ }
    const button = $('themeToggle');
    if (button) {
      button.textContent = light ? '☾' : '☼';
      button.setAttribute('aria-label', light ? 'Przełącz na ciemny motyw' : 'Przełącz na jasny motyw');
      button.title = light ? 'Włącz ciemny motyw' : 'Włącz jasny motyw';
    }
  }

  let theme = 'dark';
  try { theme = localStorage.getItem('trasaStudio.theme') || 'dark'; } catch (_) { /* Use default theme. */ }
  setTheme(theme);
  $('themeToggle')?.addEventListener('click', () => setTheme(body.dataset.theme === 'light' ? 'dark' : 'light'));

  function resizeCanvas() {
    if (!canvas || !ctx) return;
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(62, Math.max(20, Math.round(width / 24)));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      radius: Math.random() * 1.4 + 0.4,
      phase: Math.random() * Math.PI * 2
    }));
  }

  function animateParticles() {
    rafId = 0;
    if (!ctx || document.hidden || reducedMotion) return;
    ctx.clearRect(0, 0, width, height);
    const light = body.dataset.theme === 'light';
    const dotColor = light ? '70,94,161' : '143,173,238';
    const lineColor = light ? '100,123,182' : '100,144,220';
    const time = performance.now() / 1600;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const dx = pointer.x - p.x;
      const dy = pointer.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 150 && dist > 0) { p.vx -= dx / dist * 0.0016; p.vy -= dy / dist * 0.0016; }
      p.vx *= 0.996;
      p.vy *= 0.996;
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -5) p.x = width + 5;
      if (p.x > width + 5) p.x = -5;
      if (p.y < -5) p.y = height + 5;
      if (p.y > height + 5) p.y = -5;
      const alpha = 0.16 + (Math.sin(time + p.phase) + 1) * 0.1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${dotColor},${alpha})`;
      ctx.fill();
      for (let j = i + 1; j < particles.length; j += 1) {
        const q = particles[j];
        const distance = Math.hypot(p.x - q.x, p.y - q.y);
        if (distance < 95) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `rgba(${lineColor},${(1 - distance / 95) * (light ? 0.1 : 0.17)})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }
    rafId = window.requestAnimationFrame(animateParticles);
  }

  function startAnimation() {
    if (ctx && !reducedMotion && !document.hidden && !rafId) rafId = window.requestAnimationFrame(animateParticles);
  }
  resizeCanvas();
  startAnimation();
  window.addEventListener('resize', () => { resizeCanvas(); startAnimation(); }, { passive: true });
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') { pointer.x = -1000; pointer.y = -1000; }
    else { pointer.x = event.clientX; pointer.y = event.clientY; }
  }, { passive: true });
  window.addEventListener('pointerleave', () => { pointer.x = -1000; pointer.y = -1000; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
    else startAnimation();
  });

  function stops() {
    return [...document.querySelectorAll('#stopsList .stop-input')].map((input) => input.value.trim());
  }

  function updateTelemetry() {
    const routeStops = stops();
    const link = $('generatedLink')?.value.trim() || '';
    const filled = routeStops.filter(Boolean);
    const normalized = new Map();
    let duplicates = 0;
    routeStops.forEach((stop, index) => {
      if (!stop) return;
      const normalizedName = stop.toLocaleLowerCase('pl-PL').replace(/\s+/g, ' ');
      if (normalized.has(normalizedName)) duplicates += 1;
      else normalized.set(normalizedName, index);
    });
    const issues = [];
    if (routeStops.length < 2) issues.push('Dodaj minimum dwa punkty');
    if (filled.length !== routeStops.length) issues.push(`${routeStops.length - filled.length} pustych pól`);
    if (duplicates) issues.push(`${duplicates} powtórzonych nazw`);
    if (link.length > 2048) issues.push('link przekracza 2048 znaków');
    if ($('telemetryStops')) $('telemetryStops').textContent = String(routeStops.length);
    if ($('telemetryStopsNote')) $('telemetryStopsNote').textContent = 'Punktów w trasie';
    if ($('telemetryChars')) $('telemetryChars').textContent = link ? link.length.toLocaleString('pl-PL') : '—';
    if ($('telemetryCharsNote')) $('telemetryCharsNote').textContent = !link ? 'Link pojawi się po uzupełnieniu punktów' : link.length > 2048 ? 'Długi link — sprawdź zgodność' : `Zapas do 2048 znaków: ${2048 - link.length}`;
    const lengthBar = $('telemetryLengthBar');
    if (lengthBar) {
      lengthBar.style.width = `${Math.min(100, link.length / 2048 * 100)}%`;
      lengthBar.style.background = link.length > 2048 ? 'linear-gradient(90deg,#ff9a82,#ff6f91)' : 'linear-gradient(90deg,#958aff,#72e2eb)';
    }
    if ($('telemetryHealth')) {
      $('telemetryHealth').textContent = issues.length ? 'Do sprawdzenia' : 'W porządku';
      $('telemetryHealth').style.color = issues.length ? '#ffc58d' : 'var(--aurora-mint)';
    }
    if ($('telemetryHealthNote')) $('telemetryHealthNote').textContent = issues[0] || 'Nie wykryto oczywistych problemów';
  }

  const stopList = $('stopsList');
  if (stopList) {
    stopList.addEventListener('input', updateTelemetry);
    stopList.addEventListener('change', updateTelemetry);
    new MutationObserver(() => updateTelemetry()).observe(stopList, { childList: true, subtree: true });
  }
  $('routeName')?.addEventListener('input', updateTelemetry);
  $('travelMode')?.addEventListener('change', updateTelemetry);
  $('generatedLink')?.addEventListener('input', updateTelemetry);
  // Link value is set programmatically by app.js, so read it cheaply once per second.
  const telemetryInterval = window.setInterval(updateTelemetry, 1000);
  window.addEventListener('pagehide', () => clearInterval(telemetryInterval), { once: true });

  $('focusMapBtn')?.addEventListener('click', () => {
    const target = document.querySelector('.map-panel');
    if (!target) return;
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    if (target.animate && !reducedMotion) target.animate([
      { boxShadow: '0 0 0 0 rgba(113,228,242,0)' },
      { boxShadow: '0 0 0 3px rgba(113,228,242,.22)' },
      { boxShadow: '0 0 0 0 rgba(113,228,242,0)' }
    ], { duration: 900, easing: 'ease-out' });
  });
  $('telemetryCopyBtn')?.addEventListener('click', () => {
    const button = $('copyLinkBtn') || $('copyGeneratedBtn');
    if (button && !button.disabled) button.click();
    else toast('Najpierw uzupełnij wszystkie punkty trasy.', true);
  });

  document.addEventListener('keydown', (event) => {
    const active = document.activeElement;
    const typing = active && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      $('saveRouteBtn')?.click();
    } else if (modifier && event.key === 'Enter') {
      event.preventDefault();
      $('openMapsBtn')?.click();
    } else if (event.key === '/' && !typing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const input = $('mapSearchQuery');
      if (input) {
        event.preventDefault();
        const details = input.closest('details');
        if (details) details.open = true;
        input.focus();
      }
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && active?.classList?.contains('stop-input')) {
      event.preventDefault();
      const row = active.closest('.stop-row');
      const action = row?.querySelector(event.key === 'ArrowUp' ? '[data-action="move-up"]' : '[data-action="move-down"]');
      if (action && !action.disabled) action.click();
    }
  });

  if ('IntersectionObserver' in window && !reducedMotion) {
    const revealTargets = document.querySelectorAll('.library-panel,.map-panel,.shortlink-panel,.search-panel,.bottom-notes');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.06 });
    revealTargets.forEach((target) => target.classList.add('reveal-on-scroll'));
    revealTargets.forEach((target) => observer.observe(target));
  }

  updateTelemetry();
})();
