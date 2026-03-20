/**
 * exportHandlers.js - Export button listeners and analysis data helpers
 * Sets up PDF/Excel/history export handlers and provides data assembly functions.
 * @module exportHandlers
 */

import { appState } from './state.js';
import { exportToPDF, exportComparatifGlobalPDF, exportToExcel, saveToHistory } from './exportManager.js';

// ─── Data helpers ─────────────────────────────────────────────────────────────

/**
 * Assemble current analysis results for export
 * @returns {Object} Analysis data snapshot
 */
export function buildCurrentAnalysisData() {
  const state = appState.getState();
  const records = state.records || [];
  const offers = state.offers || [];
  const stats = state.stats || {};

  return {
    timestamp: new Date().toISOString(),
    annualConsumption: stats.total || 0,
    costBase: state.costBase || 0,
    pvSavings: state.pvSavings || 0,
    temperature: stats.avg || 0,
    pvConfig: {
      kwp: Number(document.getElementById('pv-kwp')?.value) || 0,
      region: document.getElementById('pv-region')?.value || 'centre',
      annualProduction: state.annualPvProduction || 0,
      autoconsumptionRate: state.autoconsumptionRate || 0
    },
    annualSummary: {
      annualConsumption: stats.total || 0,
      costBase: state.costBase || 0,
      pvSavings: state.pvSavings || 0
    },
    offers: offers.map(o => ({
      name: o.name || 'N/A',
      costNoPV: o.costNoPV || 0,
      costWithPV: o.costWithPV || 0,
      savings: (o.costNoPV || 0) - (o.costWithPV || 0),
      color: o.color || '#999'
    })),
    rawRecords: records.slice(0, 365)
  };
}

/**
 * Get current consumption statistics snapshot
 * @returns {Object}
 */
export function getCurrentConsumptionData() {
  const stats = appState.getState().stats || {};
  return { total: stats.total || 0, avg: stats.avg || 0, min: stats.min || 0, max: stats.max || 0 };
}

/**
 * Get current offers array
 * @returns {Array}
 */
export function getCurrentOffers() {
  return appState.getState().offers || [];
}

/**
 * Get simple monthly breakdown (consumption per month)
 * @returns {Array}
 */
export function getCurrentMonthlyBreakdown() {
  const records = appState.getState().records || [];
  if (!records.length) return [];

  const months = {};
  for (const rec of records) {
    const date = new Date(rec.dateDebut);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!months[key]) months[key] = [];
    months[key].push(rec);
  }

  return Object.entries(months).map(([month, recs]) => ({
    month,
    consumption: recs.reduce((sum, r) => sum + (Number(r.valeur) || 0), 0)
  }));
}

// ─── Button listeners ─────────────────────────────────────────────────────────

/**
 * Setup all export/history button event listeners
 */
export function setupExportHandlers() {
  const withLoadingState = (btn, defaultText, action) => {
    btn.addEventListener('click', async () => {
      try {
        btn.disabled = true;
        btn.textContent = '⏳ Génération...';
        await action();
        btn.textContent = '✅ Exporté!';
        setTimeout(() => { btn.textContent = defaultText; btn.disabled = false; }, 2000);
      } catch (error) {
        console.error('Erreur export:', error);
        alert(`Erreur lors de l'export. Vérifiez que les librairies sont chargées via CDN.\n${error.message || ''}`);
        btn.textContent = defaultText;
        btn.disabled = false;
      }
    });
  };

  const btnPdf = document.getElementById('btn-export-pdf');
  if (btnPdf) {
    withLoadingState(btnPdf, '📄 Export PDF Solaire', async () => {
      await exportToPDF(buildCurrentAnalysisData(), getCurrentConsumptionData(), getCurrentOffers());
    });
  }

  const btnExcel = document.getElementById('btn-export-excel');
  if (btnExcel) {
    withLoadingState(btnExcel, '📊 Export Excel', async () => {
      await exportToExcel(buildCurrentAnalysisData(), getCurrentMonthlyBreakdown(), getCurrentOffers());
    });
  }

  const btnComparatif = document.getElementById('btn-export-comparatif-pdf');
  if (btnComparatif) {
    withLoadingState(btnComparatif, '📄 Export Rapport Complet PDF', async () => {
      await exportComparatifGlobalPDF(buildCurrentAnalysisData(), getCurrentConsumptionData());
    });
  }

  const btnHistory = document.getElementById('btn-save-history');
  if (btnHistory) {
    btnHistory.addEventListener('click', () => {
      try {
        const label = prompt('Nom pour cette analyse (optionnel):', `Analyse ${new Date().toLocaleDateString('fr-FR')}`);
        if (label !== null) {
          const saved = saveToHistory(buildCurrentAnalysisData(), label);
          if (saved) {
            alert(`✅ Analyse sauvegardée: "${saved.label}"`);
            btnHistory.textContent = '✅ Sauvegardé!';
            setTimeout(() => { btnHistory.textContent = '💾 Sauvegarder'; }, 2000);
          }
        }
      } catch (error) {
        console.error('Erreur sauvegarde:', error);
        alert('Erreur lors de la sauvegarde.');
      }
    });
  }
}
