/* ============================================================
   src/pages/page-preview.js — CrypView V3
   Aperçu animé de page.html dans #terminal (index.html).
   - AUCUNE requête réseau : bougies et chiffres sont générés
     localement (PRNG déterministe).
   - Le « live » ne tourne que lorsque l'aperçu est à l'écran
     et l'onglet visible (économise batterie et données).
   - prefers-reduced-motion : rendu statique, sans boucle.
   ============================================================ */
(function () {
  'use strict';
  var root = document.getElementById('terminal');
  var stage = document.getElementById('pv-stage');
  if (!root || !stage) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var R = function (n) { return stage.querySelector('[data-r="' + n + '"]'); };
  var all = function (s, c) { return Array.prototype.slice.call((c || stage).querySelectorAll(s)); };
  var tabs = all('.pv-tab', root);
  var ZONES = ['marche', 'flux', 'derives', 'analyse', 'outils'];
  var DUR = 4200, PRE = 14, N = 36, W = 360, H = 200, VOL = 34;

  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var rnd = rng(20260101);
  var SYMS = [
    { s: 'BTC/USDT', p: 67420, v: .0016, seed: 7 }, { s: 'ETH/USDT', p: 3520, v: .002, seed: 21 },
    { s: 'SOL/USDT', p: 168, v: .003, seed: 42 },   { s: 'BNB/USDT', p: 598, v: .0018, seed: 99 }
  ];
  function fmt(p, d) { d = d == null ? (p >= 1000 ? 1 : 2) : d; return p.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function nextC(prev, s, r) {
    var o = prev.c, c = o * (1 + (r() - .485) * s.v * 2.4);
    return { o: o, c: c, h: Math.max(o, c) * (1 + r() * s.v * .7), l: Math.min(o, c) * (1 - r() * s.v * .7), v: .25 + r() * .75 };
  }
  function build(s) {
    var r = rng(s.seed), d = [{ o: s.p, c: s.p, h: s.p, l: s.p, v: .5 }];
    while (d.length < N + PRE) d.push(nextC(d[d.length - 1], s, r));
    return { sym: s, d: d, r: r, open: d[PRE].o };
  }
  function Y(c, p) { var t = Math.max(0, Math.min(1, (p - c.lo) / (c.hi - c.lo))); return 8 + (H - VOL - 16) * (1 - t); }

  /* ── Cellules graphique (1, 2 ou 4) ─────────────────────── */
  var cells = [], view = 1, introT;
  var cellsEl = stage.querySelector('.pv-cells');

  function mkCell(s) {
    var c = build(s), el = document.createElement('div');
    el.className = 'pv-cell';
    el.innerHTML = '<span class="pv-clabel">' + s.s + ' <em>1m</em></span>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><g class="pv-cs"></g><polyline class="pv-sma" pathLength="1"></polyline>' +
      '<line class="pv-ll" x1="0" x2="' + W + '"></line></svg><span class="pv-tag"></span>';
    c.el = el; c.svg = el.querySelector('svg'); c.cs = el.querySelector('.pv-cs');
    c.sma = el.querySelector('.pv-sma'); c.ll = el.querySelector('.pv-ll'); c.tag = el.querySelector('.pv-tag');
    cellsEl.appendChild(el);
    return c;
  }
  function draw(c, intro) {
    var v = c.d.slice(PRE), lo = Infinity, hi = -Infinity, st = W / N, bw = st * .62, h = '', i;
    v.forEach(function (k) { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); });
    var pad = (hi - lo) * .2; c.lo = lo - pad; c.hi = hi + pad;
    for (i = 1; i < 5; i++) { var gy = ((H - VOL) / 5 * i).toFixed(1); h += '<line class="pv-gl" x1="0" x2="' + W + '" y1="' + gy + '" y2="' + gy + '"/>'; }
    v.forEach(function (k, j) {
      var x = j * st + st / 2, yo = Y(c, k.o), yc = Y(c, k.c);
      h += '<g class="pv-c ' + (k.c >= k.o ? 'up' : 'dn') + '" style="--d:' + (j * 22) + 'ms"><line x1="' + x + '" x2="' + x + '" y1="' + Y(c, k.h) + '" y2="' + Y(c, k.l) + '"/>' +
        '<rect x="' + (x - bw / 2) + '" y="' + Math.min(yo, yc) + '" width="' + bw + '" height="' + Math.max(1.4, Math.abs(yo - yc)) + '"/>' +
        '<rect class="vb" x="' + (x - bw / 2) + '" y="' + (H - k.v * VOL) + '" width="' + bw + '" height="' + (k.v * VOL) + '"/></g>';
    });
    c.cs.innerHTML = h;
    c.svg.classList.toggle('pv-intro', !!intro);
    overlay(c);
    if (c === cells[0]) { c.alert = c.lo + (c.hi - c.lo) * .7; }
  }
  function lastC(c) { return c.d[c.d.length - 1]; }
  function updateLast(c) {
    var k = lastC(c), g = c.cs.lastElementChild, yo = Y(c, k.o), yc = Y(c, k.c);
    g.setAttribute('class', 'pv-c ' + (k.c >= k.o ? 'up' : 'dn'));
    g.children[0].setAttribute('y1', Y(c, k.h)); g.children[0].setAttribute('y2', Y(c, k.l));
    g.children[1].setAttribute('y', Math.min(yo, yc)); g.children[1].setAttribute('height', Math.max(1.4, Math.abs(yo - yc)));
    g.children[2].setAttribute('y', H - k.v * VOL); g.children[2].setAttribute('height', k.v * VOL);
  }
  function overlay(c) {
    var st = W / N, pts = [], i, k = lastC(c), y = Y(c, k.c);
    for (i = PRE; i < c.d.length; i++) {
      var s = 0, j; for (j = i - 9; j <= i; j++) s += c.d[j].c;
      pts.push(((i - PRE) * st + st / 2).toFixed(1) + ',' + Y(c, s / 10).toFixed(1));
    }
    c.sma.setAttribute('points', pts.join(' '));
    c.ll.setAttribute('y1', y); c.ll.setAttribute('y2', y);
    c.tag.style.top = (y / H * 100) + '%'; c.tag.textContent = fmt(k.c, k.c >= 1000 ? 1 : 2);
    c.tag.className = 'pv-tag ' + (k.c >= k.o ? '' : 'dn');
  }

  function setView(n) {
    view = n; cells = []; cellsEl.innerHTML = ''; cellsEl.setAttribute('data-n', n); stage.setAttribute('data-view', n);
    for (var i = 0; i < n; i++) cells.push(mkCell(SYMS[i]));
    cells.forEach(function (c) { draw(c, !reduce); });
    all('.pv-views button').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.view === n)); });
    clearTimeout(introT); introT = setTimeout(function () { cells.forEach(function (c) { c.svg.classList.remove('pv-intro'); }); }, 2200);
    chrome(true);
  }

  /* ── Panneaux annexes (valeurs simulées) ────────────────── */
  var obEl = R('ob'), trEl = R('trades'), vpEl = R('vp'), tN = 0;
  var D = { oi: 18.4, fund: .012, ls: .54, ll: 2.1, ls2: .8 };
  for (var q = 0; q < 8; q++) { var row = document.createElement('div'); row.className = 'pv-obr ' + (q < 4 ? 'a' : 'b'); row.innerHTML = '<i></i><b></b><span></span>'; obEl.appendChild(row); }
  for (q = 0; q < 9; q++) vpEl.appendChild(document.createElement('i'));
  var vpW = [18, 34, 52, 74, 96, 80, 58, 36, 20];

  function rsiOf(d) {
    var out = [], g = 0, l = 0, i, ch;
    for (i = 1; i < d.length; i++) {
      ch = d[i].c - d[i - 1].c;
      if (i <= 14) { g += Math.max(ch, 0); l += Math.max(-ch, 0); if (i === 14) { g /= 14; l /= 14; out.push(100 - 100 / (1 + g / (l || 1e-9))); } }
      else { g = (g * 13 + Math.max(ch, 0)) / 14; l = (l * 13 + Math.max(-ch, 0)) / 14; out.push(100 - 100 / (1 + g / (l || 1e-9))); }
    }
    return out;
  }
  function pc(n) { return fmt(n, 1) + ' %'; }

  function chrome(first) {
    var c = cells[0], k = lastC(c), up = k.c >= c.open, i;
    R('price').textContent = fmt(k.c);
    var pct = (k.c / c.open - 1) * 100, pe = R('pct');
    pe.textContent = (pct >= 0 ? '+' : '') + fmt(pct, 2) + ' %'; pe.className = up ? 'up' : 'dn';
    var hi = -Infinity, lo = Infinity; c.d.forEach(function (x) { hi = Math.max(hi, x.h); lo = Math.min(lo, x.l); });
    R('hi').textContent = fmt(hi); R('lo').textContent = fmt(lo); R('vol').textContent = fmt(18 + c.d.length * .3 + rnd() * 2, 1) + ' k';
    if (view === 1) {
      var rs = rsiOf(c.d), pts = rs.map(function (v, j) { return (j * W / (rs.length - 1)).toFixed(1) + ',' + (40 - v / 100 * 40).toFixed(1); }).join(' ');
      R('rsiline').setAttribute('points', pts); R('rsival').textContent = 'RSI 14 · ' + fmt(rs[rs.length - 1], 1);
      var rows = obEl.children, st = k.c > 1000 ? .5 : .01;
      for (i = 0; i < 8; i++) {
        var price = i < 4 ? k.c + (4 - i) * st : k.c - (i - 3) * st;
        rows[i].children[1].textContent = fmt(price); rows[i].children[2].textContent = fmt(.2 + rnd() * 3, 3);
        rows[i].children[0].style.width = (14 + rnd() * 70) + '%';
      }
      all('i', vpEl).forEach(function (b, j) { var w = Math.max(8, Math.min(100, vpW[j] + (first ? 0 : (rnd() - .5) * 16))); b.style.width = w + '%'; b.className = j === 4 ? 'poc' : ''; });
      if (c.alert) { var ay = Y(c, c.alert), ae = R('alert'); ae.style.top = (ay / H * 100) + '%'; R('alertp').textContent = fmt(c.alert, 0); }
    }
    D.oi += (rnd() - .48) * .06; D.fund += (rnd() - .5) * .0008; D.ls = Math.max(.42, Math.min(.62, D.ls + (rnd() - .5) * .012));
    D.ll = Math.max(.4, D.ll + (rnd() - .45) * .25); D.ls2 = Math.max(.2, D.ls2 + (rnd() - .5) * .15);
    R('oi').textContent = fmt(D.oi, 2) + ' Md$'; R('oib').style.setProperty('--w', (60 + (D.oi - 18.4) * 120) + '%');
    R('fund').textContent = (D.fund >= 0 ? '+' : '') + fmt(D.fund, 3) + ' %'; R('fundb').style.setProperty('--w', Math.min(100, Math.abs(D.fund) / .03 * 100) + '%');
    R('ls').textContent = Math.round(D.ls * 100) + ' / ' + Math.round((1 - D.ls) * 100); R('lsb').style.setProperty('--w', D.ls * 100 + '%');
    R('liq').textContent = 'L ' + fmt(D.ll, 1) + 'M · S ' + fmt(D.ls2, 1) + 'M'; R('liqb').style.setProperty('--w', D.ll / (D.ll + D.ls2) * 100 + '%');
  }
  function addTrade() {
    var k = lastC(cells[0]), buy = rnd() > .5, d = document.createElement('div');
    d.className = 'pv-tr';
    d.innerHTML = '<b class="' + (buy ? 'up' : 'dn') + '">' + fmt(k.c + (rnd() - .5) * (k.c > 1000 ? 4 : .05)) + '</b><span>' + fmt(rnd() * .6, 3) + '</span><span>' + new Date().toTimeString().slice(0, 8) + '</span>';
    trEl.insertBefore(d, trEl.firstChild);
    while (trEl.children.length > 5) trEl.removeChild(trEl.lastChild);
  }
  function tick() {
    tN++;
    cells.forEach(function (c) {
      var k = lastC(c);
      if (tN % 8 === 0) { c.d.push(nextC(k, c.sym, c.r)); c.d.shift(); draw(c, false); }
      else { var nc = k.c * (1 + (c.r() - .5) * c.sym.v * .9); k.c = nc; k.h = Math.max(k.h, nc); k.l = Math.min(k.l, nc); k.v = Math.min(1, k.v + c.r() * .05); updateLast(c); overlay(c); }
    });
    chrome(false); if (view === 1) addTrade();
  }

  /* ── Zones : focus, visite guidée automatique ───────────── */
  var current = null, lock = false, timer, inView = false, iv = 0, started = false;
  function setActive(z, user) {
    if (z !== 'marche' && view !== 1) setView(1);
    current = z; stage.setAttribute('data-active', z); stage.classList.add('has-focus');
    all('.pv-z').forEach(function (e) { e.classList.toggle('is-on', e.dataset.zone === z); });
    clearTimeout(timer);
    tabs.forEach(function (t) {
      var on = t.dataset.go === z; t.classList.remove('is-timing'); t.classList.toggle('is-active', on); t.setAttribute('aria-pressed', String(on));
      if (on && !user && !lock && !reduce) { void t.offsetWidth; t.classList.add('is-timing'); }
    });
    if (user) lock = true; else schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (lock || reduce || !inView || document.hidden) return;
    timer = setTimeout(function () { setActive(ZONES[(ZONES.indexOf(current) + 1) % ZONES.length], false); }, DUR);
  }
  function run() {
    if (reduce || !inView || document.hidden) { clearInterval(iv); iv = 0; return; }
    if (!iv) iv = setInterval(tick, 1000);
  }
  function start() {
    if (started) return; started = true;
    setView(1);
    for (var i = 0; i < 5; i++) addTrade();
    setActive('marche', false);
  }

  tabs.forEach(function (t) { t.addEventListener('click', function () { setActive(t.dataset.go, true); }); });
  stage.addEventListener('click', function (e) { var z = e.target.closest('.pv-z'); if (z) setActive(z.dataset.zone, true); });
  all('.pv-views button').forEach(function (b) {
    b.addEventListener('click', function () { lock = true; clearTimeout(timer); setView(+b.dataset.view); setActive('marche', true); });
  });
  document.addEventListener('visibilitychange', function () { run(); if (!lock) setActive(current || 'marche', false); });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      inView = es[0].isIntersecting;
      if (inView) { start(); if (!lock) setActive(current, false); }
      run(); if (!inView) { clearTimeout(timer); }
    }, { threshold: .3 }).observe(stage);
  } else { inView = true; start(); run(); }
})();
