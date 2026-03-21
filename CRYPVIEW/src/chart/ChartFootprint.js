// ============================================================
//  src/chart/ChartFootprint.js — CrypView V2
//  Engine Footprint Chart (ask/bid par niveau de prix).
//
//  Architecture du seed (v2.5.2) :
//    Phase 1 — Immédiat    : approximation OHLCV → visuel instantané
//    Phase 2 — Background  : données réelles via REST aggTrades
//                            → remplacement progressif des candles fermées
//
//  Persistance par (symbol, tf) — v2.6 :
//    Les données sont conservées dans un cache interne indexé par la clé
//    "${symbol}_${tf}". Changer de paire ou de TF ne vide plus le cache :
//    revenir sur une vue précédemment chargée réutilise les données existantes
//    et saute les phases de seed + upgrade REST.
//    Le cache est borné à MAX_CACHE_ENTRIES entrées (LRU simplifié : on expulse
//    l'entrée la plus ancienne quand la limite est atteinte).
//
//  Frontière REST / WebSocket :
//    #wsStartTime est capturé juste avant la connexion WS.
//    La requête REST couvre [candles[0].time, #wsStartTime].
//    Le WS prend le relais à partir de #wsStartTime → aucun doublage.
//    La bougie courante (ouverte) est exclusivement gérée par le WS.
//
//  Cycle de vie :
//    new ChartFootprint(chart, cSeries, container, getSymTf)
//    .activate(candles)   → seed OHLCV (si cache vide) + WS + upgrade REST async
//    .deactivate()        → coupe WS + efface canvas + observers (cache conservé)
//    .redraw(candles)     → redessine sur demande
//    .destroy()           → libère tout y compris le cache
// ============================================================

import { TF_TO_MS, RENDER_THROTTLE_MS } from '../config.js';
import { createAggTradeStream }          from '../api/binance.ws.js';
import { fetchAggTrades }                from '../api/binance.rest.js';
import { showToast }                     from '../utils/toast.js';

// Taille des lots traités par itération pour ne pas bloquer le thread UI
const UPGRADE_CHUNK_SIZE = 500;

// Nombre maximum de trades à charger via REST pour le seed haute-fidélité
const MAX_SEED_TRADES = 5_000;

/**
 * Nombre maximum d'entrées conservées dans le cache (symbol, tf).
 * Au-delà, la plus ancienne est expulsée (LRU simplifié).
 * 8 entrées couvrent aisément les usages courants en Multi-4 :
 *   4 panneaux × 2 paires = 8 combinaisons maximum.
 */
const MAX_CACHE_ENTRIES = 8;

export class ChartFootprint {
  #chart;
  #cSeries;
  #container;
  #getSymTf;    // () => { symbol, timeframe }

  // ── Cache par (symbol, tf) ────────────────────────────────
  /**
   * Cache principal indexé par `${symbol}_${tf}`.
   * Chaque valeur est un Map<candleTime, Map<bucketKey, Bucket>>.
   * Les clés sont insérées dans l'ordre d'utilisation (Map préserve l'ordre
   * d'insertion) ce qui permet un LRU simplifié via `.keys().next()`.
   *
   * @type {Map<string, Map<number, Map<number, Bucket>>>}
   */
  #cache = new Map();

  /** Clé active (currentSymbol_currentTf). */
  #currentKey = '';

  /**
   * Référence vers l'entrée active du cache.
   * Toujours synchronisé avec `#cache.get(#currentKey)`.
   * Les méthodes internes lisent/écrivent via cette référence.
   *
   * @type {Map<number, Map<number, Bucket>>}
   */
  #data = new Map();

  #ws       = null;
  #canvas   = null;
  #active   = false;
  #redrawPending = false;
  #redrawSubs    = false;

  // ── Frontière REST / WS ───────────────────────────────────
  /** Timestamp ms capturé avant la connexion WS — borne supérieure du fetch REST */
  #wsStartTime   = 0;
  /** true une fois que l'upgrade REST s'est terminé (succès ou fallback) */
  #seedUpgraded  = false;

  // ── Observers — stockés pour pouvoir les déconnecter ─────
  #resizeObs2 = null;
  #mutObs     = null;

  /**
   * @param {IChartApi}   chart
   * @param {ISeriesApi}  cSeries
   * @param {HTMLElement} container   — div#chart-container
   * @param {function(): {symbol:string, timeframe:string}} getSymTf
   */
  constructor(chart, cSeries, container, getSymTf) {
    this.#chart     = chart;
    this.#cSeries   = cSeries;
    this.#container = container;
    this.#getSymTf  = getSymTf;
  }

  // ── API publique ──────────────────────────────────────────

  /**
   * Active le Footprint.
   *
   * Séquence :
   *  1. Sélection / création de l'entrée de cache pour (symbol, tf)
   *  2a. Cache chaud → dessin immédiat + connexion WS seule (pas de seed)
   *  2b. Cache froid → seed OHLCV + WS + upgrade REST async
   */
  activate(candles) {
    if (this.#active) return;
    this.#active       = true;
    this.#seedUpgraded = false;
    this.#ensureCanvas();
    document.getElementById('fp-legend')?.classList.add('visible');

    const { symbol, timeframe } = this.#getSymTf();
    const cacheHit = this.#switchKey(symbol, timeframe);

    if (cacheHit) {
      // ── Cache chaud : données déjà présentes ──────────────
      // On lance uniquement le WS pour continuer d'accumuler les
      // nouveaux trades. Le seed REST est inutile.
      this.#wsStartTime  = Date.now();
      this.#seedUpgraded = true; // pas de phase 2 nécessaire

      this.#connectWS();
      this.#subscribeRedraws(candles);
      this.#draw(candles);
    } else {
      // ── Cache froid : seed + WS + upgrade REST ────────────
      this.#seed(candles);

      this.#wsStartTime = Date.now();

      this.#connectWS();
      this.#subscribeRedraws(candles);
      this.#draw(candles);

      this.#upgradeSeedAsync(candles);
    }
  }

  deactivate() {
    if (!this.#active) return;
    this.#active      = false;
    this.#redrawSubs  = false;
    // NB : on ne reset PAS #seedUpgraded — le cache est conservé.

    this.#ws?.destroy();
    this.#ws = null;
    // NB : on ne vide PAS #data — c'est l'intérêt du cache.

    this.#resizeObs2?.disconnect();
    this.#resizeObs2 = null;
    this.#mutObs?.disconnect();
    this.#mutObs = null;

    document.getElementById('fp-legend')?.classList.remove('visible');
    if (this.#canvas) {
      this.#canvas.getContext('2d').clearRect(0, 0, this.#canvas.width, this.#canvas.height);
      this.#canvas.style.display = 'none';
    }
  }

  redraw(candles) {
    if (this.#active) this.#draw(candles);
  }

  /**
   * Reconnexion complète après changement de symbole/TF.
   * Réutilise le cache si la combinaison (symbol, tf) a déjà été chargée.
   */
  reconnect(candles) {
    this.#redrawSubs   = false;
    // On ne vide JAMAIS le cache global ici.
    // L'ancienne entrée reste disponible si on revient dessus.

    this.#resizeObs2?.disconnect();
    this.#resizeObs2 = null;
    this.#mutObs?.disconnect();
    this.#mutObs = null;

    this.#ws?.destroy();
    this.#ws = null;

    const { symbol, timeframe } = this.#getSymTf();
    const cacheHit = this.#switchKey(symbol, timeframe);
    this.#seedUpgraded = cacheHit;

    if (cacheHit) {
      // Cache chaud → WS uniquement
      this.#wsStartTime = Date.now();
      this.#connectWS();
      this.#subscribeRedraws(candles);
      this.#draw(candles);
    } else {
      // Cache froid → seed complet
      this.#seed(candles);
      this.#wsStartTime = Date.now();
      this.#connectWS();
      this.#subscribeRedraws(candles);
      this.#draw(candles);
      this.#upgradeSeedAsync(candles);
    }
  }

  isActive() { return this.#active; }

  destroy() {
    this.deactivate();
    this.#cache.clear();
    this.#data = new Map();
    this.#currentKey = '';
    this.#canvas?.remove();
    this.#canvas = null;
  }

  // ── Gestion du cache ──────────────────────────────────────

  /**
   * Sélectionne (ou crée) l'entrée de cache pour la combinaison donnée.
   * Met à jour `#currentKey` et `#data`.
   *
   * Politique LRU simplifiée :
   *   - Si la clé est déjà dans le cache, on la déplace en fin de Map
   *     (accès récent = dernière position pour préserver l'ordre d'insertion).
   *   - Si le cache est plein et que la clé est nouvelle, on expulse l'entrée
   *     en tête de Map (la plus ancienne / la moins récemment utilisée).
   *
   * @param {string} symbol
   * @param {string} timeframe
   * @returns {boolean} true si le cache contenait déjà des données pour cette clé
   */
  #switchKey(symbol, timeframe) {
    const key  = `${symbol.toLowerCase()}_${timeframe}`;
    const warm = this.#cache.has(key) && this.#cache.get(key).size > 0;

    if (this.#cache.has(key)) {
      // Rafraîchit la position LRU : on retire puis réinsère en fin de Map
      const entry = this.#cache.get(key);
      this.#cache.delete(key);
      this.#cache.set(key, entry);
    } else {
      // Nouvelle entrée : expulsion de la plus ancienne si nécessaire
      if (this.#cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = this.#cache.keys().next().value;
        this.#cache.delete(oldest);
      }
      this.#cache.set(key, new Map());
    }

    this.#currentKey = key;
    this.#data       = this.#cache.get(key);

    return warm;
  }

  // ── Phase 1 : Seed OHLCV (approximation immédiate) ───────

  /**
   * Approxime les données Footprint depuis les bougies OHLCV.
   * Ask concentré en haut (bougie haussière), bid en bas (baissière).
   * Sert de baseline visuelle en attendant l'upgrade REST.
   *
   * N'est appelé que lorsque `#data` est vide (cache froid).
   */
  #seed(candles) {
    // Le cache est déjà vide à cet endroit (garanti par #switchKey).
    for (const c of candles) {
      const tick    = this.#tickSize(c.close);
      const nBkts   = Math.max(1, Math.ceil((c.high - c.low) / tick));
      const step    = (c.high - c.low) / nBkts;
      const isBull  = c.close >= c.open;
      const map     = new Map();

      for (let i = 0; i < nBkts; i++) {
        const priceLo  = c.low + i * step;
        const priceHi  = priceLo + step;
        const priceMid = (priceLo + priceHi) / 2;
        const ratio    = (priceMid - c.low) / ((c.high - c.low) || 1);
        const askRatio = isBull ? 0.3 + ratio * 0.7 : 0.7 - ratio * 0.4;
        const vol      = c.volume / nBkts;
        const key      = parseFloat(priceLo.toFixed(10));
        map.set(key, {
          priceLo: key,
          priceHi: parseFloat(priceHi.toFixed(10)),
          askVol:  vol * askRatio,
          bidVol:  vol * (1 - askRatio),
        });
      }
      this.#data.set(c.time, map);
    }
  }

  // ── Phase 2 : Upgrade REST aggTrades (haute-fidélité) ────

  /**
   * Charge les transactions réelles via l'API REST aggTrades et remplace
   * silencieusement les candles fermées dont l'approximation OHLCV est
   * encore active.
   *
   * Garanties :
   *  - Seules les candles FERMÉES sont remplacées (la bougie courante
   *    est exclusivement gérée par le WS pour éviter tout doublage).
   *  - Le traitement est découpé en chunks de ${UPGRADE_CHUNK_SIZE} trades
   *    avec un yield au event loop entre chaque lot (UI non bloquée).
   *  - En cas d'erreur REST, l'approximation OHLCV reste silencieusement
   *    active (fallback gracieux).
   */
  async #upgradeSeedAsync(candles) {
    if (!candles.length || !this.#active) return;

    const { symbol, timeframe } = this.#getSymTf();
    const tfMs      = TF_TO_MS[timeframe] ?? 60_000;

    const startTime = candles[0].time * 1000;
    const endTime   = this.#wsStartTime;

    const currentCandleTimeSec = Math.floor(Date.now() / tfMs) * (tfMs / 1000);

    // Capture la clé au démarrage du fetch pour vérifier qu'elle n'a pas changé
    // entre-temps (l'utilisateur peut avoir switché de paire/TF pendant le fetch).
    const keyAtStart = this.#currentKey;

    try {
      const trades = await fetchAggTrades(symbol, startTime, endTime, MAX_SEED_TRADES);

      if (!this.#active || this.#currentKey !== keyAtStart) return;

      if (!trades.length) {
        this.#seedUpgraded = true;
        return;
      }

      const upgradedTimes = new Set();

      for (let i = 0; i < trades.length; i += UPGRADE_CHUNK_SIZE) {
        if (!this.#active || this.#currentKey !== keyAtStart) return;

        const chunk = trades.slice(i, i + UPGRADE_CHUNK_SIZE);

        for (const trade of chunk) {
          const candleTimeSec = this.#calcCandleTime(trade.T, tfMs);

          if (candleTimeSec >= currentCandleTimeSec) continue;

          if (!upgradedTimes.has(candleTimeSec)) {
            this.#data.set(candleTimeSec, new Map());
            upgradedTimes.add(candleTimeSec);
          }

          this.#insertTrade(
            parseFloat(trade.p),
            parseFloat(trade.q),
            !trade.m,
            candleTimeSec,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      this.#seedUpgraded = true;

      if (this.#active && this.#currentKey === keyAtStart) this.#draw(candles);

    } catch (_err) {
      if (this.#active && this.#currentKey === keyAtStart) {
        showToast(
          'Footprint : données REST aggTrades indisponibles — mode approximation OHLCV actif.',
          'warning',
          4_000,
        );
      }
      this.#seedUpgraded = true;
    }
  }

  // ── Helpers de calcul partagés ────────────────────────────

  #calcCandleTime(tradeTimeMs, tfMs) {
    return Math.floor(tradeTimeMs / tfMs) * (tfMs / 1000);
  }

  #insertTrade(price, qty, isBuy, candleTimeSec) {
    const tick       = this.#tickSize(price);
    const bucketKey  = parseFloat((Math.floor(price / tick) * tick).toFixed(10));

    if (!this.#data.has(candleTimeSec)) {
      this.#data.set(candleTimeSec, new Map());
    }
    const buckets = this.#data.get(candleTimeSec);

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        priceLo: bucketKey,
        priceHi: bucketKey + tick,
        askVol:  0,
        bidVol:  0,
      });
    }
    const b = buckets.get(bucketKey);
    if (isBuy) b.askVol += qty; else b.bidVol += qty;
  }

  // ── WebSocket aggTrades (flux temps réel) ─────────────────

  #connectWS() {
    const { symbol } = this.#getSymTf();
    this.#ws = createAggTradeStream(symbol);
    this.#ws.onMessage = (data) => {
      if (!this.#active) return;

      if (data.T < this.#wsStartTime) return;

      const { timeframe } = this.#getSymTf();
      const tfMs = TF_TO_MS[timeframe] ?? 60_000;
      this.#insertTrade(
        parseFloat(data.p),
        parseFloat(data.q),
        !data.m,
        this.#calcCandleTime(data.T, tfMs),
      );
      this.#schedRedraw();
    };
    this.#ws.connect();
  }

  // ── Dessin canvas ─────────────────────────────────────────

  #draw(candles) {
    if (!this.#canvas || !candles.length) return;
    const W = this.#container.clientWidth;
    const H = this.#container.clientHeight;
    this.#canvas.width  = W;
    this.#canvas.height = H;

    const ctx = this.#canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const visRange = this.#chart.timeScale().getVisibleRange();
    const logRange = this.#chart.timeScale().getVisibleLogicalRange();
    if (!visRange || !logRange) return;

    const barsVisible = Math.max(1, logRange.to - logRange.from);
    const barWidthPx  = W / barsVisible;
    const showText    = barWidthPx >= 28;
    const FONT_SIZE   = 8;
    ctx.font      = `bold ${FONT_SIZE}px Space Mono,monospace`;
    ctx.textAlign = 'center';

    for (const candle of candles) {
      if (candle.time < visRange.from - 2 || candle.time > visRange.to + 2) continue;
      const buckets = this.#data.get(candle.time);
      if (!buckets?.size) continue;

      const xCenter = this.#chart.timeScale().timeToCoordinate(candle.time);
      const yHigh   = this.#cSeries.priceToCoordinate(candle.high);
      const yLow    = this.#cSeries.priceToCoordinate(candle.low);
      if (xCenter == null || yHigh == null || yLow == null) continue;

      const candleH = Math.abs(yLow - yHigh);
      if (candleH < 2) continue;

      let maxVol = 0;
      buckets.forEach(b => { const t = b.askVol + b.bidVol; if (t > maxVol) maxVol = t; });
      if (maxVol === 0) continue;

      const halfBar = Math.min(barWidthPx * 0.45, 28);

      buckets.forEach(b => {
        const yTop = this.#cSeries.priceToCoordinate(b.priceHi);
        const yBot = this.#cSeries.priceToCoordinate(b.priceLo);
        if (yTop == null || yBot == null) return;

        const y     = Math.min(yTop, yBot);
        const h     = Math.max(1, Math.abs(yBot - yTop) - 0.5);
        const total = b.askVol + b.bidVol;
        const delta = b.askVol - b.bidVol;
        const ratio = total > 0 ? delta / total : 0;

        ctx.fillStyle = ratio > 0
          ? `rgba(0,255,136,${Math.min(0.35, ratio * 0.35)})`
          : `rgba(255,61,90,${Math.min(0.35, -ratio * 0.35)})`;
        ctx.fillRect(xCenter - halfBar, y, halfBar * 2, h);

        const isImb = (b.bidVol > 0 && b.askVol / b.bidVol >= 3) || (b.askVol > 0 && b.bidVol / b.askVol >= 3);
        if (isImb) {
          ctx.strokeStyle = '#ffd700';
          ctx.lineWidth   = 0.8;
          ctx.strokeRect(xCenter - halfBar + 0.5, y + 0.5, halfBar * 2 - 1, h - 1);
        }

        if (showText && h >= 8) {
          const fmt = v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(1);
          ctx.fillStyle = 'rgba(0,255,136,0.9)';
          ctx.fillText(fmt(b.askVol), xCenter - halfBar / 2, y + h / 2 + FONT_SIZE / 3);
          ctx.strokeStyle = 'rgba(255,255,255,0.1)';
          ctx.lineWidth   = 0.5;
          ctx.beginPath(); ctx.moveTo(xCenter, y); ctx.lineTo(xCenter, y + h); ctx.stroke();
          ctx.fillStyle = 'rgba(255,61,90,0.9)';
          ctx.fillText(fmt(b.bidVol), xCenter + halfBar / 2, y + h / 2 + FONT_SIZE / 3);
        } else if (!showText) {
          ctx.fillStyle = 'rgba(0,255,136,0.55)';
          ctx.fillRect(xCenter - halfBar, y + 1, (b.askVol / maxVol) * halfBar, h - 2);
          ctx.fillStyle = 'rgba(255,61,90,0.55)';
          ctx.fillRect(xCenter, y + 1, (b.bidVol / maxVol) * halfBar, h - 2);
        }
      });
    }
  }

  // ── Abonnements de redessins ──────────────────────────────

  #subscribeRedraws(candles) {
    if (this.#redrawSubs) return;
    this.#redrawSubs = true;

    const redraw = () => { if (this.#active) this.#draw(candles); };
    this.#chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    this.#chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    this.#chart.subscribeCrosshairMove(redraw);

    this.#resizeObs2 = new ResizeObserver(() => {
      if (this.#active) { this.#canvas.width = 0; this.#draw(candles); }
    });
    this.#resizeObs2.observe(this.#container);

    let raf = false;
    this.#mutObs = new MutationObserver(() => {
      if (raf || !this.#active) return;
      raf = true;
      requestAnimationFrame(() => { raf = false; this.#draw(candles); });
    });
    this.#mutObs.observe(this.#container, {
      attributes:      true,
      attributeFilter: ['style'],
      subtree:         true,
    });
  }

  #schedRedraw() {
    if (this.#redrawPending) return;
    this.#redrawPending = true;
    setTimeout(() => {
      this.#redrawPending = false;
      this.#container.dispatchEvent(new CustomEvent('crypview:fp:redraw', { bubbles: true }));
    }, RENDER_THROTTLE_MS);
  }

  // ── Helpers ───────────────────────────────────────────────

  #tickSize(price) {
    if (price >= 10000) return 10;
    if (price >= 1000)  return 1;
    if (price >= 100)   return 0.1;
    if (price >= 10)    return 0.01;
    if (price >= 1)     return 0.001;
    return 0.0001;
  }

  #ensureCanvas() {
    let c = document.getElementById('fp-canvas');
    if (!c) {
      c = document.createElement('canvas');
      c.id = 'fp-canvas';
      c.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:3;';
      this.#container.appendChild(c);
    }
    c.style.display = 'block';
    this.#canvas = c;
  }
}
