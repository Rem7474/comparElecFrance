import { isoDateRange } from './utils.js';

export function generateTempoCalendar(records) {
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

  const dayMap = {};
  const allDays = isoDateRange(minD, maxD);
  for (const ds of allDays) dayMap[ds] = 'B';

  const seasonYearFor = (date) => (date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1);
  const startSy = seasonYearFor(minD);
  const endSy = seasonYearFor(maxD);

  const isSunday = (date) => date.getDay() === 0;
  const isSaturday = (date) => date.getDay() === 6;
  const ymd = (date) => date.toISOString().slice(0, 10);

  for (let sy = startSy; sy <= endSy; sy += 1) {
    const seasonStart = new Date(sy, 8, 1);
    const seasonEnd = new Date(sy + 1, 7, 31);
    const clipStart = seasonStart < minD ? minD : seasonStart;
    const clipEnd = seasonEnd > maxD ? maxD : seasonEnd;
    if (clipStart > clipEnd) continue;

    const redStart = new Date(sy, 10, 1);
    const redEnd = new Date(sy + 1, 2, 31);
    const redWindow = isoDateRange(redStart, redEnd)
      .filter((ds) => Object.prototype.hasOwnProperty.call(dayMap, ds))
      .filter((ds) => {
        const d = new Date(ds);
        return !isSaturday(d) && !isSunday(d);
      });

    const selectedRed = [];
    if (redWindow.length) {
      const need = 22;
      const step = redWindow.length / need;
      const pickedIdx = new Set();
      for (let i = 0; i < need && i < redWindow.length; i += 1) {
        const target = Math.floor(i * step + step / 2);
        let found = -1;
        const radius = 5;
        for (let r = 0; r <= radius && found < 0; r += 1) {
          for (const sign of [-1, 1]) {
            const idx = target + sign * r;
            if (idx < 0 || idx >= redWindow.length || pickedIdx.has(idx)) continue;
            found = idx;
            break;
          }
        }
        if (found >= 0) {
          pickedIdx.add(found);
          selectedRed.push(redWindow[found]);
        }
      }

      for (let idx = 0; selectedRed.length < need && idx < redWindow.length; idx += 1) {
        if (pickedIdx.has(idx)) continue;
        const ds = redWindow[idx];
        let runLeft = 0;
        let runRight = 0;
        let cur = new Date(ds);
        for (let k = 1; k <= 5; k += 1) {
          cur.setDate(cur.getDate() - 1);
          const key = ymd(cur);
          if (selectedRed.includes(key)) runLeft += 1;
          else break;
        }
        cur = new Date(ds);
        for (let k = 1; k <= 5; k += 1) {
          cur.setDate(cur.getDate() + 1);
          const key = ymd(cur);
          if (selectedRed.includes(key)) runRight += 1;
          else break;
        }
        if (runLeft + 1 + runRight <= 5) selectedRed.push(ds);
      }

      for (const ds of selectedRed) dayMap[ds] = 'R';
    }

    const seasonDays = isoDateRange(seasonStart, seasonEnd);
    const allWhiteCandidates = seasonDays
      .filter((ds) => Object.prototype.hasOwnProperty.call(dayMap, ds))
      .filter((ds) => {
        const d = new Date(ds);
        return !isSunday(d) && dayMap[ds] !== 'R';
      });
    const winterStart = new Date(sy, 10, 1);
    const winterEnd = new Date(sy + 1, 2, 31);
    const winterCandidates = allWhiteCandidates.filter((ds) => {
      const d = new Date(ds);
      return d >= winterStart && d <= winterEnd;
    });
    const otherCandidates = allWhiteCandidates.filter((ds) => {
      const d = new Date(ds);
      return d < winterStart || d > winterEnd;
    });

    const pickDistributed = (list, count) => {
      const picked = [];
      if (!list.length || count <= 0) return picked;
      const step = list.length / count;
      const used = new Set();
      for (let i = 0; i < count && i < list.length; i += 1) {
        const idx = Math.floor(i * step + step / 2);
        const clamped = Math.max(0, Math.min(list.length - 1, idx));
        let found = -1;
        for (let r = 0; r <= 5 && found < 0; r += 1) {
          for (const sign of [-1, 1]) {
            const j = clamped + sign * r;
            if (j < 0 || j >= list.length || used.has(j)) continue;
            found = j;
            break;
          }
        }
        if (found >= 0) {
          used.add(found);
          picked.push(list[found]);
        }
      }
      for (let j = 0; picked.length < count && j < list.length; j += 1) {
        if (!used.has(j)) picked.push(list[j]);
      }
      return picked.slice(0, count);
    };

    const whites = [];
    const needW = 43;
    const takeWinter = Math.min(needW, winterCandidates.length);
    whites.push(...pickDistributed(winterCandidates, takeWinter));
    const remaining = needW - whites.length;
    if (remaining > 0) {
      whites.push(...pickDistributed(otherCandidates, Math.min(remaining, otherCandidates.length)));
    }
    for (const ds of whites.slice(0, needW)) dayMap[ds] = 'W';
  }

  return dayMap;
}

export async function fetchTempoFromApi(startDate, endDate, onProgress, config) {
  const out = {};
  if (!config || !config.enabled) return out;
  const base = String(config.baseUrl || '').replace(/\/$/, '');

  const normColor = (value) => {
    if (value == null) return null;
    const str = String(value).toLowerCase();
    if (str.includes('bleu') || str === 'b' || str === 'blue' || str === '0') return 'B';
    if (str.includes('blanc') || str === 'w' || str === 'white' || str === '1') return 'W';
    if (str.includes('rouge') || str === 'r' || str === 'red' || str === '2') return 'R';
    return null;
  };

  const seasonYearFor = (date) => (date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1);
  const ymd = (date) => date.toISOString().slice(0, 10);

  const tryFetch = async (url) => {
    try {
      const resp = await fetch(url, { credentials: 'omit' });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (err) {
      return null;
    }
  };

  const startSy = seasonYearFor(startDate);
  const endSy = seasonYearFor(endDate);
  for (let sy = startSy; sy <= endSy; sy += 1) {
    const periodParam = `${sy}-${sy + 1}`;
    const url = `${base}/joursTempo?periode=${periodParam}`;
    const data = await tryFetch(url);
    if (Array.isArray(data)) {
      for (const item of data) {
        const ds = item && item.dateJour;
        if (!ds) continue;
        const color = normColor(item.libCouleur || item.couleur || item.color || item.codeJour);
        if (color) {
          out[ds] = color;
          if (onProgress) onProgress(1);
        }
      }
    }
  }

  const missing = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const ds = ymd(d);
    if (out[ds]) continue;
    missing.push(ds);
  }

  if (missing.length) {
    const concurrency = Math.max(1, Number(config.concurrency) || 4);
    let index = 0;
    const worker = async () => {
      while (true) {
        const i = index;
        index += 1;
        if (i >= missing.length) break;
        const ds = missing[i];
        const url = `${base}/jourTempo/${ds}`;
        const data = await tryFetch(url);
        if (data && !(data.title && data.detail)) {
          const color = normColor(
            data.libCouleur || data.couleur || data.couleurTempo || data.color || data.code || data[ds]
          );
          if (color) {
            out[ds] = color;
            if (onProgress) onProgress(1);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  return out;
}

export function buildFinalTempoMap(records, storedMap, apiMap, genMap) {
  return { ...genMap, ...storedMap, ...apiMap };
}

export function loadStoredTempoMap(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (err) {
    return {};
  }
}

export function saveStoredTempoMap(map, storageKey) {
  try {
    const clean = {};
    for (const key of Object.keys(map || {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        const value = map[key];
        if (value === 'B' || value === 'W' || value === 'R') clean[key] = value;
      }
    }
    localStorage.setItem(storageKey, JSON.stringify(clean));
  } catch (err) {
    // ignore storage errors
  }
}
