/* ════════════════════════════════════════════════════════════
   DIG project page: layer scale, scroll reveals, teaser video,
   sampling widget, results tabs, BibTeX, treasure chest.
   (The hero's scroll-driven intro lives in intro.js.)
   ════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (a, b, v) => { const u = clamp01((v - a) / (b - a)); return u * u * (3 - 2 * u); };
  const ease = u => (u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const onView = (els, cb, opts = {}) => {
    if (!('IntersectionObserver' in window)) { els.forEach(el => cb(el)); return; }
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { cb(e.target); if (opts.once !== false) io.unobserve(e.target); }
    }), opts);
    els.forEach(el => io.observe(el));
  };

  // ── layer scale: a tick per layer; the red X marks how far you've dug ──
  const gauge = document.querySelector('.gauge');
  const layers = [...document.querySelectorAll('[data-layer]')];
  const intro = document.querySelector('.intro');
  const ribbon = document.querySelector('.ribbon');
  const keyLinks = ribbon ? [...ribbon.querySelectorAll('.ribbon-key a')] : [];
  if (gauge && layers.length) {
    const ticks = gauge.querySelector('.gauge-ticks');
    const track = gauge.querySelector('.gauge-track');
    const name = gauge.querySelector('.gauge-layer');
    const links = layers.map(sec => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#${sec.dataset.anchor || sec.id}`;
      a.textContent = sec.dataset.layer;
      a.title = `${sec.dataset.layer} · ${sec.dataset.topic}`;
      li.append(a);
      ticks.append(li);
      return { sec, li, a };
    });
    let maxScroll = 1, tops = [];
    const measure = () => {
      maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      tops = links.map(({ sec }) => sec.getBoundingClientRect().top + scrollY);
      links.forEach(({ li }, k) => li.style.setProperty('--y', `${clamp01((tops[k] - innerHeight / 2) / maxScroll) * 100}%`));
    };
    let ticking = false;
    const update = () => {
      ticking = false;
      const mid = scrollY + innerHeight / 2;
      let k = 0;
      while (k < tops.length - 1 && tops[k + 1] <= mid) k++;
      name.textContent = links[k].sec.dataset.layer;
      links.forEach(({ a }, j) => a.classList.toggle('is-active', j === k));
      track.style.setProperty('--p', clamp01(scrollY / maxScroll).toFixed(4));
      // both appear once the title has formed (near the end of the intro's scroll)
      const introScroll = intro ? intro.offsetHeight - innerHeight : 0;
      const titled = scrollY > introScroll * .84 - 1;
      gauge.classList.toggle('is-on', titled);
      if (ribbon) {
        ribbon.classList.toggle('is-on', titled);
        const here = `#${links[k].sec.id}`;
        keyLinks.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === here));
      }
    };
    const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    addEventListener('scroll', request, { passive: true });
    addEventListener('resize', () => { measure(); request(); });
    addEventListener('load', () => { measure(); request(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); request(); });
    measure();
    update();
  }

  // ── reveal on scroll ────────────────────────────────────────
  onView([...document.querySelectorAll('[data-reveal]')], el => el.classList.add('is-in'),
    { rootMargin: '0px 0px -8% 0px' });

  // ── teaser video: play only while visible ───────────────────
  const video = document.querySelector('.teaser-video');
  if (video) {
    if (reduceMotion) video.controls = true;
    else if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting) video.play().catch(() => { video.controls = true; });
        else video.pause();
      }, { threshold: .3 }).observe(video);
    }
  }

  // ── sampling widget ─────────────────────────────────────────
  const sampler = document.querySelector('[data-sampler]');
  if (sampler) {
    const range = sampler.querySelector('.sampler-range');
    const out = sampler.querySelector('.sampler-t');
    const play = sampler.querySelector('.sampler-play');
    const tabs = [...sampler.querySelectorAll('.sampler-tab')];
    let tNow = 1, anim = 0;

    const setT = t => {
      tNow = t;
      range.value = t;
      out.textContent = `t = ${t.toFixed(2)}`;
      const frames = [...sampler.querySelectorAll(`.globe-frames[data-q="${sampler.dataset.active}"] img`)];
      const ts = frames.map(f => parseFloat(f.dataset.t));
      let i = 0;
      while (i < ts.length - 2 && t > ts[i + 1]) i++;
      const w = clamp01((t - ts[i]) / (ts[i + 1] - ts[i]));
      frames.forEach((f, k) => { f.style.opacity = k === i ? 1 : k === i + 1 ? w : 0; });
      sampler.style.setProperty('--reveal', smooth(.7, 1, t).toFixed(3));
    };
    const stop = () => { cancelAnimationFrame(anim); anim = 0; sampler.classList.remove('is-playing'); };
    const run = () => {
      stop();
      const t0 = performance.now(), from = tNow >= .999 ? 0 : tNow, dur = 2600 * (1 - from);
      sampler.classList.add('is-playing');
      const step = now => {
        const u = clamp01((now - t0) / dur);
        setT(from + (1 - from) * ease(u));
        anim = u < 1 ? requestAnimationFrame(step) : (sampler.classList.remove('is-playing'), 0);
      };
      anim = requestAnimationFrame(step);
    };
    const select = q => {
      sampler.dataset.active = q;
      tabs.forEach(b => b.setAttribute('aria-selected', String(b.dataset.query === q)));
      if (reduceMotion) setT(1); else { setT(0); run(); }
    };

    range.addEventListener('input', () => { stop(); setT(parseFloat(range.value)); });
    play.addEventListener('click', () => (anim ? stop() : run()));
    tabs.forEach((b, k) => {
      b.addEventListener('click', () => select(b.dataset.query));
      b.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        select(next.dataset.query);
      });
    });

    if (reduceMotion) setT(1);
    else {
      setT(0);
      onView([sampler], run, { threshold: .45 });
    }
  }

  // ── results tabs ────────────────────────────────────────────
  document.querySelectorAll('[data-tabs]').forEach(root => {
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const show = tab => tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    tabs.forEach((t, k) => {
      t.addEventListener('click', () => show(t));
      t.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        show(next);
      });
    });
  });

  // ── results: DIG-XL rows show one guided sample, or the medoid of 16 ──
  document.querySelectorAll('[data-medoid-switch]').forEach(sw => {
    const cells = [...sw.closest('table').querySelectorAll('td[data-medoid]')];
    cells.forEach(td => { td.dataset.single = td.textContent; td.dataset.singleMark = td.className; });
    sw.addEventListener('click', () => {
      const on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(on));
      cells.forEach(td => {
        td.textContent = on ? td.dataset.medoid : td.dataset.single;
        td.className = on ? (td.dataset.medoidMark || '') : td.dataset.singleMark;
        void td.offsetWidth;
        td.classList.add('is-flip');                     // a brief fade marks what changed
      });
    });
  });

  // ── BibTeX copy ─────────────────────────────────────────────
  const copyBtn = document.querySelector('.bibtex-copy');
  const bib = document.getElementById('bibtexContent');
  if (copyBtn && bib) {
    const done = () => {
      copyBtn.classList.add('is-copied');
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.classList.remove('is-copied'); copyBtn.textContent = 'Copy'; }, 1800);
    };
    const fallback = text => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px';
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      ta.remove();
    };
    copyBtn.addEventListener('click', () => {
      const text = bib.textContent.trim();
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallback(text));
      else fallback(text);
    });
  }

  // ── treasure chest opens when you reach it ──────────────────
  const chest = document.querySelector('[data-chest]');
  if (chest) onView([chest], el => el.classList.add('is-open'), { threshold: .5 });
})();
