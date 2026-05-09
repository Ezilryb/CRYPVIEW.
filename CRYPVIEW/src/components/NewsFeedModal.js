// src/components/NewsFeedModal.js
class NewsFeedModal {
  constructor() {
    this._overlay  = null;   // créé à la première ouverture
    this._id       = null;   // uid lazy-init
    this.articles  = [];
    this.filter    = 'all';
    // NE PAS appeler init() ici
  }

  // ── API publique ────────────────────────────────────────────

  open(symbol) {
    // symbol ignoré pour NewsFeed (pas de paire), conservé pour cohérence API
    if (!this._overlay) this._buildOverlay();
    this._overlay.style.display = 'flex';
    this._fetchData();
  }

  close() {
    if (this._overlay) this._overlay.style.display = 'none';
  }

  updateSymbol(symbol) {
    // NewsFeed n'est pas filtré par paire, mais re-fetch si visible
    if (this._overlay?.style.display === 'flex') this._fetchData();
  }

  destroy() {
    this._overlay?.remove();
    this._overlay = null;
  }

  // ── Construction overlay ────────────────────────────────────

  _buildOverlay() {
    this._injectCSS();
    const ov = document.createElement('div');
    ov.className = 'crypview-modal-overlay';
    ov.innerHTML = `
      <div class="crypview-modal-box">
        <div class="nf-wrap">
          <div class="nf-header">
            <h2>📰 Actualités Crypto</h2>
            <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
              <button id="${this._uid('refresh')}" class="nf-btn-action">↻ Actualiser</button>
              <button id="${this._uid('close')}" class="nf-btn-close" aria-label="Fermer">✕</button>
            </div>
          </div>
          <div class="nf-filters" id="${this._uid('filters')}">
            <button class="nf-chip active" data-f="all">Tout</button>
            <button class="nf-chip" data-f="bitcoin">Bitcoin</button>
            <button class="nf-chip" data-f="ethereum">Ethereum</button>
            <button class="nf-chip" data-f="defi">DeFi</button>
            <button class="nf-chip" data-f="nft">NFT</button>
            <button class="nf-chip" data-f="regulation">Réglementation</button>
          </div>
          <div id="${this._uid('list')}" class="nf-list"><div class="sw-spin"></div></div>
        </div>
      </div>`;
  
    document.getElementById(this._uid('close'))?.addEventListener('click', () => this.close());
    // Attendre que le DOM soit injecté
    document.body.appendChild(ov);
    this._overlay = ov;
  
    ov.addEventListener('click', e => { if (e.target === ov) this.close(); });
  
    document.getElementById(this._uid('refresh')).onclick = () => this._fetchData();
    document.getElementById(this._uid('filters')).onclick = e => {
      if (!e.target.dataset.f) return;
      this._overlay.querySelectorAll('.nf-chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      this.filter = e.target.dataset.f;
      this._renderList();
    };
  }
  
  // Utilise CryptoCompare — API gratuite sans clé
  async _fetchData() {
    this._setLoading(true);
    try {
      const res  = await fetch(
        'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest',
        { signal: AbortSignal.timeout(8_000) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // CryptoCompare retourne { Data: [...] }
      this.articles = Array.isArray(json.Data) ? json.Data : [];
      this._renderList();
    } catch (e) {
      const list = document.getElementById(this._uid('list'));
      if (list) list.innerHTML =
        '<p style="color:#ef5350;padding:16px;text-align:center">Erreur de chargement des actualités.</p>';
    } finally {
      this._setLoading(false);
    }
  }
  
  _renderList() {
    const list = document.getElementById(this._uid('list'));
    if (!list) return;
  
    const kw = this.filter === 'all' ? '' : this.filter;
    const items = kw
      ? this.articles.filter(a =>
          (a.title + (a.body || '') + (a.categories || '')).toLowerCase().includes(kw))
      : this.articles;
  
    if (!items.length) {
      list.innerHTML = '<p style="color:#888;padding:16px;text-align:center">Aucun article trouvé.</p>';
      return;
    }
  
    // Structure CryptoCompare : { title, body, url, imageurl, source, published_on, categories }
    list.innerHTML = items.slice(0, 30).map(a => {
      const img = a.imageurl || '';
      const date = this._relTime(a.published_on); // timestamp Unix (secondes)
      const desc = (a.body || '').replace(/<[^>]+>/g, '').slice(0, 120);
      return `
        <a class="nf-item" href="${a.url}" target="_blank" rel="noopener">
          ${img ? `<img class="nf-thumb" src="${img}" onerror="this.style.display='none'" alt="">` : ''}
          <div class="nf-body">
            <div class="nf-meta">
              <span class="nf-source">${a.source_info?.name || a.source || 'Crypto News'}</span>
              <span class="nf-date">${date}</span>
            </div>
            <div class="nf-title">${a.title}</div>
            <div class="nf-desc">${desc}${desc.length >= 120 ? '…' : ''}</div>
          </div>
          <span class="nf-arrow">→</span>
        </a>`;
    }).join('');
  }
  
  _relTime(ts) {
    if (!ts) return '';
    // CryptoCompare donne des timestamps Unix en secondes
    const diff = (Date.now() / 1000 - ts);
    if (diff < 3600)  return `${Math.floor(diff / 60)}min`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}j`;
  }
  
  _setLoading(on) {
    if (on) {
      const list = document.getElementById(this._uid('list'));
      if (list) list.innerHTML = '<div class="sw-spin"></div>';
    }
  }
  
  _injectCSS() {
    if (document.getElementById('nfCSS')) return;
    const s = document.createElement('style'); s.id = 'nfCSS';
    s.textContent = `
      .crypview-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;align-items:center;justify-content:center;padding:16px}
      .crypview-modal-box{background:#0d0f1a;border:1px solid #2a2d3e;border-radius:14px;width:100%;max-width:860px;max-height:90vh;overflow-y:auto}
      .nf-wrap{font-family:'Inter',sans-serif;color:#e0e0e0;padding:16px}
      .nf-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
      .nf-header h2{margin:0;font-size:1.2rem}
      .nf-btn-action{background:#1e2130;border:1px solid #333;color:#aaa;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:.85rem}
      .nf-btn-close{background:none;border:1px solid #444;border-radius:6px;color:#888;font-size:1rem;cursor:pointer;padding:4px 10px;transition:all .2s;line-height:1}
      .nf-btn-close:hover{color:#fff;border-color:#aaa}
      .nf-filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
      .nf-chip{background:#1a1d2e;border:1px solid #2a2d3e;color:#aaa;padding:5px 12px;border-radius:20px;cursor:pointer;font-size:.82rem;transition:all .2s}
      .nf-chip.active,.nf-chip:hover{background:#26a69a;border-color:#26a69a;color:#fff}
      .nf-list{display:flex;flex-direction:column;gap:10px;max-height:600px;overflow-y:auto}
      .nf-item{display:flex;align-items:flex-start;gap:12px;background:#1a1d2e;border:1px solid #2a2d3e;border-radius:10px;padding:12px;text-decoration:none;color:inherit;transition:border-color .2s}
      .nf-item:hover{border-color:#26a69a}
      .nf-thumb{width:72px;height:52px;object-fit:cover;border-radius:6px;flex-shrink:0}
      .nf-body{flex:1;min-width:0}
      .nf-meta{display:flex;gap:8px;font-size:.75rem;color:#666;margin-bottom:4px}
      .nf-source{color:#26a69a;font-weight:600}
      .nf-title{font-size:.92rem;font-weight:600;color:#e0e0e0;line-height:1.35;margin-bottom:4px}
      .nf-desc{font-size:.8rem;color:#888;line-height:1.4}
      .nf-arrow{color:#444;font-size:1.2rem;align-self:center;flex-shrink:0}
      .sw-spin{width:28px;height:28px;border:3px solid #333;border-top-color:#26a69a;border-radius:50%;animation:swspin .8s linear infinite;margin:20px auto}
      @keyframes swspin{to{transform:rotate(360deg)}}
    `;
    document.head.appendChild(s);
  }
}

export default NewsFeedModal;
