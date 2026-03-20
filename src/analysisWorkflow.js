/**
 * analysisWorkflow.js - Core analysis workflow functions
 * Contains analyzeFilesNow, renderMonthlyBreakdown, runPvSimulation, compareOffers.
 * Extracted from the former monolithic app.js.
 * @module analysisWorkflow
 */

import { appState } from './state.js';
import { DEFAULTS, KVA_STEPS, updateSubscriptionDefault } from './config.js';
import { formatNumber, isHourHC } from './utils.js';
import { appendLog, getAnalysisLog } from './logger.js';
import * as chartRenderer from './chartRenderer.js';
import {
  computeHourlyStats,
  computeCostWithProfile,
  computeDailyTempoCostMap,
  computeMonthlyBreakdown
} from './analysisEngine.js';
import {
  computeCostBase,
  computeCostHpHc,
  computeCostTotalCharge,
  computeCostTempo,
  computeCostTempoOptimized
} from './tariffEngine.js';
import { pvYieldPerKwp, simulatePVEffect, findBestPVConfig } from './pvSimulation.js';
import {
  ensureTempoDayMap,
  tempoLoading,
  renderTempoCalendarGraph
} from './tempoCalendar.js';

// ─── Shared state update callback ────────────────────────────────────────────

function onTempoUpdate(updates) {
  if (updates.tempoDayMap) appState.setState({ tempoDayMap: updates.tempoDayMap }, 'TEMPO_MAP_LOADED');
  if (updates.tempoSourceMap) appState.setState({ tempoSourceMap: updates.tempoSourceMap }, 'TEMPO_SOURCES_UPDATED');
}

/**
 * Ensure the TEMPO day map is loaded, updating appState.
 * Convenience wrapper used throughout this module and by uiManager.
 * @param {Array} records
 * @returns {Promise<Object>} tempoDayMap
 */
export async function runEnsureTempoMap(records) {
  return ensureTempoDayMap(records, tempoLoading, DEFAULTS, onTempoUpdate);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Compute monthly cost for a dynamic two-tier tariff.
 * Uses computeCostHpHc from tariffEngine (avoids duplication).
 * @param {Array} monthRecords
 * @param {Object} tariffMeta - { php, phc, hcRange, subscriptions }
 * @returns {number} Monthly cost including subscription
 */
function computeTwoTierMonthlyCost(monthRecords, tariffMeta) {
  if (!tariffMeta || !tariffMeta.php || !tariffMeta.phc) return 0;
  const result = computeCostHpHc(monthRecords, tariffMeta, tariffMeta.hcRange || '22-06');
  const selectedKva = String(Number(appState.currentKva) || 6);
  const subs = tariffMeta.subscriptions || {};
  const sub = Number(subs[selectedKva] != null ? subs[selectedKva] : Object.values(subs)[0]) || 0;
  return result.cost + sub;
}

/**
 * Calculate offer cost for a single tariff across all types.
 * @param {Object} tariffMeta
 * @param {Array} recs - Original records
 * @param {Array} recsWithPV - Records with PV applied
 * @param {Array} perHourAnnual - Hourly annual profile (no PV)
 * @param {Array} perHourWithPV - Hourly annual profile (with PV)
 * @param {number} priceBase - Fallback base price
 * @param {Object} tempoDayMap
 * @returns {{ costNoPV: number, costWithPV: number }}
 */
function calculateOfferCost(tariffMeta, recs, recsWithPV, perHourAnnual, perHourWithPV, priceBase, tempoDayMap) {
  if (!tariffMeta || !tariffMeta.type) return { costNoPV: 0, costWithPV: 0 };

  let costNoPV = 0;
  let costWithPV = 0;

  if (tariffMeta.type === 'flat') {
    const price = Number(tariffMeta.price != null ? tariffMeta.price : DEFAULTS.priceBase) || priceBase;
    costNoPV = computeCostWithProfile(perHourAnnual, price, { mode: 'base' }).cost;
    costWithPV = computeCostWithProfile(perHourWithPV, price, { mode: 'base' }).cost;
  } else if (tariffMeta.type === 'two-tier') {
    const php = Number(tariffMeta.php) || 0.2;
    const phc = Number(tariffMeta.phc) || 0.12;
    const hcRange = tariffMeta.hcRange || '22-06';
    costNoPV = computeCostWithProfile(perHourAnnual, priceBase, { mode: 'hp-hc', php, phc, hcRange }).cost;
    costWithPV = computeCostWithProfile(perHourWithPV, priceBase, { mode: 'hp-hc', php, phc, hcRange }).cost;
  } else if (tariffMeta.type === 'three-tier') {
    const tchConfig = {
      php: Number(tariffMeta.php) || Number((DEFAULTS.totalChargeHeures || {}).php) || 0,
      phc: Number(tariffMeta.phc) || Number((DEFAULTS.totalChargeHeures || {}).phc) || 0,
      phsc: Number(tariffMeta.phsc) || Number((DEFAULTS.totalChargeHeures || {}).phsc) || 0,
      hpRange: tariffMeta.hpRange || (DEFAULTS.totalChargeHeures || {}).hpRange,
      hcRange: tariffMeta.hcRange || (DEFAULTS.totalChargeHeures || {}).hcRange,
      hscRange: tariffMeta.hscRange || (DEFAULTS.totalChargeHeures || {}).hscRange
    };
    if (recs) {
      costNoPV = computeCostTotalCharge(recs, tchConfig).cost || 0;
      if (recsWithPV) costWithPV = computeCostTotalCharge(recsWithPV, tchConfig).cost || 0;
    }
  } else if (tariffMeta.type === 'tempo') {
    const tempoConfig = tariffMeta.tempoConfig || DEFAULTS.tempo || {};
    costNoPV = computeCostTempo(recs, tempoDayMap, tempoConfig).cost || 0;
    costWithPV = recsWithPV ? (computeCostTempo(recsWithPV, tempoDayMap, tempoConfig).cost || 0) : costNoPV;
  } else if (tariffMeta.type === 'tempo-optimized') {
    const tempoConfig = tariffMeta.tempoConfig || DEFAULTS.tempo || {};
    costNoPV = (computeCostTempoOptimized(recs, tempoDayMap, tempoConfig) || {}).cost || 0;
    costWithPV = recsWithPV ? ((computeCostTempoOptimized(recsWithPV, tempoDayMap, tempoConfig) || {}).cost || 0) : costNoPV;
  }

  return { costNoPV, costWithPV };
}

// ─── Public workflow functions ────────────────────────────────────────────────

/**
 * Run initial file analysis: compute stats, render charts, detect kVA, load TEMPO.
 * @param {Array} records
 */
export async function analyzeFilesNow(records) {
  const analysisLog = getAnalysisLog();
  const dashboard = document.getElementById('dashboard-section');
  if (dashboard) dashboard.classList.remove('hidden');

  // Show export buttons
  ['btn-export-pdf', 'btn-export-excel', 'btn-save-history', 'btn-export-comparatif-pdf'].forEach(id => {
    document.getElementById(id)?.classList.remove('hidden');
  });

  appendLog(analysisLog, "Démarrage de l'analyse...");
  if (!records || records.length === 0) {
    appendLog(analysisLog, 'Aucune donnée valide trouvée pour l\'analyse.');
    return;
  }

  const stats = computeHourlyStats(records);
  const totalConsoEl = document.getElementById('val-total-conso');
  if (totalConsoEl) totalConsoEl.textContent = `${formatNumber(stats.total)} kWh`;

  let stepDurationHours = 0.5;
  if (records.length > 2) {
    const t1 = new Date(records[0].dateDebut).getTime();
    const t2 = new Date(records[1].dateDebut).getTime();
    const diff = Math.abs(t2 - t1);
    if (diff > 0 && diff < 86400000) stepDurationHours = diff / 3600000;
  }
  const maxValEnergy = Math.max(...stats.max);
  const maxPowerKw = stepDurationHours > 0 ? maxValEnergy / stepDurationHours : maxValEnergy;
  let recommendedKva = 36;
  for (const step of KVA_STEPS) {
    if (step >= maxPowerKw) { recommendedKva = step; break; }
  }

  appState.setState({ detectedKva: recommendedKva, stats: { total: stats.total, avg: stats.avg } }, 'POWER_DETECTED');

  const kvaInfo = document.getElementById('power-detected-info');
  if (kvaInfo) kvaInfo.textContent = `Max: ${maxPowerKw.toFixed(1)} kW (Standard: ${recommendedKva} kVA)`;

  const kvaSel = document.getElementById('param-power-kva');
  if (kvaSel && kvaSel.value === 'auto') updateSubscriptionDefault(recommendedKva);

  chartRenderer.renderHourlyChart(stats, document.getElementById('hourly-chart'));
  try {
    const hcRange = (DEFAULTS.hp && DEFAULTS.hp.hcRange) || '22-06';
    const canvas = document.getElementById('hp-hc-pie');
    if (canvas) chartRenderer.renderHpHcPie(records, hcRange, canvas);
  } catch (err) { /* ignore */ }

  appendLog(analysisLog, 'Analyse terminée.');
  try {
    const tempoMap = await runEnsureTempoMap(records);
    try {
      const dailyCostMap = computeDailyTempoCostMap(records, tempoMap, DEFAULTS.tempo);
      renderTempoCalendarGraph(tempoMap, dailyCostMap, DEFAULTS);
    } catch (err) { /* ignore */ }
  } catch (err) {
    console.warn('Erreur génération calendrier TEMPO automatique', err);
  }
}

/**
 * Render monthly cost breakdown table + charts for all tariffs.
 * @param {Array} records
 */
export async function renderMonthlyBreakdown(records) {
  const analysisLog = getAnalysisLog();
  const recs = records || appState.records;
  if (!recs || recs.length === 0) {
    alert('Sélectionnez d\'abord un fichier de données (JSON ou CSV) via le sélecteur de fichiers.');
    return;
  }

  appendLog(analysisLog, 'Calcul ventilation mensuelle...');

  // Group records by month
  const monthlyRecords = {};
  for (const rec of recs) {
    const date = new Date(rec.dateDebut);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyRecords[monthKey]) monthlyRecords[monthKey] = [];
    monthlyRecords[monthKey].push(rec);
  }

  const pvKwp = Number(document.getElementById('pv-kwp')?.value) || 0;
  const pvRegion = document.getElementById('pv-region')?.value || 'centre';
  const standbyW = Number(document.getElementById('pv-standby')?.value) || 0;
  const annualProduction = pvKwp * pvYieldPerKwp(pvRegion);
  const exportPrice = Number(DEFAULTS.injectionPrice) || 0.06;

  let tempoMap = appState.tempoDayMap;
  if (!tempoMap || Object.keys(tempoMap).length === 0) {
    try { tempoMap = await runEnsureTempoMap(recs); } catch (err) { tempoMap = null; }
  }

  const data = computeMonthlyBreakdown(recs, annualProduction, exportPrice, standbyW, DEFAULTS.monthlySolarWeights, DEFAULTS, tempoMap || null);
  const container = document.getElementById('monthly-results');
  if (!container) return;
  container.innerHTML = '';

  const table = document.createElement('table');
  const hdr = document.createElement('tr');
  const isPvEnabled = document.getElementById('toggle-pv')?.checked ?? true;
  const loadedTariffs = appState.getState().loadedTariffs || [];
  const dynamicTwoTiers = loadedTariffs.filter(t => t.type === 'two-tier' && t.id !== 'hphc');

  let headerHTML = '<th>Mois</th><th>Consommation (kWh)</th>';
  headerHTML += '<th>Base (€)</th>';
  if (isPvEnabled) headerHTML += '<th>Base PV (€)</th><th>Éco. Base (€)</th>';
  headerHTML += '<th>HP/HC (€)</th>';
  if (isPvEnabled) headerHTML += '<th>HP/HC PV (€)</th><th>Éco. HP/HC (€)</th>';
  headerHTML += '<th>Tempo (€)</th>';
  if (isPvEnabled) headerHTML += '<th>Tempo PV (€)</th><th>Éco. Tempo (€)</th>';
  for (const tariff of dynamicTwoTiers) headerHTML += `<th>${tariff.name} (€)</th>`;
  headerHTML += '<th>Tempo Opt. (€)</th>';
  if (isPvEnabled) headerHTML += '<th>Tempo Opt. PV (€)</th><th>Éco. Tempo Opt. (€)</th>';
  headerHTML += '<th>TCH (€)</th>';
  if (isPvEnabled) headerHTML += '<th>TCH PV (€)</th><th>Éco. TCH (€)</th>';
  headerHTML += '<th>Différence vs HP/HC (€)</th>';
  hdr.innerHTML = headerHTML;
  table.appendChild(hdr);

  const monthlySavings = data.map(row => {
    const savings = {
      month: row.month,
      base: Math.max(0, (row.base.total || 0) - (row.basePV.total || 0)),
      hphc: Math.max(0, (row.hphc.total || 0) - (row.hphcPV.total || 0)),
      tempo: Math.max(0, (row.tempo.total || 0) - (row.tempoPV.total || 0)),
      tempoOpt: Math.max(0, (row.tempoOpt.total || 0) - (row.tempoOptPV.total || 0)),
      tch: Math.max(0, (row.tch.total || 0) - (row.tchPV.total || 0))
    };
    const hphcSavingsRatio = row.hphc.total > 0 ? savings.hphc / row.hphc.total : 0;
    for (const tariff of dynamicTwoTiers) {
      const costNoPV = computeTwoTierMonthlyCost(monthlyRecords[row.month] || [], tariff);
      savings[tariff.id] = Math.max(0, costNoPV * hphcSavingsRatio);
    }
    return savings;
  });

  const { bestOfferId } = appState.getState();

  const getMonthlyOfferCost = (row, offerId, usePv) => {
    switch (offerId) {
      case 'base': return usePv ? row.basePV.total : row.base.total;
      case 'hphc': return usePv ? row.hphcPV.total : row.hphc.total;
      case 'tempo': return usePv ? row.tempoPV.total : row.tempo.total;
      case 'tempoOpt': return usePv ? row.tempoOptPV.total : row.tempoOpt.total;
      case 'tch': return usePv ? row.tchPV.total : row.tch.total;
      default: return null;
    }
  };

  for (const [index, row] of data.entries()) {
    const sv = monthlySavings[index];
    const tr = document.createElement('tr');
    tr.className = 'row-divider';
    let rowHTML = `<td>${row.month}</td><td>${formatNumber(row.consumption)}</td>`;

    const hphcCost = isPvEnabled ? row.hphcPV.total : row.hphc.total;
    let bestCost = getMonthlyOfferCost(row, bestOfferId, isPvEnabled);
    if (bestOfferId === 'hphc') bestCost = hphcCost;
    if (bestCost == null) {
      const fallbackCosts = ['base', 'tempo', 'tempoOpt', 'tch']
        .map(id => getMonthlyOfferCost(row, id, isPvEnabled)).filter(v => typeof v === 'number');
      bestCost = fallbackCosts.length ? Math.min(...fallbackCosts) : hphcCost;
    }
    const diffVsHphc = hphcCost - bestCost;
    const diffClass = diffVsHphc > 0 ? 'text-success' : '';
    const diffDisplay = diffVsHphc !== 0 ? `${diffVsHphc > 0 ? '-' : '+'}${formatNumber(Math.abs(diffVsHphc))}` : '0';

    if (isPvEnabled) {
      rowHTML +=
        `<td>${formatNumber(row.base.total)}</td>` +
        `<td>${formatNumber(row.basePV.total)}</td>` +
        `<td class="text-success">${formatNumber(sv.base)}</td>` +
        `<td>${formatNumber(row.hphc.total)}</td>` +
        `<td>${formatNumber(row.hphcPV.total)}</td>` +
        `<td class="text-success">${formatNumber(sv.hphc)}</td>` +
        `<td>${formatNumber(row.tempo.total)}</td>` +
        `<td>${formatNumber(row.tempoPV.total)}</td>` +
        `<td class="text-success">${formatNumber(sv.tempo)}</td>`;
      for (const tariff of dynamicTwoTiers) {
        rowHTML += `<td>${formatNumber(computeTwoTierMonthlyCost(monthlyRecords[row.month] || [], tariff))}</td>`;
      }
      rowHTML +=
        `<td>${formatNumber(row.tempoOpt.total)}</td>` +
        `<td>${formatNumber(row.tempoOptPV.total)}</td>` +
        `<td class="text-success">${formatNumber(sv.tempoOpt)}</td>` +
        `<td>${formatNumber(row.tch.total)}</td>` +
        `<td>${formatNumber(row.tchPV.total)}</td>` +
        `<td class="text-success">${formatNumber(sv.tch)}</td>` +
        `<td class="${diffClass}" style="font-weight:bold;">${diffDisplay} €</td>`;
    } else {
      rowHTML +=
        `<td>${formatNumber(row.base.total)}</td>` +
        `<td>${formatNumber(row.hphc.total)}</td>` +
        `<td>${formatNumber(row.tempo.total)}</td>`;
      for (const tariff of dynamicTwoTiers) {
        rowHTML += `<td>${formatNumber(computeTwoTierMonthlyCost(monthlyRecords[row.month] || [], tariff))}</td>`;
      }
      rowHTML +=
        `<td>${formatNumber(row.tempoOpt.total)}</td>` +
        `<td>${formatNumber(row.tch.total)}</td>` +
        `<td class="${diffClass}" style="font-weight:bold;">${diffDisplay} €</td>`;
    }
    tr.innerHTML = rowHTML;
    table.appendChild(tr);
  }
  container.appendChild(table);

  if (isPvEnabled) {
    const totalSavings = monthlySavings.reduce((acc, row) => {
      acc.base = (acc.base || 0) + (row.base || 0);
      acc.hphc = (acc.hphc || 0) + (row.hphc || 0);
      acc.tempo = (acc.tempo || 0) + (row.tempo || 0);
      acc.tempoOpt = (acc.tempoOpt || 0) + (row.tempoOpt || 0);
      acc.tch = (acc.tch || 0) + (row.tch || 0);
      for (const tariff of dynamicTwoTiers) acc[tariff.id] = (acc[tariff.id] || 0) + (row[tariff.id] || 0);
      return acc;
    }, {});

    const totalsBox = document.createElement('div');
    totalsBox.id = 'pv-savings-totals';
    totalsBox.className = 'log mt-2';
    let totalsHTML = `<strong>Économies annuelles (par offre)</strong> — ` +
      `Base: ${formatNumber(totalSavings.base || 0)} € &nbsp;|&nbsp; ` +
      `HP/HC: ${formatNumber(totalSavings.hphc || 0)} € &nbsp;|&nbsp; ` +
      `Tempo: ${formatNumber(totalSavings.tempo || 0)} € &nbsp;|&nbsp; ` +
      `Tempo Opt.: ${formatNumber(totalSavings.tempoOpt || 0)} € &nbsp;|&nbsp; ` +
      `TCH: ${formatNumber(totalSavings.tch || 0)} €`;
    for (const tariff of dynamicTwoTiers) {
      totalsHTML += ` &nbsp;|&nbsp; ${tariff.name}: ${formatNumber(totalSavings[tariff.id] || 0)} €`;
    }
    totalsBox.innerHTML = totalsHTML;
    container.appendChild(totalsBox);
  }

  // Monthly chart
  const labels = data.map(row => row.month);
  const dynamicTariffCosts = {};
  for (const tariff of dynamicTwoTiers) {
    dynamicTariffCosts[tariff.id] = data.map(row => computeTwoTierMonthlyCost(monthlyRecords[row.month] || [], tariff));
  }

  let datasets = isPvEnabled ? [
    { label: 'Base', data: data.map(r => r.base.total), backgroundColor: '#4e79a7' },
    { label: 'Base (avec PV)', data: data.map(r => r.basePV.total), backgroundColor: '#a0cbe8' },
    { label: 'HP/HC', data: data.map(r => r.hphc.total), backgroundColor: '#f28e2b' },
    { label: 'HP/HC (avec PV)', data: data.map(r => r.hphcPV.total), backgroundColor: '#ffbe7d' },
    { label: 'Tempo', data: data.map(r => r.tempo.total), backgroundColor: '#59a14f' },
    { label: 'Tempo (avec PV)', data: data.map(r => r.tempoPV.total), backgroundColor: '#bfe5b9' },
    { label: 'Tempo Opt.', data: data.map(r => r.tempoOpt.total), backgroundColor: '#117a8b' },
    { label: 'Tempo Opt. (avec PV)', data: data.map(r => r.tempoOptPV.total), backgroundColor: '#17a2b8' },
    { label: 'TCH', data: data.map(r => r.tch.total), backgroundColor: '#d62728' },
    { label: 'TCH (avec PV)', data: data.map(r => r.tchPV.total), backgroundColor: '#ff9896' }
  ] : [
    { label: 'Base', data: data.map(r => r.base.total), backgroundColor: '#4e79a7' },
    { label: 'HP/HC', data: data.map(r => r.hphc.total), backgroundColor: '#f28e2b' },
    { label: 'Tempo', data: data.map(r => r.tempo.total), backgroundColor: '#59a14f' },
    { label: 'Tempo Opt.', data: data.map(r => r.tempoOpt.total), backgroundColor: '#17a2b8' },
    { label: 'TCH', data: data.map(r => r.tch.total), backgroundColor: '#d62728' }
  ];
  for (const tariff of dynamicTwoTiers) {
    datasets.push({ label: tariff.name, data: dynamicTariffCosts[tariff.id], backgroundColor: tariff.color });
  }

  chartRenderer.renderMonthlyChart(labels, datasets, document.getElementById('monthly-chart'));

  // Savings chart
  try {
    const sc = document.getElementById('monthly-savings-chart');
    if (sc) {
      if (isPvEnabled) {
        sc.style.display = 'block';
        if (sc.parentElement) sc.parentElement.style.display = '';
        chartRenderer.renderMonthlySavingsChart(labels, [
          { label: 'Éco. Base (€)', data: monthlySavings.map(m => m.base), backgroundColor: '#2e7d3233', borderColor: '#2e7d32', borderWidth: 1 },
          { label: 'Éco. HP/HC (€)', data: monthlySavings.map(m => m.hphc), backgroundColor: '#00838f33', borderColor: '#00838f', borderWidth: 1 },
          { label: 'Éco. Tempo (€)', data: monthlySavings.map(m => m.tempo), backgroundColor: '#8e24aa33', borderColor: '#8e24aa', borderWidth: 1 },
          { label: 'Éco. Tempo Opt. (€)', data: monthlySavings.map(m => m.tempoOpt), backgroundColor: '#005cbf33', borderColor: '#005cbf', borderWidth: 1 },
          { label: 'Éco. TCH (€)', data: monthlySavings.map(m => m.tch), backgroundColor: '#d6272833', borderColor: '#d62728', borderWidth: 1 },
          ...dynamicTwoTiers.map(t => ({
            label: `Éco. ${t.name} (€)`,
            data: monthlySavings.map(m => m[t.id] || 0),
            backgroundColor: (t.color + '33'), borderColor: t.color, borderWidth: 1
          }))
        ], sc);
      } else {
        sc.style.display = 'none';
        if (sc.parentElement) sc.parentElement.style.display = 'none';
      }
    }
  } catch (err) {
    console.warn('Erreur rendu graphique économies PV mensuelles', err);
  }

  appendLog(analysisLog, 'Ventilation mensuelle terminée.');
}

/**
 * Run PV simulation and render PV production chart.
 * @param {Array} records
 */
export async function runPvSimulation(records) {
  const analysisLog = getAnalysisLog();
  const recs = records || appState.records;
  if (!recs || recs.length === 0) {
    alert('Sélectionnez d\'abord un fichier de données (JSON ou CSV) via le sélecteur de fichiers.');
    return;
  }

  const isPvEnabled = document.getElementById('toggle-pv')?.checked ?? true;
  if (!isPvEnabled) return;

  appendLog(analysisLog, 'Estimation PV en cours...');

  const pvKwp = Number(document.getElementById('pv-kwp')?.value) || 0;
  const region = document.getElementById('pv-region')?.value || 'centre';
  const standbyW = Number(document.getElementById('pv-standby')?.value) || 0;
  const annualProduction = pvKwp * pvYieldPerKwp(region);
  const exportPrice = Number(DEFAULTS.injectionPrice) || 0;

  const pvProdEl = document.getElementById('val-pv-prod');
  if (pvProdEl) pvProdEl.textContent = `${formatNumber(annualProduction)} kWh`;

  try {
    const container = document.getElementById('pv-chart-container');
    if (container) {
      container.innerHTML = '<canvas id="pv-power-chart" class="chart-canvas-small"></canvas>';
      const pc = document.getElementById('pv-power-chart');

      let tempoMap = appState.tempoDayMap;
      if (!tempoMap || Object.keys(tempoMap).length === 0) {
        try { tempoMap = await runEnsureTempoMap(recs); } catch (err) { tempoMap = null; }
      }

      const monthly = computeMonthlyBreakdown(recs, annualProduction, exportPrice, standbyW, DEFAULTS.monthlySolarWeights, DEFAULTS, tempoMap || null);
      chartRenderer.renderPVPowerChart(
        monthly.map(m => m.month),
        monthly.map(m => m.monthPV || 0),
        monthly.map(m => m.monthSelf || 0),
        monthly.map(m => Math.max(0, (m.monthPV || 0) - (m.monthSelf || 0))),
        pc
      );
    }
  } catch (err) {
    console.warn('Erreur rendu graphique PV puissance', err);
  }
}

/**
 * Compare all loaded tariff offers and render result cards + charts.
 * @param {Array} records
 */
export async function compareOffers(records) {
  const analysisLog = getAnalysisLog();
  const recs = records || appState.records;
  if (!recs || recs.length === 0) {
    alert('Sélectionnez d\'abord un fichier de données (JSON ou CSV) via le sélecteur de fichiers.');
    return;
  }

  const grid = document.getElementById('offers-results-grid');
  appendLog(analysisLog, 'Comparaison des offres en cours...');

  const monthlyRecords = {};
  for (const rec of recs) {
    const date = new Date(rec.dateDebut);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyRecords[monthKey]) monthlyRecords[monthKey] = [];
    monthlyRecords[monthKey].push(rec);
  }

  const loadedTariffs = appState.getState().loadedTariffs || [];
  const dynamicTwoTiers = loadedTariffs.filter(t => t.type === 'two-tier' && t.id !== 'hphc');

  const isPvEnabled = document.getElementById('toggle-pv')?.checked ?? true;
  const annualProduction = isPvEnabled
    ? (Number(document.getElementById('pv-kwp')?.value) || 0) * pvYieldPerKwp(document.getElementById('pv-region')?.value || 'centre')
    : 0;
  const exportPrice = Number(DEFAULTS.injectionPrice) || 0;

  const perHourAnnual = Array.from({ length: 24 }, () => 0);
  const uniqueMonths = new Set();
  for (const rec of recs) {
    perHourAnnual[new Date(rec.dateDebut).getHours()] += Number(rec.valeur) || 0;
    const d = new Date(rec.dateDebut);
    uniqueMonths.add(`${d.getFullYear()}-${d.getMonth()}`);
  }
  const monthsCount = Math.max(1, uniqueMonths.size);
  const priceBase = Number(DEFAULTS.priceBase) || 0.18;

  const standbyW = Number(document.getElementById('pv-standby')?.value) || 0;
  const pvSim = simulatePVEffect(recs, annualProduction, exportPrice, standbyW, DEFAULTS.monthlySolarWeights);
  const perHourWithPV = perHourAnnual.map((v, h) => Math.max(0, v - (pvSim.consumedByHour[h] || 0)));

  // Build recsWithPV
  const recordsWithPV = recs.map(rec => {
    const reduction = (pvSim.allocatedByTimestamp && pvSim.allocatedByTimestamp[String(rec.dateDebut)]) || 0;
    return { ...rec, valeur: Math.max(0, Number(rec.valeur || 0) - reduction) };
  });

  const exportIncome = pvSim.exported * exportPrice;

  const kwpVal = Number(document.getElementById('pv-kwp')?.value) || 0;
  const costBase = Number(document.getElementById('pv-cost-base')?.value) || 500;
  const costPanel = Number(document.getElementById('pv-cost-panel')?.value) || 200;
  const numPanels = Math.round(kwpVal / 0.4);
  const installCost = costBase + numPanels * costPanel;

  const pvProdEl = document.getElementById('val-pv-prod');
  if (pvProdEl) pvProdEl.textContent = isPvEnabled ? `${formatNumber(annualProduction)} kWh` : 'Désactivé';

  const pvInfoEl = document.getElementById('val-pv-info');
  if (pvInfoEl) {
    pvInfoEl.innerHTML = isPvEnabled
      ? `Coût install. ~<strong>${formatNumber(installCost)} €</strong>`
      : 'Production estimée';
  }

  const selectedKva = String(Number(appState.currentKva) || 6);
  const offers = [];

  for (const tariffMeta of loadedTariffs) {
    if (tariffMeta.injectionPrice != null) continue;
    const { costNoPV, costWithPV } = calculateOfferCost(tariffMeta, recs, recordsWithPV, perHourAnnual, perHourWithPV, priceBase, appState.tempoDayMap || {});
    const subs = tariffMeta.subscriptions || {};
    const subMonthly = Number(subs[selectedKva] != null ? subs[selectedKva] : Object.values(subs)[0]) || 0;
    const subPrice = subMonthly * monthsCount;
    if (costNoPV > 0 || costWithPV > 0 || tariffMeta.type === 'tempo' || tariffMeta.type === 'tempo-optimized') {
      offers.push({ id: tariffMeta.id, name: tariffMeta.name, costNoPV: (Number(costNoPV) || 0) + subPrice, costWithPV: (Number(costWithPV) || 0) + subPrice, color: tariffMeta.color });
    }
  }

  const sortedByCost = offers.slice().sort((a, b) => a.costWithPV - b.costWithPV);
  const bestByCost = sortedByCost[0] || null;
  const worstByCost = sortedByCost[sortedByCost.length - 1] || null;

  const totalCostEl = document.getElementById('val-total-cost');
  if (totalCostEl) totalCostEl.textContent = `${formatNumber(bestByCost ? bestByCost.costWithPV : 0)} €`;

  // Display order: Base, HPHC first, then rest sorted by cost
  const baseOffer = offers.find(o => o.id === 'base');
  const hphcOffer = offers.find(o => o.id === 'hphc');
  const othersSorted = sortedByCost.filter(o => o.id !== 'base' && o.id !== 'hphc');
  const orderedOffers = [...(baseOffer ? [baseOffer] : []), ...(hphcOffer ? [hphcOffer] : []), ...othersSorted];
  offers.length = 0;
  offers.push(...orderedOffers);

  const validBest = sortedByCost.find(o => o.id !== 'tempoOpt');
  const bestId = validBest ? validBest.id : null;

  appState.setState({
    bestOfferId: bestId,
    offers: offers.map(o => ({ ...o })),
    annualPvProduction: annualProduction,
    autoconsumptionRate: annualProduction > 0 ? pvSim.selfConsumed / annualProduction : 0,
    pvSavings: exportIncome
  }, 'compareOffers');

  const getOfferColor = (id, color) => {
    if (color) return color;
    return { base: '#4e79a7', hphc: '#f28e2b', octopus: '#f28e2b', tempo: '#59a14f', tempoOpt: '#117a8b', tch: '#d62728' }[id] || '#a0cbe8';
  };

  const createCard = (title, costNoPV, costPV, isBest, warningMsg, extraInfo, isPositiveMsg) => {
    const div = document.createElement('div');
    div.className = `card result-card${isBest ? ' best-offer' : ''}`;
    const savings = costNoPV - costPV + exportIncome;

    let pvRows = '';
    if (isPvEnabled) {
      const roi = savings > 0 ? installCost / savings : 999;
      const roiDisplay = roi < 100 ? `${roi.toFixed(1)} ans` : '> 20 ans';
      pvRows = `
        <div class="savings-row"><span class="label">Sans PV:</span><span class="value">${formatNumber(costNoPV)} €</span></div>
        <div class="savings-row highlight"><span class="label">Gain Total (PV):</span><span class="value text-success">-${formatNumber(savings)} €</span></div>
        <div class="savings-row"><span class="label">Dont Export:</span><span class="value">+${formatNumber(exportIncome)} €</span></div>
        <div class="savings-row savings-divider"><span class="label">Retour Inv.:</span><span class="value value-strong">${roiDisplay}</span></div>`;
    }

    let bestExtras = '';
    if (isBest && worstByCost && worstByCost.costWithPV > costPV) {
      const diff = worstByCost.costWithPV - costPV;
      bestExtras = `<div class="alert alert-success alert-center mt-2">Économie vs ${worstByCost.name} : <strong>${formatNumber(diff)} €</strong></div>`;
    }

    const warningBlock = warningMsg
      ? `<div class="alert ${isPositiveMsg ? 'alert-success' : 'alert-warning'} alert-compact">${isPositiveMsg ? '✅' : '⚠️'} ${warningMsg}</div>`
      : '';
    const extraInfoBlock = extraInfo ? `<div class="alert alert-info alert-center mt-2">${extraInfo}</div>` : '';

    div.innerHTML = `
      <div class="card-header-row">
        <h3 class="offer-title">${title}</h3>
        ${isBest ? '<span class="badge-best">Meilleure Offre</span>' : ''}
      </div>
      ${warningBlock}
      <div class="cost-display">
        <span class="cost-main">${formatNumber(costPV)} €</span>
        <span class="cost-sub">/ an</span>
      </div>
      ${bestExtras}${extraInfoBlock}${pvRows}`;
    return div;
  };

  if (grid) {
    grid.innerHTML = '';
    for (const ofr of offers) {
      const isBest = bestId === ofr.id;
      let warning = '';
      let extra = '';
      let warningPositive = true;
      if (ofr.id === 'tempo') { warning = "Sans changement d'habitude de consommation."; warningPositive = false; }
      if (ofr.id === 'tempoOpt') { warning = 'Avec report 50% HP Rouge vers HP Blanc.'; warningPositive = false; }
      if (ofr.id === 'tch') { warning = "Tarif à 3 tranches horaires (HP/HC/HSC)."; warningPositive = false; }
      if (isBest && bestId) {
        try {
          const hRef = offers.find(x => x.id === 'hphc');
          if (hRef && hRef.id !== bestId) {
            const s = hRef.costWithPV - ofr.costWithPV;
            extra = `Économie par rapport à l'offre HP/HC: <strong>${s > 0 ? '+' : ''}${formatNumber(s)} €</strong>`;
          }
        } catch (e) { /* ignore */ }
      }
      grid.appendChild(createCard(ofr.name, ofr.costNoPV, ofr.costWithPV, isBest, warning, extra, warningPositive));
    }
  }

  // Offers chart
  const offersCanvas = document.getElementById('offers-chart');
  if (offersCanvas) chartRenderer.renderOffersChart(offers, isPvEnabled, offersCanvas);

  appendLog(analysisLog, 'Comparaison terminée.');

  // PV report
  const pvReportSec = document.getElementById('pv-report-section');
  const pvReportContent = document.getElementById('pv-report-content');
  if (pvReportSec && pvReportContent) {
    if (isPvEnabled) {
      try {
        pvReportSec.classList.remove('hidden');
        pvReportContent.innerHTML = '';
        const roiYearsTarget = Number(document.getElementById('pv-roi-years')?.value) || 15;
        const titleEl = document.getElementById('pv-report-title');
        if (titleEl) titleEl.textContent = `Rapport de Rentabilité Photovoltaïque (${roiYearsTarget} ans)`;
        const region = document.getElementById('pv-region')?.value || 'centre';
        const talon = Number(document.getElementById('pv-standby')?.value) || 50;
        const bestConfig = findBestPVConfig(recs, talon, roiYearsTarget, costBase, costPanel, region, exportPrice, DEFAULTS, appState.tempoDayMap);

        const createReportCard = (title, bestCfg) => {
          const div = document.createElement('div');
          div.className = 'result-card report-card';
          div.innerHTML = `
            <h4 class="report-card-title">${title}</h4>
            <div class="report-card-subtext">Config idéale: <strong>${bestCfg.kwp.toFixed(1)} kWc</strong> (${bestCfg.n} panneaux)<br><small>Coût install: ${formatNumber(bestCfg.cost)} €</small></div>
            <div class="report-card-metric">Économie/an: <strong>${formatNumber(bestCfg.savings)} €</strong></div>
            <div class="report-card-metric">Retour Inv.: <strong>${(bestCfg.cost / bestCfg.savings).toFixed(1)} ans</strong></div>
            <div class="report-card-gain">Gain Net (${roiYearsTarget} ans):<br>
              <span class="report-card-gain-value ${bestCfg.gain > 0 ? 'text-success' : 'text-danger'}">${formatNumber(bestCfg.gain)} €</span>
            </div>
            <button class="btn-apply-config"><span>⚡</span> Appliquer cette config</button>`;
          div.querySelector('.btn-apply-config').addEventListener('click', () => {
            const elKwp = document.getElementById('pv-kwp');
            if (elKwp) { elKwp.value = bestCfg.kwp.toFixed(1); elKwp.dispatchEvent(new Event('change')); }
            const btn = div.querySelector('.btn-apply-config');
            btn.innerHTML = '<span>✅</span> Config appliquée !';
            btn.classList.add('applied');
            setTimeout(() => { btn.innerHTML = '<span>⚡</span> Appliquer cette config'; btn.classList.remove('applied'); }, 2000);
          });
          return div;
        };

        pvReportContent.appendChild(createReportCard('Option Base', bestConfig.base));
        pvReportContent.appendChild(createReportCard('Option HP/HC', bestConfig.hphc));
        pvReportContent.appendChild(createReportCard('Option Tempo', bestConfig.tempo));
        pvReportContent.appendChild(createReportCard('Option Tempo (Optimisé)', bestConfig.tempoOpt));
      } catch (err) {
        console.warn('Erreur affichage rapport PV:', err);
        appendLog(analysisLog, 'Erreur lors du calcul de rentabilité PV. Vérifiez vos paramètres.');
      }
    } else {
      pvReportSec.classList.add('hidden');
    }
  }

  // Price/PV chart
  try {
    const pvKwp2 = Number(document.getElementById('pv-kwp')?.value) || 0;
    const pvRegion2 = document.getElementById('pv-region')?.value || 'centre';
    const standbyW2 = Number(document.getElementById('pv-standby')?.value) || 0;
    const annualProd2 = pvKwp2 * pvYieldPerKwp(pvRegion2);
    const expPrice2 = Number(DEFAULTS.injectionPrice) || 0.06;

    const monthly = computeMonthlyBreakdown(recs, annualProd2, expPrice2, standbyW2, DEFAULTS.monthlySolarWeights, DEFAULTS, appState.tempoDayMap || {});
    const mlabels = monthly.map(m => m.month);

    const mkSeries = (key, keyPV) => ({
      noPv: monthly.map(m => m.consumption > 0 ? (m[key]?.energy / m.consumption) : null),
      pv: monthly.map(m => m.consumption > 0 ? (m[keyPV]?.energy / m.consumption) : null)
    });
    const bs = mkSeries('base', 'basePV');
    const hs = mkSeries('hphc', 'hphcPV');
    const ts = mkSeries('tempo', 'tempoPV');
    const tos = mkSeries('tempoOpt', 'tempoOptPV');
    const tchs = mkSeries('tch', 'tchPV');
    const pvProdSeries = monthly.map(m => m.monthPV || 0);

    const mkLine = (label, data, color, pvColor) => [
      { type: 'line', yAxisID: 'yPrice', label, data, borderColor: color, backgroundColor: color + '60', fill: false, tension: 0.1 },
      ...(isPvEnabled && pvColor ? [{ type: 'line', yAxisID: 'yPrice', label: label + ' (avec PV)', data: pvColor.data, borderColor: pvColor.color, backgroundColor: pvColor.color + '33', fill: false, tension: 0.1 }] : [])
    ];

    const datasets = [
      ...mkLine('Prix Base (€/kWh)', bs.noPv, '#4e79a7', isPvEnabled ? { data: bs.pv, color: '#a0cbe8' } : null),
      ...mkLine('Prix HP/HC (€/kWh)', hs.noPv, '#f28e2b', isPvEnabled ? { data: hs.pv, color: '#ffbe7d' } : null),
      ...mkLine('Prix Tempo (€/kWh)', ts.noPv, '#59a14f', isPvEnabled ? { data: ts.pv, color: '#bfe5b9' } : null),
      ...mkLine('Prix Tempo Opt. (€/kWh)', tos.noPv, '#117a8b', isPvEnabled ? { data: tos.pv, color: '#17a2b8' } : null),
      ...mkLine("Prix TCH (€/kWh)", tchs.noPv, '#d62728', isPvEnabled ? { data: tchs.pv, color: '#ff9896' } : null)
    ];

    for (const tariff of dynamicTwoTiers) {
      const color = tariff.color || '#999999';
      datasets.push({ type: 'line', yAxisID: 'yPrice', label: `Prix ${tariff.name} (€/kWh)`,
        data: monthly.map(m => {
          if (m.consumption <= 0) return null;
          const mRecs = monthlyRecords[m.month] || [];
          let hp = 0, hc = 0;
          for (const rec of mRecs) {
            const v = Number(rec.valeur) || 0;
            if (isHourHC(new Date(rec.dateDebut).getHours(), tariff.hcRange || '22-06')) hc += v;
            else hp += v;
          }
          return (hp * (tariff.php || 0) + hc * (tariff.phc || 0)) / m.consumption;
        }), borderColor: color, backgroundColor: color + '33', fill: false, tension: 0.1 });
    }

    if (isPvEnabled) datasets.push({ type: 'bar', yAxisID: 'yKwh', label: 'Production PV (kWh)', data: pvProdSeries, backgroundColor: '#f1c40f55' });

    chartRenderer.renderPricePVChart(mlabels, datasets, isPvEnabled, document.getElementById('price-pv-chart'));
  } catch (err) {
    console.warn('Erreur rendu prix/PV', err);
  }
}
