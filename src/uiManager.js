/**
 * uiManager.js - UI initialization and event listener management
 * Handles all DOM interactions, form inputs, and UI state updates.
 * Dependencies are imported directly — no dependency injection.
 * @module uiManager
 */

import { appState } from './state.js';
import { DEFAULTS } from './config.js';
import { compareOffers, renderMonthlyBreakdown, runPvSimulation, analyzeFilesNow, runEnsureTempoMap } from './analysisWorkflow.js';
import { getRecordsFromCache } from './fileHandler.js';

/**
 * Initialize all DOM event listeners and handlers.
 */
export function initializeUIListeners() {
  setupFileInput();
  setupPVToggle();
  setupParameterInputs();
  setupAnalysisButtons();
}

/**
 * Setup file input and drag-drop handlers
 */
function setupFileInput() {
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const dropZoneText = document.getElementById('drop-zone-text');
  const dropZoneSub = document.getElementById('drop-zone-subtext');

  if (!fileInput || !dropZone) return;

  // Drag and drop
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }, false);
  });

  dropZone.addEventListener('dragenter', () => dropZone.classList.add('drag-over'));
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      fileInput.files = files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  fileInput.addEventListener('change', async () => {
    if (fileInput.files.length === 0) {
      dropZone.classList.remove('has-file');
      if (dropZoneText) dropZoneText.textContent = 'Cliquez ou glissez le fichier ici';
      if (dropZoneSub) dropZoneSub.textContent = 'Formats acceptés : .json (Enedis) ou .csv';
      return;
    }

    dropZone.classList.add('has-file');
    if (dropZoneText) dropZoneText.textContent = fileInput.files.length > 1 ? `${fileInput.files.length} fichiers sélectionnés` : fileInput.files[0].name;
    if (dropZoneSub) dropZoneSub.textContent = '⏳ Analyse en cours...';

    const dashboard = document.getElementById('dashboard-section');
    if (dashboard) dashboard.classList.remove('hidden');

    try {
      const records = await getRecordsFromCache(fileInput.files);
      await runEnsureTempoMap(records);
      await analyzeFilesNow(records);
      await compareOffers(records);
      await renderMonthlyBreakdown(records);
      await runPvSimulation(records);
      if (dropZoneSub) dropZoneSub.textContent = '✅ Analyse terminée';
    } catch (error) {
      console.error('Erreur analyse fichiers:', error);
      if (dropZoneSub) dropZoneSub.textContent = `❌ Erreur: ${error.message || 'Erreur inconnue'}`;
    }
  });
}

/**
 * Setup PV toggle and related inputs
 */
function setupPVToggle() {
  const toggle = document.getElementById('toggle-pv');
  const pvSection = document.getElementById('pv-inputs-section');
  const pvReportSec = document.getElementById('pv-report-section');

  if (!toggle || !pvSection) return;

  toggle.addEventListener('change', async e => {
    pvSection.classList.toggle('hidden', !e.target.checked);
    if (pvReportSec) pvReportSec.classList.toggle('hidden', !e.target.checked);

    if (appState.records && appState.records.length > 0) {
      await compareOffers(appState.records);
      await renderMonthlyBreakdown(appState.records);
    }
  });
}

/**
 * Setup parameter input validation and change handlers
 */
function setupParameterInputs() {
  const hcRangeInput = document.getElementById('param-hphc-hcRange');
  const pvRegion = document.getElementById('pv-region');
  const pvKwp = document.getElementById('pv-kwp');

  if (hcRangeInput) {
    hcRangeInput.addEventListener('change', e => {
      const isValid = validateHCRange(e.target.value);
      e.target.classList.toggle('input-error', !isValid);
      if (!isValid) e.target.title = 'Format: HH-HH ou HH-HH;HH-HH';
    });
  }

  if (pvRegion) {
    pvRegion.addEventListener('change', async () => {
      if (appState.records && appState.records.length > 0) await runPvSimulation(appState.records);
    });
  }

  if (pvKwp) {
    let timeout;
    pvKwp.addEventListener('change', () => {
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        if (appState.records && appState.records.length > 0) {
          await compareOffers(appState.records);
          await runPvSimulation(appState.records);
        }
      }, 500);
    });
  }
}

/**
 * Setup analysis action buttons
 */
function setupAnalysisButtons() {
  const btnCompare = document.getElementById('btn-compare');
  const btnMonthly = document.getElementById('btn-monthly');
  const btnPv = document.getElementById('btn-pv-sim');

  if (btnCompare) {
    btnCompare.addEventListener('click', async () => {
      if (!appState.records || appState.records.length === 0) { alert('Sélectionnez d\'abord un fichier.'); return; }
      await compareOffers(appState.records);
    });
  }

  if (btnMonthly) {
    btnMonthly.addEventListener('click', async () => {
      if (!appState.records || appState.records.length === 0) { alert('Sélectionnez d\'abord un fichier.'); return; }
      await renderMonthlyBreakdown(appState.records);
    });
  }

  if (btnPv) {
    btnPv.addEventListener('click', async () => {
      if (!appState.records || appState.records.length === 0) { alert('Sélectionnez d\'abord un fichier.'); return; }
      await runPvSimulation(appState.records);
    });
  }
}

/**
 * Validate HC range format (HH-HH or HH-HH;HH-HH)
 */
function validateHCRange(value) {
  if (!value || typeof value !== 'string') return false;
  for (const range of value.split(';').map(s => s.trim())) {
    const parts = range.split('-');
    if (parts.length !== 2) return false;
    const [s, e] = parts.map(p => parseInt(p.trim(), 10));
    if (isNaN(s) || isNaN(e) || s < 0 || s > 23 || e < 0 || e > 23) return false;
  }
  return true;
}

/**
 * Validate tariff input (must be non-negative number)
 */
export function validateTariff(value) {
  const num = Number(value);
  return !isNaN(num) && num >= 0;
}

/**
 * Update display of current tariff defaults and settings
 * @param {Object} DEFAULTS
 */
export function populateDefaultsDisplay(DEFAULTS) {
  const el = document.getElementById('defaults-display');
  if (!el) return;
  const tempoDisplay = color => {
    const v = DEFAULTS.tempo[color];
    if (!v) return '-';
    if (typeof v === 'object') return `HP ${v.hp} €/kWh — HC ${v.hc} €/kWh`;
    return `${v} €/kWh`;
  };
  el.textContent =
    `Base: ${DEFAULTS.priceBase} €/kWh (abonnement ${DEFAULTS.subBase} €/mois)\n` +
    `HP/HC: HP ${DEFAULTS.hp.php} €/kWh — HC ${DEFAULTS.hp.phc} €/kWh (HC range ${DEFAULTS.hp.hcRange}, abonnement ${DEFAULTS.hp.sub} €/mois)\n` +
    `Tempo: Bleu ${tempoDisplay('blue')} — Blanc ${tempoDisplay('white')} — Rouge ${tempoDisplay('red')} (abonnement ${DEFAULTS.tempo.sub} €/mois)\n` +
    `Total Charge'Heures: HP ${DEFAULTS.totalChargeHeures?.php || '-'} €/kWh — HC ${DEFAULTS.totalChargeHeures?.phc || '-'} €/kWh — HSC ${DEFAULTS.totalChargeHeures?.phsc || '-'} €/kWh (abonnement ${DEFAULTS.totalChargeHeures?.sub || '-'} €/mois)\n` +
    `Prix injection (revenu export): ${DEFAULTS.injectionPrice} €/kWh`;
}

/**
 * Update injection price display
 * @param {Object} DEFAULTS
 */
export function updateInjectionDisplay(DEFAULTS) {
  const injEl = document.getElementById('price-injection-display');
  if (!injEl) return;
  const p = Number(DEFAULTS.injectionPrice) || 0;
  if (p <= 0) {
    injEl.classList.add('hidden');
    injEl.textContent = '';
  } else {
    injEl.classList.remove('hidden');
    injEl.textContent = `Prix injection (revenu export): ${p} €/kWh`;
  }
}
