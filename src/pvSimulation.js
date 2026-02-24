import { getTempoRecordPricing } from './tariffEngine.js';
import { isHourHC } from './utils.js';

const PV_HOURLY_PROFILE_RAW = [
  0, 0, 0, 0, 0.005, 0.02, 0.05, 0.09, 0.12, 0.14, 0.15, 0.13,
  0.1, 0.06, 0.04, 0.02, 0.01, 0, 0, 0, 0, 0, 0, 0
];
const PV_PROFILE_SUM = PV_HOURLY_PROFILE_RAW.reduce((sum, value) => sum + value, 0) || 1;

// Normalized hourly profile (sum = 1). Source: heuristic midday peak from prior implementation.
export const PV_HOURLY_PROFILE = PV_HOURLY_PROFILE_RAW.map((value) => value / PV_PROFILE_SUM);

export function pvYieldPerKwp(region) {
  const map = { nord: 700, centre: 900, sud: 1100 };
  return map[region] || 900;
}

export function simulatePVEffect(records, annualProductionKwh, exportPriceEur, standbyW, monthlyWeights) {
  const perHourAnnual = Array.from({ length: 24 }, () => 0);
  const months = {};

  for (const rec of records) {
    const date = new Date(rec.dateDebut);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!months[key]) months[key] = { days: new Set(), records: [] };
    months[key].days.add(date.getDate());
    months[key].records.push(rec);
    perHourAnnual[date.getHours()] += Number(rec.valeur) || 0;
  }

  const monthKeys = Object.keys(months).sort();
  const monthPV = {};
  if (monthKeys.length === 1) {
    monthPV[monthKeys[0]] = annualProductionKwh;
  } else {
    for (const key of monthKeys) {
      const parts = key.split('-');
      const monthIndex = parts.length > 1 ? Number(parts[1]) - 1 : 0;
      const weight = monthlyWeights && monthlyWeights[monthIndex] != null ? monthlyWeights[monthIndex] : 1 / 12;
      monthPV[key] = annualProductionKwh * weight;
    }
  }

  const standbyPerHourKwh = (Number(standbyW) || 0) / 1000;
  let selfConsumed = 0;
  let exported = 0;
  const consumedByHour = Array.from({ length: 24 }, () => 0);
  const allocatedByTimestamp = {};

  for (const key of monthKeys) {
    const info = months[key];
    const daysCount = Math.max(1, info.days.size);
    const monthProd = monthPV[key] || 0;

    for (const rec of info.records) {
      const date = new Date(rec.dateDebut);
      const hour = date.getHours();
      const demand = Number(rec.valeur) || 0;
      const pvForHourInstance = (PV_HOURLY_PROFILE[hour] * monthProd) / daysCount;

      const allocateToStandby = Math.min(pvForHourInstance, standbyPerHourKwh, demand);
      const remainingPV = pvForHourInstance - allocateToStandby;
      const remainingDemand = Math.max(0, demand - allocateToStandby);
      const allocateToOther = Math.min(remainingPV, remainingDemand);
      const allocated = Math.min(pvForHourInstance, allocateToStandby + allocateToOther);

      selfConsumed += allocated;
      consumedByHour[hour] += allocated;
      exported += Math.max(0, pvForHourInstance - allocated);
      if (rec && rec.dateDebut) {
        const keyTs = String(rec.dateDebut);
        allocatedByTimestamp[keyTs] = (allocatedByTimestamp[keyTs] || 0) + allocated;
      }
    }
  }

  const pvPerHour = Array.from({ length: 24 }, () => 0);
  for (const key of monthKeys) {
    const monthProd = monthPV[key] || 0;
    for (let hour = 0; hour < 24; hour += 1) {
      pvPerHour[hour] += PV_HOURLY_PROFILE[hour] * monthProd;
    }
  }

  const estimatedAutoPct = annualProductionKwh > 0 ? (selfConsumed / annualProductionKwh) * 100 : 0;

  return {
    perHourAnnual,
    pvPerHour,
    selfConsumed,
    exported,
    consumedByHour,
    allocatedByTimestamp,
    estimatedAutoPct
  };
}

export function findBestPVConfig(records, talon, roiYears, costBase, costPanel, region, exportPrice, tariffs, dayMap) {
  const yieldVal = pvYieldPerKwp(region);
  const panelPower = 0.4;

  const tariffsPerRecord = records.map((rec) => {
    const hour = new Date(rec.dateDebut).getHours();
    const hcRange = tariffs.hp.hcRange || '22-06';
    const isHc = isHourHC(hour, hcRange);
    const tempoPricing = dayMap
      ? getTempoRecordPricing(rec, dayMap, tariffs.tempo)
      : { colorLetter: 'B', isHC: false, rates: tariffs.tempo.blue };
    const tempoRates = tempoPricing.rates;
    const whiteHp =
      tariffs.tempo && typeof tariffs.tempo.white === 'object'
        ? Number(tariffs.tempo.white.hp) || 0
        : Number(tariffs.tempo.white) || 0;
    return {
      base: Number(tariffs.priceBase) || 0,
      hphc: isHc ? (Number(tariffs.hp.phc) || 0) : (Number(tariffs.hp.php) || 0),
      tempo: tempoPricing.isHC ? tempoRates.hc : tempoRates.hp,
      tempoOpt:
        tempoPricing.colorLetter === 'R' && !tempoPricing.isHC
          ? tempoRates.hp * 0.5 + whiteHp * 0.5
          : tempoPricing.isHC
            ? tempoRates.hc
            : tempoRates.hp
    };
  });

  const best = {
    base: { kwp: 0, n: 0, gain: -Infinity, cost: 0, savings: 0, ratio: 0 },
    hphc: { kwp: 0, n: 0, gain: -Infinity, cost: 0, savings: 0, ratio: 0 },
    tempo: { kwp: 0, n: 0, gain: -Infinity, cost: 0, savings: 0, ratio: 0 },
    tempoOpt: { kwp: 0, n: 0, gain: -Infinity, cost: 0, savings: 0, ratio: 0 }
  };

  for (let n = 1; n <= 24; n += 1) {
    const kwp = n * panelPower;
    const annualProd = kwp * yieldVal;
    const sim = simulatePVEffect(records, annualProd, exportPrice, talon, tariffs.monthlySolarWeights);
    const totalCost = costBase + n * costPanel;
    const exportIncome = sim.exported * exportPrice;

    let savedBase = 0;
    let savedHphc = 0;
    let savedTempo = 0;
    let savedTempoOpt = 0;

    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      const selfConsumed = sim.allocatedByTimestamp[rec.dateDebut] || 0;
      if (selfConsumed > 0) {
        savedBase += selfConsumed * tariffsPerRecord[i].base;
        savedHphc += selfConsumed * tariffsPerRecord[i].hphc;
        savedTempo += selfConsumed * tariffsPerRecord[i].tempo;
        savedTempoOpt += selfConsumed * tariffsPerRecord[i].tempoOpt;
      }
    }

    const annualBase = savedBase + exportIncome;
    const annualHphc = savedHphc + exportIncome;
    const annualTempo = savedTempo + exportIncome;
    const annualTempoOpt = savedTempoOpt + exportIncome;

    const gainBase = annualBase * roiYears - totalCost;
    const gainHphc = annualHphc * roiYears - totalCost;
    const gainTempo = annualTempo * roiYears - totalCost;
    const gainTempoOpt = annualTempoOpt * roiYears - totalCost;

    const ratio = annualProd > 0 ? sim.selfConsumed / annualProd : 0;
    if (ratio > 0.05) {
      if (gainBase > best.base.gain) best.base = { kwp, n, gain: gainBase, cost: totalCost, savings: annualBase, ratio };
      if (gainHphc > best.hphc.gain) best.hphc = { kwp, n, gain: gainHphc, cost: totalCost, savings: annualHphc, ratio };
      if (gainTempo > best.tempo.gain) best.tempo = { kwp, n, gain: gainTempo, cost: totalCost, savings: annualTempo, ratio };
      if (gainTempoOpt > best.tempoOpt.gain) best.tempoOpt = { kwp, n, gain: gainTempoOpt, cost: totalCost, savings: annualTempoOpt, ratio };
    }
  }

  return best;
}
