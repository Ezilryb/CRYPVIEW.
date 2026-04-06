// ============================================================
//  src/utils/i18n-dom.js — CrypView i18n V1
//  Met à jour les éléments DOM statiques portant data-i18n
//  et data-i18n-ph après que la locale est résolue.
//
//  Usage :
//    import { applyDOMTranslations } from '../utils/i18n-dom.js';
//    applyDOMTranslations();  // à appeler après initI18n()
// ============================================================

import { t } from '../i18n/i18n.js';

/**
 * Parcourt tous les éléments [data-i18n] et remplace leur
 * textContent par la traduction correspondante.
 * Parcourt aussi [data-i18n-ph] pour les placeholders.
 */
export function applyDOMTranslations() {
  // ── Contenu texte ────────────────────────────────────────
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const translated = t(key);
    if (translated && translated !== key) {
      el.textContent = translated;
    }
  });

  // ── Placeholders (input / textarea) ──────────────────────
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.dataset.i18nPh;
    const translated = t(key);
    if (translated && translated !== key) {
      el.placeholder = translated;
    }
  });
}
