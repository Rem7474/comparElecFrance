// src/tempoCalendar.js
// Génération et gestion du calendrier Tempo pour comparElecFrance
import { fmt, isoDateRange, isHourHC, formatNumber } from './utils.js';
import { appState } from './state.js';

/**
 * Génère le calendrier Tempo à partir des records (fusionne API, localStorage, algo)
 */

export function generateTempoCalendar(records) {
  // 1) Déterminer l'intervalle couvert par les données
  let minD = null, maxD = null;
  if (records && records.length) {
    for (const r of records) {
      const d = new Date((r.dateDebut || '').slice(0, 10));
      if (isNaN(d)) continue;
      if (!minD || d < minD) minD = d;
      if (!maxD || d > maxD) maxD = d;
    }
  }
  if (!minD) { const y = new Date().getFullYear(); minD = new Date(y, 0, 1); maxD = new Date(y, 11, 31); }
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function isSunday(d) { return d.getDay() === 0; }
  function isSaturday(d) { return d.getDay() === 6; }
  // 2) Carte complète (bleu par défaut)
  const dayMap = {}; const allDays = isoDateRange(minD, maxD); for (const ds of allDays) { dayMap[ds] = 'B'; }
  // 3) Itérer par saisons Tempo (1 sept → 31 août)
  function seasonYearFor(d) { return (d.getMonth() >= 8) ? d.getFullYear() : d.getFullYear() - 1; }
  const startSy = seasonYearFor(minD); const endSy = seasonYearFor(maxD);
  for (let sy = startSy; sy <= endSy; sy++) {
    const seasonStart = new Date(sy, 8, 1); const seasonEnd = new Date(sy + 1, 7, 31);
    const clipStart = (seasonStart < minD) ? minD : seasonStart;
    const clipEnd = (seasonEnd > maxD) ? maxD : seasonEnd;
    if (clipStart > clipEnd) continue;
    // 3a) Jours rouges: 1 nov (sy) → 31 mar (sy+1), sans week-end, max 5 consécutifs, total 22 par saison
    const redStart = new Date(sy, 10, 1); const redEnd = new Date(sy + 1, 2, 31);
    const redWindow = isoDateRange(redStart, redEnd);
    const redCandidates = redWindow.filter(ds => dayMap.hasOwnProperty(ds)).filter(ds => { const d = new Date(ds); return !isSaturday(d) && !isSunday(d); });
    const selectedRed = [];
    if (redCandidates.length) {
      const need = 22;
      const step = redCandidates.length / need;
      const pickedIdx = new Set();
      for (let i = 0; i < need && i < redCandidates.length; i++) {
        const target = Math.floor(i * step + step / 2);
        let found = -1; const radius = 5;
        for (let r = 0; r <= radius && found < 0; r++) {
          for (const sign of [-1, 1]) {
            const idx = target + sign * r; if (idx < 0 || idx >= redCandidates.length) continue; if (pickedIdx.has(idx)) continue; found = idx; break;
          }
        }
        if (found >= 0) { pickedIdx.add(found); selectedRed.push(redCandidates[found]); }
      }
      for (let idx = 0; selectedRed.length < need && idx < redCandidates.length; idx++) {
        if (pickedIdx.has(idx)) continue; const ds = redCandidates[idx];
        let runLeft = 0, runRight = 0; let cur = new Date(ds);
        for (let k = 1; k <= 5; k++) { cur.setDate(cur.getDate() - 1); const s = ymd(cur); if (selectedRed.includes(s)) runLeft++; else break; }
        cur = new Date(ds);
        for (let k = 1; k <= 5; k++) { cur.setDate(cur.getDate() + 1); const s = ymd(cur); if (selectedRed.includes(s)) runRight++; else break; }
        if (runLeft + 1 + runRight <= 5) selectedRed.push(ds);
      }
      for (const ds of selectedRed) { dayMap[ds] = 'R'; }
    }
    // 3b) Jours blancs: 43 par saison, hors dimanches et rouges
    const seasonDays = isoDateRange(seasonStart, seasonEnd);
    const allWhiteCandidates = seasonDays.filter(ds => dayMap.hasOwnProperty(ds)).filter(ds => { const d = new Date(ds); return !isSunday(d) && dayMap[ds] !== 'R'; });
    const winterStart = new Date(sy, 10, 1); const winterEnd = new Date(sy + 1, 2, 31);
    const winterWhiteCandidates = allWhiteCandidates.filter(ds => { const d = new Date(ds); return d >= winterStart && d <= winterEnd; });
    const otherWhiteCandidates = allWhiteCandidates.filter(ds => { const d = new Date(ds); return d < winterStart || d > winterEnd; });
    const needW = 43; const whites = [];
    function pickDistributedFrom(list, count, radius = 5) {
      const picked = []; if (!list.length || count <= 0) return picked;
      const step = list.length / count; const used = new Set();
      for (let i = 0; i < count && i < list.length; i++) {
        const idx = Math.floor(i * step + step / 2); const clamp = Math.max(0, Math.min(list.length - 1, idx));
        let found = -1; for (let r = 0; r <= radius && found < 0; r++) {
          for (const sign of [-1, 1]) { const j = clamp + sign * r; if (j < 0 || j >= list.length) continue; if (used.has(j)) continue; found = j; break; }
        }
        if (found >= 0) { used.add(found); picked.push(list[found]); }
      }
      for (let j = 0; picked.length < count && j < list.length; j++) { if (used.has(j)) continue; picked.push(list[j]); }
      return picked.slice(0, count);
    }
    if (allWhiteCandidates.length) {
      const takeWinter = Math.min(needW, winterWhiteCandidates.length);
      const pickW = pickDistributedFrom(winterWhiteCandidates, takeWinter);
      whites.push(...pickW);
      const remaining = needW - whites.length;
      if (remaining > 0) {
        const pickOther = pickDistributedFrom(otherWhiteCandidates, Math.min(remaining, otherWhiteCandidates.length));
        whites.push(...pickOther);
      }
      for (const ds of whites.slice(0, needW)) { dayMap[ds] = 'W'; }
    }
  }
  return dayMap;
}

/**
 * Récupère le calendrier Tempo depuis l'API Enedis
 */

// Fallback : API non implémentée (à compléter si besoin)
export async function fetchTempoFromApi(startDate, endDate, onProgress, config) {
  // Pour usage offline, retourne une promesse résolue vide
  return {};
}

/**
 * Fusionne les sources de calendrier Tempo
 */

export function buildFinalTempoMap(records, storedMap, apiMap, genMap) {
  // Fusion : généré < stocké < API
  const finalMap = { ...genMap, ...storedMap, ...apiMap };
  return finalMap;
}

/**
 * Charge le calendrier Tempo depuis le localStorage
 */

export function loadStoredTempoMap(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) { return {}; }
}

/**
 * Sauvegarde le calendrier Tempo dans le localStorage
 */

export function saveStoredTempoMap(map, storageKey) {
  try {
    const clean = {};
    for (const k of Object.keys(map || {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
        const v = map[k];
        if (v === 'B' || v === 'W' || v === 'R') clean[k] = v;
      }
    }
    localStorage.setItem(storageKey, JSON.stringify(clean));
  } catch (e) { /* ignore storage errors */ }
}

/**
 * Orchestration principale : fusionne localStorage + API + génération locale
 */
export async function ensureTempoDayMap(records) {
  if (!records || !records.length) return {};
  
  const config = appState.defaults?.tempoApi || {
    enabled: true,
    storageKey: 'comparatifElec.tempoDayMap',
    baseUrl: 'https://www.services-rte.com/cms/api_private/indicateurs/v1',
    concurrency: 4
  };
  
  // 1. Générer avec l'algo local
  const genMap = generateTempoCalendar(records);
  
  // 2. Charger depuis localStorage
  const storedMap = loadStoredTempoMap(config.storageKey);
  
  // 3. Fusionner : généré < stocké (stocké remplace généré)
  const finalMap = { ...genMap, ...storedMap };
  
  // 4. Sauvegarder pour la prochaine fois
  saveStoredTempoMap(finalMap, config.storageKey);
  
  // 5. Mettre à jour appState
  appState.tempoDayMap = finalMap;
  appState.tempoSourceMap = {};
  
  return finalMap;
}

/**
 * Calcule le coût journalier Tempo selon la segmentation horaire
 * Tempo: 0-6h=HC, 6-22h=HP, 22-24h=HC
 */
export function computeDailyTempoCostMap(records, dayMap) {
  const dailyCostMap = {};
  const tempoConfig = appState.defaults?.tempo || {
    blue: { hp: 0.1460, hc: 0.1158 },
    white: { hp: 0.1791, hc: 0.1433 },
    red: { hp: 0.2726, hc: 0.2070 }
  };
  
  for (const rec of records) {
    const dateStr = (rec.dateDebut || '').slice(0, 10);
    const color = dayMap[dateStr] || 'B';
    const colorLower = color.toLowerCase();
    const prices = tempoConfig[colorLower === 'b' ? 'blue' : colorLower === 'w' ? 'white' : 'red'] || tempoConfig.blue;
    
    const h = new Date(rec.dateDebut).getHours();
    const val = Number(rec.valeur) || 0;
    const isHC = h >= 0 && h < 6 || h >= 22 && h < 24;
    const price = isHC ? prices.hc : prices.hp;
    const cost = val * price;
    
    if (!dailyCostMap[dateStr]) {
      dailyCostMap[dateStr] = { color, totalCost: 0, details: [] };
    }
    dailyCostMap[dateStr].totalCost += cost;
    dailyCostMap[dateStr].details.push({ hour: h, value: val, price, cost });
  }
  
  return dailyCostMap;
}

/**
 * Rendu du calendrier Tempo en graphique mensuel interactif
 */
export function renderTempoCalendarGraph(dayMap, dailyCostMap) {
  const container = document.getElementById('tempo-calendar-graph');
  if (!container) return;
  
  container.innerHTML = '';
  
  const colorMap = { 'B': '#4e79a7', 'W': '#59a14f', 'R': '#e15759' };
  const textes = { 'B': 'Bleu', 'W': 'Blanc', 'R': 'Rouge' };
  
  // Group by month
  const months = {};
  for (const [dateStr, color] of Object.entries(dayMap)) {
    const d = new Date(dateStr);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!months[monthKey]) months[monthKey] = [];
    months[monthKey].push({ dateStr, color, date: d });
  }
  
  // Render each month
  for (const [monthKey, days] of Object.entries(months).sort()) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tempo-month';
    wrapper.innerHTML = `<h4 style="margin: 10px 0 5px;">${monthKey}</h4>`;
    
    const grid = document.createElement('div');
    grid.className = 'tempo-grid';
    
    // Weekday headers
    const headers = document.createElement('div');
    headers.className = 'tempo-weekdays';
    for (const label of ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']) {
      const h = document.createElement('div');
      h.style.fontWeight = 'bold';
      h.style.textAlign = 'center';
      h.style.fontSize = '0.8em';
      h.textContent = label;
      headers.appendChild(h);
    }
    grid.appendChild(headers);
    
    // Days
    const sortedDays = days.sort((a, b) => a.date - b.date);
    const firstDay = sortedDays[0]?.date;
    if (firstDay) {
      const startDayOfWeek = firstDay.getDay();
      for (let i = 1; i < startDayOfWeek; i++) {
        const empty = document.createElement('div');
        grid.appendChild(empty);
      }
    }
    
    for (const { dateStr, color, date } of sortedDays) {
      const dayEl = document.createElement('div');
      dayEl.className = 'tempo-day';
      dayEl.style.backgroundColor = colorMap[color] || '#4e79a7';
      dayEl.style.cursor = 'pointer';
      dayEl.textContent = date.getDate();
      dayEl.title = `${dateStr} - ${textes[color]}`;
      
      const cost = dailyCostMap[dateStr];
      if (cost) {
        dayEl.title += ` (${cost.totalCost.toFixed(2)}€)`;
      }
      
      grid.appendChild(dayEl);
    }
    
    wrapper.appendChild(grid);
    container.appendChild(wrapper);
  }
}
