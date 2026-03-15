// ============================================================
//  src/api/binance.ws.js — CrypView V2.1.4 (FINAL)
//
//  Corrections :
//  [Fix A] Auto-connect quand un callback est passé au constructeur.
//          multi.js utilise new WSManager(url, callback, opts) sans
//          jamais appeler .connect() — le WS ne s'ouvrait jamais.
//          Avec cette correction, passer un callback déclenche
//          automatiquement la connexion via queueMicrotask (ce qui
//          laisse le temps au caller de poser ses handlers onOpen/onClose
//          avant que la socket ne soit créée).
//
//  [Fix B] Heartbeat 35s, backoff 1s→30s, CustomEvents ws-status-changed
//          (déjà présents dans la version précédente).
// ============================================================

import { BINANCE, WS_CONFIG } from '../config.js';
import { showToast }          from '../utils/toast.js';

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS  = 30_000;
const MAX_RECONNECT_ATTEMPTS  = WS_CONFIG.MAX_RECONNECT_ATTEMPTS ?? 6;
const SILENCE_TIMEOUT_MS      = 35_000;

// ── Helpers ───────────────────────────────────────────────────

function emitStatus(state, extra = {}) {
  window.dispatchEvent(
    new CustomEvent('ws-status-changed', { detail: { state, ...extra }, bubbles: false })
  );
}

export function closeWS(ws) {
  if (!ws) return null;
  try {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  } catch (_) {}
  return null;
}

// ── Classe WSManager ──────────────────────────────────────────

export class WSManager {

  #ws                = null;
  #url               = '';
  #reconnectAttempts = 0;
  #reconnectTimer    = null;
  #silenceTimer      = null;
  #destroyed         = false;

  // Callbacks publics — surcharger après instanciation OU passer en constructeur
  onOpen    = () => {};
  onMessage = (_data) => {};
  onClose   = () => {};

  /**
   * @param {string}    url        — URL du stream WebSocket Binance
   * @param {Function} [callback]  — Raccourci pour onMessage.
   *   Forme utilisée par multi.js :
   *     new WSManager(url, msg => this.#onKline(msg))
   *   Quand un callback est fourni, la connexion démarre automatiquement
   *   via queueMicrotask (laisse le caller poser onOpen/onClose d'abord).
   *
   * [Fix A] : sans auto-connect, multi.js créait le WSManager mais
   *   n'appelait jamais .connect() → WS jamais ouvert → graphique figé.
   *
   * @param {object} [_opts] — Ignoré (rétrocompatibilité multi.js)
   */
  constructor(url, callback, _opts) {
    this.#url = url;

    if (typeof callback === 'function') {
      this.onMessage = callback;
      // Auto-connect différé d'un tick pour laisser le caller
      // surcharger onOpen / onClose si besoin avant l'ouverture socket.
      queueMicrotask(() => {
        if (!this.#destroyed) this.connect();
      });
    }
  }

  // ── API publique ──────────────────────────────────────────

  connect() {
    if (this.#destroyed) return;

    const prev = this.#ws;
    this.#ws = null;
    this.#clearTimers();

    if (prev) {
      prev.onopen = prev.onmessage = prev.onerror = null;

      if (prev.readyState === WebSocket.CLOSING) {
        prev.onclose = () => {
          prev.onclose = null;
          if (!this.#destroyed) this.#openSocket();
        };
        return;
      }

      prev.onclose = null;
      if (prev.readyState === WebSocket.CONNECTING || prev.readyState === WebSocket.OPEN) {
        prev.close();
      }
    }

    this.#openSocket();
  }

  /**
   * Change d'URL et reconnecte. Remet à zéro le compteur de tentatives.
   * @param {string} newUrl
   */
  reconnect(newUrl) {
    this.#url               = newUrl;
    this.#reconnectAttempts = 0;
    this.#destroyed         = false;
    this.#clearTimers();
    this.connect();
  }

  /**
   * Libère toutes les ressources. L'instance ne peut plus être réutilisée.
   */
  destroy() {
    this.#destroyed = true;
    this.#clearTimers();
    this.#ws = closeWS(this.#ws);
    emitStatus('disconnected');
  }

  // ── Privé : ouverture socket ──────────────────────────────

  #openSocket() {
    if (this.#destroyed) return;
    this.#ws = new WebSocket(this.#url);

    this.#ws.onopen = () => {
      this.#reconnectAttempts = 0;
      this.#resetSilenceTimer();
      emitStatus('connected');
      this.onOpen();
    };

    this.#ws.onmessage = (event) => {
      this.#resetSilenceTimer();
      try { this.onMessage(JSON.parse(event.data)); } catch (_) {}
    };

    this.#ws.onerror = () => {
      // Toujours suivi d'un onclose — on laisse onclose gérer la reconnexion
    };

    this.#ws.onclose = () => {
      this.#clearSilenceTimer();
      if (this.#destroyed) return;
      this.onClose();
      this.#scheduleReconnect();
    };
  }

  // ── Privé : heartbeat ────────────────────────────────────

  #resetSilenceTimer() {
    this.#clearSilenceTimer();
    this.#silenceTimer = setTimeout(() => {
      showToast(
        `Connexion silencieuse (${SILENCE_TIMEOUT_MS / 1000}s sans données) — reconnexion…`,
        'warning', 4_000
      );
      emitStatus('reconnecting', { reason: 'silence' });

      // Fermeture forcée → déclenchera onclose → #scheduleReconnect
      const dead = this.#ws;
      this.#ws = null;
      if (dead) {
        dead.onclose = () => {
          dead.onclose = null;
          if (!this.#destroyed) this.#scheduleReconnect();
        };
        dead.onopen = dead.onmessage = dead.onerror = null;
        try { dead.close(); } catch (_) {}
      } else if (!this.#destroyed) {
        this.#scheduleReconnect();
      }
    }, SILENCE_TIMEOUT_MS);
  }

  #clearSilenceTimer() {
    if (this.#silenceTimer !== null) {
      clearTimeout(this.#silenceTimer);
      this.#silenceTimer = null;
    }
  }

  // ── Privé : backoff exponentiel ──────────────────────────

  /** Annule les deux timers (reconnexion + silence). */
  #clearTimers() {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#clearSilenceTimer();
  }

  /**
   * Délais : 1s → 2s → 4s → 8s → 16s → 30s (plafonné)
   */
  #scheduleReconnect() {
    if (this.#destroyed) return;

    if (this.#reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      emitStatus('disconnected', { reason: 'max_attempts' });
      showToast(
        'Connexion WebSocket perdue après plusieurs tentatives. Change de paire ou recharge la page.',
        'error', 8_000
      );
      return;
    }

    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * Math.pow(2, this.#reconnectAttempts)
    );
    this.#reconnectAttempts++;

    emitStatus('reconnecting', {
      attempt: this.#reconnectAttempts,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      delayMs: delay,
    });

    showToast(
      `WS déconnecté — reconnexion dans ${(delay / 1000).toFixed(0)}s… ` +
      `(${this.#reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
      'warning', delay
    );

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// ── Factories ────────────────────────────────────────────────
// Utilisées par ChartCore.js — appellent .connect() explicitement.

export function createKlineStream(symbol, interval) {
  return new WSManager(BINANCE.wsKline(symbol, interval));
}
export function createAggTradeStream(symbol) {
  return new WSManager(BINANCE.wsAgg(symbol));
}
export function createTickerStream(symbol) {
  return new WSManager(BINANCE.wsTicker(symbol));
}
export function createTradeStream(symbol) {
  return new WSManager(BINANCE.wsTrades(symbol));
}
