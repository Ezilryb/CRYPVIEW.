// ============================================================
//  src/components/RiskCalculatorModal.js — CrypView V4.0
//  Outils de gestion du risque : 6 onglets.
//
//  Tab 1 — Taille de position
//  Tab 2 — Risque / Récompense
//  Tab 3 — Levier & Liquidation
//  Tab 4 — Scénario de perte max (Monte Carlo simplifié)
//  Tab 5 — Stop suiveur avancé (Fixed %, ATR, % des gains)
//  Tab 6 — Simulation slippage & frais
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

    ['position', 'rr', 'liq', 'maxloss', 'trailing', 'slippage'].forEach(t => {
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
      case 'maxloss':  content.innerHTML = this.#tplMaxLoss();  this.#bindMaxLoss();  break;
      case 'trailing': content.innerHTML = this.#tplTrailing(); this.#bindTrailing(); break;
      case 'slippage': content.innerHTML = this.#tplSlippage(); this.#bindSlippage(); break;
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
        ${this.#field('rc-entry',    "📍 Prix d'entrée",          priceStr,'number', 'any')}
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

      const riskUSD     = balance * riskPct / 100;
      const priceDiff   = Math.abs(entry - stop);
      const pctMove     = (priceDiff / entry) * 100;
      const positionUSD = (riskUSD / priceDiff) * entry;
      const quantity    = positionUSD / entry;
      const isLong      = entry > stop;

      res.style.display = 'block';
      res.innerHTML = `
        <div class="rc-result-title">📊 Résultats</div>
        <div class="rc-result-grid">
          ${this.#resBox('Risque en USD',      this.#fmtU(riskUSD),       'var(--red)')}
          ${this.#resBox('Taille de position', this.#fmtU(positionUSD),   'var(--accent)')}
          ${this.#resBox('Quantité à trader',  this.#fmtQ(quantity),      'var(--text)')}
          ${this.#resBox('Stop-loss %',        pctMove.toFixed(2) + ' %', 'var(--yellow)')}
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
    ['rc-balance', 'rc-risk-pct', 'rc-entry', 'rc-stop'].forEach(id =>
      document.getElementById(id)?.addEventListener('input', calc)
    );
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
        Évalue si un trade vaut la peine en comparant le <strong>gain potentiel</strong>
        à la <strong>perte maximale</strong>.
      </div>
      <div class="rc-grid2">
        ${this.#field('rr-entry',    "📍 Prix d'entrée",     entry, 'number', 'any')}
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
      const minWinRate = 1 / (1 + ratio) * 100;
      const ratioColor = ratio >= 3 ? 'var(--green)' : ratio >= 2 ? 'var(--accent)'
                       : ratio >= 1 ? 'var(--yellow)' : 'var(--red)';

      res.style.display = 'block';
      res.innerHTML = `
        <div class="rc-result-title">📊 Analyse R/R</div>
        <div style="text-align:center;margin-bottom:14px;">
          <div style="font-size:42px;font-family:'Syne',sans-serif;font-weight:800;color:${ratioColor};">${ratio.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--muted);">Ratio Risque / Récompense</div>
        </div>
        <div class="rc-result-grid">
          ${this.#resBox('Perte potentielle', '-' + this.#fmtU(lossUSD), 'var(--red)')}
          ${this.#resBox('Gain potentiel',    '+' + this.#fmtU(gainUSD), 'var(--green)')}
          ${this.#resBox('Stop-loss %',       ((risk / entry) * 100).toFixed(2) + ' %', 'var(--red)')}
          ${this.#resBox('Take-profit %',     ((reward / entry) * 100).toFixed(2) + ' %', 'var(--green)')}
        </div>
        <div class="rc-result-row">
          <span>Win-rate min. rentable :</span>
          <strong style="color:${minWinRate < 50 ? 'var(--green)' : 'var(--yellow)'}">${minWinRate.toFixed(1)} %</strong>
        </div>
        ${!validDir ? '<div class="rc-warn">⚠ Stop-loss du mauvais côté de l\'entrée.</div>' : ''}
        <div class="rc-rr-bar">
          <div class="rc-rr-loss" style="flex:${risk.toFixed(4)}"></div>
          <div class="rc-rr-pivot"></div>
          <div class="rc-rr-gain" style="flex:${reward.toFixed(4)}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);">
          <span>Stop 🛑 ${stop.toFixed(2)}</span>
          <span>Entrée 📍 ${entry.toFixed(2)}</span>
          <span>TP 🎯 ${tp.toFixed(2)}</span>
        </div>`;
    };

    document.getElementById('rr-calc')?.addEventListener('click', calc);
    ['rr-entry', 'rr-stop', 'rr-tp', 'rr-size-usd'].forEach(id =>
      document.getElementById(id)?.addEventListener('input', calc)
    );
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
      </div>
      <div class="rc-grid2">
        ${this.#field('liq-entry',    "📍 Prix d'entrée",            entry,  'number', 'any')}
        ${this.#field('liq-size-usd', '💵 Taille de position (USDT)', '1000', 'number', '0.01')}
        ${this.#fieldSelect('liq-side', '↕️ Direction', [['long','▲ LONG'], ['short','▼ SHORT']])}
        ${this.#field('liq-lev',      '⚡ Levier (x)',                '10',   'number', '1', '1', '125')}
        ${this.#field('liq-mm',       '🔧 Marge maintenance (%)',     '0.5',  'number', '0.01')}
        ${this.#field('liq-fee',      "💸 Frais d'ouverture (%)",    '0.06', 'number', '0.001')}
      </div>
      <button id="liq-calc" class="rc-btn-primary">▶ Calculer la liquidation</button>
      <div id="liq-result" class="rc-result" style="display:none"></div>
      <div class="rc-tip">
        💡 Binance Futures : marge maintenance BTC ≈ 0,5 %. Plus le levier est élevé, plus la liquidation est proche.
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

      const margin   = sizeUSD / lev;
      const qty      = sizeUSD / entry;
      const openFee  = sizeUSD * (fee / 100);
      const mmFrac   = mm / 100;
      let liqPrice;
      if (side === 'long') {
        liqPrice = entry * (1 - 1 / lev + mmFrac);
      } else {
        liqPrice = entry * (1 + 1 / lev - mmFrac);
      }
      liqPrice = Math.max(0, liqPrice);

      const pctToLiq = Math.abs(liqPrice - entry) / entry * 100;
      const maxLoss  = margin + openFee;
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
          ${this.#resBox('Marge requise',        this.#fmtU(margin), 'var(--accent)')}
          ${this.#resBox('Perte max (marge)',     '-' + this.#fmtU(maxLoss), 'var(--red)')}
        </div>
        <div class="rc-result-row"><span>Quantité :</span><strong>${this.#fmtQ(qty)} unités</strong></div>
        <div class="rc-result-row">
          <span>Direction :</span>
          <strong style="color:${isLong ? 'var(--green)' : 'var(--red)'}">
            ${isLong ? '▲ LONG' : '▼ SHORT'} × ${lev}
          </strong>
        </div>
        <div style="margin-top:12px;">
          <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-bottom:4px;">
            <span>${isLong ? '🛑 Liq.' : '📍 Entrée'} ${isLong ? liqPrice.toFixed(2) : entry.toFixed(2)}</span>
            <span>${pctToLiq.toFixed(2)} % de marge</span>
            <span>${isLong ? '📍 Entrée' : '🛑 Liq.'} ${isLong ? entry.toFixed(2) : liqPrice.toFixed(2)}</span>
          </div>
          <div style="height:8px;border-radius:4px;background:rgba(28,35,51,1);overflow:hidden;position:relative;">
            <div style="position:absolute;${isLong ? 'left' : 'right'}:0;height:100%;
                        width:${Math.min(100, pctToLiq * lev).toFixed(1)}%;
                        background:${liqColor};border-radius:4px;"></div>
          </div>
        </div>
        ${pctToLiq < 5
          ? '<div class="rc-warn">🔴 DANGER — Liquidation très proche ! Réduisez le levier.</div>'
          : pctToLiq < 10
          ? '<div class="rc-warn" style="border-color:var(--yellow);background:rgba(247,201,72,.07);">🟡 Levier élevé — surveillez votre position.</div>'
          : '<div style="font-size:9px;color:var(--green);margin-top:8px;padding:6px 10px;background:rgba(0,255,136,.07);border-radius:4px;border:1px solid rgba(0,255,136,.2);">✅ Distance de liquidation raisonnable.</div>'}`;
    };

    document.getElementById('liq-calc')?.addEventListener('click', calc);
    ['liq-entry', 'liq-size-usd', 'liq-lev', 'liq-mm', 'liq-fee'].forEach(id =>
      document.getElementById(id)?.addEventListener('input', calc)
    );
    document.getElementById('liq-side')?.addEventListener('change', calc);
    if (document.getElementById('liq-entry')?.value) calc();
  }

  // ══════════════════════════════════════════════════════════
  //  TAB 4 — Scénario de perte max (Monte Carlo simplifié)
  // ══════════════════════════════════════════════════════════

  #tplMaxLoss() {
    return `
      <div class="rc-desc">
        Simule l'impact de <strong>séries de pertes consécutives</strong> sur votre capital.
        Identifie le point de ruine et calibre le sizing optimal selon Kelly.
      </div>
      <div class="rc-grid2">
        ${this.#field('ml-balance',   '💰 Capital initial (USDT)',    '10000', 'number', '0.01')}
        ${this.#field('ml-risk-pct',  '⚠️ Risque par trade (%)',      '2',     'number', '0.1')}
        ${this.#field('ml-win-rate',  '🎯 Win rate estimé (%)',       '50',    'number', '1', '1', '100')}
        ${this.#field('ml-rr',        '⚖️ Ratio R/R moyen',           '1.5',   'number', '0.1')}
        ${this.#field('ml-n-trades',  '🔢 Nombre de trades à simuler','100',   'number', '1', '1', '1000')}
        ${this.#field('ml-alert-dd',  '🚨 Seuil alerte drawdown (%)', '20',    'number', '1')}
      </div>
      <button id="ml-calc" class="rc-btn-primary">▶ Simuler les scénarios</button>
      <div id="ml-result" class="rc-result" style="display:none">
        <div class="rc-result-title">📊 Analyse de survie du compte</div>
        <canvas id="ml-canvas" height="100"
                style="width:100%;display:block;border-radius:6px;
                       background:rgba(0,0,0,.3);margin-bottom:12px;"></canvas>
        <div id="ml-result-body"></div>
      </div>
      <div class="rc-tip">
        💡 Le critère de Kelly donne le % optimal à risquer pour maximiser la croissance à long terme.
        La demi-Kelly (Kelly / 2) est souvent recommandée pour réduire la volatilité du compte.
      </div>`;
  }

  #bindMaxLoss() {
    const calc = () => {
      const balance  = parseFloat(document.getElementById('ml-balance')?.value)   || 0;
      const riskPct  = parseFloat(document.getElementById('ml-risk-pct')?.value)  || 0;
      const winRate  = parseFloat(document.getElementById('ml-win-rate')?.value)  || 50;
      const rr       = parseFloat(document.getElementById('ml-rr')?.value)        || 1.5;
      const nTrades  = Math.min(1000, parseInt(document.getElementById('ml-n-trades')?.value) || 100);
      const alertDD  = parseFloat(document.getElementById('ml-alert-dd')?.value)  || 20;

      const res = document.getElementById('ml-result');
      if (!res) return;
      if (!balance || !riskPct || !nTrades) { res.style.display = 'none'; return; }

      // Critère de Kelly : f* = (p * (b+1) - 1) / b
      // p = win rate, b = ratio R/R
      const p      = winRate / 100;
      const q      = 1 - p;
      const kelly  = Math.max(0, (p * (rr + 1) - 1) / rr);
      const halfKelly = kelly / 2;
      const expectancy = p * rr - q;  // par unité de risque

      // Simulation déterministe : pire cas (N pertes consécutives) + scénario moyen
      const riskFrac = riskPct / 100;

      // Scénario 1 : perte consécutive pure (worst case)
      const worstCase = [];
      let bal = balance;
      let ruineAt = -1;
      for (let i = 0; i <= nTrades; i++) {
        worstCase.push(bal);
        if (bal < balance * 0.1 && ruineAt === -1) ruineAt = i;
        bal *= (1 - riskFrac);
      }

      // Scénario 2 : séquence aléatoire répétée 5 fois, on prend la médiane
      const simRuns = [];
      for (let run = 0; run < 20; run++) {
        let b = balance;
        const series = [b];
        for (let i = 0; i < nTrades; i++) {
          b *= Math.random() < p ? (1 + riskFrac * rr) : (1 - riskFrac);
          series.push(b);
        }
        simRuns.push(series);
      }
      // Médiane à chaque pas
      const medianSeries = Array.from({ length: nTrades + 1 }, (_, i) => {
        const vals = simRuns.map(r => r[i]).sort((a, b) => a - b);
        return vals[Math.floor(vals.length / 2)];
      });

      // MaxDD pire cas
      const worstDD = (balance - worstCase.at(-1)) / balance * 100;
      // Nb pertes consécutives avant alerte DD
      const lossesToAlert = Math.ceil(Math.log(1 - alertDD / 100) / Math.log(1 - riskFrac));
      // Balance après alerte DD
      const balAfterAlert = balance * Math.pow(1 - riskFrac, lossesToAlert);
      // Recovery needed
      const recoveryPct = (balance / balAfterAlert - 1) * 100;

      res.style.display = 'block';

      // Canvas
      requestAnimationFrame(() => {
        const canvas = document.getElementById('ml-canvas');
        if (!canvas) return;
        const W = canvas.offsetWidth;
        canvas.width = W;
        const H = 100;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);

        const allVals = [...worstCase, ...medianSeries];
        const minV = Math.min(...allVals) * 0.95;
        const maxV = Math.max(...allVals) * 1.05;
        const range = maxV - minV || 1;
        const xs = (i) => (i / nTrades) * W;
        const ys = (v) => H - ((v - minV) / range) * (H - 10) - 5;

        // Ligne de référence (balance initiale)
        ctx.strokeStyle = 'rgba(139,148,158,.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(0, ys(balance));
        ctx.lineTo(W, ys(balance));
        ctx.stroke();
        ctx.setLineDash([]);

        // Seuil d'alerte
        const alertBalance = balance * (1 - alertDD / 100);
        ctx.strokeStyle = 'rgba(255,153,0,.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, ys(alertBalance));
        ctx.lineTo(W, ys(alertBalance));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,153,0,.7)';
        ctx.font = '8px Space Mono,monospace';
        ctx.fillText(`-${alertDD}%`, W - 32, ys(alertBalance) - 3);

        // Série pire cas (rouge)
        ctx.beginPath();
        worstCase.forEach((v, i) => i === 0 ? ctx.moveTo(xs(i), ys(v)) : ctx.lineTo(xs(i), ys(v)));
        ctx.strokeStyle = 'rgba(255,61,90,.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Série médiane (vert)
        ctx.beginPath();
        medianSeries.forEach((v, i) => i === 0 ? ctx.moveTo(xs(i), ys(v)) : ctx.lineTo(xs(i), ys(v)));
        ctx.strokeStyle = 'rgba(0,255,136,.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Légende
        ctx.fillStyle = 'rgba(255,61,90,.85)';
        ctx.fillText('Pire cas', 6, 14);
        ctx.fillStyle = 'rgba(0,255,136,.85)';
        ctx.fillText('Médiane (×20 sim.)', 60, 14);
      });

      const kellyColor = kelly * 100 > riskPct * 1.5 ? 'var(--green)'
                       : kelly * 100 > riskPct ? 'var(--yellow)' : 'var(--red)';

      document.getElementById('ml-result-body').innerHTML = `
        <div class="rc-result-grid">
          ${this.#resBox('Kelly optimal',   (kelly * 100).toFixed(2) + ' %', kellyColor)}
          ${this.#resBox('Demi-Kelly',      (halfKelly * 100).toFixed(2) + ' %', 'var(--accent)')}
          ${this.#resBox('Espérance / trade', (expectancy * 100).toFixed(2) + ' %',
            expectancy > 0 ? 'var(--green)' : 'var(--red)')}
          ${this.#resBox('Pertes → alerte DD', lossesToAlert + ' trades', 'var(--yellow)')}
        </div>
        <div class="rc-result-row">
          <span>Balance après ${lossesToAlert} pertes consécutives :</span>
          <strong style="color:var(--red)">${this.#fmtU(balAfterAlert)}</strong>
        </div>
        <div class="rc-result-row">
          <span>Recovery nécessaire pour breakeven :</span>
          <strong style="color:var(--red)">+${recoveryPct.toFixed(1)} %</strong>
        </div>
        <div class="rc-result-row">
          <span>Balance médiane après ${nTrades} trades :</span>
          <strong style="color:${medianSeries.at(-1) >= balance ? 'var(--green)' : 'var(--red)'}">
            ${this.#fmtU(medianSeries.at(-1))}
          </strong>
        </div>
        ${kelly * 100 < riskPct
          ? `<div class="rc-warn">⚠ Votre risque actuel (${riskPct}%) dépasse la Kelly (${(kelly * 100).toFixed(2)}%). Vous sur-tradez — réduisez la taille.</div>`
          : ''}
        ${expectancy <= 0
          ? `<div class="rc-warn">🔴 Espérance négative (${(expectancy * 100).toFixed(2)}%) : votre stratégie n'est pas rentable sur le long terme.</div>`
          : ''}`;
    };

    document.getElementById('ml-calc')?.addEventListener('click', calc);
    ['ml-balance', 'ml-risk-pct', 'ml-win-rate', 'ml-rr', 'ml-n-trades', 'ml-alert-dd'].forEach(id =>
      document.getElementById(id)?.addEventListener('input', calc)
    );
  }

  // ══════════════════════════════════════════════════════════
  //  TAB 5 — Stop suiveur avancé
  // ══════════════════════════════════════════════════════════

  #tplTrailing() {
    const price = this.#callbacks.getCurrentPrice?.() ?? 0;
    const entry = price > 0 ? price.toFixed(price > 100 ? 2 : 6) : '';

    return `
      <div class="rc-desc">
        Calcule les niveaux de <strong>stop suiveur</strong> selon trois méthodes.
        Simulez comment votre stop évolue quand le prix monte.
      </div>
      <div class="rc-grid2">
        ${this.#field('tr-entry',   "📍 Prix d'entrée",           entry,  'number', 'any')}
        ${this.#field('tr-size',    '💵 Position (USDT)',          '1000', 'number', '0.01')}
        ${this.#fieldSelect('tr-method', '⚙️ Méthode de trail', [
          ['fixed_pct',  '% fixe (ex: 2%)'],
          ['atr',        'Multiple ATR'],
          ['gains_pct',  '% des gains'],
        ])}
        ${this.#field('tr-activation', '🚀 Activation (gain %)',  '1',    'number', '0.1')}
        ${this.#field('tr-trail-pct',  '📉 Trail % (pour % fixe)','2',    'number', '0.1')}
        ${this.#field('tr-atr',        '📊 Valeur ATR (prix)',    '',     'number', 'any')}
      </div>
      <div class="rc-grid2" style="margin-bottom:14px;">
        ${this.#field('tr-atr-mult', '✕ Multiplicateur ATR',     '2',    'number', '0.1')}
        ${this.#field('tr-gains-pct','📥 % des gains à protéger', '50',   'number', '1', '1', '100')}
      </div>
      <button id="tr-calc" class="rc-btn-primary">▶ Calculer le stop suiveur</button>
      <div id="tr-result" class="rc-result" style="display:none"></div>
      <div class="rc-tip">
        💡 <strong>% fixe</strong> : trail reste constant. <strong>ATR</strong> : s'adapte à la volatilité.
        <strong>% des gains</strong> : protège une partie du profit réalisé.
      </div>`;
  }

  #bindTrailing() {
    const updateMethodVisibility = () => {
      const method   = document.getElementById('tr-method')?.value ?? 'fixed_pct';
      const trailRow = document.getElementById('tr-trail-pct')?.closest('div');
      const atrRow   = document.getElementById('tr-atr')?.closest('div');
      const atrMult  = document.getElementById('tr-atr-mult')?.closest('div');
      const gainRow  = document.getElementById('tr-gains-pct')?.closest('div');
      if (trailRow) trailRow.style.opacity = method === 'fixed_pct' ? '1' : '0.35';
      if (atrRow)   atrRow.style.opacity   = method === 'atr' ? '1' : '0.35';
      if (atrMult)  atrMult.style.opacity  = method === 'atr' ? '1' : '0.35';
      if (gainRow)  gainRow.style.opacity  = method === 'gains_pct' ? '1' : '0.35';
    };

    document.getElementById('tr-method')?.addEventListener('change', updateMethodVisibility);
    updateMethodVisibility();

    const calc = () => {
      const entry      = parseFloat(document.getElementById('tr-entry')?.value)      || 0;
      const size       = parseFloat(document.getElementById('tr-size')?.value)       || 0;
      const method     = document.getElementById('tr-method')?.value ?? 'fixed_pct';
      const activation = parseFloat(document.getElementById('tr-activation')?.value) || 1;
      const trailPct   = parseFloat(document.getElementById('tr-trail-pct')?.value)  || 2;
      const atr        = parseFloat(document.getElementById('tr-atr')?.value)        || 0;
      const atrMult    = parseFloat(document.getElementById('tr-atr-mult')?.value)   || 2;
      const gainsPct   = parseFloat(document.getElementById('tr-gains-pct')?.value)  || 50;

      const res = document.getElementById('tr-result');
      if (!res) return;
      if (!entry || !size) { res.style.display = 'none'; return; }

      const qty           = size / entry;
      const activationPx  = entry * (1 + activation / 100);

      // Calcul du trail selon la méthode
      const computeStop = (currentPrice) => {
        switch (method) {
          case 'fixed_pct':
            return currentPrice * (1 - trailPct / 100);
          case 'atr': {
            const atrVal = atr > 0 ? atr : entry * 0.01;
            return currentPrice - atrVal * atrMult;
          }
          case 'gains_pct': {
            const gain = currentPrice - entry;
            if (gain <= 0) return entry * (1 - trailPct / 100);
            return entry + gain * (1 - gainsPct / 100);
          }
          default: return currentPrice * (1 - trailPct / 100);
        }
      };

      // Tableau des stops pour différents niveaux de prix
      const levels = [0, 1, 2, 3, 5, 7, 10, 15, 20, 30];
      const rows = levels.map(pctUp => {
        const px   = entry * (1 + pctUp / 100);
        const stop = computeStop(px);
        const gain = (stop - entry) * qty;
        const prot = pctUp > 0 ? (stop - entry) / (px - entry) * 100 : 0;
        const active = px >= activationPx;
        return { pctUp, px, stop, gain, prot, active };
      });

      // Stop initial (au niveau d'activation)
      const initialStop   = computeStop(activationPx);
      const initialGainPx = initialStop - entry;
      const breakEvenStop = computeStop(entry * (1 + (trailPct > 0 ? trailPct / 100 : 0.02) + activation / 100));

      res.style.display = 'block';
      res.innerHTML = `
        <div class="rc-result-title">
          🎯 Stop Suiveur — ${method === 'fixed_pct' ? `% fixe ${trailPct}%`
                              : method === 'atr' ? `ATR × ${atrMult}`
                              : `${gainsPct}% des gains`}
        </div>
        <div class="rc-result-grid" style="margin-bottom:12px;">
          ${this.#resBox("Prix d'activation", activationPx.toFixed(2), 'var(--accent)')}
          ${this.#resBox('Stop à activation', initialStop.toFixed(2), initialGainPx >= 0 ? 'var(--green)' : 'var(--red)')}
          ${this.#resBox('Gain/perte au stop', (initialGainPx >= 0 ? '+' : '') + this.#fmtU(initialGainPx * qty), initialGainPx >= 0 ? 'var(--green)' : 'var(--red)')}
          ${this.#resBox('Activation dès', '+' + activation + '% gain', 'var(--muted)')}
        </div>
        <div style="overflow-x:auto;margin-bottom:10px;">
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead>
              <tr style="background:var(--panel);color:var(--muted);font-size:8px;text-transform:uppercase;letter-spacing:.6px;">
                <th style="padding:5px 8px;text-align:right;">Prix actuel</th>
                <th style="padding:5px 8px;text-align:right;">+%</th>
                <th style="padding:5px 8px;text-align:right;">Stop suiveur</th>
                <th style="padding:5px 8px;text-align:right;">P&L protégé</th>
                <th style="padding:5px 8px;text-align:right;">% gains prot.</th>
                <th style="padding:5px 8px;text-align:center;">Actif</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr style="border-bottom:1px solid rgba(28,35,51,.5);
                            ${r.active ? '' : 'opacity:.45;'}">
                  <td style="padding:5px 8px;text-align:right;font-weight:700;color:var(--text);">
                    ${r.px.toFixed(r.px > 100 ? 2 : 4)}
                  </td>
                  <td style="padding:5px 8px;text-align:right;color:var(--muted);">+${r.pctUp}%</td>
                  <td style="padding:5px 8px;text-align:right;font-weight:700;
                              color:${r.gain >= 0 ? 'var(--green)' : 'var(--red)'};">
                    ${r.stop.toFixed(r.stop > 100 ? 2 : 4)}
                  </td>
                  <td style="padding:5px 8px;text-align:right;
                              color:${r.gain >= 0 ? 'var(--green)' : 'var(--red)'};">
                    ${r.gain >= 0 ? '+' : ''}${this.#fmtU(r.gain)}
                  </td>
                  <td style="padding:5px 8px;text-align:right;color:var(--muted);">
                    ${r.pctUp > 0 ? r.prot.toFixed(0) + '%' : '—'}
                  </td>
                  <td style="padding:5px 8px;text-align:center;">
                    ${r.active ? '✅' : '⏸'}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${method === 'atr' && !atr
          ? '<div class="rc-warn">ℹ Pas de valeur ATR saisie — estimation automatique à 1% du prix d\'entrée.</div>'
          : ''}`;
    };

    document.getElementById('tr-calc')?.addEventListener('click', calc);
    ['tr-entry', 'tr-size', 'tr-method', 'tr-activation',
     'tr-trail-pct', 'tr-atr', 'tr-atr-mult', 'tr-gains-pct'].forEach(id =>
      document.getElementById(id)?.addEventListener('input', calc)
    );
  }

  // ══════════════════════════════════════════════════════════
  //  TAB 6 — Simulation slippage & frais
  // ══════════════════════════════════════════════════════════

  #tplSlippage() {
    return `
      <div class="rc-desc">
        Quantifie l'impact réel des <strong>frais de trading et du slippage</strong>
        sur vos performances. Calcule le rendement minimum nécessaire pour être rentable.
      </div>
      <div class="rc-grid2">
        ${this.#field('sl-capital',  '💰 Capital total (USDT)',         '10000', 'number', '0.01')}
        ${this.#field('sl-size',     '💵 Taille trade typique (USDT)',  '1000',  'number', '0.01')}
        ${this.#fieldSelect('sl-order', '📋 Type d\'ordre', [
          ['market', 'Market (Taker)'],
          ['limit',  'Limit (Maker)'],
          ['mix',    'Mix 50/50'],
        ])}
        ${this.#field('sl-taker',    '💸 Frais taker (%)',              '0.10',  'number', '0.001')}
        ${this.#field('sl-maker',    '💸 Frais maker (%)',              '0.02',  'number', '0.001')}
        ${this.#field('sl-slip',     '🌊 Slippage aller+retour (%)',    '0.05',  'number', '0.001')}
        ${this.#field('sl-monthly',  '📅 Trades / mois',                '20',    'number', '1')}
        ${this.#field('sl-rr',       '⚖️ Ratio R/R moyen',              '1.5',   'number', '0.1')}
      </div>
      <button id="sl-calc" class="rc-btn-primary">▶ Calculer l'impact des frais</button>
      <div id="sl-result" class="rc-result" style="display:none"></div>
      <div class="rc-tip">
        💡 Le slippage est souvent sous-estimé. Sur des paires peu liquides, il peut dépasser les frais eux-mêmes.
        Choisir des ordres limit réduit drastiquement les coûts.
      </div>`;
  }

  #bindSlippage() {
    const calc = () => {
      const capital   = parseFloat(document.getElementById('sl-capital')?.value)  || 0;
      const size      = parseFloat(document.getElementById('sl-size')?.value)     || 0;
      const orderType = document.getElementById('sl-order')?.value ?? 'market';
      const taker     = parseFloat(document.getElementById('sl-taker')?.value)    || 0;
      const maker     = parseFloat(document.getElementById('sl-maker')?.value)    || 0;
      const slip      = parseFloat(document.getElementById('sl-slip')?.value)     || 0;
      const monthly   = parseInt(document.getElementById('sl-monthly')?.value)    || 20;
      const rr        = parseFloat(document.getElementById('sl-rr')?.value)       || 1.5;

      const res = document.getElementById('sl-result');
      if (!res) return;
      if (!capital || !size || !monthly) { res.style.display = 'none'; return; }

      // Frais effectifs selon le type d'ordre
      let effectiveFee;
      switch (orderType) {
        case 'market': effectiveFee = taker;                break;
        case 'limit':  effectiveFee = maker;               break;
        default:       effectiveFee = (taker + maker) / 2; break;
      }

      // Coût par round-trip (entrée + sortie)
      const feePerTrade     = size * (effectiveFee / 100) * 2;  // x2 pour entrée+sortie
      const slipPerTrade    = size * (slip / 100);               // déjà aller+retour
      const totalPerTrade   = feePerTrade + slipPerTrade;
      const pctPerTrade     = totalPerTrade / size * 100;

      // Projections mensuelles / annuelles
      const costMonthly     = totalPerTrade * monthly;
      const costAnnual      = costMonthly * 12;
      const feesAnnual      = feePerTrade  * monthly * 12;
      const slipAnnual      = slipPerTrade * monthly * 12;

      // Drag sur le capital
      const dragPct         = costAnnual / capital * 100;
      const feeDragPct      = feesAnnual / capital * 100;
      const slipDragPct     = slipAnnual / capital * 100;

      // Rendement break-even annuel
      const breakEvenAnnual = dragPct;

      // Avec vs sans frais : impact sur un backtest hypothétique
      // Supposons win rate 50%, R/R rr → espérance brute = 50%*rr - 50% = (rr-1)/2
      const grossExpPerTrade = size * ((rr - 1) / 2) / 100;  // en simplifié
      const netExpPerTrade   = grossExpPerTrade - totalPerTrade;
      const netExpPct        = netExpPerTrade / size * 100;

      // Impact sur le P&L annuel si espérance positive
      const annualGross = grossExpPerTrade * monthly * 12;
      const annualNet   = netExpPerTrade   * monthly * 12;
      const dragOnPnl   = annualGross > 0 ? (1 - annualNet / annualGross) * 100 : 0;

      // Comparaison market vs limit pour ce volume
      const costMarket  = size * (taker / 100) * 2 * monthly * 12 + slipAnnual;
      const costLimit   = size * (maker / 100) * 2 * monthly * 12;
      const savingLimit = costMarket - costLimit;

      const dragColor = dragPct > 10 ? 'var(--red)' : dragPct > 5 ? 'var(--yellow)' : 'var(--green)';

      res.style.display = 'block';
      res.innerHTML = `
        <div class="rc-result-title">💸 Analyse des coûts de trading</div>

        <div class="rc-result-grid" style="margin-bottom:12px;">
          ${this.#resBox('Coût par trade',       this.#fmtU(totalPerTrade),  'var(--red)')}
          ${this.#resBox('% du trade',           pctPerTrade.toFixed(3) + '%', 'var(--red)')}
          ${this.#resBox('Coût mensuel',         this.#fmtU(costMonthly),    'var(--yellow)')}
          ${this.#resBox('Coût annuel total',    this.#fmtU(costAnnual),     'var(--red)')}
        </div>

        <div style="margin-bottom:12px;">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">
            Décomposition annuelle
          </div>

          <!-- Barre frais vs slippage -->
          ${this.#costBar('Frais (${feeDragPct.toFixed(2)}% du capital)',
            feeDragPct, dragPct, 'rgba(255,61,90,.6)')}
          ${this.#costBar('Slippage (${slipDragPct.toFixed(2)}% du capital)',
            slipDragPct, dragPct, 'rgba(255,153,0,.6)')}

          <div style="margin-top:6px;">
            ${this.#barRow('Frais (annuels)',    this.#fmtU(feesAnnual),   feeDragPct,  dragPct, 'rgba(255,61,90,.6)')}
            ${this.#barRow('Slippage (annuel)',  this.#fmtU(slipAnnual),   slipDragPct, dragPct, 'rgba(255,153,0,.6)')}
          </div>
        </div>

        <div class="rc-result-row">
          <span>Drag annuel sur le capital :</span>
          <strong style="color:${dragColor}">${dragPct.toFixed(2)} %</strong>
        </div>
        <div class="rc-result-row">
          <span>Rendement annuel minimum (break-even) :</span>
          <strong style="color:var(--yellow)">+${breakEvenAnnual.toFixed(2)} %</strong>
        </div>
        <div class="rc-result-row">
          <span>Impact sur P&L brut (hypothèse R/R ${rr}) :</span>
          <strong style="color:${dragOnPnl > 30 ? 'var(--red)' : 'var(--yellow)'}">
            −${dragOnPnl > 0 ? dragOnPnl.toFixed(1) : '0'}% de vos gains
          </strong>
        </div>

        <div style="margin-top:12px;padding:10px 14px;background:rgba(0,200,255,.05);
                    border:1px solid rgba(0,200,255,.15);border-radius:6px;">
          <div style="font-size:9px;color:#00c8ff;text-transform:uppercase;
                      letter-spacing:.8px;margin-bottom:8px;">
            💡 Comparaison Market vs Limit (${monthly} trades/mois)
          </div>
          <div class="rc-result-row">
            <span>Coût annuel Market :</span>
            <strong style="color:var(--red)">${this.#fmtU(costMarket)}</strong>
          </div>
          <div class="rc-result-row">
            <span>Coût annuel Limit :</span>
            <strong style="color:var(--green)">${this.#fmtU(costLimit)}</strong>
          </div>
          <div class="rc-result-row">
            <span>Économie annuelle (limit vs market) :</span>
            <strong style="color:var(--green)">+${this.#fmtU(savingLimit)}</strong>
          </div>
        </div>

        ${dragPct > 15
          ? '<div class="rc-warn">🔴 Drag > 15% — vos frais détruisent votre capital. Réduisez la fréquence ou utilisez des ordres limit.</div>'
          : dragPct > 7
          ? '<div class="rc-warn" style="border-color:var(--yellow);background:rgba(247,201,72,.07);">🟡 Drag entre 7–15% — frais élevés. Privilégiez les ordres limit et réduisez le slippage.</div>'
          : '<div style="font-size:9px;color:var(--green);margin-top:8px;padding:6px 10px;background:rgba(0,255,136,.07);border-radius:4px;border:1px solid rgba(0,255,136,.2);">✅ Frais maîtrisés — votre structure de coûts est raisonnable.</div>'}`;
    };

    document.getElementById('sl-calc')?.addEventListener('click', calc);
    ['sl-capital', 'sl-size', 'sl-order', 'sl-taker', 'sl-maker',
     'sl-slip', 'sl-monthly', 'sl-rr'].forEach(id =>
      document.getElementById(id)?.addEventListener('input', calc)
    );
    document.getElementById('sl-order')?.addEventListener('change', calc);
  }

  // ── Helper : barre de progression ────────────────────────

  #barRow(label, value, partPct, totalPct, color) {
    const width = totalPct > 0 ? Math.min(100, (partPct / totalPct) * 100) : 0;
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
        <div style="flex:1;font-size:9px;color:var(--muted);">${label}</div>
        <div style="flex:2;height:6px;background:rgba(28,35,51,1);border-radius:3px;overflow:hidden;">
          <div style="width:${width.toFixed(1)}%;height:100%;background:${color};border-radius:3px;"></div>
        </div>
        <div style="min-width:60px;text-align:right;font-size:9px;font-weight:700;color:var(--text);">
          ${value}
        </div>
      </div>`;
  }

  #costBar(label, val, total, color) { return ''; } // kept for template compat

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
                    border-radius:4px;outline:none;box-sizing:border-box;transition:border-color .15s;"
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
                     color:var(--text);padding:8px 10px;font-family:'Space Mono',monospace;
                     font-size:11px;font-weight:700;border-radius:4px;outline:none;
                     box-sizing:border-box;cursor:pointer;">
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

    ['position', 'rr', 'liq', 'maxloss', 'trailing', 'slippage'].forEach(tab => {
      document.getElementById(`rc-tab-${tab}`)
        ?.addEventListener('click', () => this.#switchTab(tab));
    });
  }
}
