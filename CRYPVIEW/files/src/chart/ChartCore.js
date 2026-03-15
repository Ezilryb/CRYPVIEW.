// ============================================================
//  src/chart/ChartCore.js — CrypView V2.1.4 (FINAL)
//
//  Corrections (ligne plate / chandelles fantômes) :
//
//  [Fix 1] Flag #historyLoaded
//    Bloque tout appel à cSeries.update() tant que setData() n'a
//    pas terminé. Sans ce garde, un WS qui se reconnecte très vite
//    peut appeler update() AVANT setData(), ce qui insère un seul
//    doji "flottant" suivi d'une ligne plate — LightweightCharts
//    rejette ensuite silencieusement les updates dont le timestamp
//    est antérieur au doji.
//
//  [Fix 2] Destroy des streams AVANT await #loadHistory()
//    Empêche l'ancien stream (ex: BTCUSDT) d'envoyer des messages
//    pendant le chargement REST du nouveau symbole (ex: ETHUSDT).
//
//  [Fix 3] Garde k.s / k.i dans onMessage
//    Rejette les messages WS périmés (ancien symbole ou ancien TF).
//
//  [Fix 4] Préfixe CustomEvent corrigé : crypview: (pas chart:)
//    Sans ce fix, page.js n'écoutait pas les events → hideOverlay()
//    jamais appelé → overlay "⏳ Chargement…" permanent.
//
//  [Supprimé] #wsKlineConnectCount / reload on reconnect
//    Ce mécanisme appelait #loadHistory() sans await pendant que le
//    WS envoyait déjà des messages → setData() écrasait les updates
//    WS à mi-vol → ligne plate. Supprimé au profit du flag [Fix 1].
// ============================================================

import { COLORS, MAX_CANDLES_IN_MEMORY, baseChartOptions, TF_API_MAP } from '../config.js';
import { fetchKlines, parseKlines }           from '../api/binance.rest.js';
import { createKlineStream, createTickerStream, createTradeStream } from '../api/binance.ws.js';
import { showToast }                          from '../utils/toast.js';
import { fmtPrice, fmtTime }                  from '../utils/format.js';

export class TradingChart {

  // ── État public ───────────────────────────────────────────
  symbol;
  timeframe;
  candles = [];

  // ── LightweightCharts ────────────────────────────────────
  chart   = null;
  cSeries = null;
  vSeries = null;

  // ── WebSockets ───────────────────────────────────────────
  #wsKline  = null;
  #wsTicker = null;
  #wsTrades = null;

  // ── Divers ────────────────────────────────────────────────
  #container      = null;
  #resizeObserver = null;
  #lastPrice      = null;
  #open24         = null;

  /**
   * [Fix 1] Verrou setData / update.
   * false → #loadHistory() en cours, on ignore les messages WS.
   * true  → setData() terminé, les update() sont autorisés.
   */
  #historyLoaded = false;

  constructor(container, symbol, timeframe) {
    this.#container = container;
    this.symbol     = symbol.toLowerCase();
    this.timeframe  = timeframe;
    this.#initChart();
  }

  // ══════════════════════════════════════════════════════════
  //  API PUBLIQUE
  // ══════════════════════════════════════════════════════════

  async start() {
    this.#emit('status', { state: 'loading', symbol: this.symbol, timeframe: this.timeframe });
    await this.#loadHistory();       // setData() → #historyLoaded = true
    this.#connectKlineStream();      // maintenant seulement on ouvre le WS
    this.#connectTickerStream();
    this.#connectTradeStream();
  }

  /**
   * Change le symbole.
   * [Fix 2] : streams détruits AVANT le await pour stopper
   * immédiatement les messages de l'ancien symbole.
   */
  async changeSymbol(newSymbol) {
    this.#destroyAllStreams();        // [Fix 2] — avant le await
    this.symbol     = newSymbol.toLowerCase();
    this.candles    = [];
    this.#lastPrice = null;
    this.#open24    = null;
    await this.start();
  }

  /**
   * Change le timeframe.
   * [Fix 2] : le stream kline est détruit avant le await.
   */
  async changeTimeframe(newTf) {
    this.#wsKline?.destroy();        // [Fix 2] — avant le await
    this.#wsKline  = null;
    this.timeframe = newTf;
    this.candles   = [];
    await this.#loadHistory();
    this.#connectKlineStream();
  }

  destroy() {
    this.#destroyAllStreams();
    this.#resizeObserver?.disconnect();
    try { this.chart?.remove(); } catch (_) {}
    this.chart   = null;
    this.cSeries = null;
    this.vSeries = null;
    this.candles = [];
  }

  // ══════════════════════════════════════════════════════════
  //  INITIALISATION
  // ══════════════════════════════════════════════════════════

  #initChart() {
    if (this.chart) { try { this.chart.remove(); } catch (_) {} }

    const opts = baseChartOptions(this.#container);
    opts.rightPriceScale.scaleMargins = { top: 0.08, bottom: 0.22 };
    this.chart = LightweightCharts.createChart(this.#container, opts);

    this.cSeries = this.chart.addCandlestickSeries({
      upColor:         COLORS.GREEN,
      downColor:       COLORS.RED,
      borderUpColor:   COLORS.GREEN,
      borderDownColor: COLORS.RED,
      wickUpColor:     COLORS.GREEN_MID,
      wickDownColor:   COLORS.RED_MID,
    });

    this.vSeries = this.chart.addHistogramSeries({
      priceFormat:  { type: 'volume' },
      priceScaleId: 'vol',
    });
    this.chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.83, bottom: 0 },
    });

    this.#resizeObserver = new ResizeObserver(() => {
      if (!this.chart) return;
      this.chart.applyOptions({
        width:  this.#container.clientWidth,
        height: this.#container.clientHeight,
      });
    });
    this.#resizeObserver.observe(this.#container);
  }

  // ══════════════════════════════════════════════════════════
  //  HISTORIQUE
  // ══════════════════════════════════════════════════════════

  async #loadHistory() {
    // [Fix 1] : verrouille les update() WS pendant tout le chargement
    this.#historyLoaded = false;

    try {
      const raw    = await fetchKlines(this.symbol, this.timeframe);
      this.candles = parseKlines(raw);

      this.cSeries.setData(this.candles.map((c) => ({
        time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
      })));
      this.vSeries.setData(this.candles.map((c) => ({
        time:  c.time,
        value: c.volume,
        color: c.close >= c.open ? COLORS.GREEN_ALPHA : COLORS.RED_ALPHA,
      })));

      this.#emit('history:loaded', { candles: this.candles });

    } catch (err) {
      const msg = location.protocol === 'file:'
        ? 'Erreur CORS — utilise un serveur local (http://localhost).'
        : `Historique indisponible : ${err.message}. Mode live seul.`;
      showToast(msg, 'error');
      this.candles = [];
    } finally {
      // [Fix 1] : déverrouille toujours, même en cas d'erreur REST,
      // pour que le WS puisse quand même alimenter le graphique.
      this.#historyLoaded = true;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  FLUX WEBSOCKET
  // ══════════════════════════════════════════════════════════

  #connectKlineStream() {
    this.#wsKline?.destroy();
    this.#wsKline = createKlineStream(this.symbol, this.timeframe);

    this.#wsKline.onOpen = () => {
      this.#emit('status', { state: 'live' });
    };

    this.#wsKline.onMessage = (data) => {
      const k = data.k;
      if (!k) return;

      // [Fix 1] : setData() pas encore terminé → on ignore
      if (!this.#historyLoaded) return;

      // [Fix 3] : message d'un ancien symbole ou ancien TF → on ignore
      // k.s = 'BTCUSDT' (majuscules Binance), this.symbol = 'btcusdt'
      if (k.s?.toLowerCase() !== this.symbol)  return;
      if (k.i                !== this.timeframe) return;

      const candle = {
        time:   Math.floor(k.t / 1000),
        open:   +k.o,
        high:   +k.h,
        low:    +k.l,
        close:  +k.c,
        volume: +k.v,
      };

      try {
        this.cSeries.update({
          time: candle.time, open: candle.open,
          high: candle.high, low: candle.low, close: candle.close,
        });
      } catch (_) {}

      try {
        this.vSeries.update({
          time:  candle.time,
          value: candle.volume,
          color: candle.close >= candle.open ? COLORS.GREEN_ALPHA : COLORS.RED_ALPHA,
        });
      } catch (_) {}

      this.#updateCandleBuffer(candle);

      if (k.x) {
        this.#emit('candle:closed', { candle, candles: this.candles });
      }

      this.#emit('price:update', { price: candle.close, open: candle.open });
      this.#updatePriceDisplay(candle.close);
    };

    this.#wsKline.onClose = () => {
      this.#emit('status', { state: 'reconnecting' });
    };

    this.#wsKline.connect();
  }

  #connectTickerStream() {
    this.#wsTicker?.destroy();
    this.#wsTicker = createTickerStream(this.symbol);

    this.#wsTicker.onMessage = (data) => {
      this.#open24 = +data.o;
      this.#emit('ticker:update', {
        open24:   +data.o,
        high24:   +data.h,
        low24:    +data.l,
        vol24:    +data.v,
        trades24: +data.n,
      });
      if (this.#lastPrice !== null) this.#updatePriceDisplay(this.#lastPrice);
    };

    this.#wsTicker.connect();
  }

  #connectTradeStream() {
    this.#wsTrades?.destroy();
    this.#wsTrades = createTradeStream(this.symbol);

    this.#wsTrades.onMessage = (data) => {
      this.#emit('trade:new', {
        price:         parseFloat(data.p),
        qty:           parseFloat(data.q),
        isBuy:         !data.m,
        time:          data.T,
        timeFormatted: fmtTime(data.T),
      });
    };

    this.#wsTrades.connect();
  }

  // ══════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════

  /** Détruit proprement les 3 streams. Appelé dans changeSymbol et destroy. */
  #destroyAllStreams() {
    this.#wsKline?.destroy();
    this.#wsTicker?.destroy();
    this.#wsTrades?.destroy();
    this.#wsKline  = null;
    this.#wsTicker = null;
    this.#wsTrades = null;
  }

  #updateCandleBuffer(candle) {
    if (this.candles.length && this.candles.at(-1).time === candle.time) {
      this.candles[this.candles.length - 1] = candle;
    } else {
      this.candles.push(candle);
      if (this.candles.length > MAX_CANDLES_IN_MEMORY) this.candles.shift();
    }
  }

  #updatePriceDisplay(price) {
    price = parseFloat(price);
    const prevPrice = this.#lastPrice;
    this.#lastPrice = price;

    const direction = prevPrice === null ? 'neutral'
      : price > prevPrice ? 'up'
      : price < prevPrice ? 'down'
      : 'neutral';

    let pctChange = null;
    if (this.#open24) {
      pctChange = (price - this.#open24) / this.#open24 * 100;
    }

    this.#emit('price:display', {
      price,
      priceFormatted: fmtPrice(price),
      direction,
      pctChange,
      pctFormatted: pctChange !== null
        ? (pctChange >= 0 ? '+' : '') + pctChange.toFixed(2) + '%'
        : null,
    });
  }

  /**
   * [Fix 4] Préfixe correct : crypview: (était chart: dans le patch précédent).
   * page.js écoute 'crypview:status' → hideOverlay() → overlay disparaît.
   */
  #emit(name, detail = {}) {
    this.#container?.dispatchEvent(
      new CustomEvent(`crypview:${name}`, { bubbles: true, detail })
    );
  }
}
