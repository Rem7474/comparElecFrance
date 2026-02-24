// src/tempoCalendar.js
// Génération et gestion du calendrier Tempo pour comparElecFrance
import { fmt, isoDateRange } from './utils.js';

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
