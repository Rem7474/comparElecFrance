// src/app.js
// Point d'entrée principal de comparElecFrance (SPA)
import { appState } from './state.js';
import { isHourHC, formatNumber, computeHourlyStats as computeHourlyStatsUtil } from './utils.js';
import * as tariffEngine from './tariffEngine.js';
import * as pvSimulation from './pvSimulation.js';
import * as tempoCalendar from './tempoCalendar.js';

const utils = { isHourHC, formatNumber, computeHourlyStats: computeHourlyStatsUtil };

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
    const configResp = await fetch('tariffs/config.json');
    if (!configResp.ok) throw new Error(`HTTP ${configResp.status} pour config.json`);
    appState.defaults = await configResp.json();
    
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
    console.error('[TARIFS] Erreur:', appState.tariffsError);
    showTariffErrorBanner('Erreur chargement tarifs: ' + appState.tariffsError);
    appState.tariffs = {
      base: {
        id: 'base', name: 'Base', type: 'flat', price: 0.1940,
        subscriptions: { '6': 15.65, '9': 19.56, '12': 23.32 },
        color: '#4e79a7', colorWithPV: '#a0cbe8'
      }
    };
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

function initializeAllUIEvents() {
  const togglePv = document.getElementById('toggle-pv');
  if (togglePv) {
    togglePv.addEventListener('change', () => {
      const pvSettingsContainer = document.getElementById('pv-settings-container');
      const metricPv = document.getElementById('metric-pv');
      const isEnabled = togglePv.checked;
      if (pvSettingsContainer) pvSettingsContainer.style.display = isEnabled ? 'block' : 'none';
      if (metricPv) metricPv.style.display = isEnabled ? 'flex' : 'none';
      // Seulement recalculer si des données existent
      if (isEnabled && appState.records && appState.records.length) {
        const btnCalc = document.getElementById('btn-calc-pv');
        if (btnCalc) setTimeout(() => btnCalc.click(), 100);
      }
    });
    togglePv.checked = true;
    togglePv.dispatchEvent(new Event('change'));
  }
  
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
        const pvResult = await pvSimulation.simulateSolarProduction(appState.records, pvConfig);
        appState.pvResult = pvResult;
        const pvEl = document.getElementById('val-pv-prod');
        if (pvEl) pvEl.textContent = `${pvResult.production.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh`;
        const btnCompare = document.getElementById('btn-compare-offers');
        if (btnCompare) setTimeout(() => btnCompare.click(), 100);
      } catch (e) {
        console.error('Erreur simulation PV:', e);
      }
    });
  }
  
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
  
  const kvaSelect = document.getElementById('param-power-kva');
  if (kvaSelect) {
    kvaSelect.addEventListener('change', () => {
      const val = kvaSelect.value;
      appState.currentKva = val === 'auto' ? (appState.detectedKva || 6) : Number(val);
      const btnCompare = document.getElementById('btn-compare-offers');
      if (btnCompare) btnCompare.click();
    });
  }
  
  const pvInputs = ['pv-kwp', 'pv-region', 'pv-standby', 'pv-cost-base', 'pv-cost-panel'];
  pvInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        savePvSettings();
        const btnCalc = document.getElementById('btn-calc-pv');
        if (btnCalc) setTimeout(() => btnCalc.click(), 100);
      });
    }
  });
  
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });
  }
  
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

document.addEventListener('DOMContentLoaded', async () => {
  try {
    loadPvSettings();
    await loadTariffs();
    hideTariffErrorBanner();
    initializeAllUIEvents();
  } catch (err) {
    console.error('Erreur initialisation:', err);
  }

  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      if (!appState.tariffsLoaded) {
        showTariffErrorBanner('Les tarifs n\'ont pas pu être chargés');
        return;
      }
      await triggerFullRecalculation();
    });
  }
});

function displayTariffComparison(results) {
  const container = document.getElementById('tariffs-comparison');
  if (!container) return;
  
  container.innerHTML = '';
  let html = '<table class="tariff-table"><thead><tr><th>Tarif</th><th>Coût annuel</th></tr></thead><tbody>';
  
  const sortedResults = Object.entries(results)
    .filter(([, r]) => !isNaN(r.total))
    .sort((a, b) => (a[1].total || 0) - (b[1].total || 0));
  
  for (const [id, result] of sortedResults) {
    const name = { base: 'Base', hphc: 'HP/HC', tempo: 'Tempo', tempoOptimized: 'Tempo+', totalCharge: 'Total' }[id] || id;
    const cost = (result.total || 0).toFixed(2);
    html += `<tr><td>${name}</td><td style="font-weight: bold; color: #4e79a7;">${cost} €</td></tr>`;
  }
  
  html += '</tbody></table>';
  container.innerHTML = html;
  
  // Afficher aussi le graphique comparatif
  if (window.Chart && document.getElementById('offers-chart')) {
    if (window.offersChart) { window.offersChart.destroy(); window.offersChart = null; }
    const ctx = document.getElementById('offers-chart').getContext('2d');
    const labels = sortedResults.map(([id]) => ({ base: 'Base', hphc: 'HP/HC', tempo: 'Tempo', tempoOptimized: 'Tempo+', totalCharge: 'Total' }[id] || id));
    const costs = sortedResults.map(([, r]) => r.total || 0);
    window.offersChart = new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Coût annuel (€)',
          data: costs,
          backgroundColor: [
            'rgba(54,162,235,0.6)',
            'rgba(75,192,192,0.6)',
            'rgba(255,99,132,0.6)',
            'rgba(255,159,64,0.6)',
            'rgba(153,102,255,0.6)'
          ]
        }]
      },
      options: {
        responsive: true,
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Coût annuel (€)' } } }
      }
    });
  }
}

function displayMonthlyBreakdown(records, tariffResults) {
  const container = document.getElementById('monthly-results');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Grouper par mois
  const months = {};
  for (const r of records) {
    const monthKey = r.dateDebut.slice(0, 7);
    if (!months[monthKey]) months[monthKey] = [];
    months[monthKey].push(r);
  }

  let html = '<h4>Détails par mois</h4><table class="tariff-table"><thead><tr><th>Mois</th><th>Conso (kWh)</th><th>Base (€)</th><th>HP/HC (€)</th><th>Tempo (€)</th></tr></thead><tbody>';
  
  for (const [monthKey, monthRecs] of Object.entries(months).sort()) {
    const totalConso = monthRecs.reduce((s, r) => s + (Number(r.valeur) || 0), 0);
    
    // Calcul chaque tarif
    const baseCost = tariffEngine.computeCostBase(monthRecs, appState.defaults.base)?.cost || 0;
    const hphcCost = tariffEngine.computeCostHpHc(monthRecs, appState.defaults.hphc)?.cost || 0;
    const tempoCost = tariffEngine.computeCostTempo(monthRecs, appState.tempoDayMap || {}, appState.defaults.tempo)?.cost || 0;
    
    html += `<tr><td>${monthKey}</td><td>${totalConso.toFixed(1)}</td><td>${baseCost.toFixed(2)}</td><td>${hphcCost.toFixed(2)}</td><td>${tempoCost.toFixed(2)}</td></tr>`;
  }
  
  html += '</tbody></table>';
  container.innerHTML = html;
}

function displayPvResults(pvResult) {
  const container = document.getElementById('pv-results');
  if (!container || !pvResult) return;
  
  container.classList.remove('hidden');
  container.innerHTML = `
    <div style="padding: 16px; background: #f3f2f1; border-radius: 4px; margin-top: 16px;">
      <h4>Simulation Photovoltaïque</h4>
      <p><strong>Production annuelle estimée:</strong> ${(pvResult.production || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh</p>
      <p><strong>Autoconsommation estimée:</strong> ${(pvResult.selfConsumed || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh</p>
      <p><strong>Injection réseau:</strong> ${((pvResult.production || 0) - (pvResult.selfConsumed || 0)).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh</p>
      <p><strong>Économies potentielles:</strong> <span style="color: #107c10; font-weight: bold;">${(pvResult.savings || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} € / an</span></p>
    </div>
  `;
}

function displaySavingsComparison(records, tariffResults, pvResult) {
  if (!pvResult || !appState.tariffResults) return;
  
  // Créer un graphique de comparaison des tarifs avec/sans PV
  const canvas = document.getElementById('price-pv-chart');
  if (!canvas || !window.Chart) return;
  
  if (window.savingsChart) { window.savingsChart.destroy(); window.savingsChart = null; }
  
  const ctx = canvas.getContext('2d');
  const tariffNames = {
    base: 'Base',
    hphc: 'HP/HC',
    tempo: 'Tempo',
    tempoOptimized: 'Tempo+',
    totalCharge: 'Total'
  };
  
  // Calcul simplifié : économies estimées par tarif
  const labels = Object.entries(tariffResults)
    .filter(([, r]) => !isNaN(r.total))
    .map(([id]) => tariffNames[id] || id);
  
  const costWithoutPv = Object.values(tariffResults)
    .filter(r => !isNaN(r.total))
    .map(r => r.total || 0);
  
  // Économies estimées : (production * taux d'autoconsommation * prix moyen) / tarifResults count
  const avgCostWithoutPv = costWithoutPv.reduce((a, b) => a + b, 0) / costWithoutPv.length || 1;
  const savingsRatio = (pvResult.savings || 0) / costWithoutPv.length;
  const costWithPv = costWithoutPv.map(cost => Math.max(0, cost - savingsRatio));
  
  window.savingsChart = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Coût sans PV (€)',
          data: costWithoutPv,
          backgroundColor: 'rgba(255,99,132,0.6)',
          borderColor: 'rgba(255,99,132,1)',
          borderWidth: 1
        },
        {
          label: 'Coût avec PV (€)',
          data: costWithPv,
          backgroundColor: 'rgba(75,192,192,0.6)',
          borderColor: 'rgba(75,192,192,1)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Coût annuel (€)' }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.y;
              return `${ctx.dataset.label}: ${val.toFixed(2)} €`;
            }
          }
        }
      }
    }
  });
}

function displayMonthlySavingsChart(records, tariffResults) {
  const canvas = document.getElementById('monthly-savings-chart');
  if (!canvas || !window.Chart) return;
  
  if (window.monthlySavingsChart) { window.monthlySavingsChart.destroy(); window.monthlySavingsChart = null; }
  
  // Grouper par mois et calculer les économies potentielles
  const months = {};
  for (const r of records) {
    const monthKey = r.dateDebut.slice(0, 7);
    if (!months[monthKey]) months[monthKey] = [];
    months[monthKey].push(r);
  }
  
  const monthLabels = Object.keys(months).sort();
  const savingsData = monthLabels.map(monthKey => {
    const monthRecs = months[monthKey];
    const baseCost = tariffEngine.computeCostBase(monthRecs, appState.defaults.base)?.cost || 0;
    const hphcCost = tariffEngine.computeCostHpHc(monthRecs, appState.defaults.hphc)?.cost || 0;
    const tempoCost = tariffEngine.computeCostTempo(monthRecs, appState.tempoDayMap || {}, appState.defaults.tempo)?.cost || 0;
    
    const minCost = Math.min(baseCost, hphcCost, tempoCost);
    return minCost;
  });
  
  const ctx = canvas.getContext('2d');
  window.monthlySavingsChart = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels: monthLabels,
      datasets: [{
        label: 'Coût minimum mensuel (€)',
        data: savingsData,
        borderColor: 'rgba(107, 174, 214, 1)',
        backgroundColor: 'rgba(107, 174, 214, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: 'rgba(107, 174, 214, 1)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Coût (€)' }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `Coût: ${ctx.parsed.y.toFixed(2)} €`
          }
        }
      }
    }
  });
}

function displayAnalysisSummary(records, tariffResults) {
  const summaryDiv = document.getElementById('analysis-summary');
  if (!summaryDiv) return;
  
  summaryDiv.classList.remove('hidden');
  
  const totalConsumption = records.reduce((s, r) => s + (Number(r.valeur) || 0), 0);
  const bestTariff = Object.entries(tariffResults)
    .filter(([, r]) => !isNaN(r.total))
    .reduce((best, [id, res]) => (!best || (res.total || 0) < (best.total || 0)) ? { id, ...res } : best, null);
  
  const tariffNames = {
    base: 'Base',
    hphc: 'HP/HC',
    tempo: 'Tempo',
    tempoOptimized: 'Tempo+',
    totalCharge: 'Total'
  };
  
  const monthCount = new Set(records.map(r => r.dateDebut.slice(0, 7))).size;
  const avgMonthly = totalConsumption / monthCount;
  
  summaryDiv.innerHTML = `
    <div style="background: linear-gradient(135deg, #4e79a7 0%, #2c5283 100%); padding: 20px; border-radius: 6px; color: white; margin: 16px 0;">
      <h3 style="margin-top: 0; color: #fff;">📊 Résumé Analysé</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; font-size: 14px;">
        <div>
          <div style="opacity: 0.8;">Puissance détectée</div>
          <div style="font-size: 18px; font-weight: bold;">${appState.detectedKva} kVA</div>
        </div>
        <div>
          <div style="opacity: 0.8;">Total annuel</div>
          <div style="font-size: 18px; font-weight: bold;">${totalConsumption.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh</div>
        </div>
        <div>
          <div style="opacity: 0.8;">Moyenne mensuelle</div>
          <div style="font-size: 18px; font-weight: bold;">${avgMonthly.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh</div>
        </div>
        <div>
          <div style="opacity: 0.8;">Meilleure offre</div>
          <div style="font-size: 18px; font-weight: bold;">${bestTariff ? tariffNames[bestTariff.id] || bestTariff.id : 'N/A'}</div>
        </div>
      </div>
      ${bestTariff ? `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.3);">
        <strong>${tariffNames[bestTariff.id] || bestTariff.id}:</strong> ${(bestTariff.total || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} € / an
      </div>` : ''}
    </div>
  `;
}

function savePvSettings() {
  const settings = {
    pvKwp: document.getElementById('pv-kwp')?.value || '3',
    pvRegion: document.getElementById('pv-region')?.value || 'centre',
    pvStandby: document.getElementById('pv-standby')?.value || '50',
    pvCostBase: document.getElementById('pv-cost-base')?.value || '500',
    pvCostPanel: document.getElementById('pv-cost-panel')?.value || '200',
    pvRoiYears: document.getElementById('pv-roi-years')?.value || '15'
  };
  localStorage.setItem('comparatifElec.pvSettings', JSON.stringify(settings));
  console.log('Paramètres PV sauvegardés:', settings);
}

function loadPvSettings() {
  const stored = localStorage.getItem('comparatifElec.pvSettings');
  if (!stored) return;
  
  try {
    const settings = JSON.parse(stored);
    if (settings.pvKwp && document.getElementById('pv-kwp')) {
      document.getElementById('pv-kwp').value = settings.pvKwp;
    }
    if (settings.pvRegion && document.getElementById('pv-region')) {
      document.getElementById('pv-region').value = settings.pvRegion;
    }
    if (settings.pvStandby && document.getElementById('pv-standby')) {
      document.getElementById('pv-standby').value = settings.pvStandby;
    }
    if (settings.pvCostBase && document.getElementById('pv-cost-base')) {
      document.getElementById('pv-cost-base').value = settings.pvCostBase;
    }
    if (settings.pvCostPanel && document.getElementById('pv-cost-panel')) {
      document.getElementById('pv-cost-panel').value = settings.pvCostPanel;
    }
    if (settings.pvRoiYears && document.getElementById('pv-roi-years')) {
      document.getElementById('pv-roi-years').value = settings.pvRoiYears;
      const display = document.getElementById('pv-roi-display');
      if (display) display.textContent = settings.pvRoiYears + ' ans';
    }
    console.log('Paramètres PV restaurés:', settings);
  } catch (e) {
    console.warn('Erreur restauration PV settings:', e);
  }
}

export async function triggerFullRecalculation() {
  const fileInput = document.getElementById('file-input');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
  const file = fileInput.files[0];

  let records = [];
  const cacheKey = file.name + ':' + file.size + ':' + file.lastModified;
  if (appState.recordsCache && appState.recordsCache[cacheKey]) {
    records = appState.recordsCache[cacheKey];
  } else {
    try {
      const name = (file.name || '').toLowerCase();
      const txt = await file.text();
      if (name.endsWith('.json') || file.type.includes('json') || name.endsWith('.txt')) {
        let j = null;
        try { j = JSON.parse(txt); } catch (e) { alert('Fichier JSON invalide'); return; }
        const donnees = (((j || {}).cons || {}).aggregats || {}).heure?.donnees;
        if (Array.isArray(donnees)) {
          for (const rec of donnees) {
            const val = Number(rec.valeur);
            if (isNaN(val)) continue;
            records.push({ dateDebut: rec.dateDebut, dateFin: rec.dateFin, valeur: val });
          }
        } else { alert('Aucune donnée horaire'); return; }
      } else if (name.endsWith('.csv') || file.type?.toLowerCase().includes('csv')) {
        if (typeof window.csvToEnedisJson !== 'function') { alert('Convertisseur CSV indisponible'); return; }
        const j = window.csvToEnedisJson(txt);
        const donnees = (((j || {}).cons || {}).aggregats || {}).heure?.donnees;
        if (Array.isArray(donnees)) {
          for (const rec of donnees) {
            const val = Number(rec.valeur);
            if (isNaN(val)) continue;
            records.push({ dateDebut: rec.dateDebut, dateFin: rec.dateFin, valeur: val });
          }
        } else { alert('Aucune donnée horaire dans CSV'); return; }
      } else { alert('Format non supporté'); return; }
      if (!appState.recordsCache) appState.recordsCache = {};
      appState.recordsCache[cacheKey] = records;
    } catch (err) {
      alert('Erreur lecture: ' + err.message);
      return;
    }
  }
  if (!records.length) { alert('Aucune donnée valide'); return; }

  const dashboard = document.getElementById('dashboard-section');
  if (dashboard) dashboard.classList.remove('hidden');

  const stats = utils.computeHourlyStats(records);
  appState.records = records;

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
  for (const s of kvaSteps) {
    if (s >= maxPowerKw) {
      recommendedKva = s;
      break;
    }
  }
  
  appState.detectedKva = recommendedKva;
  const kvaInfo = document.getElementById('power-detected-info');
  if (kvaInfo) kvaInfo.textContent = `Max détecté: ${maxPowerKw.toFixed(1)} kW → ${recommendedKva} kVA`;
  
  const kvaSel = document.getElementById('param-power-kva');
  if (kvaSel && kvaSel.value === 'auto') {
    appState.currentKva = recommendedKva;
  } else if (!appState.currentKva) {
    appState.currentKva = 6;
  }

  const totalConsoEl = document.getElementById('val-total-conso');
  if (totalConsoEl) totalConsoEl.textContent = stats.total.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' kWh';

  if (document.getElementById('hourly-chart') && window.Chart) {
    if (window.hourlyChart) { window.hourlyChart.destroy(); window.hourlyChart = null; }
    const ctx = document.getElementById('hourly-chart').getContext('2d');
    window.hourlyChart = new window.Chart(ctx, {
      data: {
        labels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + 'h'),
        datasets: [
          { type: 'bar', label: 'Moyenne', data: stats.avg, backgroundColor: 'rgba(54,162,235,0.6)', yAxisID: 'y' },
          { type: 'line', label: 'Min', data: stats.min, borderColor: 'rgba(75,192,192,0.9)', borderWidth: 2, fill: false, yAxisID: 'y' },
          { type: 'line', label: 'Max', data: stats.max, borderColor: 'rgba(255,99,132,0.9)', borderWidth: 2, fill: false, yAxisID: 'y' }
        ]
      },
      options: { responsive: true, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true } } }
    });
  }

  try {
    const hcRange = appState.defaults?.hp?.hcRange || appState.defaults?.hphc?.hcRange || '22-06';
    let hpTotal = 0, hcTotal = 0;
    for (const r of records) {
      const v = Number(r.valeur) || 0;
      const h = new Date(r.dateDebut).getHours();
      if (isHourHC(h, hcRange)) hcTotal += v; else hpTotal += v;
    }
    const canvas = document.getElementById('hp-hc-pie');
    if (canvas) {
      if (window.hpHcPieChart) { window.hpHcPieChart.destroy(); window.hpHcPieChart = null; }
      const ctx = canvas.getContext('2d');
      const total = hpTotal + hcTotal;
      const hpPct = total > 0 ? (hpTotal / total * 100).toFixed(1) : 0;
      const hcPct = total > 0 ? (hcTotal / total * 100).toFixed(1) : 0;
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
                  const val = Number(ctx.parsed) || 0;
                  const tot = (ctx.dataset.data || []).reduce((a, b) => a + Number(b), 0);
                  const pct = tot > 0 ? (val / tot * 100).toFixed(1) : 0;
                  return `${ctx.label}: ${formatNumber(val)} kWh`;
                }
              }
            }
          }
        }
      });
    }
  } catch (e) { console.error('Erreur HP/HC:', e); }

  try {
    await tempoCalendar.ensureTempoDayMap(records);
  } catch (e) {
    console.warn('Tempo init failed:', e);
  }

  try {
    const tariffs = appState.tariffs || {};
    const results = {};
    const kva = appState.currentKva || 6;
    
    for (const [id, tariff] of Object.entries(tariffs)) {
      if (!tariff) continue;
      let res = null;
      try {
        const sub = (tariff.subscriptions?.[kva]) || 0;
        if (id === 'base') {
          res = tariffEngine.computeCostBase(records, tariff);
          res.cost = (res.cost || 0) + sub;
        } else if (id === 'hphc') {
          res = tariffEngine.computeCostHpHc(records, tariff, tariff.hcRange);
          res.cost = (res.cost || 0) + sub;
        } else if (id === 'totalCharge') {
          res = tariffEngine.computeCostTotalCharge(records, tariff);
          res.cost = (res.cost || 0) + sub;
        } else if (id === 'tempo' || id === 'tempoOptimized') {
          const dayMap = appState.tempoDayMap || {};
          res = id === 'tempo' ? 
            tariffEngine.computeCostTempo(records, dayMap, tariff) :
            tariffEngine.computeCostTempoOptimized(records, dayMap, tariff);
          res.cost = (res.cost || 0) + sub;
        }
        if (res) results[id] = { total: res.cost || 0, ...res };
      } catch (e) {
        console.error(`Erreur tarif ${id}:`, e);
        results[id] = { total: NaN, error: e.message };
      }
    }
    appState.tariffResults = results;
    console.log('Tarifs calculés:', results);
    displayAnalysisSummary(records, results);
    displayTariffComparison(results);
    displayMonthlyBreakdown(records, results);
    displayMonthlySavingsChart(records, results);
  } catch (err) {
    console.error('Erreur calculs tarifaires:', err);
  }

  const togglePv = document.getElementById('toggle-pv');
  if (togglePv && togglePv.checked) {
    try {
      const pvConfig = {
        region: document.getElementById('pv-region')?.value || 'centre',
        puissance: Number(document.getElementById('pv-kwp')?.value) || 3,
        standbyW: Number(document.getElementById('pv-standby')?.value) || 0
      };
      const pvResult = await pvSimulation.simulateSolarProduction(appState.records, pvConfig);
      appState.pvResult = pvResult;
      displayPvResults(pvResult);
      displaySavingsComparison(records, appState.tariffResults, pvResult);
      const pvEl = document.getElementById('val-pv-prod');
      if (pvEl) pvEl.textContent = `${pvResult.production.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh`;
    } catch (e) {
      console.error('Erreur PV:', e);
    }
  }

  const monthly = Array(12).fill(0);
  for (const r of records) {
    const dt = new Date(r.dateDebut);
    if (!isNaN(dt.getTime())) monthly[dt.getMonth()] += Number(r.valeur) || 0;
  }
  
  if (document.getElementById('monthly-chart') && window.Chart) {
    if (window.monthlyChart) { window.monthlyChart.destroy(); window.monthlyChart = null; }
    const ctx = document.getElementById('monthly-chart').getContext('2d');
    window.monthlyChart = new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'],
        datasets: [{ label: 'Conso (kWh)', data: monthly, backgroundColor: 'rgba(54,162,235,0.6)' }]
      },
      options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });
  }
  
  if (appState.tempoDayMap && Object.keys(appState.tempoDayMap).length > 0) {
    try {
      const dailyCostMap = tempoCalendar.computeDailyTempoCostMap(records, appState.tempoDayMap);
      tempoCalendar.renderTempoCalendarGraph(appState.tempoDayMap, dailyCostMap);
    } catch (e) {
      console.error('Erreur Tempo graph:', e);
    }
  }
}
