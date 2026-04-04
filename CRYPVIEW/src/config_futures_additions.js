// ============================================================
//  config_futures_additions.js — CrypView V3.6
//  Extrait à insérer dans src/config.js
//
//  ── INSTRUCTIONS ─────────────────────────────────────────────
//  Dans src/config.js, trouver la dernière entrée de IND_META :
//
//    eray:  { label: 'Elder Ray (13)', ... },
//  };
//
//  Ajouter AVANT la fermeture `};` :
// ============================================================

// ── Futures Binance (FAPI) ─────────────────────────────────
//
//  Copier-coller ces 3 entrées dans IND_META juste avant la fermeture `};`
//
/*
  oi:      {
    label:   'Open Interest',
    desc:    'Delta OI histogram + ligne absolue — Binance Futures',
    overlay: false,
    color:   '#00c8ff',
    cat:     'volume',
  },
  funding: {
    label:   'Funding Rate',
    desc:    'Taux de financement 8h — vert=bull (négatif), rouge=bear (positif)',
    overlay: false,
    color:   '#ff6eb4',
    cat:     'momentum',
  },
  lsr:     {
    label:   'Long/Short Ratio',
    desc:    'Ratio global comptes longs/shorts — >1 = dominance longs',
    overlay: false,
    color:   '#f7c948',
    cat:     'volume',
  },
*/

// ============================================================
//  page.js — modifier l'instanciation de ChartIndicators
//
//  ── AVANT (dans initChartModules) ────────────────────────────
//    indicators = new ChartIndicators(chart.chart, chart.cSeries, $('charts-col'));
//
//  ── APRÈS ────────────────────────────────────────────────────
//    indicators = new ChartIndicators(
//      chart.chart,
//      chart.cSeries,
//      $('charts-col'),
//      () => ({ symbol: chart.symbol, timeframe: chart.timeframe })
//    );
// ============================================================

// ============================================================
//  multi.js — modifier l'instanciation dans #initComponents ET #rebuildModules
//
//  ── AVANT ────────────────────────────────────────────────────
//    this.indicators = new ChartIndicators(this.chart, this.cSeries, chartsCol);
//
//  ── APRÈS (x2, même changement dans les deux méthodes) ───────
//    this.indicators = new ChartIndicators(
//      this.chart,
//      this.cSeries,
//      chartsCol,
//      () => ({ symbol: this.sym, timeframe: this.tf })
//    );
// ============================================================
