/**
 * analysisEngine.js - Analysis orchestration and computation engine
 * Handles all business logic for consumption analysis and cost calculations
 * @module analysisEngine
 */

import { formatNumber, isHourHC } from './utils.js';
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
  let total = 0;
  const dayGroups = {};

  // Aggregate by hour
  for (const rec of records) {
    const date = new Date(rec.dateDebut);
    const hour = date.getHours();
    const value = Number(rec.valeur) || 0;
    
    hourly[hour] += value;
    hoursCount[hour] += 1;
    total += value;
    
    // Track per day
    const dayKey = date.toISOString().slice(0, 10);
    if (!dayGroups[dayKey]) dayGroups[dayKey] = Array(24).fill(0);
    dayGroups[dayKey][hour] = value;
  }

  // Compute avg per hour
  for (let h = 0; h < 24; h++) {
    if (hoursCount[h] > 0) {
      hourly[h] /= hoursCount[h];
    }
  }

  // Compute min/max per hour
  const min = Array(24).fill(Infinity);
  const max = Array(24).fill(0);

  for (const dayHours of Object.values(dayGroups)) {
    for (let h = 0; h < 24; h++) {
      if (dayHours[h] > 0) {
        min[h] = Math.min(min[h], dayHours[h]);
        max[h] = Math.max(max[h], dayHours[h]);
      }
    }
  }

  // Replace Infinity with 0 for min
  for (let h = 0; h < 24; h++) {
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
 * @returns {Array} Monthly breakdown data
 */
export function computeMonthlyBreakdown(
  records,
  annualPvProduction,
  exportPrice,
  standbyW,
  monthlyWeights,
  defaults
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

  for (const key of keys) {
    const recs = months[key];
    const totalKwh = recs.reduce((sum, r) => sum + (Number(r.valeur) || 0), 0);

    // Parse month for weight
    const parts = key.split('-');
    const monthIdx = parts.length > 1 ? Number(parts[1]) - 1 : 0;
    const monthPV = annualPvProduction * (monthlyWeights[monthIdx] || 1 / 12);

    // Simulate PV effect
    const monthSim = simulatePVEffect(
      recs,
      monthPV,
      exportPrice,
      standbyW,
      monthlyWeights
    );
    const estimatedMonthSelf = Math.min(monthSim.selfConsumed, totalKwh, monthPV);
    const monthSelf = estimatedMonthSelf;

    // Costs without PV
    const baseEnergy = computeCostBase(recs, defaults).cost;
    const subBase = Number(defaults.subBase) || 0;
    const baseTotal = baseEnergy + subBase;

    const hphcEnergyObj = computeCostHpHc(recs, defaults.hp, defaults.hp.hcRange);
    const subHphc = Number(defaults.hp.sub) || 0;
    const hphcTotal = hphcEnergyObj.cost + subHphc;

    const tempoEnergyObj = computeCostTempo(recs, {}, defaults.tempo); // TODO: Pass actual dayMap
    const subTempo = Number(defaults.tempo.sub) || 0;
    const tempoTotal = tempoEnergyObj.cost + subTempo;

    const tempoOptEnergyObj = computeCostTempoOptimized(recs, {}, defaults.tempo);
    const tempoOptTotal = tempoOptEnergyObj.cost + subTempo;

    const tchEnergyObj = computeCostTotalCharge(recs, defaults.totalChargeHeures);
    const subTch = Number(defaults.totalChargeHeures?.sub) || 0;
    const tchTotal = tchEnergyObj.cost + subTch;

    // Apply PV reduction
    const recsWithPV = applyPvReduction(recs, monthSelf);
    
    const baseEnergyPV = computeCostBase(recsWithPV, defaults).cost;
    const baseTotalPV = baseEnergyPV + subBase - (monthPV - monthSelf) * exportPrice;

    const hphcEnergyObjPV = computeCostHpHc(recsWithPV, defaults.hp, defaults.hp.hcRange);
    const hphcTotalPV = hphcEnergyObjPV.cost + subHphc - (monthPV - monthSelf) * exportPrice;

    const tempoEnergyObjPV = computeCostTempo(recsWithPV, {}, defaults.tempo);
    const tempoTotalPV = tempoEnergyObjPV.cost + subTempo - (monthPV - monthSelf) * exportPrice;

    const tempoOptEnergyObjPV = computeCostTempoOptimized(recsWithPV, {}, defaults.tempo);
    const tempoOptTotalPV = tempoOptEnergyObjPV.cost + subTempo - (monthPV - monthSelf) * exportPrice;

    const tchEnergyObjPV = computeCostTotalCharge(recsWithPV, defaults.totalChargeHeures);
    const tchTotalPV = tchEnergyObjPV.cost + subTch - (monthPV - monthSelf) * exportPrice;

    results.push({
      month: key,
      consumption: totalKwh,
      monthPV,
      monthSelf,
      base: { energy: baseEnergy, total: baseTotal },
      basePV: { energy: baseEnergyPV, total: baseTotalPV },
      hphc: { energy: hphcEnergyObj.cost, hp: hphcEnergyObj.hp, hc: hphcEnergyObj.hc, total: hphcTotal },
      hphcPV: { energy: hphcEnergyObjPV.cost, total: hphcTotalPV },
      tempo: { energy: tempoEnergyObj.cost || 0, total: tempoTotal },
      tempoPV: { energy: tempoEnergyObjPV.cost || 0, total: tempoTotalPV },
      tempoOpt: { energy: tempoOptEnergyObj.cost || 0, total: tempoOptTotal },
      tempoOptPV: { energy: tempoOptEnergyObjPV.cost || 0, total: tempoOptTotalPV },
      tch: { energy: tchEnergyObj.cost || 0, hp: tchEnergyObj.hp || 0, hc: tchEnergyObj.hc || 0, total: tchTotal },
      tchPV: { energy: tchEnergyObjPV.cost || 0, total: tchTotalPV }
    });
  }

  return results;
}

/**
 * Compare all available offers for given consumption records
 * @param {Array} records - Consumption records
 * @param {boolean} isPvEnabled - Include PV simulation
 * @param {Object} pvParams - PV parameters {kwp, region, standby, costBase, costPanel}
 * @param {Object} defaults - DEFAULTS configuration
 * @returns {Object} Offers comparison { offers: [], best: {}, exportIncome }
 */
export function compareAllOffers(records, isPvEnabled, pvParams, defaults) {
  if (!records || records.length === 0) {
    return { offers: [], best: null, exportIncome: 0 };
  }

  // Build per-hour annual profile
  const perHourAnnual = Array(24).fill(0);
  const uniqueMonths = new Set();
  
  for (const rec of records) {
    const value = Number(rec.valeur) || 0;
    const date = new Date(rec.dateDebut);
    
    perHourAnnual[date.getHours()] += value;
    uniqueMonths.add(`${date.getFullYear()}-${date.getMonth()}`);
  }

  const monthsCount = Math.max(1, uniqueMonths.size);

  // Prepare costs
  const priceBase = Number(defaults.priceBase) || 0.18;
  const hpParams = {
    mode: 'hp-hc',
    php: Number(defaults.hp.php) || 0.2,
    phc: Number(defaults.hp.phc) || 0.12,
    hcRange: defaults.hp.hcRange || '22-06'
  };

  const subBase = (Number(defaults.subBase) || 0) * monthsCount;
  const subHp = (Number(defaults.hp.sub) || 0) * monthsCount;
  const subTempo = (Number(defaults.tempo.sub) || 0) * monthsCount;
  const subTch = (Number(defaults.totalChargeHeures?.sub) || 0) * monthsCount;

  // Compute costs without PV
  function computeCostWithProfile(perHour, priceVal, hpParams) {
    let cost = 0;
    let hpCost = 0;
    let hcCost = 0;
    
    if (hpParams.mode === 'base') {
      for (let h = 0; h < 24; h++) {
        cost += perHour[h] * priceVal;
      }
      return { cost, hpCost: 0, hcCost: 0 };
    }

    for (let h = 0; h < 24; h++) {
      const qty = perHour[h] || 0;
      if (isHourHC(h, hpParams.hcRange)) {
        hcCost += qty * hpParams.phc;
      } else {
        hpCost += qty * hpParams.php;
      }
    }

    cost = hpCost + hcCost;
    return { cost, hpCost, hcCost };
  }

  const baseCostNoPV = computeCostWithProfile(perHourAnnual, priceBase, { mode: 'base' }).cost + subBase;
  const hpCostNoPV = computeCostWithProfile(perHourAnnual, priceBase, hpParams).cost + subHp;
  const tempoResNoPV = computeCostTempo(records, {}, defaults.tempo);
  tempoResNoPV.cost += subTempo;
  const tempoOptResNoPV = computeCostTempoOptimized(records, {}, defaults.tempo);
  if (tempoOptResNoPV && typeof tempoOptResNoPV.cost === 'number') {
    tempoOptResNoPV.cost += subTempo;
  }
  const tchResNoPV = computeCostTotalCharge(records, defaults.totalChargeHeures);
  tchResNoPV.cost += subTch;

  // PV calculation
  let exportIncome = 0;
  let baseCostWithPV = baseCostNoPV;
  let hpCostWithPV = hpCostNoPV;
  let tempoResWithPV = { cost: tempoResNoPV.cost };
  let tempoOptResWithPV = { cost: tempoOptResNoPV?.cost || tempoResNoPV.cost };
  let tchResWithPV = { cost: tchResNoPV.cost };

  if (isPvEnabled) {
    const annualProduction = (pvParams.kwp || 0) * pvYieldPerKwp(pvParams.region || 'centre');
    const exportPrice = Number(defaults.injectionPrice) || 0;

    const pvSim = simulatePVEffect(
      records,
      annualProduction,
      exportPrice,
      pvParams.standby || 0,
      [] // monthlyWeights would be passed here
    );

    const perHourWithPV = perHourAnnual.map((v, h) =>
      Math.max(0, v - (pvSim.consumedByHour[h] || 0))
    );

    baseCostWithPV = computeCostWithProfile(perHourWithPV, priceBase, { mode: 'base' }).cost + subBase;
    hpCostWithPV = computeCostWithProfile(perHourWithPV, priceBase, hpParams).cost + subHp;

    const recordsWithPV = records.map(rec => ({ ...rec }));
    for (const rec of recordsWithPV) {
      const reduction = (pvSim.allocatedByTimestamp && pvSim.allocatedByTimestamp[rec.dateDebut]) || 0;
      rec.valeur = Math.max(0, Number(rec.valeur || 0) - reduction);
    }

    tempoResWithPV = computeCostTempo(recordsWithPV, {}, defaults.tempo);
    tempoResWithPV.cost += subTempo;

    tchResWithPV = computeCostTotalCharge(recordsWithPV, defaults.totalChargeHeures);
    tchResWithPV.cost += subTch;

    tempoOptResWithPV = computeCostTempoOptimized(recordsWithPV, {}, defaults.tempo);
    tempoOptResWithPV.cost = (tempoOptResWithPV?.cost || tempoResWithPV.cost) + subTempo;

    exportIncome = pvSim.exported * exportPrice;
  }

  // Build offers list
  const offers = [];

  if (defaults && defaults.priceBase != null) {
    offers.push({
      id: 'base',
      name: 'Base',
      costNoPV: baseCostNoPV,
      costWithPV: baseCostWithPV
    });
  }

  if (defaults && defaults.hp) {
    offers.push({
      id: 'hphc',
      name: 'Heures Pleines / Creuses',
      costNoPV: hpCostNoPV,
      costWithPV: hpCostWithPV
    });
  }

  if (defaults && defaults.tempo) {
    offers.push({
      id: 'tempo',
      name: 'Tempo (Classique)',
      costNoPV: tempoResNoPV.cost || 0,
      costWithPV: tempoResWithPV.cost || 0
    });

    offers.push({
      id: 'tempoOpt',
      name: 'Tempo (Optimisé)',
      costNoPV: (tempoOptResNoPV?.cost || 0),
      costWithPV: tempoOptResWithPV.cost || 0
    });
  }

  if (defaults && defaults.totalChargeHeures) {
    offers.push({
      id: 'tch',
      name: 'Total Charge\'Heures',
      costNoPV: tchResNoPV.cost || 0,
      costWithPV: tchResWithPV.cost || 0
    });
  }

  // Find best
  const sortedByCost = offers.slice().sort((a, b) => a.costWithPV - b.costWithPV);
  const best = sortedByCost[0] || null;

  return { offers, best, exportIncome };
}

/**
 * Compute daily Tempo cost breakdown
 * @param {Array} records - Consumption records
 * @param {Object} dayMap - Day to color mapping {YYYY-MM-DD: 'R'|'W'|'B'}
 * @returns {Object} Daily cost map
 */
export function computeDailyTempoCostMap(records, dayMap, defaults) {
  const out = {};

  for (const rec of records) {
    const dt = new Date(rec.dateDebut);
    const h = dt.getHours();
    const dateStr = dt.toISOString().slice(0, 10);
    let bucketDateStr = dateStr;
    let isHC = false;

    if (h < 6) {
      const prev = new Date(dt);
      prev.setDate(prev.getDate() - 1);
      bucketDateStr = prev.toISOString().slice(0, 10);
      isHC = true;
    } else if (h >= 22) {
      isHC = true;
    }

    const entry = dayMap[bucketDateStr] || 'B';
    const colorLetter = typeof entry === 'string' ? entry.toUpperCase() : 'B';
    const key = colorLetter === 'R' ? 'red' : colorLetter === 'W' ? 'white' : 'blue';
    const tempoRates = defaults.tempo[key] || {};
    const applied = isHC ? (tempoRates.hc || 0) : (tempoRates.hp || 0);

    const v = Number(rec.valeur) || 0;

    if (!out[bucketDateStr]) {
      out[bucketDateStr] = {
        energy: 0,
        cost: 0,
        hpCost: 0,
        hcCost: 0,
        hpEnergy: 0,
        hcEnergy: 0,
        color: colorLetter
      };
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
  }

  return out;
}
