/* ════════════════════════════════════════════════════════════
   DIG project page: "Can you beat DIG?"
   Five rounds of one photo each: drop your X on the map, lock it in, and see how DIG-XL did.
   After the fifth, a summary shows your total next to DIG-XL's, and where it lands among
   DIG-XL's totals in 10,000 simulated games (no scores are stored or sent anywhere).
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
  const ROUNDS = 5;                                 // photos per game, 5,000 points each
  const SIM_GAMES = 10000;                          // DIG-XL's simulated games for the summary's chart
  const BIN = 1000, NBINS = ROUNDS * 5000 / BIN;   // the chart's bars: 1,000 points each

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
  const guessBtn = $('.game-guess'), nextBtn = $('.game-next');
  const shrinkBtn = $('.game-shrink');
  const out = {
    verdict: $('[data-verdict]'), place: $('[data-place]'), dots: $('[data-dots]'),
    youPts: $('[data-you-pts]'), youKm: $('[data-you-km]'), youBar: $('[data-you-bar]'),
    digPts: $('[data-dig-pts]'), digKm: $('[data-dig-km]'), digBar: $('[data-dig-bar]'),
  };
  const box = $('.game-lightbox'), boxImg = box && box.querySelector('img');
  const prog = {
    box: $('.game-progress'), round: $('[data-round]'), list: $('.game-pips'), pips: [],
    you: $('[data-you-total]'), dig: $('[data-dig-total]'),
  };
  const sum = {
    box: $('.game-summary'), label: $('.sum-label'), you: $('[data-sum-you]'), dig: $('[data-sum-dig]'),
    verdict: $('[data-sum-verdict]'), rows: $('[data-sum-rows]'), pct: $('[data-sum-pct]'),
    dist: $('[data-dist]'), distRows: $('[data-dist-rows]'), live: $('[data-dist-live]'), again: $('.game-again'),
  };

  const PROMPT_START = coarse ? 'Tap the map to drop your X.' : 'Drop your X on the map.';
  const PROMPT_PLACED = 'Move it as often as you like, then lock in your guess.';
  hint.textContent = coarse ? 'Tap to drop your X · two fingers move the map' : 'Click the map to drop your X';

  // ── state ──
  let photos = [], order = [], pos = -1, cur = null;
  let map = null, layer = null, icons = null, dot = null, youMarker = null;
  let guess = null, you = null, revealed = false;
  let round = 0, results = [];                     // this game: { p, you, dig } per finished round

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

  // ── a game of ROUNDS rounds ──
  // Photos come from one shuffled deck, so a new game carries on through it: no repeats until all are seen.
  function newGame() {
    results = [];
    round = 0;
    root.classList.remove('is-over');
    sum.box.hidden = true;
    if (map) map.invalidateSize();                  // the map was hidden behind the summary
    nextRound();
  }

  function nextRound() {
    if (!photos.length) return;
    round++;
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
    nextBtn.hidden = true;
    hint.classList.remove('is-off');
    renderProgress();
    worldView();
    showPhoto(cur);
    if (round < ROUNDS) {                            // warm the cache for the next round
      const after = photos[order[(pos + 1) % order.length]];
      if (after) new Image().src = DATA_DIR + after.image;
    }
  }

  const total = key => results.reduce((s, r) => s + (key === 'you' ? r.you.pts : r.dig.geoscore), 0);
  const winner = r => (r.you.pts > r.dig.geoscore ? 'you' : r.you.pts < r.dig.geoscore ? 'dig' : 'tie');

  function renderProgress() {
    prog.round.textContent = String(round);
    prog.pips.forEach((li, i) => {
      li.className = results[i] ? `is-${winner(results[i])}` : i === round - 1 ? 'is-now' : '';
    });
    prog.you.textContent = nf.format(total('you'));
    prog.dig.textContent = nf.format(total('dig'));
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
    results.push({ p: cur, you, dig: cur[OPP.field] });
    youMarker.dragging.disable();
    root.classList.add('is-revealed');
    promptEl.hidden = true;
    result.hidden = false;
    out.youBar.style.setProperty('--w', 0);              // the bars grow in from zero
    out.digBar.style.setProperty('--w', 0);
    void result.offsetWidth;
    guessBtn.hidden = true;
    nextBtn.textContent = round < ROUNDS ? 'Next round' : 'See results';
    nextBtn.hidden = false;
    drawReveal();
    showResult();
    renderProgress();
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
  nextBtn.addEventListener('click', () => {
    if (round >= ROUNDS) { showSummary(); return; }
    const keyboard = nextBtn.matches(':focus-visible');
    nextRound();
    if (keyboard) mapEl.focus({ preventScroll: true });   // keep keyboard players on the map
  });

  // ── after the last round: the summary ──
  const shortPlace = t => {
    const parts = [t.city || t.region, countryName(t.country)].filter(Boolean);
    return parts.filter((p, i) => parts.indexOf(p) === i).join(', ');
  };

  function showSummary() {
    if (!digTotals) simulate();
    const yt = total('you'), dt = total('dig'), diff = yt - dt;
    sum.you.textContent = nf.format(yt);
    sum.dig.textContent = nf.format(dt);
    sum.verdict.className = `game-verdict ${diff > 0 ? 'is-win' : diff < 0 ? 'is-loss' : 'is-tie'}`;
    sum.verdict.textContent = diff > 0 ? `You beat ${OPP.name} by ${nf.format(diff)} points!`
      : diff < 0 ? `${OPP.name} wins by ${nf.format(-diff)} points.`
        : `A dead heat at ${nf.format(yt)} points.`;
    sum.pct.textContent = pctLine(below(yt) / SIM_GAMES);
    sum.rows.replaceChildren(...results.map((r, i) => {
      const tr = document.createElement('tr');
      const n = document.createElement('th');
      n.scope = 'row';
      n.textContent = String(i + 1);
      const where = document.createElement('td');
      const wrap = document.createElement('span');
      wrap.className = 'sum-place';
      const thumb = new Image(52, 34);
      thumb.className = 'sum-thumb';
      thumb.alt = '';
      thumb.decoding = 'async';
      thumb.src = DATA_DIR + r.p.image;
      const name = document.createElement('span');
      name.textContent = shortPlace(r.p.truth);
      wrap.append(thumb, name);
      where.append(wrap);
      const cell = (pts, d, best) => {
        const td = document.createElement('td');
        td.className = best ? 'num is-best' : 'num';
        td.textContent = nf.format(pts);
        td.title = `${fmtKm(d)} away`;
        return td;
      };
      const w = winner(r);
      tr.append(n, where, cell(r.you.pts, r.you.km, w === 'you'), cell(r.dig.geoscore, r.dig.km, w === 'dig'));
      return tr;
    }));
    distData = { you: yt, dig: dt };
    root.classList.add('is-over');
    sum.box.hidden = false;
    drawDist(true);
    if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    sum.label.focus({ preventScroll: true });
  }

  sum.again.addEventListener('click', () => {
    const keyboard = sum.again.matches(':focus-visible');
    newGame();
    if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    if (keyboard) mapEl.focus({ preventScroll: true });
  });

  // ── DIG-XL's games, for the summary's chart ──
  // DIG-XL "plays" SIM_GAMES games of five different photos drawn at random from this set, each scored with
  // its single guided guess (the answers you play against). A fixed seed keeps the curve, and so where a
  // total lands on it, the same for every visitor.
  let digTotals = null, digCounts = null;
  function simulate() {
    const s = photos.map(p => p[OPP.field].geoscore), n = s.length, idx = s.map((_, i) => i);
    let seed = 20261126;
    const rand = () => {                             // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    digTotals = new Int32Array(SIM_GAMES);
    for (let g = 0; g < SIM_GAMES; g++) {
      let acc = 0;
      for (let k = 0; k < ROUNDS; k++) {             // a partial shuffle draws five different photos
        const j = k + Math.floor(rand() * (n - k));
        const t = idx[k]; idx[k] = idx[j]; idx[j] = t;
        acc += s[idx[k]];
      }
      digTotals[g] = acc;
    }
    digTotals.sort();
    digCounts = new Array(NBINS).fill(0);
    digTotals.forEach(t => { digCounts[Math.min(NBINS - 1, Math.floor(t / BIN))] += 1; });
    sum.distRows.replaceChildren(...digCounts.flatMap((c, i) => {   // the chart as a table
      if (!c) return [];
      const tr = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td');
      th.scope = 'row';
      th.textContent = binRange(i);
      td.textContent = sharePct(c);
      tr.append(th, td);
      return [tr];
    }));
  }
  const binRange = i => `${nf.format(i * BIN)}–${nf.format(i === NBINS - 1 ? NBINS * BIN : i * BIN + BIN - 1)}`;
  const sharePct = c => `${(c / SIM_GAMES * 100).toFixed(1)}%`;
  const below = v => {                               // how many of DIG-XL's totals are lower than v
    let lo = 0, hi = digTotals.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (digTotals[m] < v) lo = m + 1; else hi = m; }
    return lo;
  };
  const pctLine = share => {
    const p = share * 100, name = OPP.name, games = nf.format(SIM_GAMES);
    if (p === 0) return `You’d beat ${name} in none of its ${games} games.`;
    if (p === 100) return `You’d beat ${name} in all ${games} of its games!`;
    if (p < 1) return `You’d beat ${name} in fewer than 1% of games.`;
    if (p > 99) return `You’d beat ${name} in more than 99% of games!`;
    return `You’d beat ${name} in ${Math.round(p)}% of games${p >= 50 ? '!' : '.'}`;
  };

  // ── the chart: DIG-XL's totals as bars; your total and DIG-XL's on your photos as lines ──
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svgEl = (name, attrs, parent) => {
    const e = document.createElementNS(SVGNS, name);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (parent) parent.append(e);
    return e;
  };
  const tip = document.createElement('div');
  const tipVal = document.createElement('b'), tipText = document.createElement('span');
  tip.className = 'dist-tip';
  tip.hidden = true;
  tip.append(tipVal, tipText);
  let distData = null, view = null, active = -1;

  function drawDist(animate) {
    const W = Math.floor(sum.dist.clientWidth);
    if (!W || !distData || !digCounts) return;
    const H = 226, top = 62, base = 194, left = 38, right = 10, MAX = NBINS * BIN;
    const pw = W - left - right, slot = pw / NBINS;
    const share = digCounts.map(c => c / SIM_GAMES);
    const yMax = Math.max(1, Math.ceil(Math.max(...share) * 20)) / 20;     // the next 5% up
    const X = v => left + Math.max(0, Math.min(MAX, v)) / MAX * pw;
    const Y = f => base - f / yMax * (base - top);
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
    if (animate) svg.classList.add('is-new');
    sum.dist.replaceChildren(svg, tip);
    active = -1;
    tip.hidden = true;

    for (let k = 1; k <= Math.round(yMax * 20); k++) {          // a hairline every 5% of games
      const y = Math.round(Y(k / 20)) + .5;
      svgEl('line', { class: 'd-grid', x1: left, x2: W - right, y1: y, y2: y }, svg);
      svgEl('text', { class: 'd-tick', x: left - 8, y: y + 4, 'text-anchor': 'end' }, svg).textContent = `${k * 5}%`;
    }
    svgEl('line', { class: 'd-axis', x1: left, x2: W - right, y1: base + .5, y2: base + .5 }, svg);
    const compact = pw < 300;                        // on a phone the full numbers would touch: 5K, 10K, ...
    for (let v = 0; v <= MAX; v += 5000) {
      svgEl('text', { class: 'd-tick', x: X(v), y: base + 20, 'text-anchor': v === 0 ? 'start' : v === MAX ? 'end' : 'middle' }, svg)
        .textContent = compact && v ? `${v / 1000}K` : nf.format(v);
    }
    // bars: at most 24px wide, a 2px gap between neighbours, 4px rounded tops, square at the baseline
    const bw = Math.min(24, slot - 2);
    const bars = digCounts.map((c, i) => {
      if (!c) return null;
      const x = left + i * slot + (slot - bw) / 2, y = Y(share[i]), r = Math.min(4, base - y, bw / 2);
      return svgEl('path', {
        class: 'd-bar', style: `--i:${i}`,
        d: `M${x} ${base}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${base}Z`,
      }, svg);
    });
    // lines: your total and DIG-XL's on your five photos, each topped by a dot and a label with its total
    const marks = [
      { v: distData.you, cls: 'is-you', who: 'You' },
      { v: distData.dig, cls: 'is-dig', who: OPP.name },
    ].map(m => {
      const g = svgEl('g', { class: `d-mark ${m.cls}` }, svg);
      const line = svgEl('line', {}, g), dot = svgEl('circle', { r: 4 }, g), t = svgEl('text', {}, g);
      svgEl('tspan', { class: 'd-who' }, t).textContent = m.who;
      svgEl('tspan', { class: 'd-val', dx: 6 }, t).textContent = nf.format(m.v);
      return { ...m, x: Math.round(X(m.v)) + .5, line, dot, t, w: t.getComputedTextLength() };
    });
    // Two label rows. The upper marker's line runs down through the lower row, so the lower label must
    // stay clear of it: centred on its own line if it can, else on the side away from the other line.
    // You take the top row unless only the swap keeps both labels beside their own lines.
    const ROWS = [16, 44];
    const centred = m => (m.x - m.w / 2 < 2 ? [2, 'start'] : m.x + m.w / 2 > W - 2 ? [W - 2, 'end'] : [m.x, 'middle']);
    const clear = (m, [x, anchor], other) => {
      const a = anchor === 'start' ? x : anchor === 'end' ? x - m.w : x - m.w / 2;
      return other.x < a - 6 || other.x > a + m.w + 6;
    };
    const lowerSpot = (m, other) => {
      const c = centred(m);
      if (clear(m, c, other)) return c;
      if (m.x >= other.x && m.x + 7 + m.w <= W - 2) return [m.x + 7, 'start'];
      if (m.x < other.x && m.x - 7 - m.w >= 2) return [m.x - 7, 'end'];
      return null;
    };
    const [me, dig] = marks;
    let upper = me, lower = dig, spot = lowerSpot(dig, me);
    if (!spot) {
      const swapped = lowerSpot(me, dig);
      if (swapped) { upper = dig; lower = me; spot = swapped; }
      else spot = dig.x >= me.x ? [me.x - 8, 'end'] : [me.x + 8, 'start'];   // last resort: beside your line
    }
    const put = (m, y, [x, anchor]) => {
      Object.entries({ x, y, 'text-anchor': anchor }).forEach(([k, v]) => m.t.setAttribute(k, v));
      Object.entries({ cx: m.x, cy: y + 10 }).forEach(([k, v]) => m.dot.setAttribute(k, v));
      Object.entries({ x1: m.x, x2: m.x, y1: y + 10, y2: base }).forEach(([k, v]) => m.line.setAttribute(k, v));
    };
    put(upper, ROWS[0], centred(upper));
    put(lower, ROWS[1], spot);
    // hover and touch: the whole column under the pointer is the target, not just its bar
    const hit = svgEl('rect', { class: 'd-hit', x: left, y: top - 8, width: pw, height: base - top + 8 }, svg);
    const binAt = e => Math.max(0, Math.min(NBINS - 1, Math.floor((e.clientX - svg.getBoundingClientRect().left - left) / slot)));
    hit.addEventListener('pointermove', e => setActive(binAt(e)));
    hit.addEventListener('pointerdown', e => setActive(binAt(e)));
    hit.addEventListener('pointerleave', () => setActive(-1));
    view = { W, left, slot, base, Y, share, bars };
  }

  function setActive(i, announce) {
    if (!view) return;
    if (active >= 0 && view.bars[active]) view.bars[active].classList.remove('is-on');
    active = i;
    if (i < 0) { tip.hidden = true; return; }
    if (view.bars[i]) view.bars[i].classList.add('is-on');
    tipVal.textContent = sharePct(digCounts[i]);
    tipText.textContent = ` of games scored ${binRange(i)}`;
    tip.hidden = false;
    const cx = view.left + (i + .5) * view.slot, w = tip.offsetWidth;
    tip.style.left = `${Math.max(w / 2 + 2, Math.min(view.W - w / 2 - 2, cx))}px`;
    tip.style.top = `${(view.bars[i] ? view.Y(view.share[i]) : view.base) - 10}px`;
    if (announce) sum.live.textContent = `${tipVal.textContent}${tipText.textContent}.`;
  }

  // keyboard: the arrow keys step through the bars, starting from the one your total falls in
  const youBin = () => Math.min(NBINS - 1, Math.floor(distData.you / BIN));
  sum.dist.addEventListener('keydown', e => {
    if (!view) return;
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    let i;
    if (step) i = active < 0 ? youBin() : Math.max(0, Math.min(NBINS - 1, active + step));
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = NBINS - 1;
    else return;
    e.preventDefault();
    setActive(i, true);
  });
  sum.dist.addEventListener('focus', () => { if (view && active < 0 && sum.dist.matches(':focus-visible')) setActive(youBin(), true); });
  sum.dist.addEventListener('blur', () => setActive(-1));
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => requestAnimationFrame(() => {
      if (view && !sum.box.hidden && Math.floor(sum.dist.clientWidth) !== view.W) drawDist(false);
    })).observe(sum.dist);
  }

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
      prog.pips = Array.from({ length: ROUNDS }, () => prog.list.appendChild(document.createElement('li')));
      root.querySelector('[data-rounds]').textContent = String(ROUNDS);
      prog.box.hidden = false;
      board.dataset.state = 'ready';
      newGame();
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
