import { formatNumber, fmt, isoDateRange, isHourHC, monthKeyFromDateStr, normalizeHcRange, storageKey, saveSetting, loadSetting, applySubscriptionInputs, applyHcRangeInput, applyTotalChargeHeuresInputs } from './utils.js';
import { appState } from './state.js';
import {
  computeCostBase,
  computeCostHpHc,
  computeCostTotalCharge,
  computeCostTempo,
  computeCostTempoOptimized,
  applyPvReduction,
  getPriceForPower,
  SUBSCRIPTION_GRID
} from './tariffEngine.js';
import { pvYieldPerKwp, simulatePVEffect, findBestPVConfig } from './pvSimulation.js';
import {
  generateTempoCalendar,
  fetchTempoFromApi,
  buildFinalTempoMap,
  loadStoredTempoMap,
  saveStoredTempoMap,
  tempoStorageKey,
  showTempoLoading,
  updateTempoLoading,
  hideTempoLoading,
  mapColorToHex,
  getRepresentativePriceForEntry,
  createTooltip,
  renderTempoCalendarGraph,
  ensureTempoDayMap
} from './tempoCalendar.js';
import * as chartRenderer from './chartRenderer.js';
import { parseMultipleFiles, deduplicateRecords, sortRecordsByDate } from './fileHandler.js';
import { initializeUIListeners, populateDefaultsDisplay as populateDefaultsDisplayUI, updateInjectionDisplay as updateInjectionDisplayUI } from './uiManager.js';
import {
  computeHourlyStats,
  computeCostWithProfile,
  calculateStandbyFromRecords,
  computeDailyTempoCostMap,
  computeMonthlyBreakdown
} from './analysisEngine.js';
import {
  invalidateCache,
  extractPvParams,
  readDomValuesOnce,
  buildTableFragmentEfficiently,
  calculateInstallCost,
  applyPvToRecords
} from './calculationEngine.js';
import {
  triggerFullRecalculation as workflowTriggerRecalc,
  setupSubscriptionInputBindings,
  setupTotalChargeInputBindings,
  setupHcRangeInputBinding
} from './workflowEngine.js';
import { setupPvControls, setupPvToggle } from './pvManager.js';
import { loadTariffs } from './tariffManager.js';
import { loadAllTariffFiles, renderTariffCards } from './tariffDisplay.js';

const prmInput = document.getElementById('input-prm');
const dateInput = document.getElementById('input-date');
const logEl = document.getElementById('download-log');

const fileInput = document.getElementById('file-input');
const btnGenerateCsv = document.getElementById('btn-generate-csv');

const dropZone = document.getElementById('drop-zone');
const dropZoneText = document.getElementById('drop-zone-text');
const dropZoneSub = document.getElementById('drop-zone-subtext');

// File input and drop zone are now managed by uiManager.js

const btnThemeToggle = document.getElementById('btn-theme-toggle');
function applyTheme(isDark) {
  if (isDark) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
  applyTheme(true);
} else if (savedTheme === 'light') {
  applyTheme(false);
} else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  applyTheme(true);
}

if (btnThemeToggle) {
  btnThemeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.contains('dark-mode');
    applyTheme(!isDark);
  });
}

try {
  if (dateInput && !dateInput.value) {
    dateInput.value = fmt(new Date());
  }
} catch (err) {
  // ignore
}

function generateConsoleSnippetForPrm(prm, dateRef) {
  const code = [];
  code.push('(async function(){');
  code.push('  try{');
  code.push('    // retrieve personId from the authenticated session (mon-compte)');
  code.push("    const uiResp = await fetch('https://alex.microapplications.enedis.fr/mon-compte/api/private/v2/userinfos?espace=PARTICULIER', {credentials:'include'}); const ui = await uiResp.json();");
  code.push("    console.log('userinfos:', ui);");
  code.push("    const personId = (ui && ui.idPersonne) ? String(ui.idPersonne) : null; if(!personId) console.warn('idPersonne not found in /mon-compte userinfos response'); else console.log('idPersonne trouvé:', personId);");
  code.push(`    const prm = '${String(prm).replace(/'/g, "\\'")}';`);
  code.push('    // build 52 weekly dateDebut values based on a reference date');
  code.push(`    const dateRef = '${String(dateRef).replace(/'/g, "\\'")}';`);
  code.push('    function _fmt(d){ return d.toISOString().slice(0,10); }');
  code.push('    const start = new Date(dateRef); start.setHours(0,0,0,0);');
  code.push('    const dateDebuts = []; for(let i=0;i<52;i++){ const sd = new Date(start); sd.setDate(start.getDate()-7*i); dateDebuts.push(_fmt(sd)); }');
  code.push('    const combined = []; let meta = null;');
  code.push("    console.log('Weeks to fetch: ' + dateDebuts.length);");
  code.push('    for(let i=0;i<dateDebuts.length;i++){');
  code.push('      const ds = dateDebuts[i];');
  code.push('      try{');
  code.push('        console.log(`Fetching ${i+1}/${dateDebuts.length} (dateDebut=${ds})`);');
  code.push('        const qs = `mesuresTypeCode=COURBE&mesuresCorrigees=false&typeDonnees=CONS&dateDebut=${ds}&segments=C5`;');
  code.push('        const url = personId ? `https://alex.microapplications.enedis.fr/mes-mesures-prm/api/private/v2/personnes/${personId}/prms/${prm}/donnees-energetiques?${qs}` : `https://alex.microapplications.enedis.fr/mes-mesures-prm/api/private/v2/prms/${prm}/donnees-energetiques?${qs}`;');
  code.push('        const r = await fetch(url, {credentials:\'include\'});');
  code.push('        let j = null; try{ j = await r.json(); }catch(e){ const t = await r.text(); try{ j = JSON.parse(t); }catch(e2){ j = null; } }');
  code.push('        if(j && j.cons && j.cons.aggregats && j.cons.aggregats.heure && Array.isArray(j.cons.aggregats.heure.donnees)){');
  code.push('          const arr = j.cons.aggregats.heure.donnees; console.log(`Success ${i+1}/${dateDebuts.length}: ${arr.length} records`); if(!meta){ meta = { unite: (j.cons.aggregats.heure.unite||null), grandeurMetier: j.grandeurMetier||null, grandeurPhysique: j.grandeurPhysique||null }; } for(const it of arr) combined.push(it); }');
  code.push('        else { console.warn(`No hourly data for ${i+1}/${dateDebuts.length} (dateDebut=${ds})`); }');
  code.push('      }catch(e){ console.error(\'fetch error at index \' + i, e); }');
  code.push('      await new Promise(r=>setTimeout(r,200));');
  code.push('    }');
  code.push('    combined.sort((a,b)=> new Date(a.dateDebut) - new Date(b.dateDebut));');
  code.push('    const dedup = []; const seen = new Set(); for(const r of combined){ if(r && r.dateDebut && !seen.has(r.dateDebut)){ dedup.push(r); seen.add(r.dateDebut); } }');
  code.push("    console.log('Preparing download with ' + dedup.length + ' records');");
  code.push("    const out = { cons: { aggregats: { heure: { donnees: dedup, unite: (meta && meta.unite) || 'kW' } } }, grandeurMetier: (meta && meta.grandeurMetier) || 'CONS', grandeurPhysique: (meta && meta.grandeurPhysique) || 'PA', dateDebut: (dedup.length? dedup[0].dateDebut.slice(0,10): null), dateFin: (dedup.length? dedup[dedup.length-1].dateFin.slice(0,10): null) };");
  code.push("    const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'consommation_annee.json'; document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();");
  code.push('  }catch(e){ console.error(\'Erreur globale\', e); } })();');
  return code.join('\n');
}

if (btnGenerateCsv) {
  btnGenerateCsv.addEventListener('click', () => {
    const prm = prmInput.value.trim();
    if (!prm) {
      alert('Veuillez saisir le PRM.');
      return;
    }
    const dateRef = dateInput.value ? new Date(dateInput.value).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const scriptArea = document.getElementById('console-script');
    if (scriptArea) {
      const scriptText = generateConsoleSnippetForPrm(prm, dateRef);
      scriptArea.value = scriptText;
      const scriptBlock = document.getElementById('script-area');
      if (scriptBlock) scriptBlock.classList.remove('hidden');
      (async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(scriptText);
            appendLog(logEl, 'Script console généré et copié dans le presse-papiers. Collez-le dans la console d\'Enedis (F12 → Console).');
          } else {
            scriptArea.select();
            const ok = document.execCommand && document.execCommand('copy');
            if (ok) appendLog(logEl, 'Script console copié (fallback). Collez-le dans la console d\'Enedis.');
            else appendLog(logEl, 'Script généré mais impossible de le copier automatiquement — copiez-le manuellement depuis la zone de script.');
          }
        } catch (err) {
          appendLog(logEl, `Échec copie automatique du script: ${err && err.message}`);
        }
      })();
    } else {
      appendLog(logEl, 'Script généré mais zone introuvable — copiez-le manuellement.');
    }
  });
}

const tempoLoading = {
  container: document.getElementById('tempo-loading'),
  fill: document.getElementById('tempo-loading-fill'),
  text: document.getElementById('tempo-loading-text'),
  total: 0,
  done: 0
};

const DEFAULTS = {
  priceBase: 0.194,
  subBase: 15.65,
  hp: { php: 0.2065, phc: 0.1579, hcRange: '22-06', sub: 15.65 },
  octopusEnergy: { php: 0.2132, phc: 0.1251, hcRange: '22-06', sub: 15.65 },
  tempo: {
    blue: { hp: 0.1612, hc: 0.1325 },
    white: { hp: 0.1871, hc: 0.1499 },
    red: { hp: 0.706, hc: 0.1575 },
    sub: 15.59,
    hcRange: '22-06',
    approxPct: { B: 0.8, W: 0.15, R: 0.05 }
  },
  totalChargeHeures: {
    php: 0.2305,
    phc: 0.1579,
    phsc: 0.1337,
    sub: 15.65,
    hpRange: '07-23',
    hcRange: '23-02;06-07',
    hscRange: '02-06'
  },
  injectionPrice: 0,
  monthlySolarWeightsRaw: [0.6, 0.7, 0.9, 1.1, 1.2, 1.3, 1.3, 1.2, 1.0, 0.8, 0.6, 0.5],
  tempoApi: {
    enabled: true,
    baseUrl: 'https://www.api-couleur-tempo.fr/api',
    perDayThrottleMs: 120,
    concurrency: 6,
    storageKey: 'comparatifElec.tempoDayMap'
  }
};
DEFAULTS.monthlySolarWeights = (function normalizeWeights() {
  const sum = DEFAULTS.monthlySolarWeightsRaw.reduce((a, b) => a + b, 0) || 1;
  return DEFAULTS.monthlySolarWeightsRaw.map((v) => v / sum);
})();

appState.setState({ tariffs: DEFAULTS }, 'TARIFFS_DEFAULTS');

// getPriceForPower and SUBSCRIPTION_GRID now imported from tariffEngine.js

function updateSubscriptionDefault(kva) {
  if (!kva) return;
  const safeKva = Number(kva);
  if (Number.isNaN(safeKva)) return;

  const base = getPriceForPower('base', safeKva) || 15.47;
  const hp = getPriceForPower('hphc', safeKva) || 15.74;
  const tempo = getPriceForPower('tempo', safeKva) || 15.5;

  DEFAULTS.subBase = base;
  DEFAULTS.hp.sub = hp;
  DEFAULTS.tempo.sub = tempo;

  const inpBase = document.getElementById('param-sub-base');
  const inpHp = document.getElementById('param-sub-hphc');
  const inpTempo = document.getElementById('param-sub-tempo');
  if (inpBase) inpBase.value = base.toFixed(2);
  if (inpHp) inpHp.value = hp.toFixed(2);
  if (inpTempo) inpTempo.value = tempo.toFixed(2);

  appState.setState({ currentKva: safeKva }, 'POWER_UPDATED');
  populateDefaultsDisplayUI(DEFAULTS);
}

const kvaSelect = document.getElementById('param-power-kva');
if (kvaSelect) {
  kvaSelect.addEventListener('change', async () => {
    const val = kvaSelect.value;
    if (val !== 'auto') {
      updateSubscriptionDefault(val);
      await triggerFullRecalculation();
    } else if (appState.detectedKva) {
      updateSubscriptionDefault(appState.detectedKva);
      await triggerFullRecalculation();
    }
  });
}

function appendLog(el, msg) {
  if (!el) return;
  el.textContent = (el.textContent ? `${el.textContent}\n` : '') + msg;
}

// Tempo loading functions now imported from tempoCalendar.js

const analysisLog = document.getElementById('analysis-log');
const hourlyCanvas = document.getElementById('hourly-chart');
let hourlyChart = null;

function buildFileCacheKey(fileList) {
  return Array.from(fileList)
    .map((file) => `${file.name}:${file.size}:${file.lastModified}`)
    .join('|');
}

async function parseFilesToRecords(fileList) {
  const records = [];
  const csvFiles = [];
  const otherFiles = [];

  for (const file of fileList) {
    const name = (file.name || '').toLowerCase();
    appendLog(analysisLog, `Lecture: ${file.name}`);
    if (name.endsWith('.csv') || (file.type && file.type.toLowerCase().includes('csv'))) {
      csvFiles.push(file);
    } else if (name.endsWith('.json') || file.type.includes('json') || name.endsWith('.txt')) {
      otherFiles.push(file);
    } else {
      appendLog(analysisLog, `${file.name} ignoré (formats supportés: JSON/CSV).`);
    }
  }

  if (otherFiles.length > 0) {
    try {
      const parsed = await parseMultipleFiles(otherFiles);
      records.push(...parsed);
    } catch (err) {
      appendLog(analysisLog, `Erreur lecture fichiers JSON: ${err && err.message ? err.message : err}`);
    }
  }

  for (const file of csvFiles) {
    try {
      const txt = await file.text();
      if (typeof window.csvToEnedisJson !== 'function') throw new Error('convertisseur CSV indisponible');
      const json = window.csvToEnedisJson(txt);
      const donnees = (((json || {}).cons || {}).aggregats || {}).heure && (((json || {}).cons || {}).aggregats || {}).heure.donnees;
      if (Array.isArray(donnees)) {
        for (const rec of donnees) {
          const val = Number(rec.valeur);
          if (Number.isNaN(val)) continue;
          records.push({ dateDebut: rec.dateDebut, dateFin: rec.dateFin, valeur: val });
        }
        appendLog(analysisLog, `Converti depuis CSV: ${donnees.length} enregistrements`);
      } else {
        appendLog(analysisLog, `CSV non reconnu: aucune donnée horaire trouvée dans ${file.name}`);
      }
    } catch (err) {
      appendLog(analysisLog, `Erreur conversion CSV (${file.name}): ${err && err.message ? err.message : err}`);
    }
  }

  const dedup = deduplicateRecords(records);
  const sorted = sortRecordsByDate(dedup);
  appendLog(analysisLog, `Total enregistrements valides: ${sorted.length}`);
  return sorted;
}

export async function getRecordsFromCache(fileList) {
  if (!fileList || fileList.length === 0) return [];
  const key = buildFileCacheKey(fileList);
  if (appState.recordsCacheKey === key && appState.records.length) {
    return appState.records;
  }
  const records = await parseFilesToRecords(fileList);
  appState.setState({ records, recordsCacheKey: key }, 'FILES_LOADED');
  return records;
}

// Imported from analysisEngine.js
// computeHourlyStats() is now imported

function renderHourlyChart(stats) {
  chartRenderer.renderHourlyChart(stats, hourlyCanvas);
}

function renderHpHcPie(records) {
  try {
    const hcRange = (DEFAULTS.hp && DEFAULTS.hp.hcRange) || '22-06';
    const canvas = document.getElementById('hp-hc-pie');
    if (!canvas) return;
    chartRenderer.renderHpHcPie(records, hcRange, canvas);
  } catch (err) {
    console.warn('Erreur rendu HP/HC pie', err);
  }
}

export async function analyzeFilesNow(records) {
  const dashboard = document.getElementById('dashboard-section');
  if (dashboard) dashboard.classList.remove('hidden');

  appendLog(analysisLog, 'Démarrage de l\'analyse...');
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
  const kvaSteps = [3, 6, 9, 12, 15, 18, 24, 30, 36];
  let recommendedKva = 36;
  for (const step of kvaSteps) {
    if (step >= maxPowerKw) {
      recommendedKva = step;
      break;
    }
  }

  appState.setState({ detectedKva: recommendedKva }, 'POWER_DETECTED');

  const kvaInfo = document.getElementById('power-detected-info');
  if (kvaInfo) kvaInfo.textContent = `Max: ${maxPowerKw.toFixed(1)} kW (Standard: ${recommendedKva} kVA)`;

  const kvaSel = document.getElementById('param-power-kva');
  if (kvaSel && kvaSel.value === 'auto') updateSubscriptionDefault(recommendedKva);

  renderHourlyChart(stats);
  try {
    renderHpHcPie(records);
  } catch (err) {
    // ignore
  }

  appendLog(analysisLog, 'Analyse terminée.');
  try {
    const tempoMap = await ensureTempoDayMap(records, tempoLoading, DEFAULTS, (updates) => {
      if (updates.tempoDayMap) appState.setState({ tempoDayMap: updates.tempoDayMap }, 'TEMPO_MAP_LOADED');
      if (updates.tempoSourceMap) appState.setState({ tempoSourceMap: updates.tempoSourceMap }, 'TEMPO_SOURCES_UPDATED');
    });
    try {
      const dailyCostMap = computeDailyTempoCostMap(records, tempoMap, DEFAULTS.tempo);
      renderTempoCalendarGraph(tempoMap, dailyCostMap, DEFAULTS);
    } catch (err) {
      // ignore
    }
  } catch (err) {
    console.warn('Erreur génération calendrier TEMPO automatique', err);
  }
}

// computeCostWithProfile, monthKeyFromDateStr, computeMonthlyBreakdown imported from analysisEngine.js

/**
 * Helper: Compute monthly cost for a two-tier tariff
 * @param {Array} monthRecords - Records for a single month
 * @param {Object} tariffMeta - Tariff metadata { php, phc, hcRange }
 * @returns {number} Monthly cost without PV
 */
function computeTwoTierMonthlyCost(monthRecords, tariffMeta) {
  if (!tariffMeta || !tariffMeta.php || !tariffMeta.phc) return 0;
  let hp = 0, hc = 0;
  for (const rec of monthRecords) {
    const date = new Date(rec.dateDebut);
    const hour = date.getHours();
    const value = Number(rec.valeur) || 0;
    if (isHourHC(hour, tariffMeta.hcRange || '22-06')) {
      hc += value;
    } else {
      hp += value;
    }
  }
  const sub = (tariffMeta.subscriptions && tariffMeta.subscriptions[Object.keys(tariffMeta.subscriptions)[0]]) || 0;
  return hp * tariffMeta.php + hc * tariffMeta.phc + sub;
}

export async function renderMonthlyBreakdown(records) {
  const recs = records || appState.records;
  if (!recs || recs.length === 0) {
    alert('Sélectionnez d\'abord un fichier JSON via le sélecteur de fichiers.');
    return;
  }

  appendLog(analysisLog, 'Calcul ventilation mensuelle...');
  
  // Group records by month for dynamic tariff calculations
  const monthlyRecords = {};
  for (const rec of recs) {
    const date = new Date(rec.dateDebut);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyRecords[monthKey]) monthlyRecords[monthKey] = [];
    monthlyRecords[monthKey].push(rec);
  }
  
  // Prepare parameters for computeMonthlyBreakdown
  const pvKwp = Number(document.getElementById('pv-kwp')?.value) || 0;
  const pvRegion = document.getElementById('pv-region')?.value || 'centre';
  const standbyW = Number(document.getElementById('pv-standby')?.value) || 0;
  const annualProduction = pvKwp * pvYieldPerKwp(pvRegion);
  const exportPrice = Number(DEFAULTS.injectionPrice) || 0.06;
  
  let tempoMap = appState.tempoDayMap;
  if (!tempoMap || Object.keys(tempoMap).length === 0) {
    try {
      tempoMap = await ensureTempoDayMap(recs, tempoLoading, DEFAULTS, (updates) => {
        if (updates.tempoDayMap) appState.setState({ tempoDayMap: updates.tempoDayMap }, 'TEMPO_MAP_LOADED');
        if (updates.tempoSourceMap) appState.setState({ tempoSourceMap: updates.tempoSourceMap }, 'TEMPO_SOURCES_UPDATED');
      });
    } catch (err) {
      tempoMap = null;
    }
  }

  const data = computeMonthlyBreakdown(
    recs,
    annualProduction,
    exportPrice,
    standbyW,
    DEFAULTS.monthlySolarWeights,
    DEFAULTS,
    tempoMap || null
  );
  const container = document.getElementById('monthly-results');
  if (!container) return;
  container.innerHTML = '';

  const table = document.createElement('table');
  const hdr = document.createElement('tr');
  const isPvEnabled = document.getElementById('toggle-pv') ? document.getElementById('toggle-pv').checked : true;
  
  // Load tariff metadata once
  const loadedTariffs = (appState.getState().loadedTariffs || []);
  const dynamicTwoTiers = loadedTariffs.filter(t => t.type === 'two-tier' && t.id !== 'hphc');
  
  // Build header dynamically: hardcoded tariffs + any two-tier dynamic tariffs
  let headerHTML = '<th>Mois</th><th>Consommation (kWh)</th>';
  headerHTML += '<th>Base (€)</th>';
  if (isPvEnabled) headerHTML += '<th>Base PV (€)</th><th>Éco. Base (€)</th>';
  headerHTML += '<th>HP/HC (€)</th>';
  if (isPvEnabled) headerHTML += '<th>HP/HC PV (€)</th><th>Éco. HP/HC (€)</th>';
  
  // Add dynamic two-tier tariffs
  for (const tariff of dynamicTwoTiers) {
    headerHTML += `<th>${tariff.name} (€)</th>`;
  }
  
  headerHTML += '<th>Tempo (€)</th>';
  if (isPvEnabled) headerHTML += '<th>Tempo PV (€)</th><th>Éco. Tempo (€)</th>';
  headerHTML += '<th>TCH (€)</th>';
  if (isPvEnabled) headerHTML += '<th>TCH PV (€)</th><th>Éco. TCH (€)</th>';
  
  hdr.innerHTML = headerHTML;
  table.appendChild(hdr);

  const monthlySavings = data.map((row) => ({
    month: row.month,
    base: Math.max(0, (row.base.total || 0) - (row.basePV.total || 0)),
    hphc: Math.max(0, (row.hphc.total || 0) - (row.hphcPV.total || 0)),
    tempo: Math.max(0, (row.tempo.total || 0) - (row.tempoPV.total || 0)),
    tempoOpt: Math.max(0, (row.tempoOpt.total || 0) - (row.tempoOptPV.total || 0)),
    tch: Math.max(0, (row.tch.total || 0) - (row.tchPV.total || 0))
  }));

  const { bestOfferId } = appState.getState();
  
  // Helper function to compute monthly cost for a two-tier tariff

  const getMonthlyOfferCost = (row, offerId, usePv) => {
    if (!offerId) return null;
    switch (offerId) {
      case 'base':
        return usePv ? row.basePV.total : row.base.total;
      case 'hphc':
        return usePv ? row.hphcPV.total : row.hphc.total;
      case 'tempo':
        return usePv ? row.tempoPV.total : row.tempo.total;
      case 'tempoOpt':
        return usePv ? row.tempoOptPV.total : row.tempoOpt.total;
      case 'tch':
        return usePv ? row.tchPV.total : row.tch.total;
      default:
        return null;
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
        .map((id) => getMonthlyOfferCost(row, id, isPvEnabled))
        .filter((value) => typeof value === 'number');
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
      
      // Add dynamic two-tier tariffs
      for (const tariff of dynamicTwoTiers) {
        const monthRecords = monthlyRecords[row.month] || [];
        const dynamicCost = computeTwoTierMonthlyCost(monthRecords, tariff);
        rowHTML += `<td>${formatNumber(dynamicCost)}</td>`;
      }
      
      rowHTML +=
        `<td>${formatNumber(row.tempoOpt.total)}</td>` +
        `<td>${formatNumber(row.tempoOptPV.total)}</td>` +
        `<td class="text-success">${formatNumber(sv.tempoOpt)}</td>` +
        `<td>${formatNumber(row.tch.total)}</td>` +
        `<td>${formatNumber(row.tchPV.total)}</td>` +
        `<td class="text-success">${formatNumber(sv.tch)}</td>` +
        `<td class="${diffClass}" style="font-weight: bold;">${diffDisplay} €</td>`;
    } else {
      rowHTML +=
        `<td>${formatNumber(row.base.total)}</td>` +
        `<td>${formatNumber(row.hphc.total)}</td>` +
        `<td>${formatNumber(row.tempo.total)}</td>`;
      
      // Add dynamic two-tier tariffs (without PV)
      for (const tariff of dynamicTwoTiers) {
        const monthRecords = monthlyRecords[row.month] || [];
        const dynamicCost = computeTwoTierMonthlyCost(monthRecords, tariff);
        rowHTML += `<td>${formatNumber(dynamicCost)}</td>`;
      }
      
      rowHTML +=
        `<td>${formatNumber(row.tempoOpt.total)}</td>` +
        `<td>${formatNumber(row.tch.total)}</td>` +
        `<td class="${diffClass}" style="font-weight: bold;">${diffDisplay} €</td>`;
    }
    tr.innerHTML = rowHTML;
    table.appendChild(tr);
  }
  container.appendChild(table);

  if (isPvEnabled) {
    const totalSavings = monthlySavings.reduce(
      (acc, row) => ({
        base: acc.base + (row.base || 0),
        hphc: acc.hphc + (row.hphc || 0),
        tempo: acc.tempo + (row.tempo || 0),
        tempoOpt: acc.tempoOpt + (row.tempoOpt || 0),
        tch: acc.tch + (row.tch || 0)
      }),
      { base: 0, hphc: 0, tempo: 0, tempoOpt: 0, tch: 0 }
    );
    const totalsBox = document.createElement('div');
    totalsBox.id = 'pv-savings-totals';
    totalsBox.className = 'log mt-2';
    totalsBox.innerHTML =
      `<strong>Économies annuelles (par offre)</strong> — ` +
      `Base: ${formatNumber(totalSavings.base)} € &nbsp; | &nbsp; ` +
      `HP/HC: ${formatNumber(totalSavings.hphc)} € &nbsp; | &nbsp; ` +
      `Tempo: ${formatNumber(totalSavings.tempo)} € &nbsp; | &nbsp; ` +
      `Tempo Opt.: ${formatNumber(totalSavings.tempoOpt)} € &nbsp; | &nbsp; ` +
      `TCH: ${formatNumber(totalSavings.tch)} €`;
    container.appendChild(totalsBox);
  }

  const labels = data.map((row) => row.month);
  let datasets = [];
  if (isPvEnabled) {
    datasets = [
      { label: 'Base', data: data.map((row) => row.base.total), backgroundColor: '#4e79a7' },
      { label: 'Base (avec PV)', data: data.map((row) => row.basePV.total), backgroundColor: '#a0cbe8' },
      { label: 'HP/HC', data: data.map((row) => row.hphc.total), backgroundColor: '#f28e2b' },
      { label: 'HP/HC (avec PV)', data: data.map((row) => row.hphcPV.total), backgroundColor: '#ffbe7d' },
      { label: 'Tempo', data: data.map((row) => row.tempo.total), backgroundColor: '#59a14f' },
      { label: 'Tempo (avec PV)', data: data.map((row) => row.tempoPV.total), backgroundColor: '#bfe5b9' },
      { label: 'Tempo Opt.', data: data.map((row) => row.tempoOpt.total), backgroundColor: '#117a8b' },
      { label: 'Tempo Opt. (avec PV)', data: data.map((row) => row.tempoOptPV.total), backgroundColor: '#17a2b8' },
      { label: 'TCH', data: data.map((row) => row.tch.total), backgroundColor: '#d62728' },
      { label: 'TCH (avec PV)', data: data.map((row) => row.tchPV.total), backgroundColor: '#ff9896' }
    ];
  } else {
    datasets = [
      { label: 'Base', data: data.map((row) => row.base.total), backgroundColor: '#4e79a7' },
      { label: 'HP/HC', data: data.map((row) => row.hphc.total), backgroundColor: '#f28e2b' },
      { label: 'Tempo', data: data.map((row) => row.tempo.total), backgroundColor: '#59a14f' },
      { label: 'Tempo Opt.', data: data.map((row) => row.tempoOpt.total), backgroundColor: '#17a2b8' },
      { label: 'TCH', data: data.map((row) => row.tch.total), backgroundColor: '#d62728' }
    ];
  }

  const ctx = document.getElementById('monthly-chart').getContext('2d');
  if (window.monthlyChart) {
    window.monthlyChart.destroy();
    window.monthlyChart = null;
  }
  window.monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: { responsive: true, scales: { y: { beginAtZero: true } }, interaction: { mode: 'index' } }
  });

  try {
    const sc = document.getElementById('monthly-savings-chart');
    if (sc) {
      if (isPvEnabled) {
        sc.style.display = 'block';
        try {
          if (sc.parentElement) sc.parentElement.style.display = '';
        } catch (err) {
          // ignore
        }
        const ctxs = sc.getContext('2d');
        if (window.monthlySavingsChart) {
          window.monthlySavingsChart.destroy();
          window.monthlySavingsChart = null;
        }
        window.monthlySavingsChart = new Chart(ctxs, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              { label: 'Éco. Base (€)', data: monthlySavings.map((m) => m.base), backgroundColor: '#2e7d3233', borderColor: '#2e7d32', borderWidth: 1 },
              { label: 'Éco. HP/HC (€)', data: monthlySavings.map((m) => m.hphc), backgroundColor: '#00838f33', borderColor: '#00838f', borderWidth: 1 },
              { label: 'Éco. Tempo (€)', data: monthlySavings.map((m) => m.tempo), backgroundColor: '#8e24aa33', borderColor: '#8e24aa', borderWidth: 1 },
              { label: 'Éco. Tempo Opt. (€)', data: monthlySavings.map((m) => m.tempoOpt), backgroundColor: '#005cbf33', borderColor: '#005cbf', borderWidth: 1 },
              { label: 'Éco. TCH (€)', data: monthlySavings.map((m) => m.tch), backgroundColor: '#d6272833', borderColor: '#d62728', borderWidth: 1 }
            ]
          },
          options: {
            responsive: true,
            scales: { y: { beginAtZero: true, title: { display: true, text: '€ / mois économisés' } } },
            interaction: { mode: 'index' }
          }
        });
      } else {
        sc.style.display = 'none';
        try {
          if (sc.parentElement) sc.parentElement.style.display = 'none';
        } catch (err) {
          // ignore
        }
      }
    }
  } catch (err) {
    console.warn('Erreur rendu graphique économies PV mensuelles', err);
  }
  appendLog(analysisLog, 'Ventilation mensuelle terminée.');
}

export async function runPvSimulation(records) {
  const recs = records || appState.records;
  if (!recs || recs.length === 0) {
    alert('Sélectionnez d\'abord un fichier JSON via le sélecteur de fichiers.');
    return;
  }

  const isPvEnabled = document.getElementById('toggle-pv') ? document.getElementById('toggle-pv').checked : true;
  if (!isPvEnabled) return;

  appendLog(analysisLog, 'Estimation PV en cours...');
  const pvKwp = Number((document.getElementById('pv-kwp') || {}).value) || 0;
  const region = (document.getElementById('pv-region') || {}).value || 'centre';
  const standbyW = Number((document.getElementById('pv-standby') || {}).value) || 0;
  const yieldVal = pvYieldPerKwp(region);
  const annualProduction = pvKwp * yieldVal;
  const exportPrice = Number(DEFAULTS.injectionPrice) || 0;

  const pvSim = simulatePVEffect(recs, annualProduction, exportPrice, standbyW, DEFAULTS.monthlySolarWeights);
  const pvProdEl = document.getElementById('val-pv-prod');
  if (pvProdEl) pvProdEl.textContent = `${formatNumber(annualProduction)} kWh`;

  try {
    const container = document.getElementById('pv-chart-container');
    if (container) {
      container.innerHTML = '<canvas id="pv-power-chart" class="chart-canvas-small"></canvas>';
      const pc = document.getElementById('pv-power-chart');

      const pvKwp = Number(document.getElementById('pv-kwp')?.value) || 0;
      const pvRegion = document.getElementById('pv-region')?.value || 'centre';
      const standbyW = Number(document.getElementById('pv-standby')?.value) || 0;
      const annualProduction = pvKwp * pvYieldPerKwp(pvRegion);
      const exportPrice = Number(DEFAULTS.injectionPrice) || 0.06;

      let tempoMap = appState.tempoDayMap;
      if (!tempoMap || Object.keys(tempoMap).length === 0) {
        try {
          tempoMap = await ensureTempoDayMap(recs, tempoLoading, DEFAULTS, (updates) => {
            if (updates.tempoDayMap) appState.setState({ tempoDayMap: updates.tempoDayMap }, 'TEMPO_MAP_LOADED');
            if (updates.tempoSourceMap) appState.setState({ tempoSourceMap: updates.tempoSourceMap }, 'TEMPO_SOURCES_UPDATED');
          });
        } catch (err) {
          tempoMap = null;
        }
      }

      const monthly = computeMonthlyBreakdown(
        recs,
        annualProduction,
        exportPrice,
        standbyW,
        DEFAULTS.monthlySolarWeights,
        DEFAULTS,
        tempoMap || null
      );
      const mlabels = monthly.map((m) => m.month);
      const productionSeries = monthly.map((m) => Number(m.monthPV || 0));
      const autoconsumedSeries = monthly.map((m) => Number(m.monthSelf || 0));
      const injectedSeries = monthly.map((m) => Math.max(0, Number((m.monthPV || 0) - (m.monthSelf || 0))));

      if (window.pvPowerChart) {
        window.pvPowerChart.destroy();
        window.pvPowerChart = null;
      }
      const ctxp = pc.getContext('2d');
      window.pvPowerChart = new Chart(ctxp, {
        type: 'bar',
        data: {
          labels: mlabels,
          datasets: [
            { label: 'Production PV (kWh)', data: productionSeries, backgroundColor: '#f1c40f' },
            { label: 'Autoconsommation (kWh)', data: autoconsumedSeries, backgroundColor: '#4e79a7' },
            { label: 'Injection (kWh)', data: injectedSeries, backgroundColor: '#ff9f43' }
          ]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true, title: { display: true, text: 'kWh' } } } }
      });
    }
  } catch (err) {
    console.warn('Erreur rendu graphique PV puissance', err);
  }
}

const btnExportReport = document.getElementById('btn-export-report');
if (btnExportReport) {
  btnExportReport.addEventListener('click', async () => {
    const files = fileInput && fileInput.files;
    if (!files || files.length === 0) {
      alert('Sélectionnez d\'abord un fichier JSON via le sélecteur de fichiers.');
      return;
    }
    appendLog(analysisLog, 'Génération du rapport...');
    const records = await getRecordsFromCache(files);
    const stats = computeHourlyStats(records);
    const report = {
      generatedAt: new Date().toISOString(),
      summary: { totalConsumption: stats.total },
      hourly: { avg: stats.avg, min: stats.min, max: stats.max }
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rapport_conso.json';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
    appendLog(analysisLog, 'Rapport téléchargé.');
  });
}

/**
 * Calculate offer cost based on tariff type and loaded defaults
 * Supports dynamic tariff calculation for simple/two-tier/three-tier types
 * @param {Object} tariffMeta - Tariff metadata {id, type, ...}
 * @param {Object} DEFAULTS - Tariff defaults configuration
 * @param {Array} recs - Original consumption records (needed for three-tier tariffs)
 * @param {Array} recsWithPV - Records with PV reduction applied
 * @param {Array} perHourAnnual - Hourly consumption profile (no PV)
 * @param {Array} perHourWithPV - Hourly consumption profile (with PV)
 * @param {number} priceBase - Base price (fallback)
 * @param {number} subscription - Monthly subscription
 * @returns {Object} {costNoPV, costWithPV}
 */
function calculateOfferCost(tariffMeta, DEFAULTS, recs, recsWithPV, perHourAnnual, perHourWithPV, priceBase, subscription) {
  if (!tariffMeta || !tariffMeta.type) {
    return { costNoPV: 0, costWithPV: 0 };
  }

  let costNoPV = 0,
    costWithPV = 0;

  // Base (flat rate)
  if (tariffMeta.type === 'flat') {
    const price = Number(tariffMeta.price != null ? tariffMeta.price : DEFAULTS.priceBase) || priceBase;
    costNoPV = computeCostWithProfile(perHourAnnual, price, { mode: 'base' }).cost;
    costWithPV = computeCostWithProfile(perHourWithPV, price, { mode: 'base' }).cost;
  }
  // Two-tier (HP/HC)
  else if (tariffMeta.type === 'two-tier') {
    const php = Number(tariffMeta.php) || 0.2;
    const phc = Number(tariffMeta.phc) || 0.12;
    const hcRange = tariffMeta.hcRange || '22-06';
    costNoPV = computeCostWithProfile(perHourAnnual, priceBase, { mode: 'hp-hc', php, phc, hcRange }).cost;
    costWithPV = computeCostWithProfile(perHourWithPV, priceBase, { mode: 'hp-hc', php, phc, hcRange }).cost;
  }
  // Three-tier (HP/HC/HSC)
  else if (tariffMeta.type === 'three-tier') {
    const tchConfig = {
      php: Number(tariffMeta.php) || Number((DEFAULTS.totalChargeHeures || {}).php) || 0,
      phc: Number(tariffMeta.phc) || Number((DEFAULTS.totalChargeHeures || {}).phc) || 0,
      phsc: Number(tariffMeta.phsc) || Number((DEFAULTS.totalChargeHeures || {}).phsc) || 0,
      hpRange: tariffMeta.hpRange || (DEFAULTS.totalChargeHeures || {}).hpRange,
      hcRange: tariffMeta.hcRange || (DEFAULTS.totalChargeHeures || {}).hcRange,
      hscRange: tariffMeta.hscRange || (DEFAULTS.totalChargeHeures || {}).hscRange
    };
    if (tchConfig && recs) {
      // Use actual records for accurate three-tier calculation
      const tchNoPV = computeCostTotalCharge(recs, tchConfig);
      costNoPV = tchNoPV.cost || 0;
      
      if (recsWithPV) {
        const tchWithPV = computeCostTotalCharge(recsWithPV, tchConfig);
        costWithPV = tchWithPV.cost || 0;
      }
    }
  }

  // Add subscription
  return {
    costNoPV: costNoPV + subscription,
    costWithPV: costWithPV + subscription
  };
}

export async function compareOffers(records) {
  const recs = records || appState.records;
  if (!recs || recs.length === 0) {
    alert('Sélectionnez d\'abord un fichier JSON via le sélecteur de fichiers.');
    return;
  }

  const grid = document.getElementById('offers-results-grid');
  appendLog(analysisLog, 'Comparaison des offres en cours...');

  const isPvEnabled = document.getElementById('toggle-pv') ? document.getElementById('toggle-pv').checked : true;
  const annualProduction = isPvEnabled
    ? (Number(document.getElementById('pv-kwp').value) || 0) * pvYieldPerKwp((document.getElementById('pv-region') || {}).value || 'centre')
    : 0;
  const exportPrice = Number(DEFAULTS.injectionPrice) || 0;

  const perHourAnnual = Array.from({ length: 24 }, () => 0);
  const uniqueMonths = new Set();
  for (const rec of recs) {
    const value = Number(rec.valeur) || 0;
    const date = new Date(rec.dateDebut);
    perHourAnnual[date.getHours()] += value;
    uniqueMonths.add(`${date.getFullYear()}-${date.getMonth()}`);
  }
  const monthsCount = Math.max(1, uniqueMonths.size);

  const priceBase = Number(DEFAULTS.priceBase) || 0.18;
  const hpParams = { mode: 'hp-hc', php: Number(DEFAULTS.hp.php) || 0.2, phc: Number(DEFAULTS.hp.phc) || 0.12, hcRange: DEFAULTS.hp.hcRange || '22-06' };

  const subBase = (Number(DEFAULTS.subBase) || 0) * monthsCount;
  const subHp = (Number(DEFAULTS.hp.sub) || 0) * monthsCount;
  const subOctopus = (Number((DEFAULTS.octopusEnergy || {}).sub) || 0) * monthsCount;
  const subTempo = (Number(DEFAULTS.tempo.sub) || 0) * monthsCount;
  const subTch = (Number((DEFAULTS.totalChargeHeures || {}).sub) || 0) * monthsCount;

  const baseCostNoPV = computeCostWithProfile(perHourAnnual, priceBase, { mode: 'base' }).cost + subBase;
  const hpCostNoPV = computeCostWithProfile(perHourAnnual, priceBase, hpParams).cost + subHp;

  const octopusParams = { mode: 'hp-hc', php: Number((DEFAULTS.octopusEnergy || {}).php) || 0.2, phc: Number((DEFAULTS.octopusEnergy || {}).phc) || 0.12, hcRange: (DEFAULTS.octopusEnergy || {}).hcRange || '22-06' };
  const octopusCostNoPV = computeCostWithProfile(perHourAnnual, priceBase, octopusParams).cost + subOctopus;

  const tempoResNoPV = computeCostTempo(recs, appState.tempoDayMap, DEFAULTS.tempo);
  tempoResNoPV.cost += subTempo;

  // Tempo optimized (no PV) - compute before building offers list
  const tempoOptimizedResNoPV = computeCostTempoOptimized(recs, appState.tempoDayMap, DEFAULTS.tempo);
  if (tempoOptimizedResNoPV && typeof tempoOptimizedResNoPV.cost === 'number') {
    tempoOptimizedResNoPV.cost += subTempo;
  }

  const tchResNoPV = computeCostTotalCharge(recs, DEFAULTS.totalChargeHeures);
  tchResNoPV.cost += subTch;

  const standbyW = Number((document.getElementById('pv-standby') || {}).value) || 0;
  const pvSim = simulatePVEffect(recs, annualProduction, exportPrice, standbyW, DEFAULTS.monthlySolarWeights);
  const perHourWithPV = perHourAnnual.map((v, h) => Math.max(0, v - (pvSim.consumedByHour[h] || 0)));

  const baseCostWithPV = computeCostWithProfile(perHourWithPV, priceBase, { mode: 'base' }).cost + subBase;
  const hpCostWithPV = computeCostWithProfile(perHourWithPV, priceBase, hpParams).cost + subHp;
  const octopusCostWithPV = computeCostWithProfile(perHourWithPV, priceBase, octopusParams).cost + subOctopus;

  const recordsWithPV = recs.map((rec) => ({ ...rec }));
  for (const rec of recordsWithPV) {
    const key = String(rec.dateDebut);
    const reduction = (pvSim.allocatedByTimestamp && pvSim.allocatedByTimestamp[key]) || 0;
    rec.valeur = Math.max(0, Number(rec.valeur || 0) - reduction);
  }

  const tempoResWithPV = computeCostTempo(recordsWithPV, appState.tempoDayMap, DEFAULTS.tempo);
  tempoResWithPV.cost += subTempo;
  const tchResWithPV = computeCostTotalCharge(recordsWithPV, DEFAULTS.totalChargeHeures);
  tchResWithPV.cost += subTch;

  const tempoOptimizedResWithPV = computeCostTempoOptimized(recordsWithPV, appState.tempoDayMap, DEFAULTS.tempo);
  const tempoOptimizedCost = (tempoOptimizedResWithPV && tempoOptimizedResWithPV.cost ? tempoOptimizedResWithPV.cost : tempoResWithPV.cost) + subTempo;

  const exportIncome = pvSim.exported * exportPrice;

  const kwpVal = Number(document.getElementById('pv-kwp').value) || 0;
  const costBase = Number((document.getElementById('pv-cost-base') || {}).value) || 500;
  const costPanel = Number((document.getElementById('pv-cost-panel') || {}).value) || 200;
  const numPanels = Math.round(kwpVal / 0.4);
  const installCost = costBase + numPanels * costPanel;

  const totalCostEl = document.getElementById('val-total-cost');

  const pvProdEl = document.getElementById('val-pv-prod');
  if (pvProdEl) pvProdEl.textContent = isPvEnabled ? `${formatNumber(annualProduction)} kWh` : 'Désactivé';

  const pvInfoEl = document.getElementById('val-pv-info');
  if (pvInfoEl) {
    if (isPvEnabled) {
      pvInfoEl.innerHTML = `Coût install. ~<strong>${formatNumber(installCost)} €</strong>`;
    } else {
      pvInfoEl.textContent = 'Production estimée';
    }
  }

  // Build offers dynamically from loaded tariffs
  const offers = [];

  const pushOffer = (id, name, noPV, withPV, color) => {
    offers.push({ id, name, costNoPV: Number(noPV) || 0, costWithPV: Number(withPV) || 0, color });
  };

  // Build offers from loaded tariffs (dynamic)
  // Skip tempo, tempoOptimized, and injection (special handling below)
  const loadedTariffs = (appState.getState().loadedTariffs || []);
  const skipIds = ['tempo', 'tempoOptimized', 'injection'];

  for (const tariffMeta of loadedTariffs) {
    if (skipIds.includes(tariffMeta.id) || tariffMeta.type === 'tempo' || tariffMeta.type === 'tempo-optimized' || tariffMeta.injectionPrice != null) continue; // Skip special cases

    const { costNoPV, costWithPV } = calculateOfferCost(
      tariffMeta,
      DEFAULTS,
      recs,
      recordsWithPV,
      perHourAnnual,
      perHourWithPV,
      priceBase,
      0 // Subscription will be added in the calculation function if available
    );

    // Subscription for selected power (fallback to first value)
    const selectedKva = String(Number(appState.currentKva) || 6);
    const subs = tariffMeta.subscriptions || {};
    const subMonthly = Number(subs[selectedKva] != null ? subs[selectedKva] : Object.values(subs)[0]) || 0;
    const subPrice = subMonthly * monthsCount;

    if (costNoPV > 0 || costWithPV > 0) {
      pushOffer(tariffMeta.id, tariffMeta.name, costNoPV + subPrice, costWithPV + subPrice, tariffMeta.color);
    }
  }

  // Hardcoded special offers (Tempo variants)
  // Tempo (classic)
  if (DEFAULTS && DEFAULTS.tempo) {
    pushOffer('tempo', 'Tempo (Classique)', tempoResNoPV.cost || 0, tempoResWithPV.cost || 0, '#59a14f');
    // Tempo optimized
    const tempoOptNoPV = (tempoOptimizedResNoPV && tempoOptimizedResNoPV.cost) || 0;
    pushOffer('tempoOpt', 'Tempo (Optimisé)', tempoOptNoPV, tempoOptimizedCost, '#117a8b');
  }

  // Compute best/worst by cost but display Base then HPHC first, then the rest
  const sortedByCost = offers.slice().sort((a, b) => a.costWithPV - b.costWithPV);
  const bestByCost = sortedByCost.length ? sortedByCost[0] : null;
  const worstByCost = sortedByCost.length ? sortedByCost[sortedByCost.length - 1] : null;

  if (totalCostEl) {
    const minCost = bestByCost ? bestByCost.costWithPV : 0;
    totalCostEl.textContent = `${formatNumber(minCost)} €`;
  }

  // Ensure Base and HPHC are displayed first (if present), then the remaining offers ordered by cost
  const baseOffer = offers.find((o) => o.id === 'base');
  const hphcOffer = offers.find((o) => o.id === 'hphc');
  const othersSorted = sortedByCost.filter((o) => o.id !== 'base' && o.id !== 'hphc');
  const orderedOffers = [];
  if (baseOffer) orderedOffers.push(baseOffer);
  if (hphcOffer) orderedOffers.push(hphcOffer);
  for (const o of othersSorted) orderedOffers.push(o);
  // Replace offers with the display-ordered list
  offers.length = 0;
  offers.push(...orderedOffers);

  // Exclude tempoOpt from being automatically selected as best offer (requires behavior change)
  const validBest = sortedByCost.find((o) => o.id !== 'tempoOpt');
  const bestId = validBest ? validBest.id : null;
  const worstOffer = worstByCost || null;

  appState.setState({ bestOfferId: bestId }, 'compareOffers');

  // Consistent color mapping based on offer ID, not index
  const getOfferColor = (offerId, offerColor) => {
    // Prefer color from loaded tariff metadata
    if (offerColor) return offerColor;
    
    // Fallback to ID-based mapping
    const colorMap = {
      'base': '#4e79a7',
      'hphc': '#f28e2b',
      'octopus': '#f28e2b',
      'tempo': '#59a14f',
      'tempoOpt': '#117a8b',
      'tch': '#d62728'
    };
    return colorMap[offerId] || '#a0cbe8';
  };

  const createCard = (title, costNoPV, costPV, isBest, warningMsg, customClass, extraInfo, isPositiveMsg, offerColor) => {
    const div = document.createElement('div');
    div.className = `card result-card${isBest ? ' best-offer' : ''}${customClass ? ` ${customClass}` : ''}`;
    const savings = costNoPV - costPV + exportIncome;

    let pvRows = '';
    if (isPvEnabled) {
      const roi = savings > 0 ? installCost / savings : 999;
      const roiDisplay = roi < 100 ? `${roi.toFixed(1)} ans` : '> 20 ans';
      pvRows = `
        <div class="savings-row">
          <span class="label">Sans PV:</span>
          <span class="value">${formatNumber(costNoPV)} €</span>
        </div>
        <div class="savings-row highlight">
          <span class="label">Gain Total (PV):</span>
          <span class="value text-success">-${formatNumber(savings)} €</span>
        </div>
        <div class="savings-row">
          <span class="label">Dont Export:</span>
          <span class="value">+${formatNumber(exportIncome)} €</span>
        </div>
        <div class="savings-row savings-divider">
          <span class="label">Retour Inv.:</span>
          <span class="value value-strong">${roiDisplay}</span>
        </div>
      `;
    }

    let bestOfferExtras = '';
    if (isBest && worstOffer && worstOffer.val > costPV && worstOffer.val !== Infinity) {
      const diff = worstOffer.val - costPV;
      bestOfferExtras = `<div class="alert alert-success alert-center mt-2">
        Économie vs ${worstOffer.name} : <strong>${formatNumber(diff)} €</strong>
      </div>`;
    }

    let warningBlock = '';
    if (warningMsg) {
      if (isPositiveMsg) {
        warningBlock = `<div class="alert alert-success alert-compact">✅ ${warningMsg}</div>`;
      } else {
        warningBlock = `<div class="alert alert-warning alert-compact">⚠️ ${warningMsg}</div>`;
      }
    }

    let extraInfoBlock = '';
    if (extraInfo) {
      extraInfoBlock = `<div class="alert alert-info alert-center mt-2">${extraInfo}</div>`;
    }

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
      ${bestOfferExtras}
      ${extraInfoBlock}
      ${pvRows}
    `;
    return div;
  };

  if (grid) {
    grid.innerHTML = '';
    for (const ofr of offers) {
      const isBest = bestId === ofr.id;
      let warning = '';
      let warningPositive = true;
      let extra = '';
      if (ofr.id === 'tempo') warning = "Sans changement d'habitude de consommation.";
      if (ofr.id === 'tempoOpt') warning = 'Avec report 50% HP Rouge vers HP Blanc.';
      if (ofr.id === 'tch') warning = "Tarif à 3 tranches horaires (HP/HC/HSC).";
      // Show savings vs HP/HC on best offer
      if (isBest && bestId) {
        try {
          const hphcOffer = offers.find((x) => x.id === 'hphc');
          if (hphcOffer && hphcOffer.id !== bestId) {
            const savings = hphcOffer.costWithPV - ofr.costWithPV;
            extra = `Économie par rapport à l'offre HP/HC: <strong>${savings > 0 ? '+' : ''}${formatNumber(savings)} €</strong>`;
          }
        } catch (e) {
          // ignore
        }
      }
      grid.appendChild(createCard(ofr.name, ofr.costNoPV, ofr.costWithPV, isBest, warning, '', extra, warningPositive, ofr.color));
    }
  }

  // Build chart data from dynamic offers with consistent coloring by offer ID
  const labels = [];
  const values = [];
  const bgColors = [];
  offers.forEach((ofr, idx) => {
    const offerColor = getOfferColor(ofr.id, ofr.color);
    if (isPvEnabled) {
      labels.push(`${ofr.name} (sans PV)`);
      labels.push(`${ofr.name} (avec PV)`);
      values.push(ofr.costNoPV);
      values.push(ofr.costWithPV);
      bgColors.push(offerColor);
      bgColors.push(offerColor);
    } else {
      labels.push(ofr.name);
      values.push(ofr.costNoPV);
      bgColors.push(offerColor);
    }
  });

  const offersCanvas = document.getElementById('offers-chart');
  if (offersCanvas) {
    chartRenderer.renderOffersChart(offers, isPvEnabled, offersCanvas);
  }

  appendLog(analysisLog, 'Comparaison terminée.');

  const pvReportSec = document.getElementById('pv-report-section');
  const pvReportContent = document.getElementById('pv-report-content');
  if (pvReportSec && pvReportContent) {
    if (isPvEnabled) {
      try {
        pvReportSec.classList.remove('hidden');
        pvReportContent.innerHTML = '';

        const roiYearsTarget = Number((document.getElementById('pv-roi-years') || {}).value) || 15;
        const titleEl = document.getElementById('pv-report-title');
        if (titleEl) titleEl.textContent = `Rapport de Rentabilité Photovoltaïque (${roiYearsTarget} ans)`;

        const region = (document.getElementById('pv-region') || {}).value || 'centre';
        const talon = Number((document.getElementById('pv-standby') || {}).value) || 50;
        const bestConfig = findBestPVConfig(recs, talon, roiYearsTarget, costBase, costPanel, region, exportPrice, DEFAULTS, appState.tempoDayMap);

        const createReportCard = (title, bestCfg) => {
          const div = document.createElement('div');
          div.className = 'result-card report-card';
          div.innerHTML = `
            <h4 class="report-card-title">${title}</h4>
            <div class="report-card-subtext">
              Config idéale: <strong>${bestCfg.kwp.toFixed(1)} kWc</strong> (${bestCfg.n} panneaux)<br>
              <small>Coût install: ${formatNumber(bestCfg.cost)} €</small>
            </div>
            <div class="report-card-metric">Économie/an: <strong>${formatNumber(bestCfg.savings)} €</strong></div>
            <div class="report-card-metric">Retour Inv.: <strong>${(bestCfg.cost / bestCfg.savings).toFixed(1)} ans</strong></div>
            <div class="report-card-gain">
              Gain Net (${roiYearsTarget} ans):<br>
              <span class="report-card-gain-value ${bestCfg.gain > 0 ? 'text-success' : 'text-danger'}">${formatNumber(bestCfg.gain)} €</span>
            </div>
            <button class="btn-apply-config">
              <span>⚡</span> Appliquer cette config
            </button>
          `;

          const btn = div.querySelector('.btn-apply-config');
          btn.addEventListener('click', () => {
            const elKwp = document.getElementById('pv-kwp');
            if (elKwp) {
              elKwp.value = bestCfg.kwp.toFixed(1);
              elKwp.dispatchEvent(new Event('change'));
            }
            btn.innerHTML = '<span>✅</span> Config appliquée !';
            btn.classList.add('applied');
            setTimeout(() => {
              btn.innerHTML = '<span>⚡</span> Appliquer cette config';
              btn.classList.remove('applied');
            }, 2000);
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

  try {
    const pvKwp = Number(document.getElementById('pv-kwp')?.value) || 0;
    const pvRegion = document.getElementById('pv-region')?.value || 'centre';
    const standbyW = Number(document.getElementById('pv-standby')?.value) || 0;
    const annualProduction = pvKwp * pvYieldPerKwp(pvRegion);
    const exportPrice = Number(DEFAULTS.injectionPrice) || 0.06;

    const monthly = computeMonthlyBreakdown(
      recs,
      annualProduction,
      exportPrice,
      standbyW,
      DEFAULTS.monthlySolarWeights,
      DEFAULTS,
      appState.tempoDayMap || {}
    );
    const mlabels = monthly.map((m) => m.month);
    const basePriceSeries = monthly.map((m) => (m.consumption > 0 ? m.base.energy / m.consumption : null));
    const basePricePVSeries = monthly.map((m) => (m.consumption > 0 ? m.basePV.energy / m.consumption : null));
    const hphcPriceSeries = monthly.map((m) => (m.consumption > 0 ? m.hphc.energy / m.consumption : null));
    const hphcPricePVSeries = monthly.map((m) => (m.consumption > 0 ? m.hphcPV.energy / m.consumption : null));
    const tempoPriceSeries = monthly.map((m) => (m.consumption > 0 ? m.tempo.energy / m.consumption : null));
    const tempoPricePVSeries = monthly.map((m) => (m.consumption > 0 ? m.tempoPV.energy / m.consumption : null));
    const tempoOptPriceSeries = monthly.map((m) => (m.consumption > 0 ? m.tempoOpt.energy / m.consumption : null));
    const tempoOptPricePVSeries = monthly.map((m) => (m.consumption > 0 ? m.tempoOptPV.energy / m.consumption : null));
    const tchPriceSeries = monthly.map((m) => (m.consumption > 0 ? (m.tch && m.tch.energy ? m.tch.energy / m.consumption : null) : null));
    const tchPricePVSeries = monthly.map((m) => (m.consumption > 0 ? (m.tchPV && m.tchPV.energy ? m.tchPV.energy / m.consumption : null) : null));
    const pvProdSeries = monthly.map((m) => m.monthPV || 0);
    const pc = document.getElementById('price-pv-chart');
    if (pc) {
      const ctx2 = pc.getContext('2d');
      if (window.pricePvChart) {
        window.pricePvChart.destroy();
        window.pricePvChart = null;
      }

      const datasets = [];
      datasets.push({ type: 'line', yAxisID: 'yPrice', label: 'Prix Base (€/kWh)', data: basePriceSeries, borderColor: '#4e79a7', backgroundColor: '#4e79a760', fill: false, tension: 0.1 });
      if (isPvEnabled) datasets.push({ type: 'line', yAxisID: 'yPrice', label: 'Prix Base (avec PV)', data: basePricePVSeries, borderColor: '#a0cbe8', backgroundColor: '#a0cbe860', fill: false, tension: 0.1 });

      datasets.push({ type: 'line', yAxisID: 'yPrice', label: 'Prix HP/HC (€/kWh)', data: hphcPriceSeries, borderColor: '#f28e2b', backgroundColor: '#f28e2b33', fill: false, tension: 0.1 });
      if (isPvEnabled) datasets.push({ type: 'line', yAxisID: 'yPrice', label: 'Prix HP/HC (avec PV)', data: hphcPricePVSeries, borderColor: '#ffbe7d', backgroundColor: '#ffbe7d33', fill: false, tension: 0.1 });

      datasets.push({ type: 'line', yAxisID: 'yPrice', label: 'Prix Tempo (€/kWh)', data: tempoPriceSeries, borderColor: '#59a14f', backgroundColor: '#59a14f33', fill: false, tension: 0.1 });
      if (isPvEnabled) datasets.push({ type: 'line', yAxisID: 'yPrice', label: 'Prix Tempo (avec PV)', data: tempoPricePVSeries, borderColor: '#bfe5b9', backgroundColor: '#bfe5b933', fill: false, tension: 0.1 });

      datasets.push({ type: 'line', yAxisID: 'yPrice', label: 'Prix Tempo Opt. (€/kWh)', data: tempoOptPriceSeries, borderColor: '#117a8b', backgroundColor: '#117a8b33', fill: false, tension: 0.1 });
      if (isPvEnabled) datasets.push({ type: 'line', yAxisID: 'yPrice', label: 'Prix Tempo Opt. (avec PV)', data: tempoOptPricePVSeries, borderColor: '#17a2b8', backgroundColor: '#17a2b833', fill: false, tension: 0.1 });

      // Total Charge'Heures (TCH)
      datasets.push({ type: 'line', yAxisID: 'yPrice', label: "Prix TCH (€/kWh)", data: tchPriceSeries, borderColor: '#d62728', backgroundColor: '#d6272833', fill: false, tension: 0.1 });
      if (isPvEnabled) datasets.push({ type: 'line', yAxisID: 'yPrice', label: "Prix TCH (avec PV)", data: tchPricePVSeries, borderColor: '#ff9896', backgroundColor: '#ff989633', fill: false, tension: 0.1 });

      if (isPvEnabled) datasets.push({ type: 'bar', yAxisID: 'yKwh', label: 'Production PV (kWh)', data: pvProdSeries, backgroundColor: '#f1c40f55' });

      window.pricePvChart = new Chart(ctx2, {
        type: 'bar',
        data: { labels: mlabels, datasets },
        options: {
          responsive: true,
          interaction: { mode: 'index' },
          scales: {
            yPrice: { type: 'linear', position: 'left', title: { display: true, text: '€/kWh' } },
            yKwh: { type: 'linear', position: 'right', title: { display: true, text: 'kWh (PV mensuel)' }, grid: { drawOnChartArea: false }, display: isPvEnabled }
          }
        }
      });
    }
  } catch (err) {
    console.warn('Erreur rendu prix/PV', err);
  }
}

// Tempo functions (tempoStorageKey, ensureTempoDayMap, mapColorToHex, getRepresentativePriceForEntry, createTooltip, renderTempoCalendarGraph) now imported from tempoCalendar.js

const SETTINGS_KEYS = [
  'pv-kwp',
  'pv-region',
  'pv-standby',
  'pv-cost-base',
  'pv-cost-panel',
  'param-hphc-hcRange',
  'param-sub-base',
  'param-sub-hphc',
  'param-sub-tempo',
  'param-tch-hpRange',
  'param-tch-hcRange',
  'param-tch-hscRange',
  'param-sub-tch'
];

// storageKey, saveSetting, loadSetting now imported from utils.js

for (const key of SETTINGS_KEYS) loadSetting(key);
for (const key of SETTINGS_KEYS) {
  const el = document.getElementById(key);
  if (!el) continue;
  el.addEventListener('change', () => saveSetting(key));
  el.addEventListener('input', () => saveSetting(key));
}

// Initialize DOM values from DEFAULTS
try {
  const sb = document.getElementById('param-sub-base');
  if (sb && !sb.value) sb.value = String(DEFAULTS.subBase || '');
  const sh = document.getElementById('param-sub-hphc');
  if (sh && !sh.value) sh.value = String((DEFAULTS.hp || {}).sub || '');
  const st = document.getElementById('param-sub-tempo');
  if (st && !st.value) st.value = String((DEFAULTS.tempo || {}).sub || '');
  const hpr = document.getElementById('param-tch-hpRange');
  if (hpr && !hpr.value) hpr.value = String((DEFAULTS.totalChargeHeures || {}).hpRange || '');
  const hcr = document.getElementById('param-tch-hcRange');
  if (hcr && !hcr.value) hcr.value = String((DEFAULTS.totalChargeHeures || {}).hcRange || '');
  const hsr = document.getElementById('param-tch-hscRange');
  if (hsr && !hsr.value) hsr.value = String((DEFAULTS.totalChargeHeures || {}).hscRange || '');
  const stch = document.getElementById('param-sub-tch');
  if (stch && !stch.value) stch.value = String((DEFAULTS.totalChargeHeures || {}).sub || '');
} catch (err) {
  // ignore
}

// OPTIMIZATION: Use workflow engine for coordinated recalculation - define BEFORE use in setup functions
const triggerFullRecalculation = () => workflowTriggerRecalc(
  fileInput,
  getRecordsFromCache,
  invalidateCache,
  ensureTempoDayMap,
  compareOffers,
  renderMonthlyBreakdown,
  runPvSimulation,
  DEFAULTS,
  tempoLoading,
  (msg) => appendLog(analysisLog, msg)
);

// Setup input bindings via workflowEngine
setupSubscriptionInputBindings(DEFAULTS, applySubscriptionInputs, populateDefaultsDisplayUI, triggerFullRecalculation);
setupTotalChargeInputBindings(DEFAULTS, applyTotalChargeHeuresInputs, populateDefaultsDisplayUI, triggerFullRecalculation);
setupHcRangeInputBinding(DEFAULTS, applyHcRangeInput, populateDefaultsDisplayUI, triggerFullRecalculation);

populateDefaultsDisplayUI(DEFAULTS);

// File input listener is now managed by uiManager.js

// Setup PV and offer comparison controls
setupPvControls(DEFAULTS, triggerFullRecalculation, calculateStandbyFromRecords);

// Setup PV visibility toggle
setupPvToggle(triggerFullRecalculation);

// Load tariff files from tariffs/ directory and render visual cards
loadTariffs(DEFAULTS, (msg) => appendLog(analysisLog, msg), (state, reason) => appState.setState(state, reason), () => populateDefaultsDisplayUI(DEFAULTS));

// Load and render tariff cards UI
(async () => {
  try {
    const tariffData = await loadAllTariffFiles();
    const container = document.getElementById('tariff-cards-container');
    if (container) {
      renderTariffCards(tariffData, DEFAULTS, container);
    }
  } catch (err) {
    console.warn('Failed to render tariff cards:', err);
  }
})();

// Initialize UI listeners after all functions are defined
initializeUIListeners(DEFAULTS, {
  compareOffers,
  runPvSimulation,
  renderMonthlyBreakdown,
  analyzeFilesNow,
  getRecordsFromCache,
  ensureTempoDayMap: (records) => ensureTempoDayMap(records, tempoLoading, DEFAULTS, (updates) => {
    if (updates.tempoDayMap) appState.setState({ tempoDayMap: updates.tempoDayMap }, 'TEMPO_MAP_LOADED');
    if (updates.tempoSourceMap) appState.setState({ tempoSourceMap: updates.tempoSourceMap }, 'TEMPO_SOURCES_UPDATED');
  })
});


