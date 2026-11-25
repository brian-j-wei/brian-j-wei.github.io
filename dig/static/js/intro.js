/* ════════════════════════════════════════════════════════════
   DIG hero: scroll-driven intro (like the HiT page)

   .intro is a tall section whose .stage sticks to the viewport. How far you
   have scrolled through it (progress 0 → 1) drives the whole sequence:

     0.00  stars drift in the night sky
     0.05  stars stream into the DIG wordmark (the I is a red shovel)
     0.40  the crisp wordmark materializes
     0.50  the wordmark slides beside the title, stars return to the sky
     0.60  title, authors and links fade in
     1.00  the stage unsticks and you dig into the ground

   Scrolling back up reverses it. Stars twinkle on their own clock.
   ?p=0.45 freezes the sequence at that progress (handy for screenshots).
   ════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const intro = document.querySelector('.intro');
  const stage = intro && intro.querySelector('.stage');
  const canvas = stage && stage.querySelector('.stars');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const markDig = stage.querySelector('.mark-dig');
  const slot = stage.querySelector('.logo-slot');
  const ground = stage.querySelector('.ground');
  const cue = stage.querySelector('.dig-cue');
  const cueText = cue.querySelector('.dig-cue-text');
  const hint = stage.querySelector('.dig-hint');
  const revealGroups = [
    ['title', stage.querySelectorAll('.title-main, .title-sub')],
    ['authors', stage.querySelectorAll('.authors, .affil')],
    ['links', stage.querySelectorAll('.links')],
  ];

  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (a, b, v) => { const u = clamp01((v - a) / (b - a)); return u * u * (3 - 2 * u); };
  const ease = u => { u = clamp01(u); return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
  const TAU = Math.PI * 2;

  const params = new URLSearchParams(location.search);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frozen = params.has('p') ? clamp01(parseFloat(params.get('p')) || 0) : null;

  // ── choreography, in fractions of the intro's scroll distance ──
  const S = {
    flow: .05, flowSpread: .17, flowLen: .2,     // stars stream into DIG (all land by ≈ .42)
    digIn: .4, digInLen: .07,                    // crisp wordmark materializes
    slide: .5, slideLen: .2,                     // wordmark moves beside the title
    back: .48, backSpread: .08, backLen: .2,     // stars drift back up into the sky
    title: .6, authors: .65, links: .69, fade: .1,
    cueOut: .06, cueIn: .86,
  };

  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── wordmark geometry, read from the inline SVG defs ────────
  const attrUp = (el, name) => { const h = el.closest(`[${name}]`); return h ? h.getAttribute(name) : null; };
  const toParts = sel => [...document.querySelectorAll(sel)].map(p => ({
    path: new Path2D(p.getAttribute('d')),
    stroke: attrUp(p, 'fill') === 'none' ? parseFloat(attrUp(p, 'stroke-width')) : 0,
    join: attrUp(p, 'stroke-linejoin') || 'miter',
  }));
  const LETTERS = toParts('#dig-letters path');
  const SHOVEL = toParts('#shovel-i path');
  if (!LETTERS.length || !SHOVEL.length) return;
  const VB = { x: -4, y: -4, w: 266, h: 112 };    // wordmark viewBox
  const I = { x: 123, y: 50.8, s: .4 };           // shovel placement: translate(123 50.8) scale(0.4)
  const MID = { x: 129, y: 51.5 };                // visual centre of the wordmark

  function offscreen(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c.getContext('2d', { willReadFrequently: true });
  }
  function drawParts(g, parts) {
    g.fillStyle = '#000';
    g.strokeStyle = '#000';
    for (const part of parts) {
      if (part.stroke) { g.lineWidth = part.stroke; g.lineJoin = part.join; g.stroke(part.path); }
      else g.fill(part.path);
    }
  }
  const inkArea = (g, w, h) => {
    const d = g.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 140) n++;
    return n;
  };
  function samplePixels(g, w, h, sp, rand) {
    const data = g.getImageData(0, 0, w, h).data;
    const out = [];
    for (let y = sp / 2; y < h; y += sp) {
      for (let x = sp / 2; x < w; x += sp) {
        const jx = x + (rand() - .5) * sp * .7, jy = y + (rand() - .5) * sp * .7;
        const ix = jx | 0, iy = jy | 0;
        if (ix >= 0 && iy >= 0 && ix < w && iy < h && data[(iy * w + ix) * 4 + 3] > 140) out.push({ x: jx, y: jy });
      }
    }
    return out;
  }

  // ── star sprites: soft glow, tinted from star colour → logo colour ──
  const TINTS = [[255, 255, 255], [205, 222, 255], [255, 234, 200]];
  const FORMS = [[246, 236, 214], [255, 118, 94]];   // letters (cream), shovel (red)
  const STEPS = 8;
  const sprites = TINTS.map(tc => FORMS.map(fc => Array.from({ length: STEPS + 1 }, (_, k) => {
    const u = k / STEPS, c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const [r, gg, b] = [0, 1, 2].map(i => Math.round(lerp(tc[i], fc[i], u)));
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    grd.addColorStop(.18, `rgba(${r},${gg},${b},.95)`);
    grd.addColorStop(.42, `rgba(${r},${gg},${b},.26)`);
    grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    return c;
  })));

  // ── layout + particles ──────────────────────────────────────
  let W = 0, H = 0, skyH = 0, dpr = 1, narrow = false, P = [], digBig = null;

  function build() {
    W = stage.clientWidth;
    H = stage.clientHeight;
    narrow = W < 760;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    skyH = H - (ground ? ground.offsetHeight * .62 : 80);

    const rand = mulberry32(20261109);
    const cx = W / 2, cy = H * (narrow ? .42 : .44);
    const sD = Math.min(W * (narrow ? .8 : .58), 680) / 264;
    digBig = { left: cx - (MID.x - VB.x) * sD, top: cy - (MID.y - VB.y) * sD, width: VB.w * sD, height: VB.h * sD };

    // sample the wordmark where the stars will land: letters (cream) and shovel (red)
    const w = Math.ceil(VB.w * sD), h = Math.ceil(VB.h * sD);
    const gl = offscreen(w, h), gs = offscreen(w, h);
    gl.setTransform(sD, 0, 0, sD, -VB.x * sD, -VB.y * sD);
    drawParts(gl, LETTERS);
    gs.setTransform(sD * I.s, 0, 0, sD * I.s, (I.x - VB.x) * sD, (I.y - VB.y) * sD);
    drawParts(gs, SHOVEL);
    const sp = Math.max(2.6, Math.sqrt((inkArea(gl, w, h) + inkArea(gs, w, h)) / (narrow ? 760 : 1500)));
    const targets = samplePixels(gl, w, h, sp, rand).map(p => ({ x: digBig.left + p.x, y: digBig.top + p.y, red: 0 }))
      .concat(samplePixels(gs, w, h, sp, rand).map(p => ({ x: digBig.left + p.x, y: digBig.top + p.y, red: 1 })));

    const nBg = narrow ? 200 : 360;
    const N = targets.length + nBg;
    const homes = Array.from({ length: N }, () => ({ hx: rand(), hy: Math.pow(rand(), 1.15) }));
    const makeParticle = (home, extra) => {
      const bright = rand() < .05;
      return Object.assign({
        hx: home.hx, hy: home.hy,
        ax: 4 + rand() * 11, ay: 3 + rand() * 8, fx: .04 + rand() * .14, fy: .03 + rand() * .12, ph: rand() * TAU,
        tw: .6 + rand() * 2.4, tp: rand() * TAU,
        a0: bright ? .7 + rand() * .3 : .1 + rand() * .42,
        r0: bright ? 1 + rand() * .75 : .36 + rand() * .62,
        tint: rand() < .18 ? 1 : rand() < .22 ? 2 : 0,
        a: S.flow + rand() * S.flowSpread, c: S.back + rand() * S.backSpread,
        curl: (.12 + rand() * .26) * (rand() < .85 ? 1 : -1),
        red: 0, tx: null, ty: null,
      }, extra);
    };

    // stars → wordmark: matched by angle sector then radius, so each part fills from its side of the sky
    const polar = (o, x, y) => ({ o, ang: Math.atan2(y - cy, x - cx), rad: Math.hypot(x - cx, y - cy) });
    const tp = targets.map(t => polar(t, t.x, t.y)).sort((a, b) => a.ang - b.ang);
    const hp = homes.slice(0, targets.length).map(q => polar(q, q.hx * W, q.hy * skyH)).sort((a, b) => a.ang - b.ang);
    P = [];
    const K = 28;
    for (let k = 0; k < K; k++) {
      const i0 = Math.floor(k * tp.length / K), i1 = Math.floor((k + 1) * tp.length / K);
      const ts = tp.slice(i0, i1).sort((a, b) => a.rad - b.rad);
      const hs = hp.slice(i0, i1).sort((a, b) => a.rad - b.rad);
      ts.forEach((t, j) => P.push(makeParticle(hs[j].o, { tx: t.o.x, ty: t.o.y, red: t.o.red })));
    }
    for (let i = targets.length; i < N; i++) P.push(makeParticle(homes[i], {}));
  }

  function place(el, b) {
    el.style.left = `${b.left}px`;
    el.style.top = `${b.top}px`;
    el.style.width = `${b.width}px`;
    el.style.height = `${b.height}px`;
  }
  const starPos = (q, t) => [
    q.hx * W + q.ax * Math.sin(q.fx * t * TAU + q.ph),
    q.hy * skyH + q.ay * Math.sin(q.fy * t * TAU + q.ph * 1.7),
  ];
  // quadratic arc with a sideways bulge, so streams swirl instead of travelling in straight lines
  function arc(x0, y0, x1, y1, u, curl) {
    const mx = (x0 + x1) / 2 - (y1 - y0) * curl, my = (y0 + y1) / 2 + (x1 - x0) * curl, v = 1 - u;
    return [v * v * x0 + 2 * v * u * mx + u * u * x1, v * v * y0 + 2 * v * u * my + u * u * y1];
  }

  // ── draw one moment: p = scroll progress, t = time (twinkle) ──
  function render(p, t) {
    const digOn = smooth(S.digIn, S.digIn + S.digInLen, p);
    const formR = narrow ? 1.2 : 1.55;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      const [sx, sy] = starPos(q, t);
      let x = sx, y = sy, form = 0, rel = 0;
      if (q.tx !== null) {
        rel = ease((p - q.c) / S.backLen);
        const u = ease((p - q.a) / S.flowLen);
        if (rel > 0) { [x, y] = arc(q.tx, q.ty, sx, sy, rel, -q.curl * .6); form = 1 - rel; }
        else if (u > 0) { [x, y] = arc(sx, sy, q.tx, q.ty, u, q.curl); form = u; }
      }
      const twinkle = .62 + .38 * Math.sin(t * q.tw + q.tp);
      const starA = q.a0 * twinkle;
      const formA = (.84 + .16 * twinkle) * (1 - .93 * digOn);
      let alpha = lerp(starA, formA, form);
      if (rel > 0 && rel < 1) alpha += .18 * Math.sin(Math.PI * rel);
      if (alpha <= .01) continue;
      const r = lerp(q.r0, formR, form), d = r * 11;
      ctx.globalAlpha = alpha > 1 ? 1 : alpha;
      ctx.drawImage(sprites[q.tint][q.red][Math.round(form * STEPS)], x - d / 2, y - d / 2, d, d);
    }
    ctx.globalAlpha = 1;

    if (reduceMotion) return;   // static page: CSS shows the final layout

    // crisp wordmark: big in the sky, then into the slot beside the title
    markDig.style.opacity = digOn.toFixed(3);
    const u = ease((p - S.slide) / S.slideLen);
    if (u <= 0) place(markDig, digBig);
    else {
      const st = stage.getBoundingClientRect(), sr = slot.getBoundingClientRect();
      place(markDig, {
        left: lerp(digBig.left, sr.left - st.left, u), top: lerp(digBig.top, sr.top - st.top, u),
        width: lerp(digBig.width, sr.width, u), height: lerp(digBig.height, sr.height, u),
      });
    }
    for (const [key, els] of revealGroups) {
      const o = smooth(S[key], S[key] + S.fade, p);
      els.forEach(el => {
        el.style.opacity = o.toFixed(3);
        el.style.setProperty('--rise', `${((1 - o) * 16).toFixed(1)}px`);
      });
    }
    stage.style.setProperty('--halo', smooth(S.slide, S.title + S.fade, p).toFixed(3));
    // opening screen: big prompt in the middle + shovel over the X; at the end: the small cue returns
    const hintOut = smooth(.004, S.cueOut, p);
    hint.style.opacity = (1 - hintOut).toFixed(3);
    hint.style.setProperty('--sink', `${(hintOut * 36).toFixed(1)}px`);
    hint.style.visibility = hintOut >= 1 ? 'hidden' : '';
    const cueBack = smooth(S.cueIn, S.cueIn + .06, p);
    cue.style.opacity = Math.max(1 - smooth(.01, S.cueOut, p), cueBack).toFixed(3);
    cueText.style.opacity = cueBack.toFixed(3);
  }

  // ── scroll → progress (smoothed), time → twinkle ───────────
  const distance = () => Math.max(1, intro.offsetHeight - stage.offsetHeight);
  const scrollProgress = () => clamp01(-intro.getBoundingClientRect().top / distance());
  let prog = 0, last = 0, raf = 0, visible = true;

  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(.1, (now - last) / 1000) : 0;
    last = now;
    const target = frozen === null ? scrollProgress() : frozen;
    prog += (target - prog) * (1 - Math.exp(-dt * 10));     // ease toward the scroll position
    if (Math.abs(target - prog) < 2e-4) prog = target;
    render(prog, now / 1000);
    if (visible) raf = requestAnimationFrame(frame);
  }
  const start = () => { if (!raf && !reduceMotion) { last = 0; raf = requestAnimationFrame(frame); } };

  // the prompts fast-scroll to the title (the animation plays on the way); afterwards they dig on
  const toTitle = e => {
    if (reduceMotion || scrollProgress() >= .8) return;
    e.preventDefault();
    scrollTo({ top: intro.offsetTop + distance() * .86, behavior: 'smooth' });
  };
  cue.addEventListener('click', toTitle);
  if (hint) hint.addEventListener('click', toTitle);

  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { build(); render(prog, performance.now() / 1000); }, 150);
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) start(); }).observe(intro);
  }
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) start(); });

  build();
  prog = frozen === null ? scrollProgress() : frozen;      // no catch-up animation on reload mid-page
  render(prog, reduceMotion ? 0 : performance.now() / 1000);
  start();
})();
