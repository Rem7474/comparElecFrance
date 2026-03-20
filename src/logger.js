/**
 * logger.js - Application logging utility
 * Provides appendLog for user-visible messages in the analysis log panel
 * @module logger
 */

/**
 * Append a message to a log DOM element
 * @param {HTMLElement|null} el - Log element to append to
 * @param {string} msg - Message text
 */
export function appendLog(el, msg) {
  if (!el) return;
  el.textContent = (el.textContent ? `${el.textContent}\n` : '') + msg;
}

/**
 * Get the analysis log DOM element (lazy)
 * @returns {HTMLElement|null}
 */
export function getAnalysisLog() {
  return document.getElementById('analysis-log');
}
