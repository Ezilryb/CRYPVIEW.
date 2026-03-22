// ============================================================
//  src/chart/ChartIndicators.js — CrypView V2
//  Moteur de gestion des 19 indicateurs techniques.
//
//  v2.9 : Web Worker pour les indicateurs lourds
//    Les calculs coûteux (Ichimoku, ADX, SuperTrend, MACD) sont
//    déportés dans src/workers/indicators.worker.js afin de ne
//    jamais bloquer le thread UI, même sur CPU lent ou mobile.
//
//  Architecture du worker :
//    - Initialisation paresseuse (premier indicateur lourd activé)
//    - Protocole requestId → réponse non-bloquante
//    - Les séries LW sont créées vides sur le main thread,
//      puis remplies dès que le worker répond
//    - Vérification d'activité à la réception pour ignorer les
//      réponses périmées (changement de TF / suppression pendant calcul)
//    - Fallback synchrone si l'API Worker n'est pas disponible
// ============================================================

import { LightweightCharts } from '../utils/lw.js';
import { IND_META, IND_PANEL_HEIGHT, COLORS, baseChartOptions } from '../config.js';
import {
  calcMA, calcHMA, calcVWAP,
  calcBB, calcATR, calcKeltner, calcSuperTrend,
  calcIchimoku,
  calcRSI, calcMACD, calcStoch, calcCCI,
  calcADX, calcWilliamsR, calcMFI, calcMom,
} from '../indicators/index.js';

// ── Indicateurs déportés vers le Web Worker ───────────────────
/** Clés d'indicateurs dont le calcul est délégué au Worker. */
const HEAVY_INDICATORS = new Set(['ichi', 'adx', 'st', 'macd']);

// ── Compteur pour les identifiants de requêtes ────────────────
let _reqCounter = 0;

export class ChartIndicators {
  #chart;
  #cSeries;
  #chartsCol;
  #state = new Map();

  #ichiCache = null;

  // ── Web Worker ────────────────────────────────────────────
  /** Instance unique du worker (initialisée à la demande). */
  #worker = null;
  /**
   * Map<requestId, key> — suivi des calculs en attente.
   * Utilise la clé pour retrouver l'état courant à la réception
   * (évite les références capturées périmées).
   */
  #pendingRequests = new Map();

  onStateChange = (_key, _active) => {};

  constructor(chart, cSeries, chartsCol) {
    this.#chart     = chart;
    this.#cSeries   = cSeries;
    this.#chartsCol = chartsCol;
  }

  // ── API publique ──────────────────────────────────────────

  add(key, candles, hooks = {}) {
    const meta = IND_META[key];
    if (!meta || this.isActive(key)) return;

    const ind = { active: true, s: {}, subChart: null, panel: null };
    this.#state.set(key, ind);

    if (key === 'fp') {
      hooks.onActivateFP?.();
    } else if (meta.overlay) {
      this.#mountOverlay(key, ind);
      this.#applyDataDispatch(key, ind, candles);
    } else {
      this.#mountPanel(key, ind, candles, hooks);
      this.#applyDataDispatch(key, ind, candles);
    }
    this.onStateChange(key, true);
  }

  remove(key, hooks = {}) {
    const ind = this.#state.get(key);
    if (!ind?.active) return;
    ind.active = false;
    const meta = IND_META[key];

    if (key === 'ichi') this.#ichiCache = null;

    if (key === 'fp') {
      hooks.onDeactivateFP?.();
    } else if (key === 'of') {
      hooks.onDeactivateOF?.();
      this.#destroyPanel(ind);
    } else if (meta?.overlay) {
      this.#unmountOverlay(key, ind);
    } else {
      this.#destroyPanel(ind);
    }
    ind.s = {};
    this.onStateChange(key, false);
  }

  removeAll(hooks = {}) {
    for (const key of [...this.#state.keys()]) this.remove(key, hooks);
  }

  refresh(candles) {
    if (!candles.length) return;
    for (const [key, ind] of this.#state) {
      if (ind.active && key !== 'fp' && key !== 'vp' && key !== 'of') {
        this.#applyDataDispatch(key, ind, candles);
      }
    }
    this.#refreshBoundaryLines(candles);
  }

  isActive(key)    { return this.#state.get(key)?.active === true; }
  getState(key)    { return this.#state.get(key); }
  getActiveKeys()  { return [...this.#state.entries()].filter(([,v]) => v.active).map(([k]) => k); }

  destroy() {
    this.#ichiCache = null;

    for (const [key, ind] of this.#state) {
      if (!ind.active) continue;
      const meta = IND_META[key];
      if (key === 'fp') continue;
      if (meta?.overlay) {
        if (key !== 'vp') {
          try { Object.values(ind.s).forEach(s => this.#chart?.removeSeries(s)); } catch (_) {}
        }
      } else {
        this.#destroyPanel(ind);
      }
    }
    this.#state.clear();
    this.#pendingRequests.clear();

    // Termine le worker proprement
    if (this.#worker) {
      this.#worker.terminate();
      this.#worker = null;
    }
  }

  // ── Routage calcul : léger (main thread) vs lourd (worker) ─

  /**
   * Choisit entre calcul synchrone (indicateurs légers) et
   * calcul asynchrone via Worker (indicateurs lourds).
   * @param {string}   key
   * @param {IndState} ind
   * @param {Candle[]} candles
   */
  #applyDataDispatch(key, ind, candles) {
    if (!candles.length) return;

    if (HEAVY_INDICATORS.has(key)) {
      this.#applyDataViaWorker(key, ind, candles);
    } else {
      this.#applyData(key, ind, candles);
    }
  }

  // ── Web Worker — cycle de vie ─────────────────────────────

  /**
   * Initialise le Worker de manière paresseuse (au premier besoin).
   * Retourne null si l'API Worker n'est pas disponible (fallback sync).
   * @returns {Worker|null}
   */
  #initWorker() {
    if (this.#worker) return this.#worker;
    if (typeof Worker === 'undefined') return null;

    try {
      this.#worker = new Worker(
        new URL('../workers/indicators.worker.js', import.meta.url),
        { type: 'module' }
      );
      this.#worker.onmessage  = ({ data }) => this.#handleWorkerMessage(data);
      this.#worker.onerror    = (err) => {
        console.warn('[ChartIndicators] Worker error — retour sync :', err.message);
        // En cas d'erreur critique, on détruit le worker pour forcer le fallback
        this.#worker?.terminate();
        this.#worker = null;
        this.#pendingRequests.clear();
      };
    } catch (_) {
      // Environnement sans support Worker (ex: test unitaire)
      this.#worker = null;
    }

    return this.#worker;
  }

  /**
   * Envoie un calcul lourd au Worker.
   * Si le Worker n'est pas disponible, fallback synchrone transparent.
   * @param {string}   key
   * @param {IndState} ind
   * @param {Candle[]} candles
   */
  #applyDataViaWorker(key, ind, candles) {
    const worker = this.#initWorker();

    // Fallback synchrone si Worker indisponible
    if (!worker) {
      this.#applyData(key, ind, candles);
      return;
    }

    const requestId = `${key}_${++_reqCounter}`;
    this.#pendingRequests.set(requestId, key);
    worker.postMessage({ requestId, key, candles });
  }

  /**
   * Reçoit la réponse du Worker et applique les données sur le main thread.
   * @param {{ requestId: string, key: string, result?: object, error?: string }} msg
   */
  #handleWorkerMessage({ requestId, key, result, error }) {
    if (!this.#pendingRequests.has(requestId)) return;
    this.#pendingRequests.delete(requestId);

    if (error) {
      console.warn(`[ChartIndicators] Worker — erreur calcul "${key}" :`, error);
      return;
    }

    // Vérifie que l'indicateur est toujours actif (il peut avoir été supprimé
    // pendant le calcul, ex : changement de TF ou clic "Tout retirer").
    const ind = this.#state.get(key);
    if (!ind?.active) return;

    this.#applyWorkerResult(key, ind, result);
  }

  /**
   * Applique les données calculées par le Worker aux séries LightweightCharts.
   * Appelé exclusivement sur le main thread.
   * @param {string}   key
   * @param {IndState} ind
   * @param {object}   result
   */
  #applyWorkerResult(key, ind, result) {
    try {
      switch (key) {
        case 'ichi': {
          // Mise à jour du cache pour cohérence avec les paths sync
          const lastCandle = [...this.#state.get('ichi')?.lastCandles ?? []].at?.(-1);
          try {
            ind.s.tenkan.setData(result.tenkan);
            ind.s.kijun.setData(result.kijun);
            ind.s.senkouA.setData(result.senkouA);
            ind.s.senkouB.setData(result.senkouB);
            ind.s.chikou.setData(result.chikou);
          } catch (_) {}
          break;
        }
        case 'adx':
          try {
            ind.s.adx.setData(result.adx);
            ind.s.diP.setData(result.diP);
            ind.s.diN.setData(result.diN);
          } catch (_) {}
          break;

        case 'st':
          try {
            ind.s.trend.setData(result.trend.filter(x => x.value != null));
          } catch (_) {}
          break;

        case 'macd':
          try {
            ind.s.hist.setData(result.hist);
            ind.s.macd.setData(result.macd);
            ind.s.signal.setData(result.signal);
          } catch (_) {}
          break;
      }
    } catch (_) {}
  }

  // ── Montage des séries (overlay / panneau) ────────────────

  #mountOverlay(key, ind) {
    const C = this.#chart;
    switch (key) {
      case 'ma':
        ind.s.ma20  = C.addLineSeries({ color:'#f7c948', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        ind.s.ma50  = C.addLineSeries({ color:'#ff9900', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        ind.s.ma200 = C.addLineSeries({ color:'#ff3d5a', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        break;
      case 'bb':
        ind.s.mid   = C.addLineSeries({ color:'#7c6fff',               lineWidth:1.5, priceLineVisible:false, lastValueVisible:false });
        ind.s.upper = C.addLineSeries({ color:'rgba(124,111,255,.45)', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });
        ind.s.lower = C.addLineSeries({ color:'rgba(124,111,255,.45)', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });
        break;
      case 'vwap': ind.s.vwap  = C.addLineSeries({ color:'#00ffcc', lineWidth:1.5, priceLineVisible:false, lastValueVisible:true });  break;
      case 'hma':  ind.s.hma   = C.addLineSeries({ color:'#ff6eb4', lineWidth:2,   priceLineVisible:false, lastValueVisible:false }); break;
      case 'ichi':
        ind.s.tenkan  = C.addLineSeries({ color:'#e04040',              lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        ind.s.kijun   = C.addLineSeries({ color:'#4080e0',              lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        ind.s.senkouA = C.addLineSeries({ color:'rgba(0,255,136,.35)',  lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        ind.s.senkouB = C.addLineSeries({ color:'rgba(255,61,90,.35)',  lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        ind.s.chikou  = C.addLineSeries({ color:'rgba(255,200,0,.7)',   lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        break;
      case 'kelt':
        ind.s.mid   = C.addLineSeries({ color:'#ff9900',               lineWidth:1.5, priceLineVisible:false, lastValueVisible:false });
        ind.s.upper = C.addLineSeries({ color:'rgba(255,153,0,.45)',   lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });
        ind.s.lower = C.addLineSeries({ color:'rgba(255,153,0,.45)',   lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });
        break;
      case 'st':
        ind.s.trend = C.addLineSeries({ lineWidth:2, priceLineVisible:false, lastValueVisible:true });
        break;
    }
  }

  #unmountOverlay(key, ind) {
    try { Object.values(ind.s).forEach(s => this.#chart.removeSeries(s)); } catch (_) {}
  }

  #mountPanel(key, ind, candles, hooks) {
    const panel     = document.createElement('div');
    panel.className = 'ind-panel';
    panel.style.height = `${IND_PANEL_HEIGHT}px`;
    this.#chartsCol?.appendChild(panel);
    ind.panel = panel;

    const subOpts  = baseChartOptions(panel);
    subOpts.height = IND_PANEL_HEIGHT;
    subOpts.rightPriceScale.scaleMargins = { top: 0.1, bottom: 0.1 };
    const ch = LightweightCharts.createChart(panel, subOpts);
    ind.subChart = ch;

    switch (key) {
      case 'rsi':
        ind.s.rsi = ch.addLineSeries({ color:'#c678dd', lineWidth:1.5, priceLineVisible:false, lastValueVisible:true });
        ind.s.ob  = ch.addLineSeries({ color:'rgba(255,61,90,.4)',  lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });
        ind.s.os  = ch.addLineSeries({ color:'rgba(0,255,136,.4)', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });
        ch.priceScale('right').applyOptions({ autoScale:false, minimum:0, maximum:100 });
        break;
      case 'macd':
        ind.s.hist   = ch.addHistogramSeries({ priceScaleId:'right', priceLineVisible:false, lastValueVisible:false });
        ind.s.macd   = ch.addLineSeries({ color:'#00c8ff', lineWidth:1.5, priceLineVisible:false, lastValueVisible:true });
        ind.s.signal = ch.addLineSeries({ color:'#ff6eb4', lineWidth:1,   priceLineVisible:false, lastValueVisible:true });
        break;
      case 'stoch':
        ind.s.k = ch.addLineSeries({ color:'#00c8ff', lineWidth:1.5, priceLineVisible:false, lastValueVisible:true });
        ind.s.d = ch.addLineSeries({ color:'#ff6eb4', lineWidth:1,   priceLineVisible:false, lastValueVisible:true });
        ch.priceScale('right').applyOptions({ autoScale:false, minimum:0, maximum:100 });
        break;
      case 'cci':
        ind.s.cci = ch.addLineSeries({ color:'#f7c948', lineWidth:1.5, priceLineVisible:false, lastValueVisible:true });
        ind.s.ob  = ch.addLineSeries({ color:'rgba(255,61,90,.4)',  lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });
        ind.s.os  = ch.addLineSeries({ color:'rgba(0,255,136,.4)', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });
        break;
      case 'adx':
        ind.s.adx = ch.addLineSeries({ color:'#00c8ff', lineWidth:1.5, priceLineVisible:false, lastValueVisible:true });
        ind.s.diP = ch.addLineSeries({ color:'#00ff88', lineWidth:1,   priceLineVisible:false, lastValueVisible:false });
        ind.s.diN = ch.addLineSeries({ color:'#ff3d5a', lineWidth:1,   priceLineVisible:false, lastValueVisible:false });
        break;
      case 'willr':
        ind.s.willr = ch.addLineSeries({ color:'#b0ff5c', lineWidth:1.5, priceLineVisible:false, lastValueVisible:true });
        ch.priceScale('right').applyOptions({ autoScale:false, minimum:-100, maximum:0 });
        break;
      case 'mfi':
        ind.s.mfi = ch.addLineSeries({ color:'#ff5c5c', lineWidth:1.5, priceLineVisible:false, lastValueVisible:true });
        ch.priceScale('right').applyOptions({ autoScale:false, minimum:0, maximum:100 });
        break;
      case 'atr':
        ind.s.atr = ch.addLineSeries({ color:'#00e5cc', lineWidth:1.5, priceLineVisible:false, lastValueVisible:true });
        break;
      case 'mom':
        ind.s.mom = ch.addHistogramSeries({ priceScaleId:'right', priceLineVisible:false, lastValueVisible:false });
        break;
      case 'of':
        ind.s.deltaHist = ch.addHistogramSeries({ priceScaleId:'right', priceLineVisible:false, lastValueVisible:false, base:0 });
        ind.s.cvdLine   = ch.addLineSeries({ color:'#ff9f43', lineWidth:1.5, priceLineVisible:false, lastValueVisible:true, priceScaleId:'cvd' });
        ch.priceScale('cvd').applyOptions({ position:'left', visible:true, borderColor:COLORS.GRID, scaleMargins:{top:.05,bottom:.05} });
        ch.priceScale('right').applyOptions({ scaleMargins:{top:.05,bottom:.05} });
        if (candles.length) {
          const t0 = candles[0].time, t1 = candles.at(-1).time;
          const zero = ch.addLineSeries({ color:'rgba(255,255,255,.12)', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false, priceScaleId:'right' });
          try { zero.setData([{time:t0,value:0},{time:t1,value:0}]); } catch(_) {}
          ind.s.zeroLine = zero;
        }
        hooks.onActivateOF?.();
        break;
    }
  }

  #destroyPanel(ind) {
    if (ind.subChart) { try { ind.subChart.remove(); } catch (_) {} ind.subChart = null; }
    if (ind.panel)    { ind.panel.remove(); ind.panel = null; }
  }

  // ── Calcul synchrone (indicateurs légers — main thread) ──

  #applyData(key, ind, candles) {
    if (!candles.length) return;
    try {
      switch (key) {
        case 'ma':   { const d=calcMA(candles);        ind.s.ma20.setData(d.ma20); ind.s.ma50.setData(d.ma50); ind.s.ma200.setData(d.ma200); break; }
        case 'bb':   { const d=calcBB(candles);        ind.s.mid.setData(d.mid); ind.s.upper.setData(d.upper); ind.s.lower.setData(d.lower); break; }
        case 'vwap':                                    ind.s.vwap.setData(calcVWAP(candles)); break;
        case 'hma':                                     ind.s.hma.setData(calcHMA(candles)); break;
        case 'ichi': {
          // Chemin de secours (fallback sync) — normalement géré par le worker.
          const lastTime = candles.at(-1).time;
          if (this.#ichiCache?.lastCandleTime !== lastTime) {
            this.#ichiCache = { lastCandleTime: lastTime, data: calcIchimoku(candles) };
          }
          const d = this.#ichiCache.data;
          try {
            ind.s.tenkan.setData(d.tenkan);
            ind.s.kijun.setData(d.kijun);
            ind.s.senkouA.setData(d.senkouA);
            ind.s.senkouB.setData(d.senkouB);
            ind.s.chikou.setData(d.chikou);
          } catch(_) {}
          break;
        }
        case 'kelt': { const d=calcKeltner(candles);   ind.s.mid.setData(d.mid); ind.s.upper.setData(d.upper); ind.s.lower.setData(d.lower); break; }
        case 'st':   { const d=calcSuperTrend(candles); try{ind.s.trend.setData(d.trend.filter(x=>x.value!=null));}catch(_){} break; }
        case 'rsi':                                     ind.s.rsi.setData(calcRSI(candles)); break;
        case 'macd': { const d=calcMACD(candles);      ind.s.hist.setData(d.hist); ind.s.macd.setData(d.macd); ind.s.signal.setData(d.signal); break; }
        case 'stoch':{ const d=calcStoch(candles);     ind.s.k.setData(d.k); ind.s.d.setData(d.d); break; }
        case 'cci':                                     ind.s.cci.setData(calcCCI(candles)); break;
        case 'adx':  { const d=calcADX(candles); try{ind.s.adx.setData(d.adx);ind.s.diP.setData(d.diP);ind.s.diN.setData(d.diN);}catch(_){} break; }
        case 'willr':                                   ind.s.willr.setData(calcWilliamsR(candles)); break;
        case 'mfi':                                     ind.s.mfi.setData(calcMFI(candles)); break;
        case 'atr':                                     ind.s.atr.setData(calcATR(candles)); break;
        case 'mom':                                     ind.s.mom.setData(calcMom(candles)); break;
      }
    } catch (_) {}
  }

  #refreshBoundaryLines(candles) {
    const t0 = candles[0].time, t1 = candles.at(-1).time;
    const rsi = this.#state.get('rsi');
    if (rsi?.active) {
      try { rsi.s.ob?.setData([{time:t0,value:70},{time:t1,value:70}]); } catch(_){}
      try { rsi.s.os?.setData([{time:t0,value:30},{time:t1,value:30}]); } catch(_){}
    }
    const cci = this.#state.get('cci');
    if (cci?.active) {
      try { cci.s.ob?.setData([{time:t0,value:100},{time:t1,value:100}]);  } catch(_){}
      try { cci.s.os?.setData([{time:t0,value:-100},{time:t1,value:-100}]); } catch(_){}
    }
  }
}
