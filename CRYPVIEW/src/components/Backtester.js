// ============================================================
//  src/features/Backtester.js — CrypView V3.5
//  Moteur de Backtesting — ajout simulation slippage & frais.
//
//  Nouveaux paramètres dans BacktestConfig :
//    slippagePct    — glissement marché en % (ex: 0.05 = 0.05%)
//    takerFeePct    — frais taker en % (ex: 0.1 = 0.1%)
//    makerFeePct    — frais maker en % (ex: 0.02 = 0.02%)
//    useMarketOrder — true = taker fee + slippage ; false = maker fee
//    marketImpact   — true = slippage croît avec la taille du trade
//    capital        — capital total du compte (pour sizing)
// ============================================================

import { calcRSI, calcMACD, calcMom } from '../indicators/oscillators.js';
import { calcMA, calcVWAP, calcBB }   from '../indicators/index.js';

export const SIGNAL_TYPES = [
  { id: 'rsi_below',         label: 'RSI ≤ seuil (survente)',      hasValue: true,  defaultValue: 30 },
  { id: 'rsi_above',         label: 'RSI ≥ seuil (surachat)',      hasValue: true,  defaultValue: 70 },
  { id: 'macd_cross_up',     label: 'Croisement MACD ↑ (bullish)', hasValue: false, defaultValue: null },
  { id: 'macd_cross_down',   label: 'Croisement MACD ↓ (bearish)', hasValue: false, defaultValue: null },
  { id: 'ma_cross_up',       label: 'Golden Cross (MA20 > MA50)',   hasValue: false, defaultValue: null },
  { id: 'ma_cross_down',     label: 'Death Cross (MA20 < MA50)',    hasValue: false, defaultValue: null },
  { id: 'price_above_vwap',  label: 'Prix au-dessus du VWAP',      hasValue: false, defaultValue: null },
  { id: 'price_below_vwap',  label: 'Prix en-dessous du VWAP',     hasValue: false, defaultValue: null },
  { id: 'bb_breakout_up',    label: 'Breakout Bollinger haut',     hasValue: false, defaultValue: null },
  { id: 'bb_breakout_down',  label: 'Breakout Bollinger bas',      hasValue: false, defaultValue: null },
  { id: 'momentum_positive', label: 'Momentum positif',            hasValue: false, defaultValue: null },
  { id: 'momentum_negative', label: 'Momentum négatif',            hasValue: false, defaultValue: null },
];

/**
 * @typedef {object} BacktestConfig
 * @property {string}   side             — 'long' | 'short'
 * @property {object[]} entryConditions
 * @property {object[]} exitConditions
 * @property {'AND'|'OR'} entryLogic
 * @property {'AND'|'OR'} exitLogic
 * @property {number}   stopLossPct       — % depuis entrée (0 = off)
 * @property {number}   takeProfitPct     — % depuis entrée (0 = off)
 * @property {number}   capitalPct        — % du capital par trade
 * @property {number}   initialBalance
 * @property {number}   [slippagePct]     — glissement en % (0.05 = 0.05%)
 * @property {number}   [takerFeePct]     — frais taker en % (0.1 = 0.1%)
 * @property {number}   [makerFeePct]     — frais maker en % (0.02 = 0.02%)
 * @property {boolean}  [useMarketOrder]  — true = taker+slippage, false = maker
 * @property {boolean}  [marketImpact]    — true = slippage proportionnel à la taille
 * @property {number}   [maxSlippagePct]  — plafond de slippage (ex: 0.5%)
 */

export class Backtester {
  /**
   * @param {Candle[]}       candles
   * @param {BacktestConfig} config
   * @returns {BacktestResult}
   */
  static run(candles, config) {
    if (candles.length < 60) {
      return { trades: [], equity: [], metrics: { error: 'Historique insuffisant (min. 60 bougies).' }, slippageStats: null };
    }

    const cfg = Backtester.#normalizeConfig(config);
    const indicators = Backtester.#buildIndicatorCache(candles);

    const trades   = [];
    const equity   = [];
    let   balance  = cfg.initialBalance;
    let   openTrade = null;

    // Statistiques de slippage cumulées
    const slippageStats = { totalSlippageCost: 0, totalFeeCost: 0, trades: 0, avgSlippagePct: 0 };

    for (let i = 1; i < candles.length; i++) {
      const c    = candles[i];
      const prev = candles[i - 1];
      const ind  = indicators[i];
      const indP = indicators[i - 1];

      if (openTrade) {
        const currentPnl = cfg.side === 'long'
          ? (c.close - openTrade.entry) * openTrade.qty
          : (openTrade.entry - c.close) * openTrade.qty;
        openTrade.unrealized = currentPnl;

        // Stop-Loss
        if (cfg.stopLossPct > 0) {
          const sl  = cfg.side === 'long'
            ? openTrade.entry * (1 - cfg.stopLossPct / 100)
            : openTrade.entry * (1 + cfg.stopLossPct / 100);
          const hit = cfg.side === 'long' ? c.low <= sl : c.high >= sl;
          if (hit) {
            // Prix d'exécution avec slippage adverse sur SL
            const execPrice = Backtester.#applySlippage(sl, cfg, openTrade.notional, true);
            const result    = Backtester.#closeTrade(openTrade, execPrice, 'sl', balance, trades, cfg);
            balance                       = result.balance;
            slippageStats.totalSlippageCost += result.slippageCost;
            slippageStats.totalFeeCost      += result.feeCost;
            slippageStats.trades++;
            openTrade = null;
            equity.push({ time: c.time, value: balance });
            continue;
          }
        }

        // Take-Profit
        if (cfg.takeProfitPct > 0) {
          const tp  = cfg.side === 'long'
            ? openTrade.entry * (1 + cfg.takeProfitPct / 100)
            : openTrade.entry * (1 - cfg.takeProfitPct / 100);
          const hit = cfg.side === 'long' ? c.high >= tp : c.low <= tp;
          if (hit) {
            const execPrice = Backtester.#applySlippage(tp, cfg, openTrade.notional, false);
            const result    = Backtester.#closeTrade(openTrade, execPrice, 'tp', balance, trades, cfg);
            balance                       = result.balance;
            slippageStats.totalSlippageCost += result.slippageCost;
            slippageStats.totalFeeCost      += result.feeCost;
            slippageStats.trades++;
            openTrade = null;
            equity.push({ time: c.time, value: balance });
            continue;
          }
        }
      }

      // Signal d'entrée
      if (!openTrade) {
        const entry = Backtester.#evalConditions(cfg.entryConditions, cfg.entryLogic, c, prev, ind, indP);
        if (entry) {
          const notional   = balance * (cfg.capitalPct / 100);
          const execPrice  = Backtester.#applySlippage(c.close, cfg, notional, cfg.side !== 'long');
          const feePct     = cfg.useMarketOrder ? cfg.takerFeePct / 100 : cfg.makerFeePct / 100;
          const fee        = notional * feePct;
          const qty        = (notional - fee) / execPrice;

          const slippageCostEntry = Math.abs(execPrice - c.close) * qty;
          slippageStats.totalSlippageCost += slippageCostEntry;
          slippageStats.totalFeeCost      += fee;
          slippageStats.trades++;

          balance  -= (notional + fee);
          openTrade = { id: `bt_${i}`, time: c.time, entry: execPrice, rawEntry: c.close, qty, notional, fee, unrealized: 0 };
        }
      }
      // Signal de sortie
      else {
        const exit = Backtester.#evalConditions(cfg.exitConditions, cfg.exitLogic, c, prev, ind, indP);
        if (exit) {
          const execPrice = Backtester.#applySlippage(c.close, cfg, openTrade.notional, cfg.side === 'long');
          const result    = Backtester.#closeTrade(openTrade, execPrice, 'close', balance, trades, cfg);
          balance                       = result.balance;
          slippageStats.totalSlippageCost += result.slippageCost;
          slippageStats.totalFeeCost      += result.feeCost;
          slippageStats.trades++;
          openTrade = null;
        }
      }

      equity.push({ time: c.time, value: balance + (openTrade?.unrealized ?? 0) });
    }

    // Fermeture finale
    if (openTrade) {
      const last      = candles.at(-1);
      const execPrice = Backtester.#applySlippage(last.close, cfg, openTrade.notional, cfg.side === 'long');
      const result    = Backtester.#closeTrade(openTrade, execPrice, 'close', balance, trades, cfg);
      balance = result.balance;
      slippageStats.totalSlippageCost += result.slippageCost;
      slippageStats.totalFeeCost      += result.feeCost;
      equity.push({ time: last.time, value: balance });
    }

    // Stat moyenne slippage
    if (slippageStats.trades > 0) {
      slippageStats.avgSlippagePct = parseFloat(
        ((slippageStats.totalSlippageCost / (cfg.initialBalance || 1)) * 100).toFixed(4)
      );
    }

    return {
      trades,
      equity,
      slippageStats: {
        totalSlippageCost: parseFloat(slippageStats.totalSlippageCost.toFixed(4)),
        totalFeeCost:      parseFloat(slippageStats.totalFeeCost.toFixed(4)),
        totalCost:         parseFloat((slippageStats.totalSlippageCost + slippageStats.totalFeeCost).toFixed(4)),
        avgSlippagePct:    slippageStats.avgSlippagePct,
        trades:            slippageStats.trades,
        impactOnPnl:       parseFloat(
          ((slippageStats.totalSlippageCost + slippageStats.totalFeeCost) /
            (cfg.initialBalance || 1) * 100).toFixed(3)
        ),
      },
      metrics: Backtester.#calcMetrics(trades, equity, cfg.initialBalance),
    };
  }

  // ── Normalisation config ──────────────────────────────────

  static #normalizeConfig(config) {
    return {
      ...config,
      slippagePct:    config.slippagePct    ?? 0.05,
      takerFeePct:    config.takerFeePct    ?? 0.10,
      makerFeePct:    config.makerFeePct    ?? 0.02,
      useMarketOrder: config.useMarketOrder ?? true,
      marketImpact:   config.marketImpact   ?? false,
      maxSlippagePct: config.maxSlippagePct ?? 0.50,
    };
  }

  // ── Calcul du prix d'exécution avec slippage ──────────────

  /**
   * @param {number}  price        — prix théorique
   * @param {object}  cfg          — config normalisée
   * @param {number}  notional     — montant USDT du trade
   * @param {boolean} isBuying     — true = on achète (prix monte)
   * @returns {number} prix effectif d'exécution
   */
  static #applySlippage(price, cfg, notional, isBuying) {
    let slipPct = cfg.slippagePct / 100;

    // Market impact : slippage croît avec la taille du trade
    if (cfg.marketImpact) {
      // Modèle simplifié : impact = sqrt(notional / 100_000) * slippage_base
      const impactMultiplier = Math.sqrt(Math.max(1, notional) / 100_000);
      slipPct = Math.min(cfg.maxSlippagePct / 100, slipPct * (1 + impactMultiplier));
    }

    // Slippage adverse : on achète plus cher, on vend moins cher
    return isBuying
      ? price * (1 + slipPct)
      : price * (1 - slipPct);
  }

  // ── Clôture de trade ──────────────────────────────────────

  static #closeTrade(open, closePrice, reason, balance, trades, cfg) {
    const isLong     = cfg.side !== 'short';
    const pnlGross   = open.qty * (isLong
      ? (closePrice - open.entry)
      : (open.entry - closePrice));

    const feePct     = cfg.useMarketOrder ? cfg.takerFeePct / 100 : cfg.makerFeePct / 100;
    const closeFee   = open.qty * closePrice * feePct;

    const slippageCost = Math.abs(closePrice - (isLong
      ? closePrice / (1 - cfg.slippagePct / 100)
      : closePrice / (1 + cfg.slippagePct / 100))) * open.qty;

    const recv     = open.qty * open.entry + pnlGross - closeFee;
    const newBal   = balance + recv;
    const pnlNet   = pnlGross - closeFee;
    const totalFee = open.fee + closeFee;

    trades.push({
      id:         open.id,
      entryTime:  open.time,
      exitTime:   Date.now(),
      entry:      open.rawEntry ?? open.entry,
      entryExec:  open.entry,
      exit:       closePrice,
      qty:        open.qty,
      pnl:        parseFloat(pnlNet.toFixed(4)),
      pnlGross:   parseFloat(pnlGross.toFixed(4)),
      pnlPct:     parseFloat((pnlNet / (open.qty * open.entry) * 100).toFixed(2)),
      fee:        parseFloat(totalFee.toFixed(4)),
      slippage:   parseFloat(slippageCost.toFixed(4)),
      totalCost:  parseFloat((totalFee + slippageCost).toFixed(4)),
      reason,
    });

    return {
      balance:      parseFloat(newBal.toFixed(4)),
      feeCost:      closeFee,
      slippageCost: slippageCost,
    };
  }

  // ── Cache indicateurs ─────────────────────────────────────

  static #buildIndicatorCache(candles) {
    const n     = candles.length;
    const cache = new Array(n).fill(null).map(() => ({}));
    const timeToIdx = new Map(candles.map((c, i) => [Number(c.time), i]));
    const byTime    = pt => timeToIdx.get(Number(pt.time)) ?? -1;

    try { calcRSI(candles, 14).forEach(pt => { const i = byTime(pt); if (i >= 0) cache[i].rsi = pt.value; }); } catch (_) {}
    try {
      const { macd, signal } = calcMACD(candles);
      macd.forEach((pt, k) => { const i = byTime(pt); if (i >= 0) { cache[i].macd = pt.value; cache[i].signal = signal[k]?.value; } });
    } catch (_) {}
    try {
      const { ma20, ma50 } = calcMA(candles);
      ma20.forEach(pt => { const i = byTime(pt); if (i >= 0) cache[i].ma20 = pt.value; });
      ma50.forEach(pt => { const i = byTime(pt); if (i >= 0) cache[i].ma50 = pt.value; });
    } catch (_) {}
    try { calcVWAP(candles).forEach((pt, k) => { if (k < n) cache[k].vwap = pt.value; }); } catch (_) {}
    try {
      const { upper, lower } = calcBB(candles, 20, 2);
      upper.forEach(pt => { const i = byTime(pt); if (i >= 0) cache[i].bbUpper = pt.value; });
      lower.forEach(pt => { const i = byTime(pt); if (i >= 0) cache[i].bbLower = pt.value; });
    } catch (_) {}
    try { calcMom(candles, 10).forEach(pt => { const i = byTime(pt); if (i >= 0) cache[i].momentum = pt.value; }); } catch (_) {}

    return cache;
  }

  // ── Évaluation conditions ─────────────────────────────────

  static #evalConditions(conditions, logic, c, prev, ind, indP) {
    if (!conditions?.length) return false;
    const results = conditions.map(cond => {
      switch (cond.type) {
        case 'rsi_below':         return ind.rsi   != null && ind.rsi <= (cond.value ?? 30);
        case 'rsi_above':         return ind.rsi   != null && ind.rsi >= (cond.value ?? 70);
        case 'macd_cross_up':     return indP.macd != null && ind.macd != null && indP.macd <= indP.signal && ind.macd > ind.signal;
        case 'macd_cross_down':   return indP.macd != null && ind.macd != null && indP.macd >= indP.signal && ind.macd < ind.signal;
        case 'ma_cross_up':       return indP.ma20 != null && ind.ma20 != null && indP.ma20 <= indP.ma50 && ind.ma20 > ind.ma50;
        case 'ma_cross_down':     return indP.ma20 != null && ind.ma20 != null && indP.ma20 >= indP.ma50 && ind.ma20 < ind.ma50;
        case 'price_above_vwap':  return ind.vwap  != null && c.close > ind.vwap;
        case 'price_below_vwap':  return ind.vwap  != null && c.close < ind.vwap;
        case 'bb_breakout_up':    return ind.bbUpper != null && c.close > ind.bbUpper;
        case 'bb_breakout_down':  return ind.bbLower != null && c.close < ind.bbLower;
        case 'momentum_positive': return ind.momentum != null && ind.momentum > 0;
        case 'momentum_negative': return ind.momentum != null && ind.momentum < 0;
        default: return false;
      }
    });
    return logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }

  // ── Métriques ─────────────────────────────────────────────

  static #calcMetrics(trades, equity, initial) {
    if (!trades.length) return { trades: 0, message: 'Aucun trade déclenché sur cette période.' };

    const wins      = trades.filter(t => t.pnl > 0);
    const losses    = trades.filter(t => t.pnl < 0);
    const totalPnl  = trades.reduce((a, t) => a + t.pnl, 0);
    const totalFees = trades.reduce((a, t) => a + (t.fee ?? 0), 0);
    const totalSlip = trades.reduce((a, t) => a + (t.slippage ?? 0), 0);
    const finalEq   = equity.at(-1)?.value ?? initial;

    let peak = initial, maxDD = 0;
    for (const pt of equity) {
      if (pt.value > peak) peak = pt.value;
      const dd = (peak - pt.value) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }

    const grossProfit  = wins.reduce((a, t) => a + t.pnl, 0);
    const grossLoss    = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

    const rets   = equity.map((pt, i) => i === 0 ? 0 : (pt.value - equity[i - 1].value) / equity[i - 1].value);
    const mean   = rets.reduce((a, r) => a + r, 0) / rets.length;
    const std    = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

    return {
      trades:        trades.length,
      wins:          wins.length,
      losses:        losses.length,
      winRate:       parseFloat((wins.length / trades.length * 100).toFixed(1)),
      totalPnl:      parseFloat(totalPnl.toFixed(2)),
      totalPnlGross: parseFloat(trades.reduce((a, t) => a + (t.pnlGross ?? t.pnl), 0).toFixed(2)),
      totalPnlPct:   parseFloat(((finalEq - initial) / initial * 100).toFixed(2)),
      finalBalance:  parseFloat(finalEq.toFixed(2)),
      maxDrawdown:   parseFloat(maxDD.toFixed(2)),
      profitFactor:  parseFloat(profitFactor.toFixed(2)),
      sharpe:        parseFloat(sharpe.toFixed(2)),
      avgWin:        wins.length   ? parseFloat((grossProfit / wins.length).toFixed(2)) : 0,
      avgLoss:       losses.length ? parseFloat((grossLoss / losses.length).toFixed(2))  : 0,
      totalFees:     parseFloat(totalFees.toFixed(2)),
      totalSlippage: parseFloat(totalSlip.toFixed(2)),
      costDrag:      parseFloat(((totalFees + totalSlip) / initial * 100).toFixed(3)),
    };
  }
}
