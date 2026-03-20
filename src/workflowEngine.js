/**
 * workflowEngine.js - Workflow orchestration
 * Coordinates full recalculation and parameter input bindings.
 * All dependencies are imported directly — no dependency injection needed.
 * @module workflowEngine
 */

import { appState } from './state.js';
import { DEFAULTS } from './config.js';
import { invalidateCache } from './calculationEngine.js';
import { ensureTempoDayMap, tempoLoading } from './tempoCalendar.js';
import { getRecordsFromCache } from './fileHandler.js';
import { compareOffers, renderMonthlyBreakdown, runPvSimulation } from './analysisWorkflow.js';
import { appendLog, getAnalysisLog } from './logger.js';
import { applySubscriptionInputs, applyHcRangeInput, applyTotalChargeHeuresInputs } from './utils.js';
import { populateDefaultsDisplay } from './uiManager.js';

/**
 * Trigger full recalculation after configuration changes.
 * Invalidates tariff cache, re-parses files if needed, loads TEMPO, runs all workflows.
 */
export async function triggerFullRecalculation() {
  const fileInput = document.getElementById('file-input');
  const files = fileInput && fileInput.files;
  if (!files || files.length === 0) return;

  invalidateCache('tariff');

  const records = await getRecordsFromCache(files);
  if (!records || records.length === 0) return;

  await ensureTempoDayMap(records, tempoLoading, DEFAULTS, (updates) => {
    if (updates.tempoDayMap) appState.setState({ tempoDayMap: updates.tempoDayMap }, 'TEMPO_MAP_LOADED');
    if (updates.tempoSourceMap) appState.setState({ tempoSourceMap: updates.tempoSourceMap }, 'TEMPO_SOURCES_UPDATED');
  });

  const log = getAnalysisLog();
  try {
    appendLog(log, 'Recalcul des offres...');
    await compareOffers(records);
    await renderMonthlyBreakdown(records);
    await runPvSimulation(records);
    appendLog(log, 'Recalcul terminé.');
  } catch (err) {
    console.warn('Erreur lors du recalcul', err);
    appendLog(log, `Erreur: ${err && err.message ? err.message : err}`);
  }
}

/**
 * Bind subscription inputs (Base, HP/HC, Tempo) — triggers recalculation on change.
 */
export function setupSubscriptionInputBindings() {
  ['param-sub-base', 'param-sub-hphc', 'param-sub-tempo'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', async () => {
      const changed = applySubscriptionInputs(DEFAULTS);
      if (!changed) return;
      populateDefaultsDisplay(DEFAULTS);
      await triggerFullRecalculation();
    });
  });
}

/**
 * Bind Total Charge Heures inputs — triggers recalculation on change.
 */
export function setupTotalChargeInputBindings() {
  ['param-tch-hpRange', 'param-tch-hcRange', 'param-tch-hscRange', 'param-sub-tch'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', async () => {
      const changed = applyTotalChargeHeuresInputs(DEFAULTS);
      if (!changed) return;
      populateDefaultsDisplay(DEFAULTS);
      await triggerFullRecalculation();
    });
  });
}

/**
 * Bind HP/HC range input — triggers recalculation on change.
 */
export function setupHcRangeInputBinding() {
  const el = document.getElementById('param-hphc-hcRange');
  if (!el) return;
  el.addEventListener('change', async () => {
    const before = DEFAULTS.hp && DEFAULTS.hp.hcRange;
    applyHcRangeInput(DEFAULTS);
    const after = DEFAULTS.hp && DEFAULTS.hp.hcRange;
    if (before === after) return;
    populateDefaultsDisplay(DEFAULTS);
    await triggerFullRecalculation();
  });
}
