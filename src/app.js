// src/app.js
// Point d'entrée principal de comparElecFrance (SPA)
import { appState } from './state.js';
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
 * Charge tous les fichiers de tarifs (JSON) et met à jour appState
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
    for (const t of tariffFiles) {
      try {
        const resp = await fetch(t.file);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        tariffs[t.id] = await resp.json();
      } catch (err) {
        throw new Error(`Erreur chargement ${t.file}: ${err.message || err}`);
      }
    }
    appState.tariffs = tariffs;
    appState.tariffsLoaded = true;
    appState.tariffsError = null;
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
    return appState.tariffs;
  }
}
import * as utils from './utils.js';
import * as tariffEngine from './tariffEngine.js';
import * as pvSim from './pvSimulation.js';
import * as tempoCal from './tempoCalendar.js';


// Branche l'analyse automatique à la sélection de fichier
document.addEventListener('DOMContentLoaded', () => {
  // Charger les tarifs avant d’autoriser l’analyse
  loadTariffs().then(() => {
    hideTariffErrorBanner();
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

  // 3. Afficher le dashboard
  const dashboard = document.getElementById('dashboard-section');
  if (dashboard) dashboard.classList.remove('hidden');

  // 4. Calculs statistiques (total, max, min, moyennes horaires)
  const hours = Array.from({ length: 24 }, () => []);
  let total = 0;
  for (const r of records) {
    const v = Number(r.valeur); if (isNaN(v)) continue; total += v; const dt = new Date(r.dateDebut); if (isNaN(dt.getTime())) continue; const h = dt.getHours(); hours[h].push(v);
  }
  const avg = [], min = [], max = [], count = [];
  for (let h = 0; h < 24; h++) {
    const arr = hours[h];
    if (arr.length === 0) { avg.push(0); min.push(0); max.push(0); count.push(0); }
    else { const s = arr.reduce((a, b) => a + b, 0); avg.push(s / arr.length); min.push(Math.min(...arr)); max.push(Math.max(...arr)); count.push(arr.length); }
  }

  // 5. Afficher la consommation totale
  const totalConsoEl = document.getElementById('val-total-conso');
  if (totalConsoEl) totalConsoEl.textContent = total.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' kWh';

  // 6. Rendu du graphique horaire
  const hourlyCanvas = document.getElementById('hourly-chart');
  if (hourlyCanvas && window.Chart) {
    if (window.hourlyChart) { window.hourlyChart.destroy(); window.hourlyChart = null; }
    const ctx = hourlyCanvas.getContext('2d');
    window.hourlyChart = new window.Chart(ctx, {
      data: {
        labels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + 'h'),
        datasets: [
          { type: 'bar', label: 'Moyenne (kWh)', data: avg, backgroundColor: 'rgba(54,162,235,0.6)', yAxisID: 'y' },
          { type: 'line', label: 'Min (kWh)', data: min, borderColor: 'rgba(75,192,192,0.9)', borderWidth: 2, fill: false, yAxisID: 'y' },
          { type: 'line', label: 'Max (kWh)', data: max, borderColor: 'rgba(255,99,132,0.9)', borderWidth: 2, fill: false, yAxisID: 'y' }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'kWh' } } }
      }
    });
  }

  // 7. Rendu du camembert HP/HC (si applicable)
  // (Utilise la logique de isHourHC du module utils)
  try {
    const { isHourHC, formatNumber } = await import('./utils.js');
    const hcRange = '22-06';
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
  } catch (e) { }

  // 8. Appel des modules métier pour analyses complètes
  try {
    // Centraliser l'état
    const { appState } = await import('./state.js');
    appState.records = records;

    // a) Calculs d'offres (tarifs)
    // On utilise les fonctions du module tariffEngine.js et les tarifs dynamiques de appState.tariffs
    const tariffs = appState.tariffs || {};
    const results = {};
    for (const [id, tariff] of Object.entries(tariffs)) {
      let res = null;
      try {
        if (id === 'base') {
          res = tariffEngine.computeCostBase(records, tariff);
        } else if (id === 'hphc') {
          res = tariffEngine.computeCostHpHc(records, tariff, tariff.hcRange);
        } else if (id === 'totalCharge') {
          res = tariffEngine.computeCostTotalCharge(records, tariff);
        } else if (id === 'tempo') {
          // Nécessite le calendrier Tempo (jourMap)
          const dayMap = appState.tempoDayMap || {};
          res = tariffEngine.computeCostTempo(records, dayMap, tariff);
        } else if (id === 'tempoOptimized') {
          const dayMap = appState.tempoDayMap || {};
          res = tariffEngine.computeCostTempoOptimized(records, dayMap, tariff);
        }
        if (res) {
          results[id] = { total: res.cost || 0, ...res };
        }
      } catch (e) {
        results[id] = { total: NaN, error: e.message };
      }
    }
    appState.tariffResults = results;
    // Affichage tableau comparatif
    const table = document.getElementById('tariff-table');
    if (table) {
      table.innerHTML = '<tr><th>Offre</th><th>Coût annuel (€)</th></tr>' + Object.entries(results).map(([k, v]) => `<tr><td>${k}</td><td>${isNaN(v.total) ? 'Erreur' : v.total.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</td></tr>`).join('');
    }

    // b) Simulation photovoltaïque
    const { simulateSolarProduction } = await import('./pvSimulation.js');
    const pvConfig = appState.pvConfig || { region: 'FR', puissance: 3, orientation: 'S', inclinaison: 30 };
    const pvResult = await simulateSolarProduction(records, pvConfig);
    appState.pvResult = pvResult;
    // Affichage PV
    const pvEl = document.getElementById('pv-sim-result');
    if (pvEl) {
      pvEl.textContent = pvResult ? `Prod. PV estimée : ${pvResult.production.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh, autoconsommation : ${pvResult.autoconsommationPct.toFixed(1)}%` : 'Simulation PV indisponible';
    }

    // Affichage Informations Tarifs (seulement si records chargés)
    const infoTarifEl = document.getElementById('defaults-display');
    if (infoTarifEl) {
      const parent = infoTarifEl.parentElement;
      if (records && records.length > 0) {
        infoTarifEl.textContent = JSON.stringify(appState.tariffs, null, 2);
        if (parent && parent.classList.contains('hidden')) parent.classList.remove('hidden');
      } else {
        infoTarifEl.textContent = '';
        if (parent && !parent.classList.contains('hidden')) parent.classList.add('hidden');
      }
    }

    // c) Ventilation mensuelle
    const monthly = Array(12).fill(0);
    for (const r of records) {
      const dt = new Date(r.dateDebut); if (isNaN(dt.getTime())) continue;
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

    // d) Calendrier Tempo (si activé)
    const { getOrGenerateTempoCalendar } = await import('./tempoCalendar.js');
    if (appState.tariffMode === 'TEMPO') {
      const tempoCal = await getOrGenerateTempoCalendar(records);
      appState.tempoCalendar = tempoCal;
      // Affichage résumé
      const tempoEl = document.getElementById('tempo-summary');
      if (tempoEl && tempoCal) {
        const bleu = tempoCal.filter(d => d.couleur === 'BLEU').length;
        const blanc = tempoCal.filter(d => d.couleur === 'BLANC').length;
        const rouge = tempoCal.filter(d => d.couleur === 'ROUGE').length;
        tempoEl.textContent = `Jours Tempo : ${bleu} bleu, ${blanc} blanc, ${rouge} rouge`;
      }
    }

    // e) Autres indicateurs (taux d'autoconsommation, économies, etc.)
    const ecoEl = document.getElementById('eco-indicator');
    if (ecoEl && pvResult && tarifs && tarifs['Base']) {
      const eco = tarifs['Base'].total - (tarifs['Base'].total - pvResult.economieEstimee);
      ecoEl.textContent = `Économie PV estimée : ${eco.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
    }
  } catch (err) {
    alert('Erreur lors de l’analyse complète : ' + (err.message || err));
  }
}
