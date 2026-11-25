/* ════════════════════════════════════════════════════════════
   DIG project page: "Can you beat DIG?"
   One photo at a time: drop your X on the map, lock it in, and see how DIG-XL did.
   Data: static/game/game500.json, 500 random OSV-5M test photos with DIG-XL's
   precomputed guesses (no model runs in the browser). Leaflet (vendored) and the
   data load only when the game comes near the viewport. Map tiles: OpenStreetMap.
   Add ?photo=<id> to the URL to start with a given photo.
   ════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const root = document.querySelector('[data-game]');
  if (!root) return;

  const DATA_URL = 'static/game/game500.json';
  const DATA_DIR = 'static/game/';                  // photos[].image is relative to the JSON
  const LEAFLET_JS = 'static/vendor/leaflet/leaflet.js';
  // OpenStreetMap's own tiles: free with attribution for light use like this page
  // (https://operations.osmfoundation.org/policies/tiles/)
  const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILES_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  // Photos kept out of the game. Their images are not in static/game/images (all 500 are in osv5m_game500.zip).
  const SKIP = new Set([
    // upside down (the camera was mounted upside down)
    '3792854217499528', '453846815913710', '310416490450226', '2892291787702564', '1383870418637389',
    '1479280662432643', '1113056435839223', '485008839586332', '488345702411175', '771030250264544',
    '2884975541772645', '304017118039735', '947025206152110', '4536224149766122', '301273671606261',
    '376134763692962', '788437428714204', '490813262118162', '1149315252201283', '463683944700618',
    '2927042400914087', '874534329792933', '256693046201857', '983497572461916',
    // a text overlay gives the answer away (GPS coordinates, a URL, an email address)
    '482427302826862', '781523725899393', '1099445290465874', '920563268798352',
    // ...including dashcams that print the GPS position along the bottom edge
    '296732288849108', '1641529759369852', '488066709135043', '2992290794366881', '3883292391708572',
    '1092742927903333', '485195336025598', '1124488678050433', '1149353408811230', '163026775752460',
    '316226500077491', '3889559807748254', '182066137149972',
    // not a street view (indoors; open ocean from a plane)
    '921380541767048', '1102876220235183',
  ]);

  // The opponent: DIG-XL's single guided sample (photos[].model_guided), the paper's protocol.
  const OPP = {
    field: 'model_guided', name: 'DIG-XL',
    dots: 'The faint dots are 100 more samples from DIG: a picture of how sure it was.',
  };
  const LAYOUT_KEY = 'dig-game-bigmap';            // remembers "Bigger map" for this browser

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;   // phones and tablets

  // ── scoring: the OSV-5M GeoScore, exactly as the model was scored ──
  const R = 6371;  // km
  function km(lat1, lon1, lat2, lon2) {          // great-circle distance (haversine)
    const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  const geoscore = d => Math.round(5000 * Math.exp(-d / 1492.7));  // 0..5000 points

  // Points along the great circle from a to b ([lat, lon]). Longitudes are unwrapped, so a line
  // across the ±180° meridian carries on into the next copy of the world instead of doubling back.
  function arc(a, b, n = 80) {
    const r = Math.PI / 180;
    const vec = ([la, lo]) => [Math.cos(la * r) * Math.cos(lo * r), Math.cos(la * r) * Math.sin(lo * r), Math.sin(la * r)];
    const A = vec(a), B = vec(b);
    const om = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
    const s = Math.sin(om);
    const pts = [];
    let prev = a[1];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const w1 = s < 1e-9 ? 1 - t : Math.sin((1 - t) * om) / s;
      const w2 = s < 1e-9 ? t : Math.sin(t * om) / s;
      const x = A[0] * w1 + B[0] * w2, y = A[1] * w1 + B[1] * w2, z = A[2] * w1 + B[2] * w2;
      let lon = Math.atan2(y, x) / r;
      lon += Math.round((prev - lon) / 360) * 360;
      prev = lon;
      pts.push([Math.atan2(z, Math.hypot(x, y)) / r, lon]);
    }
    return pts;
  }

  // ── formatting ──
  const nf = new Intl.NumberFormat('en-US');
  const fmtKm = d => `${d < 10 ? d.toFixed(1) : nf.format(Math.round(d))} km`;
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { /* older browsers show the code */ }
  const countryName = cc => {
    try { return (cc && regionNames && regionNames.of(cc)) || cc || ''; } catch (e) { return cc || ''; }
  };
  const placeName = t => {
    const parts = [t.city, t.region, countryName(t.country)].filter(Boolean);
    return parts.filter((p, i) => parts.indexOf(p) === i).join(', ');
  };
  const shuffle = a => {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  // ── elements ──
  const $ = sel => root.querySelector(sel);
  const board = $('.game-board'), fig = $('.game-photo'), img = $('.game-img'), photoBg = $('.game-photo-bg');
  const mapWrap = $('.game-mapwrap'), mapEl = $('.game-map'), hint = $('.game-hint'), wheelHint = $('.game-wheel');
  const loading = $('[data-loading]'), promptEl = $('[data-prompt]'), result = $('.game-result');
  const guessBtn = $('.game-guess'), skipBtn = $('.game-skip'), nextBtn = $('.game-next');
  const shrinkBtn = $('.game-shrink');
  const out = {
    verdict: $('[data-verdict]'), place: $('[data-place]'), dots: $('[data-dots]'),
    youPts: $('[data-you-pts]'), youKm: $('[data-you-km]'), youBar: $('[data-you-bar]'),
    digPts: $('[data-dig-pts]'), digKm: $('[data-dig-km]'), digBar: $('[data-dig-bar]'),
  };
  const box = $('.game-lightbox'), boxImg = box && box.querySelector('img');

  const PROMPT_START = coarse ? 'Tap the map to drop your X.' : 'Drop your X on the map.';
  const PROMPT_PLACED = 'Move it as often as you like, then lock in your guess.';
  hint.textContent = coarse ? 'Tap to drop your X · two fingers move the map' : 'Click the map to drop your X';

  // ── state ──
  let photos = [], order = [], pos = -1, cur = null;
  let map = null, layer = null, icons = null, dot = null, youMarker = null;
  let guess = null, you = null, revealed = false;

  // ── bigger map: the photo shrinks into the map's corner, the map takes the whole board ──
  let bigMap = false;
  try { bigMap = localStorage.getItem(LAYOUT_KEY) === '1'; } catch (e) { /* storage blocked */ }
  const renderLayout = () => {
    board.classList.toggle('is-bigmap', bigMap);
    shrinkBtn.setAttribute('aria-pressed', String(bigMap));
    shrinkBtn.title = bigMap ? 'Bring the photo back' : 'Shrink the photo for a bigger map';
  };
  shrinkBtn.addEventListener('click', () => {
    bigMap = !bigMap;
    try { localStorage.setItem(LAYOUT_KEY, bigMap ? '1' : '0'); } catch (e) { /* ignore */ }
    const swap = () => { renderLayout(); if (map) map.invalidateSize(); };
    if (!document.startViewTransition || reduceMotion) { swap(); return; }
    // morph the photo and the map between the two layouts (named only for the morph)
    fig.style.viewTransitionName = 'game-photo';
    mapWrap.style.viewTransitionName = 'game-map';
    document.startViewTransition(swap).finished.finally(() => {
      fig.style.viewTransitionName = mapWrap.style.viewTransitionName = '';
    });
  });
  renderLayout();

  // ── map ──
  const PIN = 'M16 41C16 41 3 26.5 3 15.5a13 13 0 0 1 26 0C29 26.5 16 41 16 41Z';
  const LINE = { weight: 2.6, opacity: .95, dashArray: '7 7', lineCap: 'round', interactive: false };
  const TIP = { direction: 'top', className: 'gm-tip' };

  function buildMap() {
    icons = {
      you: L.divIcon({
        className: 'gm gm-you', iconSize: [34, 34], iconAnchor: [17, 17], tooltipAnchor: [0, -14],
        html: '<svg viewBox="0 0 34 34"><path class="gm-x-case" d="M9 9l16 16M25 9 9 25"/><path class="gm-x" d="M9 9l16 16M25 9 9 25"/></svg>',
      }),
      dig: L.divIcon({
        className: 'gm gm-dig gm-pop', iconSize: [28, 28], iconAnchor: [14, 14], tooltipAnchor: [0, -14],
        html: '<svg viewBox="0 0 28 28"><circle class="gm-badge" cx="14" cy="14" r="12.5"/>'
          + '<g class="gm-shovel" transform="translate(14 14) rotate(35) scale(.068)"><use href="#shovel-i"/></g></svg>',
      }),
      truth: L.divIcon({
        className: 'gm gm-truth gm-pop', iconSize: [32, 42], iconAnchor: [16, 41], tooltipAnchor: [0, -38],
        html: `<svg viewBox="0 0 32 42"><path class="gm-pin" d="${PIN}"/><g class="gm-cam" transform="translate(16 15.6)">`
          + '<rect x="-7.5" y="-4.6" width="15" height="10.4" rx="2"/><rect x="-3" y="-7.2" width="6" height="3.6" rx="1"/>'
          + '<circle class="gm-lens" cy=".6" r="3"/></g></svg>',
      }),
    };

    map = L.map(mapEl, {
      worldCopyJump: true,
      minZoom: 0,
      maxZoom: 18,
      zoomSnap: 1,                   // whole zoom levels keep the raster tiles sharp and seamless
      wheelPxPerZoomLevel: 120,
      scrollWheelZoom: false,        // turned on once you use the map (wheelGate)
      dragging: !coarse,             // touch: one finger scrolls the page, two move the map
      zoomAnimation: !reduceMotion,
      fadeAnimation: !reduceMotion,
      markerZoomAnimation: !reduceMotion,
      inertia: !reduceMotion,
      maxBounds: [[-86, -1e4], [86, 1e4]],
      maxBoundsViscosity: 1,
    });
    L.tileLayer(TILES, { maxZoom: 19, attribution: TILES_CREDIT }).addTo(map);
    layer = L.layerGroup().addTo(map);
    dot = { renderer: L.canvas({ padding: .5 }), radius: 3, stroke: false, fillColor: '#3b2716', fillOpacity: .35, interactive: false };

    map.on('click', e => { if (cur && !revealed) place(e.latlng); });
    map.on('resize', () => { const s = map.getSize(); if (s.x && s.y) map.setMinZoom(fillZoom()); });
    // Leaflet only watches the window; this also catches the board changing layout
    if ('ResizeObserver' in window) new ResizeObserver(() => map.invalidateSize()).observe(mapWrap);
    mapEl.addEventListener('keydown', e => {      // keyboard: aim with the arrows, Enter drops the X
      if (e.target !== mapEl || !cur || revealed) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); place(map.getCenter()); }
    });
    if (!coarse) wheelGate();
  }

  // The map takes the scroll wheel only after you click or drag it, and lets go as soon as the page
  // scrolls or you click elsewhere, so scrolling past the game never gets stuck zooming the map.
  function wheelGate() {
    let on = false, tip = 0;
    const engage = () => {
      if (on) return;
      on = true;
      map.scrollWheelZoom.enable();
      mapWrap.classList.add('is-engaged');
      wheelHint.classList.remove('is-on');
    };
    const release = () => {
      if (!on) return;
      on = false;
      map.scrollWheelZoom.disable();
      mapWrap.classList.remove('is-engaged');
    };
    mapEl.addEventListener('mousedown', engage);
    mapEl.addEventListener('wheel', e => {
      if (on) return;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); engage(); return; }   // trackpad pinch, ctrl + wheel
      wheelHint.classList.add('is-on');
      clearTimeout(tip);
      tip = setTimeout(() => wheelHint.classList.remove('is-on'), 1200);
    }, { passive: false });
    addEventListener('scroll', release, { passive: true });
    document.addEventListener('mousedown', e => { if (!mapWrap.contains(e.target)) release(); });
  }

  // the smallest zoom at which the world fills the map's height (east-west it wraps, so you can pan around)
  const fillZoom = () => {
    const s = map.getSize();
    return Math.max(Math.round(Math.log2(s.x / 256)), Math.ceil(Math.log2(s.y / 256)), 0);
  };
  function worldView() {
    const s = map.getSize();
    if (!s.x || !s.y) return;
    map.setMinZoom(fillZoom());
    map.setView([24, 12], fillZoom(), { animate: false });
  }

  function place(latlng) {
    guess = latlng;
    if (youMarker) youMarker.setLatLng(latlng);
    else {
      youMarker = L.marker(latlng, { icon: icons.you, draggable: true, keyboard: false, autoPan: true, zIndexOffset: 1000 })
        .on('dragend', () => { guess = youMarker.getLatLng(); })
        .addTo(map);
    }
    const el = youMarker.getElement();
    if (el && !reduceMotion) { el.classList.remove('is-dropped'); void el.offsetWidth; el.classList.add('is-dropped'); }
    guessBtn.disabled = false;
    promptEl.textContent = PROMPT_PLACED;
    hint.classList.add('is-off');
  }

  // ── a round ──
  function next() {
    if (!photos.length) return;
    pos++;
    if (pos >= order.length) {                       // seen them all: reshuffle, without an immediate repeat
      const last = order[order.length - 1];
      shuffle(order);
      if (order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1], order[0]];
      pos = 0;
    }
    cur = photos[order[pos]];
    revealed = false;
    guess = null;
    you = null;
    root.classList.remove('is-revealed');
    map.stop();
    layer.clearLayers();
    if (youMarker) { youMarker.remove(); youMarker = null; }
    promptEl.textContent = PROMPT_START;
    promptEl.hidden = false;
    result.hidden = true;
    guessBtn.disabled = true;
    guessBtn.hidden = false;
    skipBtn.hidden = false;
    nextBtn.hidden = true;
    hint.classList.remove('is-off');
    worldView();
    showPhoto(cur);
    const after = photos[order[(pos + 1) % order.length]];   // warm the cache for the next round
    if (after) new Image().src = DATA_DIR + after.image;
  }

  function showPhoto(p) {
    const src = DATA_DIR + p.image;
    fig.classList.add('is-loading');
    img.alt = 'Street-level photo for this round. Where was it taken?';
    img.width = p.width;
    img.height = p.height;
    fig.style.setProperty('--ar', (p.width / p.height).toFixed(4));   // the shrunken photo keeps its shape
    img.src = src;
    photoBg.style.backgroundImage = `url("${src}")`;
    const done = () => { if (cur === p) fig.classList.remove('is-loading'); };
    if (img.decode) img.decode().then(done, done);
    else img.onload = img.onerror = done;
  }

  function reveal() {
    if (!guess || !cur || revealed) return;
    revealed = true;
    const g = guess.wrap();
    const d = km(cur.truth.lat, cur.truth.lon, g.lat, g.lng);
    you = { lat: g.lat, lon: g.lng, km: d, pts: geoscore(d) };
    youMarker.dragging.disable();
    root.classList.add('is-revealed');
    promptEl.hidden = true;
    result.hidden = false;
    out.youBar.style.setProperty('--w', 0);              // the bars grow in from zero
    out.digBar.style.setProperty('--w', 0);
    void result.offsetWidth;
    guessBtn.hidden = true;
    skipBtn.hidden = true;
    nextBtn.hidden = false;
    drawReveal();
    showResult();
    nextBtn.focus({ preventScroll: true });
  }

  function drawReveal() {
    layer.clearLayers();
    const o = cur[OPP.field];
    const t = [cur.truth.lat, cur.truth.lon];
    const youArc = arc(t, [you.lat, you.lon]);
    const digArc = arc(t, [o.lat, o.lon]);
    const youEnd = youArc[youArc.length - 1], digEnd = digArc[digArc.length - 1];
    // samples go on the copy of the world nearest the truth, like the guesses
    cur.samples.forEach(([la, lo]) => L.circleMarker([la, lo + Math.round((t[1] - lo) / 360) * 360], dot).addTo(layer));
    L.polyline(digArc, { ...LINE, color: '#241a12' }).addTo(layer);
    L.polyline(youArc, { ...LINE, color: '#c23b27' }).addTo(layer);
    L.marker(digEnd, { icon: icons.dig, keyboard: false, zIndexOffset: 900 })   // above the pin, below your X
      .bindTooltip(`${OPP.name}: ${fmtKm(o.km)} away`, TIP).addTo(layer);
    L.marker(t, { icon: icons.truth, keyboard: false, zIndexOffset: 800 })
      .bindTooltip(`Taken here: ${placeName(cur.truth)}`, TIP).addTo(layer);
    youMarker.setLatLng(youEnd);
    youMarker.unbindTooltip().bindTooltip(`You: ${fmtKm(you.km)} away`, TIP);
    const bounds = L.latLngBounds([t, youEnd, digEnd]);
    const fit = { paddingTopLeft: [48, 64], paddingBottomRight: [48, 36], maxZoom: 9 };
    if (bigMap) {                                    // keep the markers clear of the shrunken photo
      const m = mapEl.getBoundingClientRect(), f = fig.getBoundingClientRect();
      if (f.left - m.left < m.width / 2) fit.paddingTopLeft[0] += f.width + 12;
      else fit.paddingBottomRight[0] += f.width + 12;
    }
    if (reduceMotion) map.fitBounds(bounds, { ...fit, animate: false });
    else map.flyToBounds(bounds, { ...fit, duration: 1.2 });
  }

  function showResult() {
    const o = cur[OPP.field];
    const name = OPP.name;
    const diff = you.pts - o.geoscore;
    out.youPts.textContent = nf.format(you.pts);
    out.youKm.textContent = fmtKm(you.km);
    out.digPts.textContent = nf.format(o.geoscore);
    out.digKm.textContent = fmtKm(o.km);
    out.youBar.style.setProperty('--w', (you.pts / 5000).toFixed(4));
    out.digBar.style.setProperty('--w', (o.geoscore / 5000).toFixed(4));
    out.verdict.className = `game-verdict ${diff > 0 ? 'is-win' : diff < 0 ? 'is-loss' : 'is-tie'}`;
    out.verdict.textContent = (you.km < 10 ? 'X marks the spot! ' : '') + (
      diff > 0 ? `You beat ${name} by ${nf.format(diff)} points!`
        : diff < 0 ? `${name} wins by ${nf.format(-diff)} points.`
          : `A dead heat at ${nf.format(you.pts)} points.`);
    out.place.textContent = placeName(cur.truth);
    out.dots.textContent = OPP.dots;
  }

  guessBtn.addEventListener('click', reveal);
  skipBtn.addEventListener('click', next);
  nextBtn.addEventListener('click', () => {
    const keyboard = nextBtn.matches(':focus-visible');
    next();
    if (keyboard) mapEl.focus({ preventScroll: true });   // keep keyboard players on the map
  });

  // ── enlarged photo (up to 2x its native size) ──
  if (box && typeof box.showModal === 'function') {
    const open = () => {
      if (!cur) return;
      boxImg.src = img.currentSrc || img.src;
      box.style.setProperty('--w', `${cur.width}px`);
      box.style.setProperty('--ar', (cur.width / cur.height).toFixed(4));
      box.showModal();
    };
    $('.game-enlarge').addEventListener('click', open);
    img.addEventListener('click', open);
    box.addEventListener('click', () => box.close());      // backdrop, photo or × all close it
  } else {
    $('.game-enlarge').hidden = true;
    img.style.cursor = 'default';
  }

  // ── load Leaflet and the data once the game is near ──
  const loadLeaflet = () => (window.L ? Promise.resolve() : new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LEAFLET_JS;
    s.onload = () => (window.L ? resolve() : reject(new Error('Leaflet did not initialize')));
    s.onerror = () => reject(new Error('Leaflet failed to load'));
    document.head.append(s);
  }));
  const loadData = () => fetch(DATA_URL).then(r => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  });

  const start = () => {
    Promise.all([loadData(), loadLeaflet()]).then(([data]) => {
      photos = data.photos.filter(p => !SKIP.has(p.id));
      order = shuffle(photos.map((_, i) => i));
      const want = new URLSearchParams(location.search).get('photo');
      const k = want ? photos.findIndex(p => p.id === want) : -1;
      if (k >= 0) { order.splice(order.indexOf(k), 1); order.unshift(k); }
      buildMap();
      board.dataset.state = 'ready';
      next();
    }).catch(err => {
      board.dataset.state = 'error';
      loading.textContent = 'The game could not load. Please refresh the page to try again.';
      console.warn('[game]', err);
    });
  };

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: '150% 0px' });
    io.observe(root);
  } else start();
})();
