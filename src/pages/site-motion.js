/* ============================================================
   src/pages/site-motion.js — CrypView V3
   Couche additive : thème clair/sombre, micro-interactions et
   animations au défilement. N'importe, ne modifie et ne
   remplace aucun script existant (src/pages/index.js) : tout
   ce fichier fait est purement décoratif et utilise ses propres
   attributs (data-reveal, .count-up, #cursor-glow, #scroll-progress).
   ============================================================ */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;

  /* ── 1. Thème clair / sombre ──────────────────────────────── */
  var THEME_KEY = 'crypview-theme';
  var themeBtn  = document.getElementById('theme-toggle-btn');

  function applyTheme(theme) {
    root.classList.toggle('light-theme', theme === 'light');
    if (themeBtn) {
      themeBtn.setAttribute(
        'aria-label',
        theme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'
      );
    }
    try {
      document.dispatchEvent(new CustomEvent('crypview:theme:change', { detail: { theme: theme } }));
    } catch (e) { /* no-op */ }
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = root.classList.contains('light-theme') ? 'dark' : 'light';
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      applyTheme(next);
    });
  }

  /* ── 2. Nav : ombre au défilement + barre de progression ──── */
  var nav      = document.getElementById('nav');
  var progress = document.getElementById('scroll-progress');
  var ticking  = false;

  function onScroll() {
    var y = window.scrollY || window.pageYOffset;

    if (nav) nav.classList.toggle('scrolled', y > 8);

    if (progress) {
      var doc = document.documentElement;
      var max = (doc.scrollHeight - doc.clientHeight) || 1;
      progress.style.width = Math.min(100, (y / max) * 100) + '%';
    }

    if (!reduceMotion) {
      root.style.setProperty('--parallax-slow', (y * 0.04).toFixed(2) + 'px');
      root.style.setProperty('--parallax-fast', (y * 0.09).toFixed(2) + 'px');
    }

    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      window.requestAnimationFrame(onScroll);
      ticking = true;
    }
  }, { passive: true });
  onScroll();

  /* ── 4. Révélation au défilement — nouveaux blocs uniquement ── */
  var revealEls = document.querySelectorAll('[data-reveal]');
  if (revealEls.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('is-revealed'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });
      revealEls.forEach(function (el) { io.observe(el); });
    }
  }

  /* ── 5. Compteurs animés (hero-stats) ─────────────────────── */
  var counters = document.querySelectorAll('.count-up');
  if (counters.length) {
    var animateCount = function (el) {
      var target = parseFloat(el.getAttribute('data-count-to'), 10) || 0;
      if (reduceMotion) { el.textContent = target; return; }
      var start = performance.now();
      var duration = 1100;
      function step(now) {
        var p = Math.min(1, (now - start) / duration);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.floor(eased * target);
        if (p < 1) window.requestAnimationFrame(step);
        else el.textContent = target;
      }
      window.requestAnimationFrame(step);
    };

    if ('IntersectionObserver' in window) {
      var countIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            countIo.unobserve(entry.target);
          }
        });
      }, { threshold: 0.6 });
      counters.forEach(function (el) { countIo.observe(el); });
    } else {
      counters.forEach(animateCount);
    }
  }

  /* ── 8. Spotlight curseur sur les cartes ──────────────────── */
  /* Pose --mx/--my (en %) sur chaque carte survolée ; consommé
     par styles/theme-refresh.css (background-image radial-gradient).
     Purement décoratif, ne touche à aucune logique fonctionnelle. */
  if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
    var spotlightSelector = '.feat-card, .adv-card, .tool-card, .pwa-card';
    document.querySelectorAll(spotlightSelector).forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        var px = ((e.clientX - r.left) / r.width) * 100;
        var py = ((e.clientY - r.top) / r.height) * 100;
        card.style.setProperty('--mx', px.toFixed(1) + '%');
        card.style.setProperty('--my', py.toFixed(1) + '%');
      });
    });
  }

  /* ── 9. Scrollspy — surligne le lien de nav de la section vue ── */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav-links a[href^="#"]'));
  if (navLinks.length) {
    var navTargets = navLinks
      .map(function (a) {
        var id = a.getAttribute('href').slice(1);
        var el = document.getElementById(id);
        return el ? { link: a, el: el } : null;
      })
      .filter(Boolean);

    if (navTargets.length && 'IntersectionObserver' in window) {
      var setActive = function (link) {
        navLinks.forEach(function (a) { a.classList.remove('active'); });
        if (link) link.classList.add('active');
      };
      var spy = new IntersectionObserver(function (entries) {
        var visible = entries
          .filter(function (en) { return en.isIntersecting; })
          .sort(function (a, b) { return b.intersectionRatio - a.intersectionRatio; });
        if (visible.length) {
          var match = navTargets.find(function (t) { return t.el === visible[0].target; });
          if (match) setActive(match.link);
        }
      }, { threshold: [0.15, 0.35, 0.55], rootMargin: '-15% 0px -55% 0px' });
      navTargets.forEach(function (t) { spy.observe(t.el); });
    }
  }

  /* ── 10. Bouton retour en haut (se greffe sur le rAF existant) ── */
  var backToTop = document.getElementById('back-to-top');
  if (backToTop) {
    var toggleBackToTop = function () {
      var y = window.scrollY || window.pageYOffset;
      backToTop.classList.toggle('show', y > 640);
    };
    window.addEventListener('scroll', function () { toggleBackToTop(); }, { passive: true });
    toggleBackToTop();
    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  /* ── 11. Compteurs de ticker-item : léger fondu d'entrée en cascade ── */
  var tickerItems = document.querySelectorAll('.ticker-item');
  if (tickerItems.length && !reduceMotion) {
    tickerItems.forEach(function (el, i) {
      el.style.animation = 'fadeIn .5s ease ' + (1 + i * 0.04).toFixed(2) + 's backwards';
    });
  }

  /* ── 12a. Description compacte au survol / focus ──────────── */
  document.querySelectorAll('.ind-btn').forEach(function (btn) {
    var li   = btn.closest('li');
    var desc = li ? li.querySelector('.ind-desc') : null;
    if (desc && desc.textContent.trim()) {
      btn.setAttribute('data-ind-desc', desc.textContent.trim());
      btn.setAttribute('aria-label', btn.textContent.trim() + '. ' + desc.textContent.trim());
    }
  });

  /* ── 12b. Descriptions des indicateurs (accordéon au clic) ── */
  document.querySelectorAll('.ind-list').forEach(function (list) {
    list.addEventListener('click', function (e) {
      var btn = e.target.closest('.ind-btn');
      if (!btn || !list.contains(btn)) return;
      var li = btn.closest('li');
      var wasOpen = li.classList.contains('expanded');
      list.querySelectorAll('li.expanded').forEach(function (openLi) {
        openLi.classList.remove('expanded');
        var b = openLi.querySelector('.ind-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        li.classList.add('expanded');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ── 12c. Bouton "réduire" de la démo d'alertes ───────────── */
  var adcMinimize = document.getElementById('adc-minimize');
  var adcCard      = adcMinimize ? adcMinimize.closest('.alert-demo-card') : null;
  if (adcMinimize && adcCard) {
    adcMinimize.addEventListener('click', function () {
      var collapsed = adcCard.classList.toggle('collapsed');
      adcMinimize.setAttribute('aria-expanded', String(!collapsed));
      adcMinimize.setAttribute('aria-label', collapsed ? 'Agrandir la démo' : 'Réduire la démo');
    });
  }

  /* ── 12. Effet "typing caret" léger sur le sous-titre du hero ── */
  /* Ajoute un curseur clignotant en fin d'animation d'entrée du
     .hero-sub existant, sans modifier le texte ni son timing. */
  var heroSub = document.querySelector('.hero-sub');
  if (heroSub && !reduceMotion) {
    heroSub.addEventListener('animationend', function handler(ev) {
      if (ev.animationName !== 'fadeUp') return;
      heroSub.removeEventListener('animationend', handler);
      var caret = document.createElement('span');
      caret.setAttribute('aria-hidden', 'true');
      caret.style.cssText = 'display:inline-block;width:2px;height:1em;background:var(--accent);' +
        'margin-left:4px;vertical-align:-2px;animation:blinkDot 1s step-end infinite';
      heroSub.appendChild(caret);
      window.setTimeout(function () {
        if (caret && caret.parentNode) caret.style.opacity = '0';
      }, 2600);
    });
  }

  /* ── 13. Cartes principales : visibles même si index.js échoue ── */
  var featCards = document.querySelectorAll('.feat-card');
  if (featCards.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      featCards.forEach(function (c) { c.classList.add('visible'); });
    } else {
      var cardIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('visible'); cardIo.unobserve(en.target); }
        });
      }, { threshold: 0.1 });
      featCards.forEach(function (c) { cardIo.observe(c); });
    }
  }

})();
