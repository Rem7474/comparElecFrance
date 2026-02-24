// src/app.js
// Point d'entrée principal de comparElecFrance (SPA)
import { appState } from './state.js';
import * as utils from './utils.js';
import * as tariffEngine from './tariffEngine.js';
import * as pvSim from './pvSimulation.js';
import * as tempoCal from './tempoCalendar.js';


// Branche l'analyse automatique à la sélection de fichier
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
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

  // 2. Parser le fichier (JSON ou CSV)
  let records = [];
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
  } catch (err) {
    alert('Erreur lors de la lecture du fichier : ' + err.message);
    return;
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

  // 8. TODO : Appeler les autres modules pour simulation PV, calculs d'offres, ventilation mensuelle, calendrier Tempo, etc.
  // (À compléter pour la migration totale du comportement)
}
