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

/**
 * Get storage key for Tempo map
 * @param {Object} tempoApiConfig - Tempo API configuration
 * @returns {string} Storage key
 */
export function tempoStorageKey(tempoApiConfig) {
  return (tempoApiConfig && tempoApiConfig.storageKey) || 'comparatifElec.tempoDayMap';
}

/**
 * Show Tempo loading indicator
 * @param {Object} tempoLoading - Loading UI object
 * @param {number} total - Total items to load
 */
export function showTempoLoading(tempoLoading, total) {
  if (!tempoLoading || !tempoLoading.container) return;
  tempoLoading.total = total || 0;
  tempoLoading.done = 0;
  tempoLoading.container.style.display = 'block';
  if (tempoLoading.fill) tempoLoading.fill.style.width = '0%';
  if (tempoLoading.text) {
    tempoLoading.text.textContent = total > 0 ? `Chargement des jours Tempo… 0/${total}` : 'Chargement des jours Tempo…';
  }
}

/**
 * Update Tempo loading progress
 * @param {Object} tempoLoading - Loading UI object
 * @param {number} done - Items completed
 * @param {number} total - Total items
 */
export function updateTempoLoading(tempoLoading, done, total) {
  if (!tempoLoading || !tempoLoading.container) return;
  tempoLoading.done = done;
  tempoLoading.total = total || tempoLoading.total;
  const pct = tempoLoading.total > 0 ? Math.min(100, Math.round((done / tempoLoading.total) * 100)) : 0;
  if (tempoLoading.fill) tempoLoading.fill.style.width = `${pct}%`;
  if (tempoLoading.text) tempoLoading.text.textContent = `Chargement des jours Tempo… ${done}/${tempoLoading.total}`;
}

/**
 * Hide Tempo loading indicator
 * @param {Object} tempoLoading - Loading UI object
 */
export function hideTempoLoading(tempoLoading) {
  if (!tempoLoading || !tempoLoading.container) return;
  tempoLoading.container.style.display = 'none';
}

/**
 * Map Tempo color code to hex color
 * @param {string} col - Color code (R|W|B)
 * @returns {string} Hex color
 */
export function mapColorToHex(col) {
  const c = String(col || '').toUpperCase();
  if (c === 'R') return '#e15759';
  if (c === 'W') return '#59a14f';
  if (c === 'B') return '#4e79a7';
  return '#999999';
}

/**
 * Get representative price for Tempo entry
 * @param {string|Object} entry - Tempo day entry
 * @param {Object} defaults - DEFAULTS tariff config
 * @returns {number} Representative price in €/kWh
 */
export function getRepresentativePriceForEntry(entry, defaults) {
  const toNumber = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value !== 'string') return 0;
    const parsed = Number.parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const resolveTempoConfig = (obj) => {
    if (!obj || typeof obj !== 'object') return {};
    if (obj.tempo && typeof obj.tempo === 'object') return obj.tempo;
    if (obj.blue || obj.white || obj.red) return obj;
    return {};
  };

  let rates = null;
  const safeDefaults = defaults || {};
  const tempoConfig = resolveTempoConfig(safeDefaults);
  if (!entry) return Number(safeDefaults.priceBase || 0);
  if (typeof entry === 'string') {
    const letter = entry.toUpperCase();
    const key = letter === 'B' ? 'blue' : letter === 'W' ? 'white' : letter === 'R' ? 'red' : entry.toLowerCase();
    const def = tempoConfig[key];
    if (def && typeof def === 'object') rates = { hp: toNumber(def.hp), hc: toNumber(def.hc) };
    else rates = { hp: toNumber(def), hc: toNumber(def) };
  } else if (entry && typeof entry === 'object') {
    if (entry.rates) rates = { hp: toNumber(entry.rates.hp), hc: toNumber(entry.rates.hc) };
    else if (entry.color) {
      const letter = String(entry.color || '').toUpperCase();
      const key = letter === 'B' ? 'blue' : letter === 'W' ? 'white' : letter === 'R' ? 'red' : String(entry.color || '').toLowerCase();
      const def = tempoConfig[key];
      if (def && typeof def === 'object') rates = { hp: toNumber(def.hp), hc: toNumber(def.hc) };
      else if (def != null) rates = { hp: toNumber(def), hc: toNumber(def) };
    }
  }
  if (!rates) return Number(safeDefaults.priceBase || 0);
  return (Number(rates.hp) + Number(rates.hc)) / 2;
}

/**
 * Create or get tooltip element for Tempo calendar
 * @returns {HTMLElement} Tooltip element
 */
export function createTooltip() {
  let tooltip = document.getElementById('tempo-tooltip');
  if (tooltip) return tooltip;
  tooltip = document.createElement('div');
  tooltip.id = 'tempo-tooltip';
  tooltip.className = 'tempo-tooltip';
  document.body.appendChild(tooltip);
  return tooltip;
}

/**
 * Render Tempo calendar graph with daily costs
 * @param {Object} dayMap - Tempo day color map
 * @param {Object} dailyCostMap - Daily cost breakdown
 * @param {Object} defaults - DEFAULTS configuration
 */
export function renderTempoCalendarGraph(dayMap, dailyCostMap, defaults) {
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
        const price = getRepresentativePriceForEntry(entry, defaults);
        dayEl.title = `${dStr} - ${colorKey} - ${price.toFixed(4)} €/kWh`;
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

/**
 * Ensure Tempo day map is loaded and up-to-date
 * @param {Array} records - Consumption records
 * @param {Object} tempoLoading - Loading UI object
 * @param {Object} defaults - DEFAULTS configuration
 * @param {Function} onStateUpdate - Callback to update state { tempoDayMap, tempoSourceMap }
 * @returns {Promise<Object>} Final Tempo day map
 */
export async function ensureTempoDayMap(records, tempoLoading, defaults, onStateUpdate) {
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
  const storageKey = tempoStorageKey(defaults.tempoApi);
  const stored = loadStoredTempoMap(storageKey);
  const initial = { ...genMap, ...stored };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const apiEnd = maxD < today ? maxD : today;

  let totalToFetch = 0;
  const storedForCount = loadStoredTempoMap(storageKey);
  for (let d = new Date(minD); d <= apiEnd; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    if (!storedForCount[ds]) totalToFetch += 1;
  }

  let done = 0;
  let apiMap = {};
  try {
    if (defaults.tempoApi && defaults.tempoApi.enabled && totalToFetch > 0) {
      showTempoLoading(tempoLoading, totalToFetch);
    }
    apiMap = await fetchTempoFromApi(minD, apiEnd, (inc) => {
      done += Number(inc) || 0;
      updateTempoLoading(tempoLoading, done, totalToFetch);
    }, defaults.tempoApi);
  } catch (err) {
    console.warn('fetchTempoFromApi failed', err);
  } finally {
    hideTempoLoading(tempoLoading);
  }

  if (apiMap && Object.keys(apiMap).length) {
    const merged = { ...stored, ...apiMap };
    saveStoredTempoMap(merged, storageKey);
  }

  const finalMap = buildFinalTempoMap(records, stored, apiMap, genMap);
  
  if (onStateUpdate) {
    const src = {};
    for (const key of Object.keys(genMap)) src[key] = 'gen';
    for (const key of Object.keys(stored || {})) src[key] = 'store';
    for (const key of Object.keys(apiMap || {})) src[key] = 'api';
    onStateUpdate({ tempoDayMap: finalMap, tempoSourceMap: src });
  }

  return finalMap;
}

// ─── Shared tempo loading state ───────────────────────────────────────────────
// Singleton with lazy DOM getters so it can be imported at module load time
// without requiring the DOM to be ready yet.
export const tempoLoading = {
  get container() { return document.getElementById('tempo-loading'); },
  get fill() { return document.getElementById('tempo-loading-fill'); },
  get text() { return document.getElementById('tempo-loading-text'); },
  total: 0,
  done: 0
};
