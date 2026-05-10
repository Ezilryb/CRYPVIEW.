// ============================================================
//  src/components/RiskCalculatorModal.js — CrypView V3.9
//  Outils de gestion du risque : 3 onglets.
//
//  Tab 1 — Taille de position
//    Inputs : solde, % risqué, prix entrée, stop-loss
//    Output : taille USD, quantité, risque $
//
//  Tab 2 — Risque / Récompense
//    Inputs : entrée, stop, take-profit, quantité
//    Output : ratio R/R, gain potentiel, perte potentielle
//
//  Tab 3 — Levier & Liquidation
//    Inputs : entrée, levier, taille USD, marge maintenance, côté
//    Output : prix de liquidation, marge requise, perte max
//
//  Usage :
//    const rc = new RiskCalculatorModal({ getCurrentPrice: () => lastPrice });
//    rc.open();
// ============================================================

export class RiskCalculatorModal {
  #overlay;
  #activeTab  = 'position';
  #callbacks;

  /** @param {{ getCurrentPrice?: () => number }} [callbacks] */
  constructor(callbacks = {}) {
    this.#callbacks = callbacks;
    this.#overlay   = document.getElementById('risk-calc-overlay');
    this.#bindStaticEvents();
  }

  open() {
    if (!this.#overlay) return;
    this.#overlay.style.display = 'flex';
    this.#switchTab(this.#activeTab);
  }

  close() {
    if (this.#overlay) this.#overlay.style.display = 'none';
  }

  // ── Navigation ────────────────────────────────────────────

  #switchTab(tab) {
    this.#activeTab = tab;

    ['position', 'rr', 'liq'].forEach(t => {
      const btn = document.getElementById(`rc-tab-${t}`);
      if (btn) {
        btn.classList.toggle('active', t === tab);
        btn.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      }
    });

    const content = document.getElementById('rc-content');
    if (!content) return;

    switch (tab) {
      case 'position': content.innerHTML = this.#tplPosition(); this.#bindPosition(); break;
      case 'rr':       content.innerHTML = this.#tplRR();       this.#bindRR();       break;
      case 'liq':      content.innerHTML = this.#tplLiq();      this.#bindLiq();      break;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  TAB 1 — Taille de position
  // ══════════════════════════════════════════════════════════

  #tplPosition() {
    const price = this.#callbacks.getCurrentPrice?.() ?? 0;
    const stop  = price > 0 ? (price * 0.98).toFixed(price > 100 ? 2 : 6) : '';
    const priceStr = price > 0 ? price.toFixed(price > 100 ? 2 : 6) : '';

    return `
      <div class="rc-desc">
        Calcule la <strong>quantité optimale</strong> à trader selon votre tolérance au risque.
      </div>

      <div class="rc-grid2">
        ${this.#field('rc-balance',  '💰 Solde du compte (USDT)', '10000', 'number', '0.01')}
        ${this.#field('rc-risk-pct', '⚠️ Risque par trade (%)',   '1',     'number', '0.1')}
        ${this.#field('rc-entry',    '📍 Prix d\'entrée',         priceStr,'number', 'any')}
        ${this.#field('rc-stop',     '🛑 Prix Stop-Loss',          stop,    'number', 'any')}
      </div>

      <button id="rc-calc-pos" class="rc-btn-primary">▶ Calculer la taille</button>

      <div id="rc-pos-result" class="rc-result" style="display:none"></div>

      <div class="rc-tip">
        💡 Règle des 1–2 % : ne risquez jamais plus de 2 % de votre capital sur un seul trade.
      </div>`;
  }

  #bindPosition() {
    const calc = () => {
      const balance  = parseFloat(document.getElementById('rc-balance')?.value)  || 0;
      const riskPct  = parseFloat(document.getElementById('rc-risk-pct')?.value) || 0;
      const entry    = parseFloat(document.getElementById('rc-entry')?.value)     || 0;
      const stop     = parseFloat(document.getElementById('rc-stop')?.value)      || 0;

      const res = document.getElementById('rc-pos-result');
      if (!res) return;

      if (!balance || !riskPct || !entry || !stop || entry === stop) {
        res.style.display = 'none'; return;
      }

      const riskUSD      = balance * riskPct / 100;
      const priceDiff    = Math.abs(entry - stop);
      const pctMove      = (priceDiff / entry) * 100;
      const positionUSD  = (riskUSD / priceDiff) * entry;
      const quantity     = positionUSD / entry;
      const isLong       = entry > stop;

      res.style.display = 'block';
      res.innerHTML = `
        <div class="rc-result-title">📊 Résultats</div>
        <div class="rc-result-grid">
          ${this.#resBox('Risque en USD',       this.#fmtU(riskUSD),       'var(--red)')}
          ${this.#resBox('Taille de position',  this.#fmtU(positionUSD),   'var(--accent)')}
          ${this.#resBox('Quantité à acheter',  this.#fmtQ(quantity),      'var(--text)')}
          ${this.#resBox('Stop-loss %',         pctMove.toFixed(2) + ' %', 'var(--yellow)')}
        </div>
        <div class="rc-result-row">
          <span>Direction :</span>
          <strong style="color:${isLong ? 'var(--green)' : 'var(--red)'}">
            ${isLong ? '▲ LONG' : '▼ SHORT'}
          </strong>
        </div>
        <div class="rc-result-row">
          <span>Capital engagé :</span>
          <strong>${(positionUSD / balance * 100).toFixed(1)} % du solde</strong>
        </div>
        ${positionUSD > balance
          ? '<div class="rc-warn">⚠ Position supérieure au solde — réduisez le risque ou utilisez du levier.</div>'
          : ''}`;
    };

    document.getElementById('rc-calc-pos')?.addEventListener('click', calc);
    ['rc-balance', 'rc-risk-pct', 'rc-entry', 'rc-stop'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', calc);
    });
    // Calcul auto si les champs sont pré-remplis
    if (document.getElementById('rc-entry')?.value) calc();
  }

  // ══════════════════════════════════════════════════════════
  //  TAB 2 — Risque / Récompense
  // ══════════════════════════════════════════════════════════

  #tplRR() {
    const price = this.#callbacks.getCurrentPrice?.() ?? 0;
    const entry = price > 0 ? price.toFixed(price > 100 ? 2 : 6) : '';
    const stop  = price > 0 ? (price * 0.98).toFixed(price > 100 ? 2 : 6) : '';
    const tp    = price > 0 ? (price * 1.04).toFixed(price > 100 ? 2 : 6) : '';

    return `
      <div class="rc-desc">
        Évalue si un trade vaut la peine d'être pris en comparant le <strong>gain potentiel</strong>
        à la <strong>perte maximale</strong>.
      </div>

      <div class="rc-grid2">
        ${this.#field('rr-entry',    '📍 Prix d\'entrée',     entry, 'number', 'any')}
        ${this.#field('rr-stop',     '🛑 Stop-Loss',           stop,  'number', 'any')}
        ${this.#field('rr-tp',       '🎯 Take-Profit',         tp,    'number', 'any')}
        ${this.#field('rr-size-usd', '💵 Taille position (USDT)', '1000', 'number', '0.01')}
      </div>

      <button id="rr-calc" class="rc-btn-primary">▶ Calculer le R/R</button>

      <div id="rr-result" class="rc-result" style="display:none"></div>

      <div class="rc-tip">
        💡 Minimum recommandé : R/R ≥ 2. Avec un win rate de 50 %, un R/R de 2 est rentable.
      </div>`;
  }

  #bindRR() {
    const calc = () => {
      const entry   = parseFloat(document.getElementById('rr-entry')?.value)    || 0;
      const stop    = parseFloat(document.getElementById('rr-stop')?.value)     || 0;
      const tp      = parseFloat(document.getElementById('rr-tp')?.value)       || 0;
      const sizeUSD = parseFloat(document.getElementById('rr-size-usd')?.value) || 0;

      const res = document.getElementById('rr-result');
      if (!res) return;

      if (!entry || !stop || !tp || entry === stop) { res.style.display = 'none'; return; }

      const risk    = Math.abs(entry - stop);
      const reward  = Math.abs(tp - entry);
      const ratio   = reward / risk;
      const qty     = sizeUSD / entry;
      const lossUSD = qty * risk;
      const gainUSD = qty * reward;

      const isLong  = tp > entry;
      const validDir = isLong ? (stop < entry) : (stop > entry);

      // Win-rate minimal pour être rentable avec ce R/R
      const minWinRate = 1 / (1 + ratio) * 100;

      const ratioColor = ratio >= 3 ? 'var(--green)'
                       : ratio >= 2 ? 'var(--accent)'
                       : ratio >= 1 ? 'var(--yellow)'
                       : 'var(--red)';

      res.style.display = 'block';
      res.innerHTML = `
        <div class="rc-result-title">📊 Analyse R/R</div>
        <div style="text-align:center;margin-bottom:14px;">
          <div style="font-size:42px;font-family:'Syne',sans-serif;font-weight:800;color:${ratioColor};">
            ${ratio.toFixed(2)}
          </div>
          <div style="font-size:11px;color:var(--muted);">Ratio Risque / Récompense</div>
        </div>
        <div class="rc-result-grid">
          ${this.#resBox('Perte potentielle', '-' + this.#fmtU(lossUSD), 'var(--red)')}
          ${this.#resBox('Gain potentiel',    '+' + this.#fmtU(gainUSD), 'var(--green)')}
          ${this.#resBox('Stop-loss %',       ((risk / entry) * 100).toFixed(2) + ' %', 'var(--red)')}
          ${this.#resBox('Take-profit %',     ((reward / entry) * 100).toFixed(2) + ' %', 'var(--green)')}
        </div>
        <div class="rc-result-row">
          <span>Win-rate min. pour être rentable :</span>
          <strong style="color:${minWinRate < 50 ? 'var(--green)' : 'var(--yellow)'}">
            ${minWinRate.toFixed(1)} %
          </strong>
        </div>
        <div class="rc-result-row">
          <span>Direction :</span>
          <strong style="color:${isLong ? 'var(--green)' : 'var(--red)'}">
            ${isLong ? '▲ LONG' : '▼ SHORT'}
          </strong>
        </div>
        ${!validDir ? '<div class="rc-warn">⚠ Stop-loss du mauvais côté de l\'entrée pour la direction.</div>' : ''}
        <div class="rc-rr-bar">
          <div class="rc-rr-loss"  style="flex:${risk.toFixed(4)}"></div>
          <div class="rc-rr-pivot"></div>
          <div class="rc-rr-gain"  style="flex:${reward.toFixed(4)}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);">
          <span>Stop 🛑 ${stop.toFixed(2)}</span>
          <span>Entrée 📍 ${entry.toFixed(2)}</span>
          <span>TP 🎯 ${tp.toFixed(2)}</span>
        </div>`;
    };

    document.getElementById('rr-calc')?.addEventListener('click', calc);
    ['rr-entry', 'rr-stop', 'rr-tp', 'rr-size-usd'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', calc);
    });
    if (document.getElementById('rr-entry')?.value) calc();
  }

  // ══════════════════════════════════════════════════════════
  //  TAB 3 — Levier & Liquidation
  // ══════════════════════════════════════════════════════════

  #tplLiq() {
    const price = this.#callbacks.getCurrentPrice?.() ?? 0;
    const entry = price > 0 ? price.toFixed(price > 100 ? 2 : 6) : '';

    return `
      <div class="rc-desc">
        Calcule le <strong>prix de liquidation</strong> et la marge nécessaire pour une position à levier.
        Connaître sa liquidation <em>avant</em> d'entrer est essentiel.
      </div>

      <div class="rc-grid2">
        ${this.#field('liq-entry',    '📍 Prix d\'entrée',            entry, 'number', 'any')}
        ${this.#field('liq-size-usd', '💵 Taille de position (USDT)', '1000', 'number', '0.01')}
        ${this.#fieldSelect('liq-side', '↕️ Direction', [['long','▲ LONG'], ['short','▼ SHORT']])}
        ${this.#field('liq-lev',      '⚡ Levier (x)',                '10',   'number', '1', '1', '125')}
        ${this.#field('liq-mm',       '🔧 Marge maintenance (%)',     '0.5',  'number', '0.01')}
        ${this.#field('liq-fee',      '💸 Frais d\'ouverture (%)',    '0.06', 'number', '0.001')}
      </div>

      <button id="liq-calc" class="rc-btn-primary">▶ Calculer la liquidation</button>

      <div id="liq-result" class="rc-result" style="display:none"></div>

      <div class="rc-tip">
        💡 Binance Futures : marge de maintenance BTC ≈ 0,5 %. Plus le levier est élevé,
        plus la liquidation est proche de l'entrée.
      </div>`;
  }

  #bindLiq() {
    const calc = () => {
      const entry   = parseFloat(document.getElementById('liq-entry')?.value)    || 0;
      const sizeUSD = parseFloat(document.getElementById('liq-size-usd')?.value) || 0;
      const side    = document.getElementById('liq-side')?.value ?? 'long';
      const lev     = parseFloat(document.getElementById('liq-lev')?.value)      || 1;
      const mm      = parseFloat(document.getElementById('liq-mm')?.value)        || 0.5;
      const fee     = parseFloat(document.getElementById('liq-fee')?.value)       || 0.06;

      const res = document.getElementById('liq-result');
      if (!res) return;

      if (!entry || !sizeUSD || lev < 1) { res.style.display = 'none'; return; }

      // Marge initiale = taille / levier
      const margin   = sizeUSD / lev;
      const qty      = sizeUSD / entry;

      // Frais d'ouverture
      const openFee  = sizeUSD * (fee / 100);

      // Prix de liquidation (formule cross-margin simplifiée, isolated)
      // Long :  liq = entry × (1 - 1/lev + mm/100)
      // Short : liq = entry × (1 + 1/lev - mm/100)
      const mmFrac  = mm / 100;
      let liqPrice;
      if (side === 'long') {
        liqPrice = entry * (1 - 1 / lev + mmFrac);
      } else {
        liqPrice = entry * (1 + 1 / lev - mmFrac);
      }
      liqPrice = Math.max(0, liqPrice);

      // % mouvement jusqu'à liquidation
      const pctToLiq = Math.abs(liqPrice - entry) / entry * 100;

      // Perte maximale = marge + frais
      const maxLoss = margin + openFee;

      // Ratio de risque
      const riskRatio = maxLoss / sizeUSD * 100;

      const isLong   = side === 'long';
      const liqColor = pctToLiq < 5  ? 'var(--red)'
                     : pctToLiq < 15 ? 'var(--yellow)'
                     : 'var(--green)';

      res.style.display = 'block';
      res.innerHTML = `
        <div class="rc-result-title">⚡ Analyse du levier × ${lev}</div>
        <div class="rc-result-grid">
          ${this.#resBox('Prix de liquidation', liqPrice.toFixed(liqPrice > 10 ? 2 : 6), liqColor)}
          ${this.#resBox('% avant liquidation', pctToLiq.toFixed(2) + ' %', liqColor)}
          ${this.#resBox('Marge requise',        this.#fmtU(margin),  'var(--accent)')}
          ${this.#resBox('Perte max (marge)',     '-' + this.#fmtU(maxLoss), 'var(--red)')}
        </div>
        <div class="rc-result-row">
          <span>Quantité :</span>
          <strong>${this.#fmtQ(qty)} unités</strong>
        </div>
        <div class="rc-result-row">
          <span>Frais ouverture :</span>
          <strong style="color:var(--muted)">-${this.#fmtU(openFee)}</strong>
        </div>
        <div class="rc-result-row">
          <span>Exposition totale :</span>
          <strong>${this.#fmtU(sizeUSD)}</strong>
        </div>
        <div class="rc-result-row">
          <span>Direction :</span>
          <strong style="color:${isLong ? 'var(--green)' : 'var(--red)'}">
            ${isLong ? '▲ LONG' : '▼ SHORT'} × ${lev}
          </strong>
        </div>

        <!-- Jauge distance liquidation -->
        <div style="margin-top:12px;">
          <div style="display:flex;justify-content:space-between;font-size:9px;
                      color:var(--muted);margin-bottom:4px;">
            <span>${isLong ? '🛑 Liquidation' : '📍 Entrée'} ${isLong ? liqPrice.toFixed(2) : entry.toFixed(2)}</span>
            <span>${pctToLiq.toFixed(2)} % de marge</span>
            <span>${isLong ? '📍 Entrée' : '🛑 Liquidation'} ${isLong ? entry.toFixed(2) : liqPrice.toFixed(2)}</span>
          </div>
          <div style="height:8px;border-radius:4px;background:rgba(28,35,51,1);overflow:hidden;position:relative;">
            <div style="position:absolute;${isLong ? 'left' : 'right'}:0;height:100%;
                        width:${Math.min(100, pctToLiq * lev).toFixed(1)}%;
                        background:${liqColor};border-radius:4px;transition:width .3s;">
            </div>
          </div>
        </div>

        ${pctToLiq < 5 ? '<div class="rc-warn">🔴 DANGER — Liquidation très proche ! Réduisez le levier.</div>'
          : pctToLiq < 10 ? '<div class="rc-warn" style="border-color:var(--yellow);background:rgba(247,201,72,.07);">🟡 Levier élevé — surveillez votre position.</div>'
          : '<div style="font-size:9px;color:var(--green);margin-top:8px;padding:6px 10px;background:rgba(0,255,136,.07);border-radius:4px;border:1px solid rgba(0,255,136,.2);">✅ Distance de liquidation raisonnable.</div>'}`;
    };

    document.getElementById('liq-calc')?.addEventListener('click', calc);
    ['liq-entry', 'liq-size-usd', 'liq-lev', 'liq-mm', 'liq-fee'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', calc);
    });
    document.getElementById('liq-side')?.addEventListener('change', calc);
    if (document.getElementById('liq-entry')?.value) calc();
  }

  // ── Helpers HTML ──────────────────────────────────────────

  #field(id, label, value = '', type = 'number', step = 'any', min = '', max = '') {
    return `<div>
      <label for="${id}" style="display:block;font-size:9px;color:var(--muted);
                                text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;">
        ${label}
      </label>
      <input id="${id}" type="${type}" value="${value}"
             step="${step}" ${min ? `min="${min}"` : ''} ${max ? `max="${max}"` : ''}
             autocomplete="off"
             style="width:100%;background:var(--bg);border:1px solid var(--border);
                    color:var(--text);padding:8px 10px;
                    font-family:'Space Mono',monospace;font-size:12px;font-weight:700;
                    border-radius:4px;outline:none;box-sizing:border-box;
                    transition:border-color .15s;"
             onfocus="this.style.borderColor='var(--accent)'"
             onblur="this.style.borderColor='var(--border)'">
    </div>`;
  }

  #fieldSelect(id, label, options) {
    return `<div>
      <label for="${id}" style="display:block;font-size:9px;color:var(--muted);
                                text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;">
        ${label}
      </label>
      <select id="${id}"
              style="width:100%;background:var(--bg);border:1px solid var(--border);
                     color:var(--text);padding:8px 10px;
                     font-family:'Space Mono',monospace;font-size:11px;font-weight:700;
                     border-radius:4px;outline:none;box-sizing:border-box;cursor:pointer;">
        ${options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
    </div>`;
  }

  #resBox(label, value, color = 'var(--text)') {
    return `<div style="background:rgba(0,0,0,.25);border:1px solid var(--border);
                        border-radius:6px;padding:10px 12px;">
      <div style="font-size:8px;color:var(--muted);text-transform:uppercase;
                  letter-spacing:.8px;margin-bottom:4px;">${label}</div>
      <div style="font-size:16px;font-family:'Syne',sans-serif;font-weight:800;color:${color};">
        ${value}
      </div>
    </div>`;
  }

  #fmtU(v) {
    if (!isFinite(v)) return '—';
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M $';
    if (v >= 1_000)     return v.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' $';
    return v.toFixed(2) + ' $';
  }

  #fmtQ(v) {
    if (!isFinite(v)) return '—';
    if (v >= 1)      return v.toFixed(4);
    if (v >= 0.001)  return v.toFixed(6);
    return v.toExponential(3);
  }

  // ── Événements statiques ──────────────────────────────────

  #bindStaticEvents() {
    document.getElementById('risk-calc-close')
      ?.addEventListener('click', () => this.close());

    this.#overlay?.addEventListener('click', e => {
      if (e.target === this.#overlay) this.close();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.#overlay?.style.display === 'flex') {
        e.stopPropagation();
        this.close();
      }
    });

    ['position', 'rr', 'liq'].forEach(tab => {
      document.getElementById(`rc-tab-${tab}`)
        ?.addEventListener('click', () => this.#switchTab(tab));
    });
  }
}
