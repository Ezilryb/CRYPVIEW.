// ============================================================
//  src/components/BacktestModal.js — CrypView V3.4 (Fix i18n + multi-conditions)
//
//  CORRECTIONS :
//    1. Import de t() depuis i18n.js
//    2. #bindStrategyEvents appelle #bindCondRowEvents sur les lignes
//       INITIALES → fix du bug "plusieurs conditions ne fonctionnent pas"
//    3. Signal labels traduits via t(`backtest.signals.${id}`)
//    4. Champ valeur correctement masqué à l'init pour noValue types
//    5. Bouton delete : hover + handler sur lignes initiales
//    6. Chaînes UI principales traduites
// ============================================================

import { Backtester, SIGNAL_TYPES } from '../features/Backtester.js';
import { t } from '../i18n/i18n.js';

export class BacktestModal {
  #overlay;
  #callbacks;
  #activeTab  = 'strategy';
  #lastResult = null;

  /** @param {{ getCandles: () => Candle[], getSymbol: () => string, getTf: () => string }} callbacks */
  constructor(callbacks) {
    this.#callbacks = callbacks;
    this.#overlay   = document.getElementById('backtest-overlay');
    this.#bindStaticEvents();
  }

  // ── API publique ──────────────────────────────────────────

  open() {
    this.#overlay.style.display = 'flex';
    this.#switchTab('strategy');
  }

  close() {
    this.#overlay.style.display = 'none';
  }

  // ── Navigation ────────────────────────────────────────────

  #switchTab(tab) {
    this.#activeTab = tab;
    ['strategy', 'results'].forEach(name => {
      const btn = document.getElementById(`bt-tab-${name}`);
      if (btn) {
        btn.classList.toggle('active', name === tab);
        btn.setAttribute('aria-selected', name === tab ? 'true' : 'false');
      }
    });
    const content = document.getElementById('bt-content');
    if (!content) return;

    if (tab === 'strategy') {
      content.innerHTML = this.#tplStrategy();
      this.#bindStrategyEvents();
    } else {
      content.innerHTML = this.#tplResults();
      if (this.#lastResult) this.#drawEquityCurve(this.#lastResult.equity);
    }
  }

  // ── Helpers i18n ──────────────────────────────────────────

  #tr(key, fallback) {
    const v = t(key);
    return (v && v !== key) ? v : fallback;
  }

  #sigOptions() {
    return SIGNAL_TYPES.map(s => {
      const label = this.#tr(`backtest.signals.${s.id}`, s.label);
      return `<option value="${s.id}">${label}</option>`;
    }).join('');
  }

  // ── Template stratégie ────────────────────────────────────

  #tplStrategy() {
    const sym = (this.#callbacks.getSymbol?.() ?? 'btcusdt').toUpperCase().replace('USDT', '/USDT');
    const tf  = (this.#callbacks.getTf?.() ?? '—').toUpperCase();
    const n   = this.#callbacks.getCandles?.()?.length ?? 0;

    const allConds  = this.#tr('backtest.allConds',   'TOUTES (ET)');
    const anyCond   = this.#tr('backtest.anyCond',    "L'UNE (OU)");
    const addCond   = this.#tr('backtest.addCond',    '+ Ajouter');
    const entryLbl  = this.#tr('backtest.entry',      '📈 Conditions d\'entrée');
    const exitLbl   = this.#tr('backtest.exit',       '📉 Conditions de sortie');
    const runLbl    = this.#tr('backtest.run',        '▶ Lancer le backtest');
    const slLbl     = this.#tr('backtest.stopLoss',   'Stop-Loss %');
    const tpLbl     = this.#tr('backtest.takeProfit', 'Take-Profit %');
    const capLbl    = this.#tr('backtest.capital',    'Capital / trade %');
    const sideLbl   = this.#tr('backtest.side',       'Côté');
    const longLbl   = this.#tr('backtest.long',       'Long ▲');
    const shortLbl  = this.#tr('backtest.short',      'Short ▼');
    const thrLbl    = this.#tr('backtest.threshold',  'seuil');
    const delLbl    = this.#tr('alerts.delete',        'Supprimer');

    // Contexte traduit
    let ctxHtml = `<strong style="color:var(--accent)">${sym}</strong> · TF ${tf} · <strong>${n}</strong> bougies`;
    const ctxKey = t('backtest.context', { sym, tf, n });
    if (ctxKey && ctxKey !== 'backtest.context') ctxHtml = ctxKey;

    const condRow = (prefix, idx) => {
      const first = SIGNAL_TYPES[0];
      const show  = first?.hasValue !== false;
      return `
      <div class="bt-cond-row" id="${prefix}-row-${idx}"
           style="display:flex;align-items:center;gap:6px;margin-bottom:6px;animation:fadeCondIn .18s ease;">
        <select class="bt-cond-type" data-prefix="${prefix}" data-idx="${idx}"
                style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);
                       padding:6px 8px;font-family:'Space Mono',monospace;font-size:10px;
                       border-radius:4px;outline:none;cursor:pointer;">
          ${this.#sigOptions()}
        </select>
        <input class="bt-cond-val" data-prefix="${prefix}" data-idx="${idx}"
               type="number" placeholder="${thrLbl}"
               value="${first?.defaultValue ?? ''}"
               style="width:74px;background:var(--bg);border:1px solid var(--border);color:var(--text);
                      padding:6px 8px;font-family:'Space Mono',monospace;font-size:11px;
                      border-radius:4px;outline:none;text-align:center;
                      display:${show ? 'block' : 'none'};">
        <button class="bt-del-cond" data-prefix="${prefix}" data-idx="${idx}"
                style="background:none;border:none;color:var(--muted);font-size:13px;
                       cursor:pointer;padding:4px;line-height:1;transition:color .15s;"
                aria-label="${delLbl}">✕</button>
      </div>`;
    };

    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                  background:rgba(0,200,255,.05);border:1px solid rgba(0,200,255,.15);
                  border-radius:6px;margin-bottom:14px;font-size:10px;">
        <span style="font-size:16px">📊</span><span>${ctxHtml}</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:9px;color:var(--accent);text-transform:uppercase;letter-spacing:.8px;">${entryLbl}</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <select id="bt-entry-logic" style="background:var(--bg);border:1px solid var(--border);color:var(--muted);
                     padding:3px 7px;font-family:'Space Mono',monospace;font-size:9px;border-radius:4px;outline:none;">
                <option value="AND">${allConds}</option>
                <option value="OR">${anyCond}</option>
              </select>
              <button class="bt-add-cond" data-prefix="entry"
                      style="background:rgba(0,255,136,.08);border:1px solid rgba(0,255,136,.25);
                             color:var(--accent);padding:3px 9px;font-size:9px;border-radius:3px;
                             cursor:pointer;font-family:'Space Mono',monospace;">${addCond}</button>
            </div>
          </div>
          <div id="entry-conditions">${condRow('entry', 0)}</div>
        </div>

        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:9px;color:var(--red);text-transform:uppercase;letter-spacing:.8px;">${exitLbl}</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <select id="bt-exit-logic" style="background:var(--bg);border:1px solid var(--border);color:var(--muted);
                     padding:3px 7px;font-family:'Space Mono',monospace;font-size:9px;border-radius:4px;outline:none;">
                <option value="AND">${allConds}</option>
                <option value="OR">${anyCond}</option>
              </select>
              <button class="bt-add-cond" data-prefix="exit"
                      style="background:rgba(255,61,90,.08);border:1px solid rgba(255,61,90,.25);
                             color:var(--red);padding:3px 9px;font-size:9px;border-radius:3px;
                             cursor:pointer;font-family:'Space Mono',monospace;">${addCond}</button>
            </div>
          </div>
          <div id="exit-conditions">${condRow('exit', 0)}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
        ${this.#paramField('bt-side',    sideLbl, 'select', [['long', longLbl], ['short', shortLbl]])}
        ${this.#paramField('bt-sl-pct',  slLbl,   'number', null, '2')}
        ${this.#paramField('bt-tp-pct',  tpLbl,   'number', null, '4')}
        ${this.#paramField('bt-cap-pct', capLbl,  'number', null, '10')}
      </div>

      <button id="bt-run-btn"
              style="width:100%;padding:13px;border-radius:6px;cursor:pointer;
                     font-family:'Syne',sans-serif;font-size:14px;font-weight:800;
                     background:var(--accent);color:var(--bg);border:none;
                     transition:background .15s;letter-spacing:.04em;">${runLbl}</button>`;
  }

  #paramField(id, label, type, opts, def = '') {
    const inner = type === 'select'
      ? `<select id="${id}" style="width:100%;background:var(--bg);border:1px solid var(--border);
                                   color:var(--text);padding:7px 8px;font-family:'Space Mono',monospace;
                                   font-size:11px;border-radius:4px;outline:none;cursor:pointer;">
           ${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
         </select>`
      : `<input id="${id}" type="number" value="${def}" min="0" step="0.1"
                style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);
                       padding:7px 8px;font-family:'Space Mono',monospace;font-size:11px;
                       border-radius:4px;outline:none;text-align:center;">`;
    return `<div>
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;">${label}</div>
      ${inner}
    </div>`;
  }

  // ── Liaison événements stratégie ─────────────────────────

  #bindStrategyEvents() {
    let entryIdx = 1, exitIdx = 1;

    // ═══════════════════════════════════════════════════════
    //  FIX PRINCIPAL — Bug "plusieurs conditions"
    //
    //  Le problème : #bindCondRowEvents n'était jamais appelé
    //  pour les lignes générées dans #tplStrategy(). Résultat :
    //
    //  1. Le handler onchange du <select> n'était PAS attaché
    //     → quand l'utilisateur choisissait "MACD crossover"
    //       (noValue), le champ numérique restait visible et
    //       sa valeur (NaN ou 0) était lue lors de #collectConditions,
    //       produisant { type:'macd_cross_up', value: null } ← OK
    //       MAIS le display:block du champ brouillait l'UX.
    //
    //  2. Le handler onclick du bouton ✕ n'était PAS attaché
    //     → impossible de supprimer la ligne initiale.
    //
    //  3. Avec la logique AND et plusieurs conditions, si une
    //     condition mal configurée (champ visible mais vide)
    //     retournait null pour hasValue:false, le collect
    //     produisait { value: null } correctement — mais avec
    //     le champ visible l'utilisateur croyait devoir le remplir.
    //
    //  Solution : appeler #bindCondRowEvents dès la création
    //  du template, AVANT tout ajout de nouvelles lignes.
    // ═══════════════════════════════════════════════════════
    const entryCont = document.getElementById('entry-conditions');
    const exitCont  = document.getElementById('exit-conditions');
    if (entryCont) this.#bindCondRowEvents(entryCont);
    if (exitCont)  this.#bindCondRowEvents(exitCont);

    // Boutons "+ Ajouter"
    document.querySelectorAll('.bt-add-cond').forEach(btn => {
      btn.addEventListener('click', () => {
        const prefix    = btn.dataset.prefix;
        const container = document.getElementById(`${prefix}-conditions`);
        if (!container) return;
        const idx = prefix === 'entry' ? entryIdx++ : exitIdx++;
        const tmp = document.createElement('div');
        tmp.innerHTML = this.#condRowHTML(prefix, idx);
        container.appendChild(tmp.firstElementChild);
        this.#bindCondRowEvents(container);
      });
    });

    document.getElementById('bt-run-btn')
      ?.addEventListener('click', () => this.#runBacktest());
  }

  #condRowHTML(prefix, idx) {
    const thrLbl = this.#tr('backtest.threshold', 'seuil');
    const delLbl = this.#tr('alerts.delete',       'Supprimer');
    const first  = SIGNAL_TYPES[0];
    const show   = first?.hasValue !== false;
    return `<div class="bt-cond-row" id="${prefix}-row-${idx}"
               style="display:flex;align-items:center;gap:6px;margin-bottom:6px;animation:fadeCondIn .18s ease;">
      <select class="bt-cond-type" data-prefix="${prefix}" data-idx="${idx}"
              style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);
                     padding:6px 8px;font-family:'Space Mono',monospace;font-size:10px;
                     border-radius:4px;outline:none;">${this.#sigOptions()}</select>
      <input class="bt-cond-val" data-prefix="${prefix}" data-idx="${idx}"
             type="number" placeholder="${thrLbl}" value="${first?.defaultValue ?? ''}"
             style="width:74px;background:var(--bg);border:1px solid var(--border);color:var(--text);
                    padding:6px 8px;font-family:'Space Mono',monospace;font-size:11px;
                    border-radius:4px;outline:none;text-align:center;display:${show ? 'block' : 'none'};">
      <button class="bt-del-cond" data-prefix="${prefix}" data-idx="${idx}"
              style="background:none;border:none;color:var(--muted);font-size:13px;
                     cursor:pointer;padding:4px;line-height:1;transition:color .15s;"
              aria-label="${delLbl}">✕</button>
    </div>`;
  }

  /**
   * Lie les handlers sur toutes les lignes du conteneur (idempotent — utilise
   * onclick/onchange, pas addEventListener, pour éviter les doublons).
   */
  #bindCondRowEvents(container) {
    container.querySelectorAll('.bt-del-cond').forEach(btn => {
      btn.onclick = () => {
        const row = document.getElementById(`${btn.dataset.prefix}-row-${btn.dataset.idx}`);
        if (row && container.querySelectorAll('.bt-cond-row').length > 1) row.remove();
      };
      btn.onmouseenter = () => { btn.style.color = 'var(--red)'; };
      btn.onmouseleave = () => { btn.style.color = 'var(--muted)'; };
    });

    container.querySelectorAll('.bt-cond-type').forEach(sel => {
      sel.onchange = () => {
        const meta     = SIGNAL_TYPES.find(s => s.id === sel.value);
        const valInput = container.querySelector(`.bt-cond-val[data-idx="${sel.dataset.idx}"]`);
        if (!valInput) return;
        // Masque le champ valeur pour les types sans seuil (MACD cross, MA cross…)
        valInput.style.display = (meta?.hasValue !== false) ? 'block' : 'none';
        if (meta?.defaultValue != null) valInput.value = meta.defaultValue;
        else if (meta?.hasValue === false) valInput.value = '';
      };
    });
  }

  #collectConditions(prefix) {
    const rows = document.querySelectorAll(`#${prefix}-conditions .bt-cond-row`);
    return [...rows].map(row => {
      const type = row.querySelector('.bt-cond-type')?.value;
      const val  = parseFloat(row.querySelector('.bt-cond-val')?.value);
      const meta = SIGNAL_TYPES.find(s => s.id === type);
      return { type, value: (meta?.hasValue !== false) && !isNaN(val) ? val : null };
    });
  }

  #runBacktest() {
    const candles = this.#callbacks.getCandles?.() ?? [];
    const config  = {
      side:            document.getElementById('bt-side')?.value  ?? 'long',
      entryConditions: this.#collectConditions('entry'),
      exitConditions:  this.#collectConditions('exit'),
      entryLogic:      document.getElementById('bt-entry-logic')?.value ?? 'AND',
      exitLogic:       document.getElementById('bt-exit-logic')?.value  ?? 'AND',
      stopLossPct:     parseFloat(document.getElementById('bt-sl-pct')?.value  ?? 0),
      takeProfitPct:   parseFloat(document.getElementById('bt-tp-pct')?.value  ?? 0),
      capitalPct:      parseFloat(document.getElementById('bt-cap-pct')?.value ?? 10),
      initialBalance:  10_000,
    };

    const btn = document.getElementById('bt-run-btn');
    if (btn) {
      btn.textContent = this.#tr('backtest.running', '⏳ Calcul…');
      btn.disabled    = true;
    }

    setTimeout(() => {
      try {
        this.#lastResult = Backtester.run(candles, config);
      } catch (err) {
        this.#lastResult = { trades: [], equity: [], metrics: { error: err?.message ?? String(err) } };
      }
      if (btn) {
        btn.textContent = this.#tr('backtest.run', '▶ Lancer le backtest');
        btn.disabled    = false;
      }
      this.#switchTab('results');
    }, 30);
  }

  // ── Template résultats ────────────────────────────────────

  #tplResults() {
    if (!this.#lastResult) {
      return `<div style="padding:48px;text-align:center;color:var(--muted);font-size:12px;">
        <div style="font-size:28px;margin-bottom:12px">⚙️</div>
        ${this.#tr('backtest.noResult', 'Configurez et lancez un backtest depuis l\'onglet Stratégie.')}
      </div>`;
    }

    const { metrics, trades, equity } = this.#lastResult;
    const errorMsg = metrics.error ?? metrics.message;
    if (errorMsg) {
      return `<div style="padding:32px;text-align:center;color:var(--muted);font-size:11px;">
        <div style="font-size:22px;margin-bottom:10px">⚠️</div>
        ${errorMsg}
      </div>`;
    }

    const color = metrics.totalPnlPct >= 0 ? 'var(--green)' : 'var(--red)';
    const box = (lbl, val, c = 'var(--text)') =>
      `<div style="background:rgba(255,255,255,.02);border:1px solid var(--border);
                   border-radius:6px;padding:10px 12px;">
         <div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:3px;">${lbl}</div>
         <div style="font-size:14px;font-family:'Syne',sans-serif;font-weight:800;color:${c};">${val}</div>
       </div>`;

    const lastTradesLbl = (() => {
      const k = t('backtest.lastTrades', { n: trades.length });
      return (k && k !== 'backtest.lastTrades') ? k : `${trades.length} total · affichage des 20 derniers`;
    })();

    const noTradeLbl = this.#tr('backtest.noTrade', 'Aucun trade déclenché sur cette période.');

    const tradeRows = trades.slice(-20).reverse().map(tr => {
      const c    = tr.pnl >= 0 ? 'var(--green)' : 'var(--red)';
      const icon = tr.reason === 'sl' ? '🛑' : tr.reason === 'tp' ? '🎯' : '📤';
      const dt   = new Date(tr.entryTime * 1_000).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
      return `<tr style="border-bottom:1px solid rgba(28,35,51,.5);font-size:10px;">
        <td style="padding:5px 8px;color:var(--muted);">${dt}</td>
        <td style="padding:5px 8px;">${icon} ${tr.reason.toUpperCase()}</td>
        <td style="padding:5px 8px;text-align:right;">${tr.entry.toFixed(2)}</td>
        <td style="padding:5px 8px;text-align:right;">${tr.exit.toFixed(2)}</td>
        <td style="padding:5px 8px;text-align:right;color:${c};font-weight:700;">${tr.pnl >= 0 ? '+' : ''}${tr.pnl.toFixed(2)} $</td>
      </tr>`;
    }).join('');

    return `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;">
        ${box(this.#tr('backtest.metrics.totalPnl','P&L Total'), `${metrics.totalPnlPct >= 0?'+':''}${metrics.totalPnlPct}%`, color)}
        ${box(this.#tr('backtest.metrics.trades','Trades'), metrics.trades)}
        ${box(this.#tr('backtest.metrics.winRate','Win Rate'), `${metrics.winRate}%`, metrics.winRate>=50?'var(--green)':'var(--red)')}
        ${box(this.#tr('backtest.metrics.profitFactor','Profit Factor'), metrics.profitFactor, metrics.profitFactor>=1?'var(--green)':'var(--red)')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">
        ${box(this.#tr('backtest.metrics.maxDD','Max Drawdown'), `${metrics.maxDrawdown}%`, metrics.maxDrawdown>15?'var(--red)':'var(--muted)')}
        ${box(this.#tr('backtest.metrics.sharpe','Sharpe'), metrics.sharpe, metrics.sharpe>=1?'var(--green)':'var(--muted)')}
        ${box(this.#tr('backtest.metrics.avgWin','Gain moyen'), `+${metrics.avgWin} $`, 'var(--green)')}
        ${box(this.#tr('backtest.metrics.avgLoss','Perte moy.'), `-${metrics.avgLoss} $`, 'var(--red)')}
      </div>

      <canvas id="bt-equity-canvas" height="90"
              style="width:100%;display:block;border:1px solid var(--border);
                     border-radius:6px;background:rgba(0,0,0,.25);margin-bottom:12px;"
              aria-label="Courbe equity"></canvas>

      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px;">
        ${lastTradesLbl}
      </div>
      <div style="overflow-y:auto;max-height:180px;border:1px solid var(--border);border-radius:6px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:var(--panel);font-size:9px;color:var(--muted);position:sticky;top:0;z-index:1;">
              <th style="padding:5px 8px;text-align:left;font-weight:400;">Date</th>
              <th style="padding:5px 8px;font-weight:400;">Action</th>
              <th style="padding:5px 8px;text-align:right;font-weight:400;">Entrée</th>
              <th style="padding:5px 8px;text-align:right;font-weight:400;">Sortie</th>
              <th style="padding:5px 8px;text-align:right;font-weight:400;">P&L</th>
            </tr>
          </thead>
          <tbody>${tradeRows || `<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--muted);font-size:10px;">${noTradeLbl}</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  #drawEquityCurve(equity) {
    const canvas = document.getElementById('bt-equity-canvas');
    if (!canvas || !equity?.length) return;
    const W = canvas.offsetWidth || 400;
    canvas.width = W;
    const H   = 90;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (equity.length < 2) return;

    const minV  = Math.min(...equity.map(p => p.value));
    const maxV  = Math.max(...equity.map(p => p.value));
    const range = maxV - minV || 1;
    const xs    = equity.map((_, i) => (i / (equity.length - 1)) * W);
    const ys    = equity.map(p => H - 8 - ((p.value - minV) / range) * (H - 16));
    const up    = equity.at(-1).value >= equity[0].value;
    const color = up ? '#00ff88' : '#ff3d5a';

    const y0 = H - 8 - ((10_000 - minV) / range) * (H - 16);
    ctx.strokeStyle = 'rgba(139,148,158,.25)'; ctx.lineWidth = 0.8; ctx.setLineDash([4,3]);
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
    ctx.setLineDash([]);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, up ? 'rgba(0,255,136,.2)' : 'rgba(255,61,90,.2)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(xs[0], H);
    xs.forEach((x, i) => ctx.lineTo(x, ys[i]));
    ctx.lineTo(xs.at(-1), H);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath();
    xs.forEach((x, i) => i === 0 ? ctx.moveTo(x, ys[i]) : ctx.lineTo(x, ys[i]));
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke();
  }

  // ── Événements statiques ──────────────────────────────────

  #bindStaticEvents() {
    document.getElementById('backtest-close')
      ?.addEventListener('click', () => this.close());
    this.#overlay?.addEventListener('click', e => {
      if (e.target === this.#overlay) this.close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.#overlay?.style.display === 'flex') {
        e.stopPropagation(); this.close();
      }
    });
    ['strategy', 'results'].forEach(tab => {
      document.getElementById(`bt-tab-${tab}`)
        ?.addEventListener('click', () => this.#switchTab(tab));
    });
  }
}
