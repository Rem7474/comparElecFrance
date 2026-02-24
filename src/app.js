// src/app.js
// Point d'entrée principal de comparElecFrance (SPA)
import { appState } from './state.js';
import { isHourHC, formatNumber, computeHourlyStats } from './utils.js';
import * as tariffEngine from './tariffEngine.js';
import * as pvSim from './pvSimulation.js';
import * as tempoCal from './tempoCalendar.js';
// Fonction utilitaire pour afficher/masquer la bannière d’erreur tarifs
function showTariffErrorBanner(msg) {
  let banner = document.getElementById('tariff-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'tariff-error-banner';
    banner.className = 'error-banner';
    banner.innerHTML = `<span id="tariff-error-text"></span> <button id="tariff-error-close" class="btn btn-small">Fermer</button>`;
    document.body.prepend(banner);
    banner.querySelector('#tariff-error-close').onclick = () => banner.classList.add('hidden');
  }
  banner.querySelector('#tariff-error-text').textContent = msg;
  banner.classList.remove('hidden');
}

function hideTariffErrorBanner() {
  const banner = document.getElementById('tariff-error-banner');
  if (banner) banner.classList.add('hidden');
}

/**
 * Charge tous les fichiers de tarifs (JSON) et la configuration
 * Gère les erreurs et fallback
 */
export async function loadTariffs() {
  const tariffFiles = [
    { id: 'base', file: 'tariffs/base.json' },
    { id: 'hphc', file: 'tariffs/hphc.json' },
    { id: 'tempo', file: 'tariffs/tempo.json' },
    { id: 'tempoOptimized', file: 'tariffs/tempoOptimized.json' },
    { id: 'totalCharge', file: 'tariffs/totalCharge.json' }
  ];
  appState.tariffsLoaded = false;
  appState.tariffsError = null;
  const tariffs = {};
  try {
    // Charger la configuration
    const configResp = await fetch('tariffs/config.json');
    if (!configResp.ok) throw new Error(`HTTP ${configResp.status} pour config.json`);
    appState.defaults = await configResp.json();
    
    // Ajouter les références aux tariffs dans defaults
    for (const t of tariffFiles) {
      try {
        const resp = await fetch(t.file);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        tariffs[t.id] = await resp.json();
        appState.defaults[t.id] = tariffs[t.id];
      } catch (err) {
        throw new Error(`Erreur chargement ${t.file}: ${err.message || err}`);
      }
    }
    
    appState.tariffs = tariffs;
    appState.tariffsLoaded = true;
    appState.tariffsError = null;
    
    // Ajouter le mapping HP/HC pour compatibilité
    if (tariffs.hphc) {
      appState.defaults.hp = {
        php: tariffs.hphc.php,
        phc: tariffs.hphc.phc,
        hcRange: tariffs.hphc.hcRange,
        sub: tariffs.hphc.subscriptions?.[6] || 0
      };
    }
    
    hideTariffErrorBanner();
    return tariffs;
  } catch (err) {
    appState.tariffsLoaded = false;
    appState.tariffsError = err.message || String(err);
    console.error('[TARIFS] Erreur lors du chargement des tarifs:', appState.tariffsError);
    showTariffErrorBanner('Erreur lors du chargement des tarifs : ' + appState.tariffsError);
    // Fallback minimal : charger le tarif base en dur
    appState.tariffs = {
      base: {
        id: 'base', name: 'Base', type: 'flat', price: 0.1940,
        subscriptions: { '6': 15.65, '9': 19.56, '12': 23.32 },
        color: '#4e79a7', colorWithPV: '#a0cbe8'
      }
    };
    // Configuration fallback
    appState.defaults = {
      monthlySolarWeights: [0.03, 0.05, 0.09, 0.11, 0.13, 0.14, 0.15, 0.13, 0.10, 0.07, 0.04, 0.03],
      injectionPrice: 0.10,
      priceBase: 0.1940,
      tempoApi: {
        enabled: true,
        baseUrl: 'https://www.services-rte.com/cms/api_private/indicateurs/v1',
        concurrency: 4,
        storageKey: 'comparatifElec.tempoDayMap'
      }
    };
    return appState.tariffs;
  }
}

/**
 * Initialise tous les événements UI de l'application
 */
function initializeAllUIEvents() {
  // Toggle PV
  const togglePv = document.getElementById('toggle-pv');
  if (togglePv) {
    togglePv.addEventListener('change', () => {
      const pvSettingsContainer = document.getElementById('pv-settings-container');
      const metricPv = document.getElementById('metric-pv');
      const isEnabled = togglePv.checked;
      
      if (pvSettingsContainer) pvSettingsContainer.style.display = isEnabled ? 'block' : 'none';
      if (metricPv) metricPv.style.display = isEnabled ? 'flex' : 'none';
      
      const btnCalc = document.getElementById('btn-calc-pv');
      if (btnCalc && isEnabled) setTimeout(() => btnCalc.click(), 100);
    });
    togglePv.checked = true;
    togglePv.dispatchEvent(new Event('change'));
  }
  
  // Bouton Calculer PV
  const btnCalcPv = document.getElementById('btn-calc-pv');
  if (btnCalcPv) {
    btnCalcPv.classList.remove('hidden');
    
    btnCalcPv.addEventListener('click', async () => {
      const fileInput = document.getElementById('file-input');
      if (!fileInput || !fileInput.files || !fileInput.files.length) {
        alert('Veuillez d\'abord charger un fichier');
        return;
      }
      
      const togglePv = document.getElementById('toggle-pv');
      if (!togglePv || !togglePv.checked) return;
      
      if (!appState.records || !appState.records.length) return;
      
      const pvConfig = {
        region: document.getElementById('pv-region')?.value || 'centre',
        puissance: Number(document.getElementById('pv-kwp')?.value) || 3,
        standbyW: Number(document.getElementById('pv-standby')?.value) || 0
      };
      
      try {
        const pvResult = await pvSim.simulateSolarProduction(appState.records, pvConfig);
        appState.pvResult = pvResult;
        
        const pvEl = document.getElementById('val-pv-prod');
        if (pvEl) {
          pvEl.textContent = `${pvResult.production.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh`;
        }
        
        const btnCompare = document.getElementById('btn-compare-offers');
        if (btnCompare) setTimeout(() => btnCompare.click(), 100);
      } catch (e) {
        console.error('Erreur simulation PV:', e);
      }
    });
  }
  
  // Bouton Comparer Offres
  const btnCompare = document.getElementById('btn-compare-offers');
  if (btnCompare) {
    btnCompare.classList.remove('hidden');
    
    btnCompare.addEventListener('click', async () => {
      if (!appState.records || !appState.records.length) {
        alert('Veuillez d\'abord charger un fichier');
        return;
      }
      await triggerFullRecalculation();
    });
  }
  
  // Slider ROI
  const roiSlider = document.getElementById('pv-roi-years');
  const roiDisplay = document.getElementById('pv-roi-display');
  if (roiSlider && roiDisplay) {
    roiSlider.addEventListener('input', (e) => {
      roiDisplay.textContent = e.target.value + ' ans';
    });
    roiSlider.addEventListener('change', () => {
      const btnCalc = document.getElementById('btn-calc-pv');
      if (btnCalc) btnCalc.click();
    });
  }
  
  // Paramètre power kVA
  const kvaSelect = document.getElementById('param-power-kva');
  if (kvaSelect) {
    kvaSelect.addEventListener('change', () => {
      const val = kvaSelect.value;
      if (val === 'auto') {
        appState.currentKva = appState.detectedKva || 6;
      } else {
        appState.currentKva = Number(val);
      }
      const btnCompare = document.getElementById('btn-compare-offers');
      if (btnCompare) btnCompare.click();
    });
  }
  
  // Inputs PV auto-update
  const pvInputs = ['pv-kwp', 'pv-region', 'pv-standby', 'pv-cost-base', 'pv-cost-panel'];
  pvInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        const btnCalc = document.getElementById('btn-calc-pv');
        if (btnCalc) setTimeout(() => btnCalc.click(), 100);
      });
    }
  });
  
  // Drag & Drop zone
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });
  }
  
  // Export rapport
  const btnExport = document.getElementById('btn-export-report');
  if (btnExport) {
    btnExport.addEventListener('click', async () => {
      if (!appState.records || !appState.records.length) {
        alert('Veuillez d\'abord charger un fichier');
        return;
      }
      
      const report = {
        generatedAt: new Date().toISOString(),
        summary: {
          totalConsumption: appState.records.reduce((s, r) => s + (Number(r.valeur) || 0), 0),
          period: {
            start: appState.records[0]?.dateDebut,
            end: appState.records[appState.records.length - 1]?.dateFin
          }
        },
        tariffs: appState.tariffResults || {},
        pv: appState.pvResult || {},
        settings: {
          currentKva: appState.currentKva,
          detectedKva: appState.detectedKva
        }
      };
      
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'rapport_comparatif_elec.json';
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    });
  }
  
  // Bouton thème
  const btnTheme = document.getElementById('btn-theme-toggle');
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      localStorage.setItem('theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
    });
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') document.body.classList.add('dark-theme');
  }
}

// Branche l'analyse automatique à la sélection de fichier
document.addEventListener('DOMContentLoaded', () => {
  // Charger les tarifs avant d’autoriser l’analyse
  loadTariffs().then(() => {
    hideTariffErrorBanner();
    initializeAllUIEvents();
  }).catch(() => {
    // Bannière déjà affichée par loadTariffs
  });

  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (!appState.tariffsLoaded) {
        showTariffErrorBanner('Les tarifs n’ont pas pu être chargés. Analyse impossible.');
        return;
      }
      triggerFullRecalculation();
    });
  }
});

/**
 * Orchestration du recalcul complet de l'application
 * (Import, analyse, simulation PV, calculs tarifs, calendrier Tempo)
 */
export async function triggerFullRecalculation() {
  // 1. Récupérer le fichier sélectionné
  const fileInput = document.getElementById('file-input');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
  const file = fileInput.files[0];

  // 2. Parser le fichier (JSON ou CSV) avec cache
  let records = [];
  const cacheKey = file.name + ':' + file.size + ':' + file.lastModified;
  if (appState.recordsCache && appState.recordsCache[cacheKey]) {
    records = appState.recordsCache[cacheKey];
  } else {
    try {
      const name = (file.name || '').toLowerCase();
      const txt = await file.text();
      if (name.endsWith('.json') || file.type.includes('json') || name.endsWith('.txt')) {
        let j = null; try { j = JSON.parse(txt); } catch (e) { alert('Fichier JSON invalide'); return; }
        const donnees = (((j || {}).cons || {}).aggregats || {}).heure && (((j || {}).cons || {}).aggregats || {}).heure.donnees;
        if (Array.isArray(donnees)) {
          for (const rec of donnees) { const val = Number(rec.valeur); if (isNaN(val)) continue; records.push({ dateDebut: rec.dateDebut, dateFin: rec.dateFin, valeur: val }); }
        } else { alert('Aucune donnée horaire trouvée dans le fichier'); return; }
      } else if (name.endsWith('.csv') || (file.type && file.type.toLowerCase().includes('csv'))) {
        if (typeof window.csvToEnedisJson !== 'function') { alert('Convertisseur CSV indisponible'); return; }
        const j = window.csvToEnedisJson(txt);
        const donnees = (((j || {}).cons || {}).aggregats || {}).heure && (((j || {}).cons || {}).aggregats || {}).heure.donnees;
        if (Array.isArray(donnees)) {
          for (const rec of donnees) { const val = Number(rec.valeur); if (isNaN(val)) continue; records.push({ dateDebut: rec.dateDebut, dateFin: rec.dateFin, valeur: val }); }
        } else { alert('Aucune donnée horaire trouvée dans le CSV'); return; }
      } else {
        alert('Format de fichier non supporté.'); return;
      }
      if (!appState.recordsCache) appState.recordsCache = {};
      appState.recordsCache[cacheKey] = records;
    } catch (err) {
      alert('Erreur lors de la lecture du fichier : ' + err.message);
      return;
    }
  }
  if (!records.length) { alert('Aucune donnée valide trouvée.'); return; }

  // 3. Afficher le dashboard et rendre visibles les boutons
  const dashboard = document.getElementById('dashboard-section');
  if (dashboard) dashboard.classList.remove('hidden');
  
  const btnCalcPv = document.getElementById('btn-calc-pv');
  if (btnCalcPv) btnCalcPv.classList.remove('hidden');
  
  const btnCompare = document.getElementById('btn-compare-offers');
  if (btnCompare) btnCompare.classList.remove('hidden');

  // 4. Calculs statistiques avec la fonction utilitaire
  const stats = computeHourlyStats(records);
  
  // Stocker dans appState
  appState.records = records;

  // 5. Détection automatique kVA
  let stepDurationHours = 0.5; // 30 min par défaut Enedis
  if (records.length > 2) {
    const t1 = new Date(records[0].dateDebut).getTime();
    const t2 = new Date(records[1].dateDebut).getTime();
    const diff = Math.abs(t2 - t1);
    if (diff > 0 && diff < 86400000) stepDurationHours = diff / 3600000;
  }
  
  const maxValEnergy = Math.max(...stats.max);
  const maxPowerKw = (stepDurationHours > 0) ? (maxValEnergy / stepDurationHours) : maxValEnergy;
  
  const kvaSteps = [3, 6, 9, 12, 15, 18, 24, 30, 36];
  let recommendedKva = 36;
  for (const s of kvaSteps) {
    if (s >= maxPowerKw) {
      recommendedKva = s;
      break;
    }
  }
  
  appState.detectedKva = recommendedKva;
  
  const kvaInfo = document.getElementById('power-detected-info');
  if (kvaInfo) {
    kvaInfo.textContent = `Max détecté: ${maxPowerKw.toFixed(1)} kW → ${recommendedKva} kVA recommandé`;
  }
  
  const kvaSel = document.getElementById('param-power-kva');
  if (kvaSel && kvaSel.value === 'auto') {
    appState.currentKva = recommendedKva;
  } else if (!appState.currentKva) {
    appState.currentKva = 6;
  }

  // 6. Afficher la consommation totale
  const totalConsoEl = document.getElementById('val-total-conso');
  if (totalConsoEl) totalConsoEl.textContent = stats.total.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' kWh';

  // 7. Rendu du graphique horaire
  const hourlyCanvas = document.getElementById('hourly-chart');
  if (hourlyCanvas && window.Chart) {
    if (window.hourlyChart) { window.hourlyChart.destroy(); window.hourlyChart = null; }
    const ctx = hourlyCanvas.getContext('2d');
    window.hourlyChart = new window.Chart(ctx, {
      data: {
        labels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + 'h'),
        datasets: [
          { type: 'bar', label: 'Moyenne (kWh)', data: stats.avg, backgroundColor: 'rgba(54,162,235,0.6)', yAxisID: 'y' },
          { type: 'line', label: 'Min (kWh)', data: stats.min, borderColor: 'rgba(75,192,192,0.9)', borderWidth: 2, fill: false, yAxisID: 'y' },
          { type: 'line', label: 'Max (kWh)', data: stats.max, borderColor: 'rgba(255,99,132,0.9)', borderWidth: 2, fill: false, yAxisID: 'y' }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'kWh' } } }
      }
    });
  }

  // 8. Rendu du camembert HP/HC (si applicable)
  try {
    const hcRange = appState.defaults?.hp?.hcRange || appState.defaults?.hphc?.hcRange || '22-06';
    let hpTotal = 0, hcTotal = 0;
    for (const r of records) {
      const v = Number(r.valeur) || 0;
      const h = new Date(r.dateDebut).getHours();
      if (isHourHC(h, hcRange)) hcTotal += v; else hpTotal += v;
    }
    const canvas = document.getElementById('hp-hc-pie'); if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (window.hpHcPieChart) { window.hpHcPieChart.destroy(); window.hpHcPieChart = null; }
    const totalPie = hpTotal + hcTotal;
    const hpPct = totalPie > 0 ? Math.round((hpTotal / totalPie) * 1000) / 10 : 0;
    const hcPct = totalPie > 0 ? Math.round((hcTotal / totalPie) * 1000) / 10 : 0;
    window.hpHcPieChart = new window.Chart(ctx, {
      type: 'pie',
      data: {
        labels: [`HP (${hpPct}%)`, `HC (${hcPct}%)`],
        datasets: [{ data: [hpTotal, hcTotal], backgroundColor: ['#4e79a7', '#f28e2b'] }]
      },
      options: {
        responsive: true,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                try {
                  const val = Number(ctx.parsed) || 0;
                  const tot = (ctx.dataset.data || []).reduce((a, b) => a + (Number(b) || 0), 0);
                  const pct = tot > 0 ? (val / tot * 100) : 0;
                  const pctTxt = `${pct.toFixed(1)}%`;
                  return `${ctx.label}: ${formatNumber(val)} kWh (${pctTxt})`;
                } catch (e) { return ctx.label; }
              }
            }
          }
        }
      }
    });
  } catch (e) { console.error('Erreur HP/HC pie:', e); }

  // 9. Calculs tarifaires complets
  try {
    // Initialiser le calendrier Tempo si nécessaire
    try {
      await tempoCal.ensureTempoDayMap(records);
    } catch (e) {
      console.warn('Tempo calendar initialization failed, using fallback', e);
    }

    // Calculs d'offres (tarifs)
    const tariffs = appState.tariffs || {};
    const results = {};
    const kva = appState.currentKva || 6;
    
    for (const [id, tariff] of Object.entries(tariffs)) {
      if (!tariff) continue;
      
      let res = null;
      try {
        const sub = (tariff.subscriptions && tariff.subscriptions[kva]) || 0;
        
        if (id === 'base') {
          res = tariffEngine.computeCostBase(records, tariff);
          res.cost = (res.cost || 0) + sub;
        } else if (id === 'hphc') {
          res = tariffEngine.computeCostHpHc(records, tariff, tariff.hcRange);
          res.cost = (res.cost || 0) + sub;
        } else if (id === 'totalCharge') {
          res = tariffEngine.computeCostTotalCharge(records, tariff);
          res.cost = (res.cost || 0) + sub;
        } else if (id === 'tempo') {
          const dayMap = appState.tempoDayMap || {};
          res = tariffEngine.computeCostTempo(records, dayMap, tariff);
          res.cost = (res.cost || 0) + sub;
        } else if (id === 'tempoOptimized') {
          const dayMap = appState.tempoDayMap || {};
          res = tariffEngine.computeCostTempoOptimized(records, dayMap, tariff);
          res.cost = (res.cost || 0) + sub;
        }
        
        if (res) {
          results[id] = { total: res.cost || 0, ...res };
        }
      } catch (e) {
        console.error(`Erreur calcul tarif ${id}:`, e);
        results[id] = { total: NaN, error: e.message };
      }
    }
    appState.tariffResults = results;
    
    // Affichage simplifié dans la console
    console.log('Résultats tarifaires:', results);

    // Simulation photovoltaïque (si activée)
    const togglePv = document.getElementById('toggle-pv');
    if (togglePv && togglePv.checked) {
      const pvConfig = {
        region: document.getElementById('pv-region')?.value || 'centre',
        puissance: Number(document.getElementById('pv-kwp')?.value) || 3,
        standbyW: Number(document.getElementById('pv-standby')?.value) || 0
      };
      
      const pvResult = await pvSim.simulateSolarProduction(records, pvConfig);
      appState.pvResult = pvResult;
      
      const pvEl = document.getElementById('val-pv-prod');
      if (pvEl) {
        pvEl.textContent = `${pvResult.production.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh`;
      }
    }

    // Ventilation mensuelle basique
    const monthly = Array(12).fill(0);
    for (const r of records) {
      const dt = new Date(r.dateDebut);
      if (isNaN(dt.getTime())) continue;
      monthly[dt.getMonth()] += Number(r.valeur) || 0;
    }
    
    const monthlyCanvas = document.getElementById('monthly-chart');
    if (monthlyCanvas && window.Chart) {
      if (window.monthlyChart) { window.monthlyChart.destroy(); window.monthlyChart = null; }
      const ctx = monthlyCanvas.getContext('2d');
      window.monthlyChart = new window.Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'],
          datasets: [{ label: 'Conso (kWh)', data: monthly, backgroundColor: 'rgba(54,162,235,0.6)' }]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
      });
    }
    
    // Rendu du calendrier Tempo si disponible
    if (appState.tempoDayMap && Object.keys(appState.tempoDayMap).length > 0) {
      try {
        const dailyCostMap = tempoCal.computeDailyTempoCostMap(records, appState.tempoDayMap);
        tempoCal.renderTempoCalendarGraph(appState.tempoDayMap, dailyCostMap);
      } catch (e) {
        console.error('Erreur rendering calendrier Tempo:', e);
      }
    }
    
  } catch (err) {
    alert('Erreur lors de l’analyse complète : ' + (err.message || err));
  }
}
