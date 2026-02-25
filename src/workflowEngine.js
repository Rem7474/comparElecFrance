/**
 * workflowEngine.js - Workflow orchestration and state management
 * Handles complex multi-step workflows and state transitions
 * @module workflowEngine
 */

import { appState } from './state.js';

/**
 * Trigger full application recalculation after configuration changes
 * Orchestrates analysis → compareOffers → breakdown → PV simulation
 * Uses invalidateCache to prevent redundant calculations
 * @param {HTMLInputElement} fileInput - File input element
 * @param {Function} getRecordsFromCache - Cache retrieval function
 * @param {Function} invalidateCache - Cache invalidation function
 * @param {Function} ensureTempoDayMap - Tempo initialization
 * @param {Function} compareOffers - Cost comparison workflow
 * @param {Function} renderMonthlyBreakdown - Monthly breakdown workflow
 * @param {Function} runPvSimulation - PV simulation workflow
 * @param {Object} DEFAULTS - Tariff configuration
 * @param {Object} tempoLoading - Tempo loading indicator element
 * @param {Function} appendAnalysisLog - Logging function
 * @returns {Promise<void>}
 */
export async function triggerFullRecalculation(
  fileInput,
  getRecordsFromCache,
  invalidateCache,
  ensureTempoDayMap,
  compareOffers,
  renderMonthlyBreakdown,
  runPvSimulation,
  DEFAULTS,
  tempoLoading,
  appendAnalysisLog
) {
  const files = fileInput && fileInput.files;
  if (!files || files.length === 0) return;

  // Invalidate cache (tariff change, not file change)
  invalidateCache('tariff');

  const records = await getRecordsFromCache(files);
  if (!records || records.length === 0) return;

  // Ensure Tempo map if needed
  await ensureTempoDayMap(records, tempoLoading, DEFAULTS, (updates) => {
    if (updates.tempoDayMap) appState.setState({ tempoDayMap: updates.tempoDayMap }, 'TEMPO_MAP_LOADED');
    if (updates.tempoSourceMap) appState.setState({ tempoSourceMap: updates.tempoSourceMap }, 'TEMPO_SOURCES_UPDATED');
  });

  // Run workflows in parallel where possible
  try {
    appendAnalysisLog('Recalcul des offres...');
    await compareOffers(records);
    await renderMonthlyBreakdown(records);
    await runPvSimulation(records);
    appendAnalysisLog('Recalcul terminé.');
  } catch (err) {
    console.warn('Erreur lors du recalcul', err);
    appendAnalysisLog(`Erreur: ${err.message}`);
  }
}

/**
 * Setup bindings for subscription inputs (Base, HP/HC, Tempo)
 * Updates DEFAULTS and triggers recalculation
 * @param {Object} DEFAULTS - Tariff configuration
 * @param {Function} applySubscriptionInputs - Input processor
 * @param {Function} populateDefaultsDisplay - Display updater
 * @param {Function} triggerRecalc - Recalculation trigger
 */
export function setupSubscriptionInputBindings(
  DEFAULTS,
  applySubscriptionInputs,
  populateDefaultsDisplay,
  triggerRecalc
) {
  ['param-sub-base', 'param-sub-hphc', 'param-sub-tempo'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', async () => {
      const changed = applySubscriptionInputs();
      if (!changed) return;
      populateDefaultsDisplay();
      await triggerRecalc();
    });
  });
}

/**
 * Setup bindings for Total Charge Heures (TCH) tariff inputs
 * @param {Object} DEFAULTS - Tariff configuration
 * @param {Function} applyTotalChargeInputs - Input processor
 * @param {Function} populateDefaultsDisplay - Display updater
 * @param {Function} triggerRecalc - Recalculation trigger
 */
export function setupTotalChargeInputBindings(
  DEFAULTS,
  applyTotalChargeInputs,
  populateDefaultsDisplay,
  triggerRecalc
) {
  ['param-tch-hpRange', 'param-tch-hcRange', 'param-tch-hscRange', 'param-sub-tch'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', async () => {
      const changed = applyTotalChargeInputs();
      if (!changed) return;
      populateDefaultsDisplay();
      await triggerRecalc();
    });
  });
}

/**
 * Setup bindings for HP/HC range input
 * @param {Object} DEFAULTS - Tariff configuration
 * @param {Function} applyHcRangeInput - Range processor
 * @param {Function} populateDefaultsDisplay - Display updater
 * @param {Function} triggerRecalc - Recalculation trigger
 */
export function setupHcRangeInputBinding(
  DEFAULTS,
  applyHcRangeInput,
  populateDefaultsDisplay,
  triggerRecalc
) {
  const el = document.getElementById('param-hphc-hcRange');
  if (!el) return;

  el.addEventListener('change', async () => {
    const before = DEFAULTS.hp && DEFAULTS.hp.hcRange;
    applyHcRangeInput();
    const after = DEFAULTS.hp && DEFAULTS.hp.hcRange;
    if (before === after) return;
    populateDefaultsDisplay();
    await triggerRecalc();
  });
}
