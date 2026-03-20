/**
 * app.js - Application entry point and initialization
 * Wires together all modules. Contains NO business logic - only setup, theme,
 * DOM initialization, settings persistence, and the Enedis script generator.
 * All heavy logic lives in analysisWorkflow.js, config.js, and domain modules.
 */

import { DEFAULTS, SETTINGS_KEYS, updateSubscriptionDefault } from './config.js';
import { appState } from './state.js';
import { saveSetting, loadSetting } from './utils.js';
import { populateDefaultsDisplay, initializeUIListeners } from './uiManager.js';
import { setupPvControls, setupPvToggle } from './pvManager.js';
import {
  triggerFullRecalculation,
  setupSubscriptionInputBindings,
  setupTotalChargeInputBindings,
  setupHcRangeInputBinding
} from './workflowEngine.js';
import { loadTariffs } from './tariffManager.js';
import { loadAllTariffFiles, renderTariffCards } from './tariffDisplay.js';
import { calculateStandbyFromRecords, computeHourlyStats } from './analysisEngine.js';
import { setupExportHandlers } from './exportHandlers.js';
import { appendLog, getAnalysisLog } from './logger.js';
import { getRecordsFromCache } from './fileHandler.js';

// ---- Theme ------------------------------------------------------------------

function applyTheme(isDark) {
  document.body.classList.toggle('dark-mode', isDark);
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') applyTheme(true);
else if (savedTheme === 'light') applyTheme(false);
else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme(true);

document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
  applyTheme(!document.body.classList.contains('dark-mode'));
});

// ---- Date init --------------------------------------------------------------

try {
  const dateInput = document.getElementById('input-date');
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
} catch (e) { /* ignore */ }

// ---- Enedis console script generator ---------------------------------------

function generateConsoleSnippetForPrm(prm, dateRef) {
  const esc = s => String(s).replace(/'/g, "\\'");
  return [
    '(async function(){',
    '  try{',
    "    const uiResp = await fetch('https://alex.microapplications.enedis.fr/mon-compte/api/private/v2/userinfos?espace=PARTICULIER', {credentials:'include'}); const ui = await uiResp.json();",
    "    const personId = (ui && ui.idPersonne) ? String(ui.idPersonne) : null;",
    "    const prm = '" + esc(prm) + "';",
    "    const dateRef = '" + esc(dateRef) + "';",
    '    function _fmt(d){ return d.toISOString().slice(0,10); }',
    '    const start = new Date(dateRef); start.setHours(0,0,0,0);',
    '    const dateDebuts = []; for(let i=0;i<52;i++){ const sd = new Date(start); sd.setDate(start.getDate()-7*i); dateDebuts.push(_fmt(sd)); }',
    '    const combined = []; let meta = null;',
    '    for(let i=0;i<dateDebuts.length;i++){',
    '      const ds = dateDebuts[i]; try{',
    '        const qs = "mesuresTypeCode=COURBE&mesuresCorrigees=false&typeDonnees=CONS&dateDebut="+ds+"&segments=C5";',
    '        const base = "https://alex.microapplications.enedis.fr/mes-mesures-prm/api/private/v2";',
    '        const url = personId ? base+"/personnes/"+personId+"/prms/"+prm+"/donnees-energetiques?"+qs : base+"/prms/"+prm+"/donnees-energetiques?"+qs;',
    "        const r = await fetch(url, {credentials:'include'});",
    '        let j = null; try{ j = await r.json(); }catch(e){ j = null; }',
    '        if(j && j.cons && j.cons.aggregats && j.cons.aggregats.heure && Array.isArray(j.cons.aggregats.heure.donnees)){',
    "          const arr = j.cons.aggregats.heure.donnees; if(!meta){ meta = { unite: (j.cons.aggregats.heure.unite||'kW') }; } for(const it of arr) combined.push(it); }",
    "      }catch(e){ console.error('fetch error', e); }",
    '      await new Promise(r=>setTimeout(r,200));',
    '    }',
    '    combined.sort((a,b)=> new Date(a.dateDebut) - new Date(b.dateDebut));',
    '    const dedup = []; const seen = new Set(); for(const r of combined){ if(r && r.dateDebut && !seen.has(r.dateDebut)){ dedup.push(r); seen.add(r.dateDebut); } }',
    "    const out = { cons: { aggregats: { heure: { donnees: dedup, unite: (meta && meta.unite)||'kW' } } }, grandeurMetier: 'CONS', grandeurPhysique: 'PA' };",
    "    const blob = new Blob([JSON.stringify(out,null,2)],{type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'consommation_annee.json'; document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();",
    "  }catch(e){ console.error('Erreur globale', e); } })();"
  ].join('\n');
}

const logEl = document.getElementById('download-log');
document.getElementById('btn-generate-csv')?.addEventListener('click', () => {
  const prm = document.getElementById('input-prm')?.value.trim();
  if (!prm) { alert('Veuillez saisir le PRM.'); return; }
  const rawDate = document.getElementById('input-date')?.value;
  const dateRef = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const scriptArea = document.getElementById('console-script');
  if (!scriptArea) return;
  const scriptText = generateConsoleSnippetForPrm(prm, dateRef);
  scriptArea.value = scriptText;
  document.getElementById('script-area')?.classList.remove('hidden');
  (async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(scriptText);
        appendLog(logEl, "Script console genere et copie dans le presse-papiers. Collez-le dans la console Enedis (F12).");
      } else {
        appendLog(logEl, 'Copie automatique non disponible - copiez manuellement depuis la zone de script.');
      }
    } catch (err) {
      appendLog(logEl, 'Echec copie automatique: ' + (err && err.message));
    }
  })();
});

// ---- kVA selector ----------------------------------------------------------

const kvaSelect = document.getElementById('param-power-kva');
if (kvaSelect) {
  kvaSelect.addEventListener('change', async () => {
    const val = kvaSelect.value;
    const kva = val !== 'auto' ? val : appState.detectedKva;
    if (kva) {
      updateSubscriptionDefault(kva);
      populateDefaultsDisplay(DEFAULTS);
      await triggerFullRecalculation();
    }
  });
}

// ---- JSON report export ----------------------------------------------------

document.getElementById('btn-export-report')?.addEventListener('click', async () => {
  const analysisLog = getAnalysisLog();
  const fileInput = document.getElementById('file-input');
  const files = fileInput && fileInput.files;
  appendLog(analysisLog, 'Generation du rapport...');
  const records = (files && files.length > 0) ? await getRecordsFromCache(files) : (appState.records || []);
  if (!records || records.length === 0) {
    alert("Selectionnez d'abord un fichier de donnees (JSON ou CSV).");
    return;
  }
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
  appendLog(analysisLog, 'Rapport telecharge.');
});

// ---- Settings persistence --------------------------------------------------

for (const key of SETTINGS_KEYS) loadSetting(key);
for (const key of SETTINGS_KEYS) {
  const el = document.getElementById(key);
  if (!el) continue;
  el.addEventListener('change', () => saveSetting(key));
  el.addEventListener('input', () => saveSetting(key));
}

// ---- Init DOM from DEFAULTS ------------------------------------------------

try {
  const fields = {
    'param-sub-base': DEFAULTS.subBase,
    'param-sub-hphc': DEFAULTS.hp && DEFAULTS.hp.sub,
    'param-sub-tempo': DEFAULTS.tempo && DEFAULTS.tempo.sub,
    'param-tch-hpRange': DEFAULTS.totalChargeHeures && DEFAULTS.totalChargeHeures.hpRange,
    'param-tch-hcRange': DEFAULTS.totalChargeHeures && DEFAULTS.totalChargeHeures.hcRange,
    'param-tch-hscRange': DEFAULTS.totalChargeHeures && DEFAULTS.totalChargeHeures.hscRange,
    'param-sub-tch': DEFAULTS.totalChargeHeures && DEFAULTS.totalChargeHeures.sub
  };
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = String(val || '');
  }
} catch (e) { /* ignore */ }

// ---- Wiring ----------------------------------------------------------------

appState.setState({ tariffs: DEFAULTS }, 'TARIFFS_DEFAULTS');

setupSubscriptionInputBindings();
setupTotalChargeInputBindings();
setupHcRangeInputBinding();
populateDefaultsDisplay(DEFAULTS);

setupPvControls(DEFAULTS, triggerFullRecalculation, calculateStandbyFromRecords);
setupPvToggle(triggerFullRecalculation);

setupExportHandlers();
initializeUIListeners();

// Load tariff JSON files -> update DEFAULTS + appState
loadTariffs(
  DEFAULTS,
  msg => appendLog(getAnalysisLog(), msg),
  (state, reason) => appState.setState(state, reason),
  () => populateDefaultsDisplay(DEFAULTS)
).then(() => {
  const currentKva = Number(appState.currentKva) || 6;
  const tchTariff = (appState.getState().loadedTariffs || []).find(t => t.id === 'totalCharge');
  if (tchTariff && tchTariff.subscriptions) {
    const kvaStr = String(currentKva);
    DEFAULTS.totalChargeHeures.sub = Number(
      tchTariff.subscriptions[kvaStr] != null
        ? tchTariff.subscriptions[kvaStr]
        : Object.values(tchTariff.subscriptions)[0]
    ) || 15.65;
  }
});

// Load and render tariff info cards
(async () => {
  try {
    const tariffData = await loadAllTariffFiles();
    const container = document.getElementById('tariff-cards-container');
    if (container) renderTariffCards(tariffData, DEFAULTS, container);
  } catch (err) {
    console.warn('Failed to render tariff cards:', err);
  }
})();
