/**
 * uiManager.js - UI initialization and event listener management
 * Handles all DOM interactions, form inputs, and UI state updates
 * @module uiManager
 */

import { appState } from './state.js';

// Functions to be injected
let compareOffers = null;
let runPvSimulation = null;
let renderMonthlyBreakdown = null;
let analyzeFilesNow = null;
let getRecordsFromCache = null;
let ensureTempoDayMap = null;

/**
 * Initialize all DOM event listeners and handlers
 * @param {Object} DEFAULTS - Default tariff configuration
 * @param {Object} deps - Dependencies { compareOffers, runPvSimulation, renderMonthlyBreakdown, analyzeFilesNow, getRecordsFromCache, ensureTempoDayMap }
 */
export function initializeUIListeners(DEFAULTS, deps = {}) {
  // Inject dependencies
  compareOffers = deps.compareOffers || (() => console.warn('compareOffers not provided'));
  runPvSimulation = deps.runPvSimulation || (() => console.warn('runPvSimulation not provided'));
  renderMonthlyBreakdown = deps.renderMonthlyBreakdown || (() => console.warn('renderMonthlyBreakdown not provided'));
  analyzeFilesNow = deps.analyzeFilesNow || (() => console.warn('analyzeFilesNow not provided'));
  getRecordsFromCache = deps.getRecordsFromCache || (() => console.warn('getRecordsFromCache not provided'));
  ensureTempoDayMap = deps.ensureTempoDayMap || (() => console.warn('ensureTempoDayMap not provided'));

  setupFileInput();
  setupPVToggle();
  setupParameterInputs(DEFAULTS);
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
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  dropZone.addEventListener('dragenter', () => dropZone.classList.add('drag-over'));
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      fileInput.files = files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // Update drop zone visual feedback
  fileInput.addEventListener('change', async () => {
    if (fileInput.files.length === 0) {
      if (dropZone) dropZone.classList.remove('has-file');
      if (dropZoneText) dropZoneText.textContent = 'Cliquez ou glissez le fichier ici';
      if (dropZoneSub) dropZoneSub.textContent = 'Formats acceptés : .json (Enedis) ou .csv';
      return;
    }

    // Update visual feedback
    if (dropZone) dropZone.classList.add('has-file');
    if (dropZoneText) dropZoneText.textContent = fileInput.files.length > 1 
      ? `${fileInput.files.length} fichiers sélectionnés` 
      : fileInput.files[0].name;
    if (dropZoneSub) dropZoneSub.textContent = '⏳ Analyse en cours...';
    
    // Show dashboard
    const dashboard = document.getElementById('dashboard-section');
    if (dashboard) dashboard.classList.remove('hidden');
    
    try {
      // Parse files to records
      const records = await getRecordsFromCache(fileInput.files);
      
      // Ensure tempo data
      await ensureTempoDayMap(records);
      
      // Run analysis
      await analyzeFilesNow(records);
      
      // Run full calculations
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

  toggle.addEventListener('change', async (e) => {
    pvSection.classList.toggle('hidden', !e.target.checked);
    
    if (pvReportSec) {
      pvReportSec.classList.toggle('hidden', !e.target.checked);
    }

    // Re-run analysis if we have records
    if (appState.records && appState.records.length > 0) {
      await compareOffers(appState.records);
      await renderMonthlyBreakdown(appState.records);
    }
  });
}

/**
 * Setup parameter input validation
 */
function setupParameterInputs(DEFAULTS) {
  const hcRangeInput = document.getElementById('param-hphc-hcRange');
  const pvRegion = document.getElementById('pv-region');
  const pvKwp = document.getElementById('pv-kwp');

  // HC Range validation
  if (hcRangeInput) {
    hcRangeInput.addEventListener('change', (e) => {
      const isValid = validateHCRange(e.target.value);
      e.target.classList.toggle('input-error', !isValid);
      if (!isValid) {
        console.warn('Format HC range invalide:', e.target.value);
        e.target.title = 'Format: HH-HH ou HH-HH;HH-HH';
      }
    });
  }

  // PV Region change
  if (pvRegion) {
    pvRegion.addEventListener('change', async () => {
      if (appState.records && appState.records.length > 0) {
        await runPvSimulation(appState.records);
      }
    });
  }

  // PV Power change with debounce
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
      if (!appState.records || appState.records.length === 0) {
        alert('Sélectionnez d\'abord un fichier.');
        return;
      }
      await compareOffers(appState.records);
    });
  }

  if (btnMonthly) {
    btnMonthly.addEventListener('click', async () => {
      if (!appState.records || appState.records.length === 0) {
        alert('Sélectionnez d\'abord un fichier.');
        return;
      }
      await renderMonthlyBreakdown(appState.records);
    });
  }

  if (btnPv) {
    btnPv.addEventListener('click', async () => {
      if (!appState.records || appState.records.length === 0) {
        alert('Sélectionnez d\'abord un fichier.');
        return;
      }
      await runPvSimulation(appState.records);
    });
  }
}

/**
 * Validate HC range format (HH-HH or HH-HH;HH-HH)
 * @param {string} value - Range string
 * @returns {boolean} Valid or not
 */
function validateHCRange(value) {
  if (!value || typeof value !== 'string') return false;

  const ranges = value.split(';').map((s) => s.trim());

  for (const range of ranges) {
    const parts = range.split('-');
    if (parts.length !== 2) return false;

    const [startStr, endStr] = parts.map((s) => s.trim());
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);

    if (isNaN(start) || isNaN(end) || start < 0 || start > 23 || end < 0 || end > 23) {
      return false;
    }
  }

  return true;
}

/**
 * Validate tariff input (must be positive number)
 * @param {string|number} value - Value to validate
 * @returns {boolean} Valid or not
 */
export function validateTariff(value) {
  const num = Number(value);
  return !isNaN(num) && num >= 0;
}

/**
 * Setup tariff input validation for all contract params
 */
export function setupTariffValidation() {
  const tariffInputs = document.querySelectorAll('[id^="param-"]');

  tariffInputs.forEach((input) => {
    input.addEventListener('change', (e) => {
      if (e.target.id.includes('Range')) {
        // HC Range validation already done above
        return;
      }

      const isValid = validateTariff(e.target.value);
      e.target.classList.toggle('input-error', !isValid);

      if (!isValid) {
        console.warn('Tarif invalide:', e.target.id, e.target.value);
        e.target.title = 'Doit être un nombre positif';
      }
    });
  });
}

/**
 * Show error message to user
 * @param {string} message - Error message
 */
export function showError(message) {
  const logEl = document.getElementById('analysis-log');
  if (logEl) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'log-error';
    errorDiv.textContent = '❌ ' + message;
    logEl.appendChild(errorDiv);
  }
  console.error(message);
}

/**
 * Show success message to user
 * @param {string} message - Success message
 */
export function showSuccess(message) {
  const logEl = document.getElementById('analysis-log');
  if (logEl) {
    const successDiv = document.createElement('div');
    successDiv.className = 'log-success';
    successDiv.textContent = '✅ ' + message;
    logEl.appendChild(successDiv);
  }
}

/**
 * Show loading state on element
 * @param {HTMLElement} element - Element to show loading state
 * @param {boolean} isLoading - Loading or not
 */
export function setElementLoading(element, isLoading) {
  if (!element) return;

  if (isLoading) {
    element.disabled = true;
    element.classList.add('loading');
    element.dataset.originalText = element.textContent;
    element.textContent = '⏳ Traitement...';
  } else {
    element.disabled = false;
    element.classList.remove('loading');
    element.textContent = element.dataset.originalText || 'Valider';
  }
}

/**
 * Update display of current tariff defaults and settings
 * @param {Object} DEFAULTS - Tariff defaults object
 */
export function populateDefaultsDisplay(DEFAULTS) {
  const el = document.getElementById('defaults-display');
  if (el) {
    const tempoDisplay = (color) => {
      const value = DEFAULTS.tempo[color];
      if (!value) return '-';
      if (typeof value === 'object') return `HP ${value.hp} €/kWh — HC ${value.hc} €/kWh`;
      return `${value} €/kWh`;
    };
    const txt =
      `Base: ${DEFAULTS.priceBase} €/kWh (abonnement ${DEFAULTS.subBase} €/mois)\n` +
      `HP/HC: HP ${DEFAULTS.hp.php} €/kWh — HC ${DEFAULTS.hp.phc} €/kWh (HC range ${DEFAULTS.hp.hcRange}, abonnement ${DEFAULTS.hp.sub} €/mois)\n` +
      `Tempo: Bleu ${tempoDisplay('blue')} — Blanc ${tempoDisplay('white')} — Rouge ${tempoDisplay('red')} (abonnement ${DEFAULTS.tempo.sub} €/mois)\n` +
      `Total Charge'Heures: HP ${((DEFAULTS.totalChargeHeures||{}).php||'-')} €/kWh — HC ${((DEFAULTS.totalChargeHeures||{}).phc||'-')} €/kWh — HSC ${((DEFAULTS.totalChargeHeures||{}).phsc||'-')} €/kWh (HP range ${((DEFAULTS.totalChargeHeures||{}).hpRange||'-')}, HC range ${((DEFAULTS.totalChargeHeures||{}).hcRange||'-')}, HSC range ${((DEFAULTS.totalChargeHeures||{}).hscRange||'-')}, abonnement ${((DEFAULTS.totalChargeHeures||{}).sub||'-')} €/mois)\n` +
      `Prix injection (revenu export): ${DEFAULTS.injectionPrice} €/kWh`;
    el.textContent = txt;
  }
}

/**
 * Update injection price display
 * @param {Object} DEFAULTS - Tariff defaults object
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
