import { formatNumber, fmt, isoDateRange, isHourHC } from './utils.js';
import { appState } from './state.js';
import {
  computeCostBase,
  computeCostHpHc,
  computeCostTotalCharge,
  computeCostTempo,
  computeCostTempoOptimized,
  applyPvReduction
} from './tariffEngine.js';
import { pvYieldPerKwp, simulatePVEffect, findBestPVConfig } from './pvSimulation.js';
import {
  generateTempoCalendar,
  fetchTempoFromApi,
  buildFinalTempoMap,
  loadStoredTempoMap,
  saveStoredTempoMap
} from './tempoCalendar.js';
import * as chartRenderer from './chartRenderer.js';
import { parseMultipleFiles, deduplicateRecords, sortRecordsByDate } from './fileHandler.js';

const prmInput = document.getElementById('input-prm');
const dateInput = document.getElementById('input-date');
const logEl = document.getElementById('download-log');

const fileInput = document.getElementById('file-input');
const btnGenerateCsv = document.getElementById('btn-generate-csv');

const dropZone = document.getElementById('drop-zone');
const dropZoneText = document.getElementById('drop-zone-text');
const dropZoneSub = document.getElementById('drop-zone-subtext');

if (fileInput && dropZone) {
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      dropZone.classList.add('has-file');
      dropZoneText.textContent = fileInput.files[0].name;
      dropZoneSub.textContent = 'Fichier prêt pour l\'analyse';
      const icon = dropZone.querySelector('.file-drop-zone-icon');
      if (icon) icon.textContent = '✅';
    } else {
      dropZone.classList.remove('has-file');
      dropZoneText.textContent = 'Cliquez ou glissez le fichier ici';
      dropZoneSub.textContent = 'Formats acceptés : .json (Enedis) ou .csv';
      const icon = dropZone.querySelector('.file-drop-zone-icon');
      if (icon) icon.textContent = '📂';
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(
      eventName,
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.add('drag-over');
      },
      false
    );
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(
      eventName,
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.remove('drag-over');
      },
      false
    );
  });
}

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

const SUBSCRIPTION_GRID = {
  base: { 3: 12.03, 6: 15.65, 9: 19.56, 12: 23.32, 15: 26.84, 18: 30.49, 24: 38.24, 30: 45.37, 36: 52.54 },
  hphc: { 6: 15.65, 9: 19.56, 12: 23.32, 15: 26.84, 18: 30.49, 24: 38.24, 30: 45.37, 36: 52.54 },
  tempo: { 6: 15.59, 9: 19.38, 12: 23.07, 15: 26.47, 18: 30.04, 30: 44.73, 36: 52.42 }
};

function getPriceForPower(type, kva) {
  const grid = SUBSCRIPTION_GRID[type];
  if (!grid) return 0;
  if (grid[kva]) return grid[kva];
  const avail = Object.keys(grid)
    .map(Number)
    .sort((a, b) => a - b);
  const upper = avail.find((p) => p >= kva);
  if (upper) return grid[upper];
  return grid[avail[avail.length - 1]] || 0;
}

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
  populateDefaultsDisplay();
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

function showTempoLoading(total) {
  if (!tempoLoading.container) return;
  tempoLoading.total = total || 0;
  tempoLoading.done = 0;
  tempoLoading.container.style.display = 'block';
  if (tempoLoading.fill) tempoLoading.fill.style.width = '0%';
  if (tempoLoading.text) {
    tempoLoading.text.textContent = total > 0 ? `Chargement des jours Tempo… 0/${total}` : 'Chargement des jours Tempo…';
  }
}

function updateTempoLoading(done, total) {
  if (!tempoLoading.container) return;
  tempoLoading.done = done;
  tempoLoading.total = total || tempoLoading.total;
  const pct = tempoLoading.total > 0 ? Math.min(100, Math.round((done / tempoLoading.total) * 100)) : 0;
  if (tempoLoading.fill) tempoLoading.fill.style.width = `${pct}%`;
  if (tempoLoading.text) tempoLoading.text.textContent = `Chargement des jours Tempo… ${done}/${tempoLoading.total}`;
}

function hideTempoLoading() {
  if (!tempoLoading.container) return;
  tempoLoading.container.style.display = 'none';
}

const analysisLog = document.getElementById('analysis-log');
const hourlyCanvas = document.getElementById('hourly-chart');
let hourlyChart = null;

function appendAnalysisLog(msg) {
  appendLog(analysisLog, msg);
}

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
    appendAnalysisLog(`Lecture: ${file.name}`);
    if (name.endsWith('.csv') || (file.type && file.type.toLowerCase().includes('csv'))) {
      csvFiles.push(file);
    } else if (name.endsWith('.json') || file.type.includes('json') || name.endsWith('.txt')) {
      otherFiles.push(file);
    } else {
      appendAnalysisLog(`${file.name} ignoré (formats supportés: JSON/CSV).`);
    }
  }

  if (otherFiles.length > 0) {
    try {
      const parsed = await parseMultipleFiles(otherFiles);
      records.push(...parsed);
    } catch (err) {
      appendAnalysisLog(`Erreur lecture fichiers JSON: ${err && err.message ? err.message : err}`);
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
        appendAnalysisLog(`Converti depuis CSV: ${donnees.length} enregistrements`);
      } else {
        appendAnalysisLog(`CSV non reconnu: aucune donnée horaire trouvée dans ${file.name}`);
      }
    } catch (err) {
      appendAnalysisLog(`Erreur conversion CSV (${file.name}): ${err && err.message ? err.message : err}`);
    }
  }

  const dedup = deduplicateRecords(records);
  const sorted = sortRecordsByDate(dedup);
  appendAnalysisLog(`Total enregistrements valides: ${sorted.length}`);
  return sorted;
}

async function getRecordsFromCache(fileList) {
  if (!fileList || fileList.length === 0) return [];
  const key = buildFileCacheKey(fileList);
  if (appState.recordsCacheKey === key && appState.records.length) {
    return appState.records;
  }
  const records = await parseFilesToRecords(fileList);
  appState.setState({ records, recordsCacheKey: key }, 'FILES_LOADED');
  return records;
}

function computeHourlyStats(records) {
  const hours = Array.from({ length: 24 }, () => []);
  let total = 0;
  for (const rec of records) {
    const val = Number(rec.valeur);
    if (Number.isNaN(val)) continue;
    total += val;
    const dt = new Date(rec.dateDebut);
    if (Number.isNaN(dt.getTime())) continue;
    hours[dt.getHours()].push(val);
  }
  const avg = [];
  const min = [];
  const max = [];
  const count = [];
  for (let h = 0; h < 24; h += 1) {
    const arr = hours[h];
    if (!arr.length) {
      avg.push(0);
      min.push(0);
      max.push(0);
      count.push(0);
    } else {
      const sum = arr.reduce((a, b) => a + b, 0);
      avg.push(sum / arr.length);
      min.push(Math.min(...arr));
      max.push(Math.max(...arr));
      count.push(arr.length);
    }
  }
  return { total, avg, min, max, count };
}

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

async function analyzeFilesNow(records) {
  const dashboard = document.getElementById('dashboard-section');
  if (dashboard) dashboard.classList.remove('hidden');

  appendAnalysisLog('Démarrage de l\'analyse...');
  if (!records || records.length === 0) {
    appendAnalysisLog('Aucune donnée valide trouvée pour l\'analyse.');
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

  appendAnalysisLog('Analyse terminée.');
  try {
    const tempoMap = await ensureTempoDayMap(records);
    try {
      const dailyCostMap = computeDailyTempoCostMap(records, tempoMap);
      renderTempoCalendarGraph(tempoMap, dailyCostMap);
    } catch (err) {
      // ignore
    }
  } catch (err) {
    console.warn('Erreur génération calendrier TEMPO automatique', err);
  }
}

function computeCostWithProfile(perHourAnnual, priceBase, hpParams) {
  let cost = 0;
  let hpCost = 0;
  let hcCost = 0;
  if (hpParams.mode === 'base') {
    for (let h = 0; h < 24; h += 1) cost += perHourAnnual[h] * priceBase;
    return { cost, hpCost: 0, hcCost: 0 };
  }
  if (hpParams.mode === 'tch') {
    let hscCost = 0;
    for (let h = 0; h < 24; h += 1) {
      const qty = perHourAnnual[h] || 0;
      if (hpParams.hscRange && isHourHC(h, hpParams.hscRange)) {
        hscCost += qty * hpParams.phsc;
      } else if (isHourHC(h, hpParams.hcRange)) {
        hcCost += qty * hpParams.phc;
      } else {
        hpCost += qty * hpParams.php;
      }
    }
    cost = hpCost + hcCost + hscCost;
    return { cost, hpCost, hcCost, hscCost };
  }

  for (let h = 0; h < 24; h += 1) {
    const qty = perHourAnnual[h] || 0;
    if (isHourHC(h, hpParams.hcRange)) {
      hcCost += qty * hpParams.phc;
    } else {
      hpCost += qty * hpParams.php;
    }
  }
  cost = hpCost + hcCost;
  return { cost, hpCost, hcCost };
}

function monthKeyFromDateStr(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return (dateStr || '').slice(0, 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function computeMonthlyBreakdown(records) {
  const months = {};
  for (const rec of records) {
    const key = monthKeyFromDateStr(rec.dateDebut);
    if (!months[key]) months[key] = [];
    months[key].push(rec);
  }

  const keys = Object.keys(months).sort();
  const annualProduction = (Number(document.getElementById('pv-kwp').value) || 0) * pvYieldPerKwp((document.getElementById('pv-region') || {}).value || 'centre');
  const exportPrice = Number(DEFAULTS.injectionPrice) || 0.06;

  const results = [];
  for (const key of keys) {
    const recs = months[key];
    const totalKwh = recs.reduce((sum, r) => sum + (Number(r.valeur) || 0), 0);
    const parts = key.split('-');
    const monthIdx = parts.length > 1 ? Number(parts[1]) - 1 : 0;
    const monthPV = annualProduction * (DEFAULTS.monthlySolarWeights[monthIdx] || 1 / 12);

    const standbyW = Number((document.getElementById('pv-standby') || {}).value) || 0;
    const monthSim = simulatePVEffect(recs, monthPV, exportPrice, standbyW, DEFAULTS.monthlySolarWeights);
    const estimatedMonthSelf = Math.min(monthSim.selfConsumed, totalKwh, monthPV);
    const monthSelf = estimatedMonthSelf;

    const baseEnergy = computeCostBase(recs, DEFAULTS).cost;
    const subBase = Number(DEFAULTS.subBase) || 0;
    const baseTotal = baseEnergy + subBase;

    const hphcEnergyObj = computeCostHpHc(recs, DEFAULTS.hp, DEFAULTS.hp.hcRange);
    const subHphc = Number(DEFAULTS.hp.sub) || 0;
    const hphcTotal = hphcEnergyObj.cost + subHphc;

    const tempoEnergyObj = computeCostTempo(recs, appState.tempoDayMap, DEFAULTS.tempo);
    const subTempo = Number(DEFAULTS.tempo.sub) || 0;
    const tempoTotal = tempoEnergyObj.cost + subTempo;

    const tempoOptEnergyObj = computeCostTempoOptimized(recs, appState.tempoDayMap, DEFAULTS.tempo);
    const tempoOptTotal = tempoOptEnergyObj.cost + subTempo;

    const tchEnergyObj = computeCostTotalCharge(recs, DEFAULTS.totalChargeHeures);
    const subTch = Number((DEFAULTS.totalChargeHeures || {}).sub) || 0;
    const tchTotal = tchEnergyObj.cost + subTch;

    const recsWithPV = applyPvReduction(recs, monthSelf);
    const baseEnergyPV = computeCostBase(recsWithPV, DEFAULTS).cost;
    const baseTotalPV = baseEnergyPV + subBase - (monthPV - monthSelf) * exportPrice;

    const hphcEnergyObjPV = computeCostHpHc(recsWithPV, DEFAULTS.hp, DEFAULTS.hp.hcRange);
    const hphcTotalPV = hphcEnergyObjPV.cost + subHphc - (monthPV - monthSelf) * exportPrice;

    const tempoEnergyObjPV = computeCostTempo(recsWithPV, appState.tempoDayMap, DEFAULTS.tempo);
    const tempoTotalPV = tempoEnergyObjPV.cost + subTempo - (monthPV - monthSelf) * exportPrice;

    const tempoOptEnergyObjPV = computeCostTempoOptimized(recsWithPV, appState.tempoDayMap, DEFAULTS.tempo);
    const tempoOptTotalPV = tempoOptEnergyObjPV.cost + subTempo - (monthPV - monthSelf) * exportPrice;

    const tchEnergyObjPV = computeCostTotalCharge(recsWithPV, DEFAULTS.totalChargeHeures);
    const tchTotalPV = tchEnergyObjPV.cost + subTch - (monthPV - monthSelf) * exportPrice;

    results.push({
      month: key,
      consumption: totalKwh,
      monthPV,
      monthSelf,
      base: { energy: baseEnergy, total: baseTotal },
      basePV: { energy: baseEnergyPV, total: baseTotalPV },
      hphc: { energy: hphcEnergyObj.cost, hp: hphcEnergyObj.hp, hc: hphcEnergyObj.hc, total: hphcTotal },
      hphcPV: { energy: hphcEnergyObjPV.cost, total: hphcTotalPV },
      tempo: { energy: tempoEnergyObj.cost || 0, total: tempoTotal },
      tempoPV: { energy: tempoEnergyObjPV.cost || 0, total: tempoTotalPV },
      tempoOpt: { energy: tempoOptEnergyObj.cost || 0, total: tempoOptTotal },
      tempoOptPV: { energy: tempoOptEnergyObjPV.cost || 0, total: tempoOptTotalPV },
      tch: { energy: tchEnergyObj.cost || 0, hp: tchEnergyObj.hp || 0, hc: tchEnergyObj.hc || 0, hsc: tchEnergyObj.hsc || 0, total: tchTotal },
      tchPV: { energy: tchEnergyObjPV.cost || 0, total: tchTotalPV }
    });
  }

  return results;
}

async function renderMonthlyBreakdown(records) {
  const recs = records || appState.records;
  if (!recs || recs.length === 0) {
    alert('Sélectionnez d\'abord un fichier JSON via le sélecteur de fichiers.');
    return;
  }

  appendAnalysisLog('Calcul ventilation mensuelle...');
  const data = computeMonthlyBreakdown(recs);
  const container = document.getElementById('monthly-results');
  if (!container) return;
  container.innerHTML = '';

  const table = document.createElement('table');
  const hdr = document.createElement('tr');
  const isPvEnabled = document.getElementById('toggle-pv') ? document.getElementById('toggle-pv').checked : true;
  let headerHTML = '<th>Mois</th><th>Consommation (kWh)</th>';
  if (isPvEnabled) {
    headerHTML +=
      '<th>Base (€)</th><th>Base (avec PV) (€)</th><th>Éco. PV Base (€)</th>' +
      '<th>HP/HC (€)</th><th>HP/HC (avec PV) (€)</th><th>Éco. PV HP/HC (€)</th>' +
      '<th>Tempo (€)</th><th>Tempo (avec PV) (€)</th><th>Éco. PV Tempo (€)</th>' +
      '<th>Tempo Opt. (€)</th><th>Tempo Opt. (avec PV) (€)</th><th>Éco. PV Tempo Opt. (€)</th>' +
      '<th>TCH (€)</th><th>TCH (avec PV) (€)</th><th>Éco. PV TCH (€)</th>';
  } else {
    headerHTML += '<th>Base (€)</th><th>HP/HC (€)</th><th>Tempo (€)</th><th>Tempo Opt. (€)</th><th>TCH (€)</th>';
  }
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

  for (const [index, row] of data.entries()) {
    const sv = monthlySavings[index];
    const tr = document.createElement('tr');
    tr.className = 'row-divider';
    let rowHTML = `<td>${row.month}</td><td>${formatNumber(row.consumption)}</td>`;
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
        `<td class="text-success">${formatNumber(sv.tempo)}</td>` +
        `<td>${formatNumber(row.tempoOpt.total)}</td>` +
        `<td>${formatNumber(row.tempoOptPV.total)}</td>` +
        `<td class="text-success">${formatNumber(sv.tempoOpt)}</td>` +
        `<td>${formatNumber(row.tch.total)}</td>` +
        `<td>${formatNumber(row.tchPV.total)}</td>` +
        `<td class="text-success">${formatNumber(sv.tch)}</td>`;
    } else {
      rowHTML +=
        `<td>${formatNumber(row.base.total)}</td>` +
        `<td>${formatNumber(row.hphc.total)}</td>` +
        `<td>${formatNumber(row.tempo.total)}</td>` +
        `<td>${formatNumber(row.tempoOpt.total)}</td>` +
        `<td>${formatNumber(row.tch.total)}</td>`;
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
  appendAnalysisLog('Ventilation mensuelle terminée.');
}

async function runPvSimulation(records) {
  const recs = records || appState.records;
  if (!recs || recs.length === 0) {
    alert('Sélectionnez d\'abord un fichier JSON via le sélecteur de fichiers.');
    return;
  }

  const isPvEnabled = document.getElementById('toggle-pv') ? document.getElementById('toggle-pv').checked : true;
  if (!isPvEnabled) return;

  appendAnalysisLog('Estimation PV en cours...');
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

      const monthly = computeMonthlyBreakdown(recs);
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
    appendAnalysisLog('Génération du rapport...');
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
    appendAnalysisLog('Rapport téléchargé.');
  });
}

async function compareOffers(records) {
  const recs = records || appState.records;
  if (!recs || recs.length === 0) {
    alert('Sélectionnez d\'abord un fichier JSON via le sélecteur de fichiers.');
    return;
  }

  const grid = document.getElementById('offers-results-grid');
  appendAnalysisLog('Comparaison des offres en cours...');

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
  const subTempo = (Number(DEFAULTS.tempo.sub) || 0) * monthsCount;
  const subTch = (Number((DEFAULTS.totalChargeHeures || {}).sub) || 0) * monthsCount;

  const baseCostNoPV = computeCostWithProfile(perHourAnnual, priceBase, { mode: 'base' }).cost + subBase;
  const hpCostNoPV = computeCostWithProfile(perHourAnnual, priceBase, hpParams).cost + subHp;

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
  const minCost = Math.min(baseCostWithPV, hpCostWithPV, tempoResWithPV.cost || Infinity, tchResWithPV.cost);
  if (totalCostEl) totalCostEl.textContent = `${formatNumber(minCost)} €`;

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

  // Build offers dynamically from loaded tariffs (DEFAULTS / appState.tariffs)
  const offers = [];

  const pushOffer = (id, name, noPV, withPV) => {
    offers.push({ id, name, costNoPV: Number(noPV) || 0, costWithPV: Number(withPV) || 0 });
  };

  // Base
  if (DEFAULTS && DEFAULTS.priceBase != null) {
    pushOffer('base', 'Base', baseCostNoPV, baseCostWithPV);
  }

  // HP/HC
  if (DEFAULTS && DEFAULTS.hp) {
    pushOffer('hphc', 'Heures Pleines / Creuses', hpCostNoPV, hpCostWithPV);
  }

  // Tempo (classic)
  if (DEFAULTS && DEFAULTS.tempo) {
    pushOffer('tempo', 'Tempo (Classique)', (tempoResNoPV.cost || 0), (tempoResWithPV.cost || 0));
    // Tempo optimized
    const tempoOptNoPV = (tempoOptimizedResNoPV && tempoOptimizedResNoPV.cost) || 0;
    pushOffer('tempoOpt', 'Tempo (Optimisé)', tempoOptNoPV, tempoOptimizedCost);
  }

  // Total Charge'Heures (TCH)
  if (DEFAULTS && DEFAULTS.totalChargeHeures) {
    pushOffer('tch', "Total Charge'Heures", (tchResNoPV.cost || 0), (tchResWithPV.cost || 0));
  }

  // Compute best/worst by cost but display Base then HPHC first, then the rest
  const sortedByCost = offers.slice().sort((a, b) => a.costWithPV - b.costWithPV);
  const bestByCost = sortedByCost.length ? sortedByCost[0] : null;
  const worstByCost = sortedByCost.length ? sortedByCost[sortedByCost.length - 1] : null;

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

  // Consistent color mapping based on offer ID, not index
  const getOfferColor = (offerId) => {
    const colorMap = {
      'base': '#4e79a7',
      'hphc': '#f28e2b',
      'tempo': '#59a14f',
      'tempoOpt': '#117a8b',
      'tch': '#d62728'
    };
    return colorMap[offerId] || '#a0cbe8';
  };

  const createCard = (title, costNoPV, costPV, isBest, warningMsg, customClass, extraInfo, isPositiveMsg) => {
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
      grid.appendChild(createCard(ofr.name, ofr.costNoPV, ofr.costWithPV, isBest, warning, '', extra, warningPositive));
    }
  }

  // Build chart data from dynamic offers with consistent coloring by offer ID
  const labels = [];
  const values = [];
  const bgColors = [];
  offers.forEach((ofr, idx) => {
    const offerColor = getOfferColor(ofr.id);
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

  appendAnalysisLog('Comparaison terminée.');

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
        appendAnalysisLog('Erreur lors du calcul de rentabilité PV. Vérifiez vos paramètres.');
      }
    } else {
      pvReportSec.classList.add('hidden');
    }
  }

  try {
    const monthly = computeMonthlyBreakdown(recs);
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

function tempoStorageKey() {
  return (DEFAULTS.tempoApi && DEFAULTS.tempoApi.storageKey) || 'comparatifElec.tempoDayMap';
}

async function ensureTempoDayMap(records) {
  let minD = null;
  let maxD = null;
  if (records && records.length) {
    for (const rec of records) {
      const date = new Date((rec.dateDebut || '').slice(0, 10));
      if (Number.isNaN(date.getTime())) continue;
      if (!minD || date < minD) minD = date;
      if (!maxD || date > maxD) maxD = date;
    }
  }
  if (!minD) {
    const year = new Date().getFullYear();
    minD = new Date(year, 0, 1);
    maxD = new Date(year, 11, 31);
  }

  const genMap = generateTempoCalendar(records);
  const stored = loadStoredTempoMap(tempoStorageKey());
  const initial = { ...genMap, ...stored };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const apiEnd = maxD < today ? maxD : today;

  let totalToFetch = 0;
  const storedForCount = loadStoredTempoMap(tempoStorageKey());
  for (let d = new Date(minD); d <= apiEnd; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    if (!storedForCount[ds]) totalToFetch += 1;
  }

  let done = 0;
  let apiMap = {};
  try {
    if (DEFAULTS.tempoApi && DEFAULTS.tempoApi.enabled && totalToFetch > 0) {
      showTempoLoading(totalToFetch);
    }
    apiMap = await fetchTempoFromApi(minD, apiEnd, (inc) => {
      done += Number(inc) || 0;
      updateTempoLoading(done, totalToFetch);
    }, DEFAULTS.tempoApi);
  } catch (err) {
    apiMap = {};
  } finally {
    hideTempoLoading();
  }

  if (apiMap && Object.keys(apiMap).length) {
    const merged = { ...stored, ...apiMap };
    saveStoredTempoMap(merged, tempoStorageKey());
  }

  const finalMap = buildFinalTempoMap(records, stored, apiMap, genMap);
  appState.setState({ tempoDayMap: finalMap }, 'TEMPO_MAP_LOADED');

  const src = {};
  for (const key of Object.keys(genMap)) src[key] = 'gen';
  for (const key of Object.keys(stored || {})) src[key] = 'store';
  for (const key of Object.keys(apiMap || {})) src[key] = 'api';
  appState.setState({ tempoSourceMap: src }, 'TEMPO_SOURCES_UPDATED');

  return finalMap;
}

function mapColorToHex(col) {
  const c = String(col || '').toUpperCase();
  if (c === 'R') return '#e15759';
  if (c === 'W') return '#59a14f';
  if (c === 'B') return '#4e79a7';
  return '#999999';
}

function getRepresentativePriceForEntry(entry) {
  let rates = null;
  if (!entry) return Number(DEFAULTS.priceBase || 0);
  if (typeof entry === 'string') {
    const letter = entry.toUpperCase();
    const key = letter === 'B' ? 'blue' : letter === 'W' ? 'white' : letter === 'R' ? 'red' : entry.toLowerCase();
    const def = DEFAULTS.tempo && DEFAULTS.tempo[key];
    if (def && typeof def === 'object') rates = { hp: Number(def.hp) || 0, hc: Number(def.hc) || 0 };
    else rates = { hp: Number(def) || 0, hc: Number(def) || 0 };
  } else if (entry && typeof entry === 'object') {
    if (entry.rates) rates = { hp: Number(entry.rates.hp) || 0, hc: Number(entry.rates.hc) || 0 };
    else if (entry.color) {
      const letter = String(entry.color || '').toUpperCase();
      const key = letter === 'B' ? 'blue' : letter === 'W' ? 'white' : letter === 'R' ? 'red' : String(entry.color || '').toLowerCase();
      const def = DEFAULTS.tempo && DEFAULTS.tempo[key];
      if (def) rates = { hp: Number(def.hp) || 0, hc: Number(def.hc) || 0 };
    }
  }
  if (!rates) return Number(DEFAULTS.priceBase || 0);
  return (Number(rates.hp) + Number(rates.hc)) / 2;
}

function createTooltip() {
  let tooltip = document.getElementById('tempo-tooltip');
  if (tooltip) return tooltip;
  tooltip = document.createElement('div');
  tooltip.id = 'tempo-tooltip';
  tooltip.className = 'tempo-tooltip';
  document.body.appendChild(tooltip);
  return tooltip;
}

function renderTempoCalendarGraph(dayMap, dailyCostMap) {
  const container = document.getElementById('tempo-calendar-graph');
  if (!container) {
    console.warn('tempo-calendar-graph container not found');
    return;
  }
  container.innerHTML = '';
  const showError = (msg) => {
    container.innerHTML = `<div class="alert alert-error">Erreur affichage calendrier: ${String(msg)}</div>`;
  };
  try {
    const keys = Object.keys(dayMap).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    if (!keys.length) {
      container.textContent = 'Aucun jour dans le calendrier.';
      return;
    }
    const start = new Date(keys[0]);
    const end = new Date(keys[keys.length - 1]);
    const tooltip = createTooltip();

    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const monthStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
      const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      const monthLabel = monthStart.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
      const monthBox = document.createElement('div');
      monthBox.className = 'tempo-month';
      const h = document.createElement('h5');
      h.textContent = monthLabel;
      monthBox.appendChild(h);
      const weekdays = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
      const wk = document.createElement('div');
      wk.className = 'tempo-weekdays';
      for (const w of weekdays) {
        const el = document.createElement('div');
        el.className = 'text-center';
        el.textContent = w;
        wk.appendChild(el);
      }
      monthBox.appendChild(wk);
      const grid = document.createElement('div');
      grid.className = 'tempo-grid';
      const firstDow = (new Date(monthStart).getDay() + 6) % 7;
      for (let i = 0; i < firstDow; i += 1) {
        const empty = document.createElement('div');
        empty.className = 'tempo-day empty';
        grid.appendChild(empty);
      }

      const mDays = isoDateRange(monthStart, monthEnd);
      for (const dStr of mDays) {
        const dateObj = new Date(dStr);
        if (dateObj < start || dateObj > end) {
          const dim = document.createElement('div');
          dim.className = 'tempo-day dim';
          dim.textContent = dateObj.getDate();
          grid.appendChild(dim);
          continue;
        }
        const entry = dayMap[dStr] || 'B';
        const colorKey = typeof entry === 'string' ? entry.toUpperCase() : (entry && entry.color ? entry.color.toUpperCase() : 'B');
        const hex = mapColorToHex(colorKey);
        const dayEl = document.createElement('div');
        dayEl.className = 'tempo-day';
        dayEl.style.background = hex;
        dayEl.textContent = String(dateObj.getDate());
        const price = getRepresentativePriceForEntry(entry);
        dayEl.addEventListener('mouseenter', (ev) => {
          tooltip.style.display = 'block';
          const info = dailyCostMap && dailyCostMap[dStr];
          const costTxt = info && typeof info.cost === 'number' ? `${info.cost.toFixed(2)} €` : '-';
          const energyTxt = info && typeof info.energy === 'number' ? `${info.energy.toFixed(2)} kWh` : '-';
          const hpCostTxt = info && typeof info.hpCost === 'number' ? `${info.hpCost.toFixed(2)} €` : '-';
          const hcCostTxt = info && typeof info.hcCost === 'number' ? `${info.hcCost.toFixed(2)} €` : '-';
          const hpEnergyTxt = info && typeof info.hpEnergy === 'number' ? `${info.hpEnergy.toFixed(2)} kWh` : '-';
          const hcEnergyTxt = info && typeof info.hcEnergy === 'number' ? `${info.hcEnergy.toFixed(2)} kWh` : '-';
          tooltip.innerHTML = `
            <strong>${dStr}</strong><br/>
            Couleur: ${colorKey}<br/>
            Prix rep.: ${price.toFixed(4)} €/kWh<br/>
            Coût jour: ${costTxt} — Conso jour: ${energyTxt}<br/>
            HP: ${hpCostTxt} / ${hpEnergyTxt} &nbsp;|&nbsp; HC: ${hcCostTxt} / ${hcEnergyTxt}
          `;
        });
        dayEl.addEventListener('mousemove', (ev) => {
          const pad = 12;
          tooltip.style.left = `${ev.clientX + pad}px`;
          tooltip.style.top = `${ev.clientY + pad}px`;
        });
        dayEl.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
        grid.appendChild(dayEl);
      }
      monthBox.appendChild(grid);
      container.appendChild(monthBox);
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  } catch (err) {
    console.error('renderTempoCalendarGraph failed', err);
    showError(err && err.message ? err.message : err);
  }
}

function computeDailyTempoCostMap(records, dayMap) {
  const out = {};
  const getRates = (entry, colorLetter) => {
    if (entry && typeof entry === 'object' && entry.rates) {
      return { hp: Number(entry.rates.hp) || 0, hc: Number(entry.rates.hc) || 0 };
    }
    const key = colorLetter === 'R' ? 'red' : colorLetter === 'W' ? 'white' : 'blue';
    const def = DEFAULTS.tempo && DEFAULTS.tempo[key];
    if (def && typeof def === 'object') return { hp: Number(def.hp) || 0, hc: Number(def.hc) || 0 };
    return { hp: Number(def) || 0, hc: Number(def) || 0 };
  };

  for (const rec of records) {
    const dt = new Date(rec.dateDebut);
    const h = dt.getHours();
    const dateStr = dt.toISOString().slice(0, 10);
    let bucketDateStr;
    let colorLetter;
    let isHC;
    if (h < 6) {
      const prev = new Date(dt);
      prev.setDate(prev.getDate() - 1);
      bucketDateStr = prev.toISOString().slice(0, 10);
      const entryPrev = dayMap[bucketDateStr] || 'B';
      colorLetter = typeof entryPrev === 'string' ? entryPrev.toUpperCase() : ((entryPrev && entryPrev.color) ? String(entryPrev.color).toUpperCase() : 'B');
      isHC = true;
    } else if (h >= 22) {
      bucketDateStr = dateStr;
      const entryCur = dayMap[bucketDateStr] || 'B';
      colorLetter = typeof entryCur === 'string' ? entryCur.toUpperCase() : ((entryCur && entryCur.color) ? String(entryCur.color).toUpperCase() : 'B');
      isHC = true;
    } else {
      bucketDateStr = dateStr;
      const entryCur = dayMap[bucketDateStr] || 'B';
      colorLetter = typeof entryCur === 'string' ? entryCur.toUpperCase() : ((entryCur && entryCur.color) ? String(entryCur.color).toUpperCase() : 'B');
      isHC = false;
    }
    const entryForBucket = dayMap[bucketDateStr] || 'B';
    const rates = getRates(entryForBucket, colorLetter);
    const applied = isHC ? rates.hc : rates.hp;
    const v = Number(rec.valeur) || 0;
    if (!out[bucketDateStr]) {
      out[bucketDateStr] = { energy: 0, cost: 0, hpCost: 0, hcCost: 0, hpEnergy: 0, hcEnergy: 0, color: colorLetter };
    }
    out[bucketDateStr].energy += v;
    out[bucketDateStr].cost += v * applied;
    if (isHC) {
      out[bucketDateStr].hcCost += v * applied;
      out[bucketDateStr].hcEnergy += v;
    } else {
      out[bucketDateStr].hpCost += v * applied;
      out[bucketDateStr].hpEnergy += v;
    }
    out[bucketDateStr].color = colorLetter;
  }

  return out;
}

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

function storageKey(key) {
  return `comparatifElec.${key}`;
}

function saveSetting(id) {
  try {
    const el = document.getElementById(id);
    if (!el) return;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    localStorage.setItem(storageKey(id), JSON.stringify(val));
  } catch (err) {
    // ignore
  }
}

function loadSetting(id) {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (raw === null) return;
    const parsed = JSON.parse(raw);
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = parsed;
    else el.value = parsed;
  } catch (err) {
    // ignore
  }
}

for (const key of SETTINGS_KEYS) loadSetting(key);
for (const key of SETTINGS_KEYS) {
  const el = document.getElementById(key);
  if (!el) continue;
  el.addEventListener('change', () => saveSetting(key));
  el.addEventListener('input', () => saveSetting(key));
}

function normalizeHcRange(str) {
  const raw = String(str || '').trim();
  if (!raw) return null;
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const match = part.match(/^\s*([0-1]?\d|2[0-3])(?::([0-5]?\d))?\s*-\s*([0-1]?\d|2[0-3])(?::([0-5]?\d))?\s*$/);
    if (!match) return null;
    const sh = String(match[1]).padStart(2, '0');
    const sm = match[2] != null ? String(match[2]).padStart(2, '0') : null;
    const eh = String(match[3]).padStart(2, '0');
    const em = match[4] != null ? String(match[4]).padStart(2, '0') : null;
    const startToken = sm != null ? `${sh}:${sm}` : `${sh}`;
    const endToken = em != null ? `${eh}:${em}` : `${eh}`;
    out.push(`${startToken}-${endToken}`);
  }
  return out.join(';');
}

function applyHcRangeFromInput() {
  const el = document.getElementById('param-hphc-hcRange');
  if (!el) return;
  const norm = normalizeHcRange(el.value);
  if (!norm) return;
  if (!DEFAULTS.hp) DEFAULTS.hp = {};
  DEFAULTS.hp.hcRange = norm;
  el.value = norm;
  populateDefaultsDisplay();
}

try {
  applyHcRangeFromInput();
} catch (err) {
  // ignore
}

(function bindHcRange() {
  const el = document.getElementById('param-hphc-hcRange');
  if (!el) return;
  el.addEventListener('change', async () => {
    const before = DEFAULTS.hp && DEFAULTS.hp.hcRange;
    applyHcRangeFromInput();
    const after = DEFAULTS.hp && DEFAULTS.hp.hcRange;
    if (before === after) return;
    try {
      const records = appState.records;
      if (records && records.length) {
        try {
          renderHpHcPie(records);
        } catch (err) {
          // ignore
        }
        await triggerFullRecalculation();
      }
    } catch (err) {
      console.warn('Recalc after HC range change failed', err);
    }
  });
})();

function applySubscriptionInputs() {
  const sb = document.getElementById('param-sub-base');
  const sh = document.getElementById('param-sub-hphc');
  const st = document.getElementById('param-sub-tempo');
  let changed = false;
  if (sb && sb.value) {
    const v = Number(sb.value);
    if (!Number.isNaN(v) && v >= 0 && DEFAULTS.subBase !== v) {
      DEFAULTS.subBase = v;
      changed = true;
    }
  }
  if (sh && sh.value) {
    const v = Number(sh.value);
    if (!Number.isNaN(v) && v >= 0 && (DEFAULTS.hp || {}).sub !== v) {
      if (!DEFAULTS.hp) DEFAULTS.hp = {};
      DEFAULTS.hp.sub = v;
      changed = true;
    }
  }
  if (st && st.value) {
    const v = Number(st.value);
    if (!Number.isNaN(v) && v >= 0 && (DEFAULTS.tempo || {}).sub !== v) {
      if (!DEFAULTS.tempo) DEFAULTS.tempo = {};
      DEFAULTS.tempo.sub = v;
      changed = true;
    }
  }
  if (changed) populateDefaultsDisplay();
  return changed;
}

(function initSubscriptionInputs() {
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
})();

function applyTotalChargeHeuresInputs() {
  const hpr = document.getElementById('param-tch-hpRange');
  const hcr = document.getElementById('param-tch-hcRange');
  const hsr = document.getElementById('param-tch-hscRange');
  const sub = document.getElementById('param-sub-tch');
  let changed = false;
  if (hpr && hpr.value) {
    const v = normalizeHcRange(hpr.value);
    if (v && (DEFAULTS.totalChargeHeures || {}).hpRange !== v) {
      if (!DEFAULTS.totalChargeHeures) DEFAULTS.totalChargeHeures = {};
      DEFAULTS.totalChargeHeures.hpRange = v;
      changed = true;
    }
  }
  if (hcr && hcr.value) {
    const v = normalizeHcRange(hcr.value);
    if (v && (DEFAULTS.totalChargeHeures || {}).hcRange !== v) {
      if (!DEFAULTS.totalChargeHeures) DEFAULTS.totalChargeHeures = {};
      DEFAULTS.totalChargeHeures.hcRange = v;
      changed = true;
    }
  }
  if (hsr && hsr.value) {
    const v = normalizeHcRange(hsr.value);
    if (v && (DEFAULTS.totalChargeHeures || {}).hscRange !== v) {
      if (!DEFAULTS.totalChargeHeures) DEFAULTS.totalChargeHeures = {};
      DEFAULTS.totalChargeHeures.hscRange = v;
      changed = true;
    }
  }
  if (sub && sub.value) {
    const v = Number(sub.value);
    if (!Number.isNaN(v) && v >= 0 && (DEFAULTS.totalChargeHeures || {}).sub !== v) {
      if (!DEFAULTS.totalChargeHeures) DEFAULTS.totalChargeHeures = {};
      DEFAULTS.totalChargeHeures.sub = v;
      changed = true;
    }
  }
  if (changed) populateDefaultsDisplay();
  return changed;
}

(function bindSubscriptionInputs() {
  ['param-sub-base', 'param-sub-hphc', 'param-sub-tempo'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', async () => {
      saveSetting(id);
      const changed = applySubscriptionInputs();
      if (!changed) return;
      await triggerFullRecalculation();
    });
  });
})();

(function bindTotalChargeInputs() {
  ['param-tch-hpRange', 'param-tch-hcRange', 'param-tch-hscRange', 'param-sub-tch'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', async () => {
      saveSetting(id);
      const changed = applyTotalChargeHeuresInputs();
      if (!changed) return;
      await triggerFullRecalculation();
    });
  });
})();

function populateDefaultsDisplay() {
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

populateDefaultsDisplay();

// Also update a dedicated injection price display if present
function updateInjectionDisplay() {
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

updateInjectionDisplay();

async function triggerFullRecalculation() {
  const files = fileInput && fileInput.files;
  if (!files || files.length === 0) return;
  const records = await getRecordsFromCache(files);
  if (!records || records.length === 0) return;
  await ensureTempoDayMap(records);
  await compareOffers(records);
  await renderMonthlyBreakdown(records);
  await runPvSimulation(records);
}

if (fileInput) {
  fileInput.addEventListener('change', async () => {
    const files = fileInput.files;
    if (!files || files.length === 0) return;
    appendAnalysisLog('Fichiers détectés — récupération des jours Tempo puis analyses...');

    const dashboard = document.getElementById('dashboard-section');
    if (dashboard) dashboard.classList.remove('hidden');

    try {
      const records = await getRecordsFromCache(files);
      await ensureTempoDayMap(records);
      await analyzeFilesNow(records);
      await triggerFullRecalculation();
    } catch (err) {
      console.warn('Auto-run analysis failed', err);
    }
  });
}

const btnCalcPv = document.getElementById('btn-calc-pv');
if (btnCalcPv) {
  btnCalcPv.addEventListener('click', async () => {
    await triggerFullRecalculation();
  });
}

const btnCompareOffers = document.getElementById('btn-compare-offers');
if (btnCompareOffers) {
  btnCompareOffers.addEventListener('click', async () => {
    await triggerFullRecalculation();
  });
}

const pvInputs = ['pv-kwp', 'pv-region', 'pv-standby', 'pv-cost-base', 'pv-cost-panel'];
for (const id of pvInputs) {
  const el = document.getElementById(id);
  if (!el) continue;
  el.addEventListener('change', async () => {
    await triggerFullRecalculation();
  });
}

const roiSlider = document.getElementById('pv-roi-years');
const roiDisplay = document.getElementById('pv-roi-display');
if (roiSlider && roiDisplay) {
  roiSlider.addEventListener('input', (event) => {
    roiDisplay.textContent = `${event.target.value} ans`;
  });
  roiSlider.addEventListener('change', async () => {
    await triggerFullRecalculation();
  });
}

function calculateStandbyFromRecords(records) {
  const dayRecords = records.filter((rec) => {
    const h = new Date(rec.dateDebut).getHours();
    return h >= 10 && h < 16;
  });
  if (!dayRecords.length) throw new Error('Pas de données de jour');
  const powers = dayRecords
    .map((rec) => {
      const durationMs = new Date(rec.dateFin) - new Date(rec.dateDebut);
      const durationHours = durationMs / (1000 * 60 * 60);
      if (durationHours <= 0) return 0;
      const kw = Number(rec.valeur) / durationHours;
      return kw * 1000;
    })
    .filter((p) => p > 0)
    .sort((a, b) => a - b);
  const idx = Math.floor(powers.length * 0.35);
  return Math.round(powers[idx]);
}

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
      const estimatedW = calculateStandbyFromRecords(records);
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

window.calculateStandbyFromRecords = calculateStandbyFromRecords;

const togglePv = document.getElementById('toggle-pv');
const pvSettingsContainer = document.getElementById('pv-settings-container');
const metricPv = document.getElementById('metric-pv');
function updatePVVisibility() {
  const isEnabled = togglePv ? togglePv.checked : true;
  if (pvSettingsContainer) pvSettingsContainer.style.display = isEnabled ? 'block' : 'none';
  if (metricPv) metricPv.style.display = isEnabled ? 'flex' : 'none';
  if (btnCalcPv) btnCalcPv.style.display = isEnabled ? '' : 'none';

  const dashboard = document.getElementById('dashboard-section');
  if (dashboard && !dashboard.classList.contains('hidden')) {
    triggerFullRecalculation();
  }
}

if (togglePv) {
  togglePv.addEventListener('change', updatePVVisibility);
  updatePVVisibility();
}

function showTariffErrorBanner(message) {
  const container = document.getElementById('tariff-errors');
  if (!container) return;
  container.classList.remove('hidden');
  const item = document.createElement('div');
  item.className = 'alert alert-warning';
  item.textContent = message;
  container.appendChild(item);
}

function mergeTariffs(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      mergeTariffs(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

// Map common tariff JSON file shapes into the DEFAULTS structure
function mapTariffToDefaults(tariffJson) {
  if (!tariffJson || typeof tariffJson !== 'object') return false;
  const id = tariffJson.id || tariffJson.name || null;
  try {
    if (id === 'base' || tariffJson.type === 'flat') {
      if (tariffJson.price != null) DEFAULTS.priceBase = tariffJson.price;
      if (tariffJson.subscriptions) DEFAULTS.subBase = Number(Object.values(tariffJson.subscriptions)[0]) || DEFAULTS.subBase;
      return true;
    }
    if (id === 'hphc' || tariffJson.type === 'two-tier') {
      if (tariffJson.php != null) DEFAULTS.hp.php = tariffJson.php;
      if (tariffJson.phc != null) DEFAULTS.hp.phc = tariffJson.phc;
      if (tariffJson.hcRange) DEFAULTS.hp.hcRange = tariffJson.hcRange;
      if (tariffJson.subscriptions) DEFAULTS.hp.sub = Number(Object.values(tariffJson.subscriptions)[0]) || DEFAULTS.hp.sub;
      return true;
    }
    if (id === 'tempo' || tariffJson.type === 'tempo') {
      if (tariffJson.blue) DEFAULTS.tempo.blue = tariffJson.blue;
      if (tariffJson.white) DEFAULTS.tempo.white = tariffJson.white;
      if (tariffJson.red) DEFAULTS.tempo.red = tariffJson.red;
      if (tariffJson.hcRange) DEFAULTS.tempo.hcRange = tariffJson.hcRange;
      if (tariffJson.approxPct) DEFAULTS.tempo.approxPct = tariffJson.approxPct;
      if (tariffJson.subscriptions) DEFAULTS.tempo.sub = Number(Object.values(tariffJson.subscriptions)[0]) || DEFAULTS.tempo.sub;
      return true;
    }
    if (id === 'totalCharge' || tariffJson.type === 'three-tier') {
      if (tariffJson.php != null) DEFAULTS.totalChargeHeures.php = tariffJson.php;
      if (tariffJson.phc != null) DEFAULTS.totalChargeHeures.phc = tariffJson.phc;
      if (tariffJson.phsc != null) DEFAULTS.totalChargeHeures.phsc = tariffJson.phsc;
      if (tariffJson.hpRange) DEFAULTS.totalChargeHeures.hpRange = tariffJson.hpRange;
      if (tariffJson.hcRange) DEFAULTS.totalChargeHeures.hcRange = tariffJson.hcRange;
      if (tariffJson.hscRange) DEFAULTS.totalChargeHeures.hscRange = tariffJson.hscRange;
      if (tariffJson.subscriptions) DEFAULTS.totalChargeHeures.sub = Number(Object.values(tariffJson.subscriptions)[0]) || DEFAULTS.totalChargeHeures.sub;
      return true;
    }
    if (id === 'injection' || tariffJson.injectionPrice != null) {
      if (tariffJson.injectionPrice != null) DEFAULTS.injectionPrice = tariffJson.injectionPrice;
      return true;
    }
  } catch (e) {
    // ignore mapping errors and fallback to generic merge
  }
  return false;
}

async function loadTariffs() {
  // Discover tariff files dynamically from the tariffs folder when possible.
  async function discoverTariffFiles() {
    // 1) Prefer an explicit index file if present
    try {
      const idxResp = await fetch('tariffs/index.json', { cache: 'no-cache' });
      if (idxResp.ok) {
        const idx = await idxResp.json();
        let list = null;
        if (Array.isArray(idx)) list = idx.map((n) => (n.startsWith('tariffs/') ? n : `tariffs/${n}`));
        else if (typeof idx === 'object' && idx.files && Array.isArray(idx.files)) list = idx.files.map((n) => (n.startsWith('tariffs/') ? n : `tariffs/${n}`));
        if (list && list.length) {
          try {
            appendAnalysisLog && appendAnalysisLog(`tariffs/index.json trouvé — chargement de ${list.length} fichiers tarifaires`);
          } catch (e) {
            // ignore logging errors
          }
          return list;
        }
      }
    } catch (err) {
      // fallthrough
    }

    // 2) Try to fetch directory listing HTML (works on simple static servers)
    try {
      const resp = await fetch('tariffs/', { cache: 'no-cache' });
      if (resp.ok) {
        const txt = await resp.text();
        const regex = /href=["']([^"']+\.json)["']/gi;
        const found = new Set();
        let m;
        while ((m = regex.exec(txt))) {
          let p = m[1];
          if (!p.startsWith('tariffs/')) p = `tariffs/${p}`;
          found.add(p);
        }
        if (found.size) return Array.from(found);
      }
    } catch (err) {
      // ignore
    }

    // 3) Fallback to conservative builtin list
    return ['tariffs/base.json', 'tariffs/hphc.json', 'tariffs/tempo.json', 'tariffs/total-charge-heures.json', 'tariffs/injection.json'];
  }

  const files = await discoverTariffFiles();
  for (const name of files) {
    try {
      const resp = await fetch(name, { cache: 'no-cache' });
      if (!resp.ok) {
        showTariffErrorBanner(`Tarif introuvable: ${name} — valeurs par défaut utilisées.`);
        console.error('Tariff fetch failed', name, resp.status);
        continue;
      }
      const json = await resp.json();
      // Try mapping known tariff file formats into DEFAULTS first
      const mapped = mapTariffToDefaults(json);
      if (!mapped) mergeTariffs(DEFAULTS, json);
    } catch (err) {
      showTariffErrorBanner(`Erreur de chargement du tarif ${name} — valeurs par défaut utilisées.`);
      console.error('Tariff parse failed', name, err);
    }
  }
  appState.setState({ tariffs: DEFAULTS }, 'TARIFFS_LOADED');
  populateDefaultsDisplay();
}

loadTariffs();
