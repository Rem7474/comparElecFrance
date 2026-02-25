/**
 * pvManager.js - Photovoltaic simulation controls and UI management
 * Handles PV input controls, visibility toggles, and button handlers
 * @module pvManager
 */

import { appState } from './state.js';

/**
 * Setup PV button and input event listeners
 * @param {Object} DEFAULTS - Tariff configuration
 * @param {Function} triggerRecalculation - Recalculation workflow trigger
 * @param {Function} calculateStandby - Standby calculation function
 */
export function setupPvControls(DEFAULTS, triggerRecalculation, calculateStandby) {
  // Setup Calculate PV button
  const btnCalcPv = document.getElementById('btn-calc-pv');
  if (btnCalcPv) {
    btnCalcPv.addEventListener('click', async () => {
      await triggerRecalculation();
    });
  }

  // Setup Compare Offers button
  const btnCompareOffers = document.getElementById('btn-compare-offers');
  if (btnCompareOffers) {
    btnCompareOffers.addEventListener('click', async () => {
      await triggerRecalculation();
    });
  }

  // Setup PV parameter input listeners
  const pvInputs = ['pv-kwp', 'pv-region', 'pv-standby', 'pv-cost-base', 'pv-cost-panel'];
  for (const id of pvInputs) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('change', async () => {
      await triggerRecalculation();
    });
  }

  // Setup ROI slider listener
  const roiSlider = document.getElementById('pv-roi-years');
  const roiDisplay = document.getElementById('pv-roi-display');
  if (roiSlider && roiDisplay) {
    roiSlider.addEventListener('input', (event) => {
      roiDisplay.textContent = `${event.target.value} ans`;
    });
    roiSlider.addEventListener('change', async () => {
      await triggerRecalculation();
    });
  }

  // Setup Estimate Standby button
  const btnEstimateStandby = document.getElementById('btn-estimate-standby');
  if (btnEstimateStandby) {
    btnEstimateStandby.addEventListener('click', async () => {
      const records = appState.records;
      if (!records || records.length === 0) {
        alert('Veuillez d\'abord charger un fichier de consommation.');
        return;
      }

      const originalText = btnEstimateStandby.textContent;
      btnEstimateStandby.textContent = '...';

      try {
        const estimatedW = calculateStandby(records);
        const input = document.getElementById('pv-standby');
        if (input) {
          input.value = estimatedW;
          input.dispatchEvent(new Event('change'));
        }
        btnEstimateStandby.textContent = `✅ ${estimatedW}W`;
        setTimeout(() => {
          btnEstimateStandby.textContent = originalText;
        }, 2000);
      } catch (err) {
        console.warn('Estimation talon échouée', err);
        alert(`Impossible d\'estimer le talon : ${err.message}`);
        btnEstimateStandby.textContent = originalText;
      }
    });
  }
}

/**
 * Update PV visibility based on toggle state
 * Shows/hides PV settings and metrics when toggle is changed
 * @param {Function} triggerRecalculation - Recalculation workflow trigger
 */
export function setupPvToggle(triggerRecalculation) {
  const togglePv = document.getElementById('toggle-pv');
  const pvSettingsContainer = document.getElementById('pv-settings-container');
  const metricPv = document.getElementById('metric-pv');
  const btnCalcPv = document.getElementById('btn-calc-pv');

  function updatePVVisibility() {
    const isEnabled = togglePv ? togglePv.checked : true;
    if (pvSettingsContainer) pvSettingsContainer.style.display = isEnabled ? 'block' : 'none';
    if (metricPv) metricPv.style.display = isEnabled ? 'flex' : 'none';
    if (btnCalcPv) btnCalcPv.style.display = isEnabled ? '' : 'none';

    const dashboard = document.getElementById('dashboard-section');
    if (dashboard && !dashboard.classList.contains('hidden')) {
      triggerRecalculation();
    }
  }

  // Initialize visibility on load
  if (togglePv) {
    updatePVVisibility();
    togglePv.addEventListener('change', updatePVVisibility);
  }

  return updatePVVisibility;
}
