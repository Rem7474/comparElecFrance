import { isHourHC } from './utils.js';

function normalizeTempoRates(tempo) {
  const getRates = (entry) => {
    if (entry && typeof entry === 'object') {
      return { hp: Number(entry.hp) || 0, hc: Number(entry.hc) || 0 };
    }
    return { hp: Number(entry) || 0, hc: Number(entry) || 0 };
  };

  return {
    blue: getRates(tempo.blue),
    white: getRates(tempo.white),
    red: getRates(tempo.red)
  };
}

function colorLetterToKey(letter) {
  const upper = String(letter || '').toUpperCase();
  if (upper === 'B') return 'blue';
  if (upper === 'W') return 'white';
  if (upper === 'R') return 'red';
  return String(letter || '').toLowerCase();
}

function getTempoEntryColor(entry) {
  if (!entry) return 'B';
  if (typeof entry === 'string') return entry.toUpperCase();
  if (entry.color) return String(entry.color).toUpperCase();
  return 'B';
}

function toLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTempoContext(recordDate, hour, dayMap) {
  const dayStr = toLocalDateKey(recordDate);
  if (hour < 6) {
    const prev = new Date(recordDate);
    prev.setDate(prev.getDate() - 1);
    const bucket = toLocalDateKey(prev);
    return { bucketDate: bucket, entry: dayMap[bucket], isHC: true };
  }
  if (hour >= 22) {
    return { bucketDate: dayStr, entry: dayMap[dayStr], isHC: true };
  }
  return { bucketDate: dayStr, entry: dayMap[dayStr], isHC: false };
}

function resolveTempoRates(entry, tempoTariff, fallbackColor) {
  if (entry && typeof entry === 'object' && entry.rates) {
    return {
      hp: Number(entry.rates.hp) || 0,
      hc: Number(entry.rates.hc) || 0
    };
  }
  const key = colorLetterToKey(fallbackColor);
  const def = tempoTariff[key];
  if (def && typeof def === 'object') {
    return { hp: Number(def.hp) || 0, hc: Number(def.hc) || 0 };
  }
  return { hp: Number(def) || 0, hc: Number(def) || 0 };
}

export function computeCostBase(records, tariff) {
  const price = Number(tariff.priceBase) || 0;
  let cost = 0;
  for (const rec of records) {
    cost += (Number(rec.valeur) || 0) * price;
  }
  return { cost };
}

export function computeCostHpHc(records, tariff, hcRange) {
  const php = Number(tariff.php) || 0;
  const phc = Number(tariff.phc) || 0;
  const range = hcRange || tariff.hcRange || '22-06';
  let hp = 0;
  let hc = 0;
  for (const rec of records) {
    const value = Number(rec.valeur) || 0;
    const hour = new Date(rec.dateDebut).getHours();
    if (isHourHC(hour, range)) {
      hc += value * phc;
    } else {
      hp += value * php;
    }
  }
  return { cost: hp + hc, hp, hc };
}

export function computeCostTotalCharge(records, tariff) {
  const php = Number(tariff.php) || 0;
  const phc = Number(tariff.phc) || 0;
  const phsc = Number(tariff.phsc) || 0;
  const hcRange = tariff.hcRange || '23-02;06-07';
  const hscRange = tariff.hscRange || '02-06';
  let hp = 0;
  let hc = 0;
  let hsc = 0;

  for (const rec of records) {
    const value = Number(rec.valeur) || 0;
    const hour = new Date(rec.dateDebut).getHours();
    if (hscRange && isHourHC(hour, hscRange)) {
      hsc += value * phsc;
    } else if (isHourHC(hour, hcRange)) {
      hc += value * phc;
    } else {
      hp += value * php;
    }
  }

  return { cost: hp + hc + hsc, hp, hc, hsc };
}

export function getTempoRecordPricing(record, dayMap, tempoTariff) {
  const dateObj = new Date(record.dateDebut);
  const hour = dateObj.getHours();
  const ctx = getTempoContext(dateObj, hour, dayMap);
  const entry = ctx.entry || 'B';
  const colorLetter = getTempoEntryColor(entry);
  const rates = resolveTempoRates(entry, tempoTariff, colorLetter);
  return { colorLetter, isHC: ctx.isHC, rates };
}

export function computeCostTempo(records, dayMap, tempoTariff) {
  const tempoRates = normalizeTempoRates(tempoTariff);
  let cost = 0;
  let blue = 0;
  let white = 0;
  let red = 0;

  if (!dayMap) {
    const pct = tempoTariff.approxPct || { B: 0.8, W: 0.15, R: 0.05 };
    const totalCons = records.reduce((sum, rec) => sum + (Number(rec.valeur) || 0), 0);
    const consB = totalCons * (pct.B || 0);
    const consW = totalCons * (pct.W || 0);
    const consR = totalCons * (pct.R || 0);
    const pBlue = (tempoRates.blue.hp + tempoRates.blue.hc) / 2;
    const pWhite = (tempoRates.white.hp + tempoRates.white.hc) / 2;
    const pRed = (tempoRates.red.hp + tempoRates.red.hc) / 2;
    cost = consB * pBlue + consW * pWhite + consR * pRed;
    blue = consB * pBlue;
    white = consW * pWhite;
    red = consR * pRed;
    return { cost, blue, white, red };
  }

  for (const rec of records) {
    const value = Number(rec.valeur) || 0;
    const { colorLetter, isHC, rates } = getTempoRecordPricing(rec, dayMap, tempoTariff);
    const applied = isHC ? rates.hc : rates.hp;
    cost += value * applied;
    if (colorLetter === 'R') red += value * applied;
    else if (colorLetter === 'W') white += value * applied;
    else blue += value * applied;
  }

  return { cost, blue, white, red };
}

export function computeCostTempoOptimized(records, dayMap, tempoTariff) {
  if (!dayMap) {
    return computeCostTempo(records, null, tempoTariff);
  }

  const tempoRates = normalizeTempoRates(tempoTariff);
  let cost = 0;
  for (const rec of records) {
    const value = Number(rec.valeur) || 0;
    const { colorLetter, isHC, rates } = getTempoRecordPricing(rec, dayMap, tempoTariff);
    if (colorLetter === 'R' && !isHC) {
      cost += value * 0.5 * rates.hp + value * 0.5 * tempoRates.white.hp;
    } else {
      cost += value * (isHC ? rates.hc : rates.hp);
    }
  }

  return { cost };
}

export function applyPvReduction(records, selfConsumedKwh) {
  const total = records.reduce((sum, rec) => sum + (Number(rec.valeur) || 0), 0);
  if (total <= 0) return records.map((rec) => ({ ...rec }));
  const factor = Math.max(0, (total - selfConsumedKwh)) / total;
  return records.map((rec) => ({ ...rec, valeur: (Number(rec.valeur) || 0) * factor }));
}

/**
 * Subscription pricing grid (€/day) for different tariffs and power levels
 */
export const SUBSCRIPTION_GRID = {
  base: { 3: 12.03, 6: 15.65, 9: 19.56, 12: 23.32, 15: 26.84, 18: 30.49, 24: 38.24, 30: 45.37, 36: 52.54 },
  hphc: { 6: 15.65, 9: 19.56, 12: 23.32, 15: 26.84, 18: 30.49, 24: 38.24, 30: 45.37, 36: 52.54 },
  tempo: { 6: 15.59, 9: 19.38, 12: 23.07, 15: 26.47, 18: 30.04, 30: 44.73, 36: 52.42 }
};

/**
 * Get subscription cost for a given tariff type and power level
 * @param {string} type - Tariff type: 'base', 'hphc', or 'tempo'
 * @param {number} kva - Power level in kVA
 * @returns {number} Subscription cost in €/day
 */
export function getPriceForPower(type, kva) {
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
