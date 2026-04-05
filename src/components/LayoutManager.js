// ============================================================
//  src/components/LayoutManager.js — CrypView V2
//  Gère les layouts multi-panneaux flexibles :
//    - Construction DOM (flex colonnes + splitters)
//    - Drag splitters redimensionnables (vertical + horizontal)
//    - Fullscreen par panneau (toggle expand/collapse)
//
//  Layouts disponibles :
//    h2    → 2 colonnes côte à côte
//    1p2   → 1 grand panneau gauche + 2 petits droite
//    1p3   → 1 grand panneau gauche + 3 petits droite
//    2x2   → grille 2×2 (alias de multi4)
//    3x3   → grille 3×3 (9 panneaux)
//    v2    → 2 panneaux empilés verticalement
//    v3    → 3 panneaux empilés verticalement
// ============================================================

/** @typedef {{ label: string, badge: string, panels: number, columns: number[][] }} LayoutConfig */

/**
 * Configurations des layouts.
 * `columns` : tableau de colonnes, chaque colonne = liste d'indices de panneaux.
 * Ex: [[0], [1, 2]] → colonne gauche avec panneau 0, colonne droite avec panneaux 1 et 2.
 */
export const LAYOUT_CONFIGS = {
  h2:  { label: '↔ 2',   badge: '2',   panels: 2, columns: [[0], [1]] },
  '1p2': { label: '⬛ 1+2', badge: '1+2', panels: 3, columns: [[0], [1, 2]] },
  '1p3': { label: '⬛ 1+3', badge: '1+3', panels: 4, columns: [[0], [1, 2, 3]] },
  '2x2': { label: '⊞ 2×2', badge: '4',   panels: 4, columns: [[0, 2], [1, 3]] },
  '3x3': { label: '⊞ 3×3', badge: '9',   panels: 9, columns: [[0, 3, 6], [1, 4, 7], [2, 5, 8]] },
  v2:  { label: '↕ 2',   badge: '↕2',  panels: 2, columns: [[0, 1]] },
  v3:  { label: '↕ 3',   badge: '↕3',  panels: 3, columns: [[0, 1, 2]] },
};

export class LayoutManager {
  /**
   * @param {HTMLElement} container  — #multi-grid
   * @param {(panel: HTMLElement, index: number) => void} onPanelCreated
   */
  constructor(container, onPanelCreated) {
    this._container = container;
    this._onPanelCreated = onPanelCreated;
    this._panels = [];
    this._fullscreenPanel = null;
    this._fsCleanup = null;
    this._layoutKey = null;
  }

  // ── API publique ──────────────────────────────────────────

  /** Construit le layout et notifie chaque panneau via le callback. */
  build(layoutKey) {
    const cfg = LAYOUT_CONFIGS[layoutKey];
    if (!cfg) { console.warn(`[LayoutManager] Layout inconnu : ${layoutKey}`); return; }

    this._layoutKey = layoutKey;
    this._panels = [];
    this._container.innerHTML = '';
    this._container.className = 'multi-grid-flex';

    // Créer N panneaux vides
    const panelEls = Array.from({ length: cfg.panels }, (_, i) => this._createPanel(i));
    this._panels = panelEls;

    // Construire les colonnes avec splitters H entre les rangs
    cfg.columns.forEach((colPanels, ci) => {
      const col = this._buildColumn(colPanels.map(i => panelEls[i]));
      this._container.appendChild(col);

      // Splitter vertical entre colonnes (sauf après la dernière)
      if (ci < cfg.columns.length - 1) {
        this._container.appendChild(this._buildSplitter('v'));
      }
    });

    // Notifier l'extérieur pour chaque panneau
    panelEls.forEach((el, i) => this._onPanelCreated(el, i));
  }

  /** Retourne l'élément panneau par index. */
  getPanel(index) { return this._panels[index] ?? null; }

  /** Nombre de panneaux dans le layout courant. */
  get panelCount() { return this._panels.length; }

  /** Destroy : retire les listeners fullscreen globaux. */
  destroy() {
    this._fsCleanup?.();
    this._container.innerHTML = '';
    this._panels = [];
  }

  // ── Construction DOM ──────────────────────────────────────

  /** Crée une colonne flex contenant les panneaux + splitters H entre eux. */
  _buildColumn(panels) {
    const col = document.createElement('div');
    col.className = 'lm-col';

    panels.forEach((panel, ri) => {
      col.appendChild(panel);
      if (ri < panels.length - 1) {
        col.appendChild(this._buildSplitter('h'));
      }
    });

    return col;
  }

  /** Crée un panneau vide avec header minimaliste (titre + btn fullscreen). */
  _createPanel(index) {
    const panel = document.createElement('div');
    panel.className = 'chart-panel';
    panel.dataset.panelIndex = String(index);

    // Bouton fullscreen intégré dans un wrapper overlay
    const fsBtn = document.createElement('button');
    fsBtn.className = 'lm-fs-btn';
    fsBtn.title = 'Plein écran';
    fsBtn.setAttribute('aria-label', 'Basculer en plein écran');
    fsBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M1.5 1h4v1.5h-2.5v2.5h-1.5v-4zm9 0h4v4h-1.5v-2.5h-2.5v-1.5zm-9 9h1.5v2.5h2.5v1.5h-4v-4zm11.5 2.5h-2.5v-2.5h-1.5v4h4v-1.5z"/></svg>';
    fsBtn.addEventListener('click', () => this._toggleFullscreen(panel));

    panel.appendChild(fsBtn);
    return panel;
  }

  // ── Drag Splitters ────────────────────────────────────────

  /**
   * Crée un splitter draggable.
   * @param {'v'|'h'} direction — vertical (entre colonnes) ou horizontal (entre rangs)
   */
  _buildSplitter(direction) {
    const splitter = document.createElement('div');
    splitter.className = `lm-splitter lm-splitter-${direction}`;
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', direction === 'v' ? 'vertical' : 'horizontal');

    this._attachDrag(splitter, direction);
    return splitter;
  }

  _attachDrag(splitter, direction) {
    const isV = direction === 'v';

    splitter.addEventListener('pointerdown', e => {
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      splitter.classList.add('lm-splitter--active');

      const prev = splitter.previousElementSibling;
      const next  = splitter.nextElementSibling;
      if (!prev || !next) return;

      // Taille initiale en px
      const rect  = prev.getBoundingClientRect();
      const start = isV ? e.clientX : e.clientY;
      const prevInitial = isV ? rect.width : rect.height;

      const onMove = ev => {
        const delta = (isV ? ev.clientX : ev.clientY) - start;
        const newSize = Math.max(80, prevInitial + delta); // min 80px par panneau
        prev.style.flexBasis = `${newSize}px`;
        prev.style.flexGrow  = '0';
        prev.style.flexShrink = '0';
        next.style.flexBasis = '0';
        next.style.flexGrow  = '1';
        next.style.flexShrink = '1';

        // Forcer le redraw des charts internes (ResizeObserver devrait suffire,
        // mais on dispatch un event au cas où)
        prev.dispatchEvent(new CustomEvent('lm:resize'));
        next.dispatchEvent(new CustomEvent('lm:resize'));
      };

      const onUp = () => {
        splitter.classList.remove('lm-splitter--active');
        splitter.releasePointerCapture(e.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  // ── Fullscreen ────────────────────────────────────────────

  _toggleFullscreen(panel) {
    if (this._fullscreenPanel === panel) {
      this._exitFullscreen();
    } else {
      this._enterFullscreen(panel);
    }
  }

  _enterFullscreen(panel) {
    if (this._fullscreenPanel) this._exitFullscreen();

    this._fullscreenPanel = panel;
    panel.classList.add('lm-panel--fullscreen');

    // Overlay sombre derrière
    const overlay = document.createElement('div');
    overlay.className = 'lm-fs-overlay';
    overlay.addEventListener('click', () => this._exitFullscreen());
    document.body.appendChild(overlay);

    // Mettre à jour l'icône du bouton
    const btn = panel.querySelector('.lm-fs-btn');
    if (btn) btn.title = 'Quitter le plein écran';

    // Raccourci Escape
    const onEsc = e => { if (e.key === 'Escape') this._exitFullscreen(); };
    document.addEventListener('keydown', onEsc);

    this._fsCleanup = () => {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
    };

    // Redraw du chart dans le panneau
    panel.dispatchEvent(new CustomEvent('lm:resize'));
  }

  _exitFullscreen() {
    if (!this._fullscreenPanel) return;
    this._fullscreenPanel.classList.remove('lm-panel--fullscreen');
    const btn = this._fullscreenPanel.querySelector('.lm-fs-btn');
    if (btn) btn.title = 'Plein écran';
    this._fullscreenPanel.dispatchEvent(new CustomEvent('lm:resize'));
    this._fsCleanup?.();
    this._fsCleanup = null;
    this._fullscreenPanel = null;
  }
}

// ── Sélecteur de layout (composant HTML injectable dans le header) ──────────

/**
 * Crée la barre de sélection de layout à injecter dans le <header>.
 * @param {string} currentKey   — clé du layout actif
 * @param {(key: string) => void} onChange
 * @returns {HTMLElement}
 */
export function buildLayoutSelector(currentKey, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'lm-selector';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Sélection du layout');

  Object.entries(LAYOUT_CONFIGS).forEach(([key, cfg]) => {
    const btn = document.createElement('button');
    btn.className = 'lm-sel-btn' + (key === currentKey ? ' active' : '');
    btn.textContent = cfg.badge;
    btn.title = cfg.label;
    btn.setAttribute('aria-pressed', String(key === currentKey));
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.lm-sel-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      onChange(key);
    });
    wrap.appendChild(btn);
  });

  return wrap;
}
