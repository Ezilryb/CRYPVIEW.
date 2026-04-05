// ============================================================
//  src/pages/multi-flex.js — CrypView V2
//  Point d'entrée pour toutes les vues multi-panneaux flexibles.
//  Gère : initialisation LayoutManager, instanciation des charts,
//         sélecteur de layout dans le header, persistance localStorage.
//
//  ⚠️  IMPORT À ADAPTER :
//  Remplacer l'import de MultiChartInstance par le chemin exact
//  utilisé dans multi2.js / multi4.js (ex: '../chart/MultiChartInstance.js'
//  ou '../pages/multi.js' selon ton arborescence).
// ============================================================

import { LayoutManager, buildLayoutSelector, LAYOUT_CONFIGS } from '../components/LayoutManager.js';

// ── Import MultiChartInstance ─────────────────────────────────
// ⚠️  Adapter ce chemin selon l'export réel dans ton projet.
// Exemple : import { MultiChartInstance } from '../chart/MultiChartInstance.js';
// Si multi2.js exporte une factory, l'utiliser ici.
// Pour l'instant on importe depuis le module multi partagé.
import { MultiChartInstance } from './multi.js';

// ── Constantes ────────────────────────────────────────────────
const LS_LAYOUT_KEY  = 'crypview_flex_layout_v1';
const LS_SYMBOLS_KEY = 'crypview_flex_symbols_v1';

/** Symboles par défaut pour les N premiers panneaux */
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT', 'AVAXUSDT'];
const DEFAULT_TF = '1h';

// ── État global de la page ─────────────────────────────────────
/** @type {MultiChartInstance[]} */
let instances = [];
let layoutManager = null;

// ── DOM ───────────────────────────────────────────────────────
const grid        = document.getElementById('multi-grid');
const headerEl    = document.querySelector('header');
const dotEl       = document.getElementById('dot');
const statusEl    = document.getElementById('status-text');
const btnBack     = document.getElementById('btn-back');
const badgeEl     = document.getElementById('badge-label');

// ── Initialisation ────────────────────────────────────────────

function init() {
  // Priorité : 1) localStorage  2) data-layout sur le grid  3) 'h2' par défaut
  const pageDefault = grid?.dataset.layout ?? 'h2';
  const savedLayout = localStorage.getItem(LS_LAYOUT_KEY) ?? pageDefault;

  // Sélecteur de layout dans le header
  const selector = buildLayoutSelector(savedLayout, switchLayout);
  // Insérer avant le bouton back (ou en fin de header)
  if (btnBack) headerEl.insertBefore(selector, btnBack);
  else headerEl.appendChild(selector);

  // Construire le premier layout
  applyLayout(savedLayout);
}

// ── Changement de layout ──────────────────────────────────────

function switchLayout(key) {
  // Sauvegarder les symboles courants avant destruction
  persistSymbols();
  destroyAll();

  localStorage.setItem(LS_LAYOUT_KEY, key);
  applyLayout(key);
}

function applyLayout(key) {
  const cfg = LAYOUT_CONFIGS[key];
  if (!cfg) return;

  // Mettre à jour le badge dans le header
  if (badgeEl) badgeEl.textContent = cfg.badge;

  // Récupérer symboles sauvegardés
  const savedSymbols = loadSymbols();

  // Construire le DOM via LayoutManager
  if (!layoutManager) {
    layoutManager = new LayoutManager(grid, (panelEl, index) => {
      initPanel(panelEl, index, savedSymbols[index] ?? DEFAULT_SYMBOLS[index] ?? 'BTCUSDT');
    });
  } else {
    // Reconstruire avec nouveau callback
    layoutManager._onPanelCreated = (panelEl, index) => {
      initPanel(panelEl, index, savedSymbols[index] ?? DEFAULT_SYMBOLS[index] ?? 'BTCUSDT');
    };
  }

  layoutManager.build(key);
  updateStatus();
}

// ── Initialisation d'un panneau ───────────────────────────────

function initPanel(panelEl, index, symbol) {
  try {
    const instance = new MultiChartInstance(panelEl, {
      symbol,
      tf: DEFAULT_TF,
      index,
      onSymbolChange: (newSym) => handleSymbolChange(index, newSym),
      onStatusChange: updateStatus,
    });

    instances[index] = instance;

    // Écouter les redimensionnements déclenchés par le splitter
    panelEl.addEventListener('lm:resize', () => {
      instance.resize?.();
    });

  } catch (err) {
    console.error(`[multi-flex] Erreur init panneau ${index}:`, err);
  }
}

// ── Gestion des symboles ──────────────────────────────────────

function handleSymbolChange(index, symbol) {
  persistSymbols();
}

function persistSymbols() {
  const symbols = instances.map(inst => inst?.symbol ?? null);
  try {
    localStorage.setItem(LS_SYMBOLS_KEY, JSON.stringify(symbols));
  } catch (_) { /* quota dépassé — ignorer */ }
}

function loadSymbols() {
  try {
    const raw = localStorage.getItem(LS_SYMBOLS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

// ── Destruction ───────────────────────────────────────────────

function destroyAll() {
  instances.forEach(inst => inst?.destroy?.());
  instances = [];
}

// ── Statut global ─────────────────────────────────────────────

function updateStatus() {
  const connected = instances.filter(i => i?.isConnected).length;
  const total     = instances.filter(Boolean).length;

  if (dotEl) {
    dotEl.className = `dot ${connected > 0 ? 'live' : ''}`;
  }
  if (statusEl) {
    statusEl.textContent = total > 0
      ? `${connected}/${total} connecté${connected > 1 ? 's' : ''}`
      : 'Connexion…';
  }
}

// ── Navigation ────────────────────────────────────────────────

btnBack?.addEventListener('click', () => {
  destroyAll();
  window.location.href = 'page.html';
});

// ── Nettoyage avant déchargement ─────────────────────────────

window.addEventListener('beforeunload', () => {
  persistSymbols();
  destroyAll();
  layoutManager?.destroy();
});

// ── Démarrage ────────────────────────────────────────────────

init();
