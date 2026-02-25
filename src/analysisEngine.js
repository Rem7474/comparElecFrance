/**
 * analysis Engine.js - Analysis orchestration and computation engine
 * Handles all business logic for consumption analysis and cost calculations
 * @module analysisEngine
 */

import { formatNumber, isHourHC, monthKeyFromDateStr } from './utils.js';
import {
  computeCostBase,
  computeCostHpHc,
  computeCostTotalCharge,
  computeCostTempo,
  computeCostTempoOptimized,
  applyPvReduction
} from './tariffEngine.js';
import { pvYieldPerKwp, simulatePVEffect, findBestPVConfig } from './pvSimulation.js';

/**
 * Compute hourly statistics from records
 * @param {Array} records - Consumption records
 * @returns {Object} Statistics { total, avg, hourly: [], min: [], max: [] }
 */
export function computeHourlyStats(records) {
  if (!records || records.length === 0) {
    return { total: 0, avg: 0, hourly: Array(24).fill(0), min: Array(24).fill(0), max: Array(24).fill(0) };
  }

  const hourly = Array(24).fill(0);
  const hoursCount = Array(24).fill(0);
  const min = Array(24).fill(Infinity);
  const max = Array(24).fill(0);
  let total = 0;

  // OPTIMIZATION: Single pass - aggregate, count, and track min/max simultaneously
  // AVoids O(n*24) dayGroups calculation - now O(n)
  for (const rec of records) {
    const date = new Date(rec.dateDebut);
    const hour = date.getHours();
    const value = Number(rec.valeur) || 0;
    
    hourly[hour] += value;
    hoursCount[hour] += 1;
    total += value;
    
    // Track min/max on-the-fly instead of storing day-by-day
    if (value > 0) {
      min[hour] = Math.min(min[hour], value);
      max[hour] = Math.max(max[hour], value);
    }
  }

  // Compute averages and cleanup
  for (let h = 0; h < 24; h++) {
    if (hoursCount[h] > 0) {
      hourly[h] /= hoursCount[h];
    }
    // Replace Infinity with 0 for hours with no data
    if (min[h] === Infinity) min[h] = 0;
  }

  const avg = total / records.length;

  return { total, avg, hourly, min, max };
}

/**
 * Compute monthly breakdown of consumption and costs
 * @param {Array} records - Consumption records
 * @param {number} annualPvProduction - Annual PV in kWh
 * @param {number} exportPrice - Injection price €/kWh
 * @param {number} standbyW - Standby power in W
 * @param {Array} monthlyWeights - Monthly solar weights
 * @param {Object} defaults - DEFAULTS tariff configuration
 * @param {Object} tempoDayMap - Tempo day color map {YYYY-MM-DD: 'R'|'W'|'B'}
 * @returns {Array} Monthly breakdown data
 */
export function computeMonthlyBreakdown(
  records,
  annualPvProduction,
  exportPrice,
  standbyW,
  monthlyWeights,
  defaults,
  tempoDayMap = {}
) {
  if (!records || records.length === 0) return [];

  const months = {};

  // Group by month
  for (const rec of records) {
    const date = new Date(rec.dateDebut);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!months[monthKey]) months[monthKey] = [];
    months[monthKey].push(rec);
  }

  const results = [];
  const keys = Object.keys(months).sort();
  let totalKwhByMonth = {};
  
  // OPTIMIZATION: Compute totals during grouping, not later in the loop
  for (const key of keys) {
    totalKwhByMonth[key] = months[key].reduce((sum, r) => sum + (Number(r.valeur) || 0), 0);
  }

  for (const key of keys) {
    const recs = months[key];
    const totalKwh = totalKwhByMonth[key];

    // Parse month for weight
    const parts = key.split('-');
    const monthIdx = parts.length > 1 ? Number(parts[1]) - 1 : 0;
    const monthPV = annualPvProduction * (monthlyWeights[monthIdx] || 1 / 12);

    // OPTIMIZATION: Simulate PV effect once, reuse for all tariffs
    const monthSim = simulatePVEffect(recs, monthPV, exportPrice, standbyW, monthlyWeights);
    const monthSelf = Math.min(monthSim.selfConsumed, totalKwh, monthPV);
    const importanceReduction = (monthPV - monthSelf) * exportPrice; // Cache the reduction factor

    // OPTIMIZATION: Compute PV-reduced records ONCE instead of per tariff
    const recsWithPV = applyPvReduction(recs, monthSelf);

    // Costs without PV
    const baseEnergy = computeCostBase(recs, defaults).cost;
    const subBase = Number(defaults.subBase) || 0;

    const hphcEnergyObj = computeCostHpHc(recs, defaults.hp, defaults.hp.hcRange);
    const subHphc = Number(defaults.hp.sub) || 0;

    const tempoEnergyObj = computeCostTempo(recs, tempoDayMap, defaults.tempo);
    const subTempo = Number(defaults.tempo.sub) || 0;

    const tempoOptEnergyObj = computeCostTempoOptimized(recs, tempoDayMap, defaults.tempo);
    const tchEnergyObj = computeCostTotalCharge(recs, defaults.totalChargeHeures);
    const subTch = Number(defaults.totalChargeHeures?.sub) || 0;

    // Costs with PV (using pre-computed records with reduction)
    const baseEnergyPV = computeCostBase(recsWithPV, defaults).cost;
    const hphcEnergyObjPV = computeCostHpHc(recsWithPV, defaults.hp, defaults.hp.hcRange);
    const tempoEnergyObjPV = computeCostTempo(recsWithPV, tempoDayMap, defaults.tempo);
    const tempoOptEnergyObjPV = computeCostTempoOptimized(recsWithPV, tempoDayMap, defaults.tempo);
    const tchEnergyObjPV = computeCostTotalCharge(recsWithPV, defaults.totalChargeHeures);

    results.push({
      month: key,
      consumption: totalKwh,
      monthPV,
      monthSelf,
      base: { energy: baseEnergy, total: baseEnergy + subBase },
      basePV: { energy: baseEnergyPV, total: baseEnergyPV + subBase - importanceReduction },
      hphc: { energy: hphcEnergyObj.cost, hp: hphcEnergyObj.hp, hc: hphcEnergyObj.hc, total: hphcEnergyObj.cost + subHphc },
      hphcPV: { energy: hphcEnergyObjPV.cost, total: hphcEnergyObjPV.cost + subHphc - importanceReduction },
      tempo: { energy: tempoEnergyObj.cost || 0, total: (tempoEnergyObj.cost || 0) + subTempo },
      tempoPV: { energy: tempoEnergyObjPV.cost || 0, total: (tempoEnergyObjPV.cost || 0) + subTempo - importanceReduction },
      tempoOpt: { energy: tempoOptEnergyObj.cost || 0, total: (tempoOptEnergyObj.cost || 0) + subTempo },
      tempoOptPV: { energy: tempoOptEnergyObjPV.cost || 0, total: (tempoOptEnergyObjPV.cost || 0) + subTempo - importanceReduction },
      tch: { energy: tchEnergyObj.cost || 0, hp: tchEnergyObj.hp || 0, hc: tchEnergyObj.hc || 0, total: (tchEnergyObj.cost || 0) + subTch },
      tchPV: { energy: tchEnergyObjPV.cost || 0, total: (tchEnergyObjPV.cost || 0) + subTch - importanceReduction }
    });
  }

  return results;
}

/**
 * Compute cost with hourly profile (Base, HP/HC, or TCH)
 * @param {Array} perHourAnnual - Annual consumption per hour [24]
 * @param {number} priceBase - Base price per kWh
 * @param {Object} hpParams - HP/HC parameters { mode, php, phc, hcRange, phsc?, hscRange? }
 * @returns {Object} { cost, hpCost, hcCost, hscCost? }
 */
export function computeCostWithProfile(perHourAnnual, priceBase, hpParams) {
  let cost = 0;
  let hpCost = 0;
  let hcCost = 0;
  if (hpParams.mode === 'base') {
    for (let h = 0; h < 24; h += 1) cost += perHourAnnual[h] * priceBase;
    return { cost, hpCost: 0, hcCost: 0 };
  }
  if (hpParams.mode === 'tch') {
    let hscCost = 0;
    for (let h = 0; h < 24; h += 1) {
      const qty = perHourAnnual[h] || 0;
      if (hpParams.hscRange && isHourHC(h, hpParams.hscRange)) {
        hscCost += qty * hpParams.phsc;
      } else if (isHourHC(h, hpParams.hcRange)) {
        hcCost += qty * hpParams.phc;
      } else {
        hpCost += qty * hpParams.php;
      }
    }
    cost = hpCost + hcCost + hscCost;
    return { cost, hpCost, hcCost, hscCost };
  }

  for (let h = 0; h < 24; h += 1) {
    const qty = perHourAnnual[h] || 0;
    if (isHourHC(h, hpParams.hcRange)) {
      hcCost += qty * hpParams.phc;
    } else {
      hpCost += qty * hpParams.php;
    }
  }
  cost = hpCost + hcCost;
  return { cost, hpCost, hcCost };
}

/**
 * Calculate standby power consumption from daytime records
 * @param {Array} records - Consumption records
 * @returns {number} Estimated standby power in Watts
 */
export function calculateStandbyFromRecords(records) {
  const dayRecords = records.filter((rec) => {
    const h = new Date(rec.dateDebut).getHours();
    return h >= 10 && h < 16;
  });
  if (!dayRecords.length) throw new Error('Pas de données de jour');
  const powers = dayRecords
    .map((rec) => {
      const durationMs = new Date(rec.dateFin) - new Date(rec.dateDebut);
      const durationHours = durationMs / (1000 * 60 * 60);
      if (durationHours <= 0) return 0;
      const kw = Number(rec.valeur) / durationHours;
      return kw * 1000;
    })
    .filter((p) => p > 0)
    .sort((a, b) => a - b);
  const idx = Math.floor(powers.length * 0.35);
  return Math.round(powers[idx]);
}

/**
 * Compute daily cost map for Tempo calendar
 * @param {Array} records - Consumption records
 * @param {Object} dayMap - Tempo day color map
 * @param {Object} tempoTariff - Tempo tariff config
 * @returns {Object} Daily cost breakdown { date: { energy, cost, hpCost, hcCost, color } }
 */
export function computeDailyTempoCostMap(records, dayMap, tempoTariff) {
  const out = {};
  const getRates = (entry, colorLetter) => {
    if (entry && typeof entry === 'object' && entry.rates) {
      return { hp: Number(entry.rates.hp) || 0, hc: Number(entry.rates.hc) || 0 };
    }
    const key = colorLetter === 'R' ? 'red' : colorLetter === 'W' ? 'white' : 'blue';
    const def = tempoTariff && tempoTariff[key];
    if (def && typeof def === 'object') return { hp: Number(def.hp) || 0, hc: Number(def.hc) || 0 };
    return { hp: Number(def) || 0, hc: Number(def) || 0 };
  };

  for (const rec of records) {
    const dt = new Date(rec.dateDebut);
    const h = dt.getHours();
    const dateStr = dt.toISOString().slice(0, 10);
    let bucketDateStr;
    let colorLetter;
    let isHC;
    if (h < 6) {
      const prev = new Date(dt);
      prev.setDate(prev.getDate() - 1);
      bucketDateStr = prev.toISOString().slice(0, 10);
      const entryPrev = dayMap[bucketDateStr] || 'B';
      colorLetter = typeof entryPrev === 'string' ? entryPrev.toUpperCase() : ((entryPrev && entryPrev.color) ? String(entryPrev.color).toUpperCase() : 'B');
      isHC = true;
    } else if (h >= 22) {
      bucketDateStr = dateStr;
      const entryCur = dayMap[bucketDateStr] || 'B';
      colorLetter = typeof entryCur === 'string' ? entryCur.toUpperCase() : ((entryCur && entryCur.color) ? String(entryCur.color).toUpperCase() : 'B');
      isHC = true;
    } else {
      bucketDateStr = dateStr;
      const entryCur = dayMap[bucketDateStr] || 'B';
      colorLetter = typeof entryCur === 'string' ? entryCur.toUpperCase() : ((entryCur && entryCur.color) ? String(entryCur.color).toUpperCase() : 'B');
      isHC = false;
    }
    const entryForBucket = dayMap[bucketDateStr] || 'B';
    const rates = getRates(entryForBucket, colorLetter);
    const applied = isHC ? rates.hc : rates.hp;
    const v = Number(rec.valeur) || 0;
    if (!out[bucketDateStr]) {
      out[bucketDateStr] = { energy: 0, cost: 0, hpCost: 0, hcCost: 0, hpEnergy: 0, hcEnergy: 0, color: colorLetter };
    }
    out[bucketDateStr].energy += v;
    out[bucketDateStr].cost += v * applied;
    if (isHC) {
      out[bucketDateStr].hcCost += v * applied;
      out[bucketDateStr].hcEnergy += v;
    } else {
      out[bucketDateStr].hpCost += v * applied;
      out[bucketDateStr].hpEnergy += v;
    }
    out[bucketDateStr].color = colorLetter;
  }

  return out;
}
