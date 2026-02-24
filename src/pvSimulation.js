// src/pvSimulation.js
// Simulation et helpers PV pour comparElecFrance

// Profil horaire PV normalisé (France, orientation sud, source ADEME)
export const PV_HOURLY_PROFILE = [
  0,0,0,0,0,0,0.01,0.03,0.07,0.12,0.15,0.13,0.12,0.13,0.14,0.13,0.11,0.08,0.04,0.02,0,0,0,0
];

/**
 * Production annuelle moyenne par kWp selon la région (kWh/kWp/an)
 */
export function pvYieldPerKwp(region) {
  const map = {
    nord: 950, nordest: 1000, nordouest: 1000, centre: 1100, sud: 1300, sudest: 1400, sudouest: 1350
  };
  return map[region] || 1100;
}

/**
 * Simulation PV : répartit la production annuelle sur les mois et heures, alloue d'abord à la veille
 */
export function simulatePVEffect(records, annualProductionKwh, exportPriceEur, standbyW = 0, monthlyWeights) {
  // Profil horaire normalisé (24h)
  const pvNorm = PV_HOURLY_PROFILE;
  // Pondération mensuelle (par défaut 1/12 si non fourni)
  const weights = Array.isArray(monthlyWeights) && monthlyWeights.length === 12
    ? monthlyWeights : Array(12).fill(1 / 12);

  // Grouper les enregistrements par mois et compter les jours distincts
  const months = {};
  for (const r of records) {
    const d = new Date(r.dateDebut); if (isNaN(d)) continue;
    const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0');
    const key = `${y}-${m}`;
    if (!months[key]) months[key] = { days: new Set(), records: [] };
    months[key].days.add(d.getDate()); months[key].records.push(r);
  }
  const monthKeys = Object.keys(months).sort();
  // Répartition de la production annuelle sur les mois présents
  const monthPV = {};
  if (monthKeys.length === 1) {
    monthPV[monthKeys[0]] = annualProductionKwh;
  } else {
    for (const k of monthKeys) {
      const parts = k.split('-');
      const mi = (parts.length > 1) ? (Number(parts[1]) - 1) : 0;
      monthPV[k] = annualProductionKwh * (weights[mi] || (1 / 12));
    }
  }
  const standbyPerHourKwh = (Number(standbyW) || 0) / 1000;
  let selfConsumed = 0, exported = 0;
  const consumedByHour = Array.from({ length: 24 }, () => 0);
  const allocatedByTimestamp = {};
  // Parcourir chaque occurrence horaire et allouer la production
  for (const k of monthKeys) {
    const info = months[k];
    const daysCount = Math.max(1, info.days.size);
    const mpv = monthPV[k] || 0;
    for (const rec of info.records) {
      const d = new Date(rec.dateDebut); const h = d.getHours();
      const demand = Number(rec.valeur) || 0;
      // production disponible sur cette occurrence horaire (kWh)
      const pvForHourInstance = (pvNorm[h] * mpv) / daysCount;
      // allouer à la veille d'abord, mais ne jamais dépasser la demande réelle
      const allocateToStandby = Math.min(pvForHourInstance, standbyPerHourKwh, demand);
      let remainingPV = pvForHourInstance - allocateToStandby;
      // demande restante après la prise en compte effective de la veille
      const remainingDemand = Math.max(0, demand - allocateToStandby);
      const allocateToOther = Math.min(remainingPV, remainingDemand);
      const allocated = Math.min(pvForHourInstance, allocateToStandby + allocateToOther);
      selfConsumed += allocated; consumedByHour[h] += allocated; exported += Math.max(0, pvForHourInstance - allocated);
      if (rec && rec.dateDebut) {
        const key = String(rec.dateDebut);
        allocatedByTimestamp[key] = (allocatedByTimestamp[key] || 0) + allocated;
      }
    }
  }
  // build aggregated pvPerHour (kWh apportés par heure-of-day sur l'année)
  // (non utilisé ici mais utile pour d'autres analyses)
  // const pvPerHour = Array.from({ length: 24 }, () => 0);
  // for (const k of monthKeys) { const mpv = monthPV[k] || 0; for (let h = 0; h < 24; h++) { pvPerHour[h] += (pvNorm[h] * mpv); } }
  const estimatedAutoPct = annualProductionKwh > 0 ? (selfConsumed / (annualProductionKwh || 1) * 100) : 0;
  return { selfConsumed, exported, consumedByHour, allocatedByTimestamp, estimatedAutoPct };
}

/**
 * Recherche la meilleure config PV (placeholder)
 */
export function findBestPVConfig(records, talon, roiYears, costBase, costPanel, region, exportPrice, tariffs, dayMap) {
  // Hypothèses :
  // - panelPower = 0.4 kWc (400Wc)
  // - on cherche le meilleur gain net sur roiYears pour chaque offre
  const yieldVal = typeof tariffs?.pvYieldPerKwp === 'function'
    ? tariffs.pvYieldPerKwp(region)
    : 1100; // fallback
  const panelPower = 0.4;
  // Préparer les tarifs de base
  const pBase = Number(tariffs?.base?.price) || 0.20;
  const pHp = Number(tariffs?.hphc?.php) || 0.22;
  const pHc = Number(tariffs?.hphc?.phc) || 0.16;
  const hcRange = tariffs?.hphc?.hcRange || '22-06';
  // Pour Tempo, on a besoin du dayMap et des prix
  function getTempoPrice(dateStr, h, map) {
    const dKey = dateStr.slice(0, 10);
    const entry = map?.[dKey] || map?.[dKey.replace(/\//g, '-')];
    let color = 'blue';
    if (typeof entry === 'string') color = (entry.toLowerCase() === 'b' ? 'blue' : (entry.toLowerCase() === 'w' ? 'white' : 'red'));
    else if (entry?.color) color = (entry.color.toLowerCase() === 'b' ? 'blue' : (entry.color.toLowerCase() === 'w' ? 'white' : 'red'));
    let isHC = h >= 22 || h < 6;
    if (entry && typeof entry === 'object') {
      if (entry.hours && entry.hours.length === 24) isHC = Boolean(entry.hours[h]);
      else if (entry.hcRange) isHC = isHourHC(h, entry.hcRange);
    }
    const tColor = tariffs?.tempo?.[color];
    if (!tColor) return 0.15;
    return isHC ? tColor.hc : tColor.hp;
  }
  // Calculs pour chaque offre
  const best = {
    base: { kwp: 0, n: 0, gain: -Infinity, cost: 0, savings: 0, ratio: 0 },
    hphc: { kwp: 0, n: 0, gain: -Infinity, cost: 0, savings: 0, ratio: 0 },
    tempo: { kwp: 0, n: 0, gain: -Infinity, cost: 0, savings: 0, ratio: 0 },
    tempoOpt: { kwp: 0, n: 0, gain: -Infinity, cost: 0, savings: 0, ratio: 0 }
  };
  for (let n = 1; n <= 24; n++) {
    const kwp = n * panelPower;
    const annualProd = kwp * yieldVal;
    const sim = simulatePVEffect(records, annualProd, exportPrice, talon);
    // Pour chaque record, calculer l'économie par offre
    let savedBase = 0, savedHphc = 0, savedTempo = 0, savedTempoOpt = 0;
    for (const r of records) {
      const h = new Date(r.dateDebut).getHours();
      const selfConsumed = sim.allocatedByTimestamp[r.dateDebut] || 0;
      if (selfConsumed > 0) {
        savedBase += selfConsumed * pBase;
        savedHphc += selfConsumed * (isHourHC(h, hcRange) ? pHc : pHp);
        savedTempo += selfConsumed * getTempoPrice(r.dateDebut, h, dayMap);
        // Pour Tempo Opt, on applique 50% HP rouge -> HP blanc (simplifié)
        let tempoOptPrice = getTempoPrice(r.dateDebut, h, dayMap);
        if (dayMap?.[r.dateDebut.slice(0, 10)] === 'R' && !(isHourHC(h, tariffs?.tempo?.hcRange))) {
          const white = tariffs?.tempo?.white;
          if (white) tempoOptPrice = 0.5 * tempoOptPrice + 0.5 * white.hp;
        }
        savedTempoOpt += selfConsumed * tempoOptPrice;
      }
    }
    const exportIncome = sim.exported * exportPrice;
    const annualBase = savedBase + exportIncome;
    const annualHphc = savedHphc + exportIncome;
    const annualTempo = savedTempo + exportIncome;
    const annualTempoOpt = savedTempoOpt + exportIncome;
    const totalCost = costBase + (n * costPanel);
    const gainBase = (annualBase * roiYears) - totalCost;
    const gainHphc = (annualHphc * roiYears) - totalCost;
    const gainTempo = (annualTempo * roiYears) - totalCost;
    const gainTempoOpt = (annualTempoOpt * roiYears) - totalCost;
    const ratio = (annualProd > 0) ? (sim.selfConsumed / annualProd) : 0;
    if (ratio > 0.05) {
      if (gainBase > best.base.gain) best.base = { kwp, n, gain: gainBase, cost: totalCost, savings: annualBase, ratio };
      if (gainHphc > best.hphc.gain) best.hphc = { kwp, n, gain: gainHphc, cost: totalCost, savings: annualHphc, ratio };
      if (gainTempo > best.tempo.gain) best.tempo = { kwp, n, gain: gainTempo, cost: totalCost, savings: annualTempo, ratio };
      if (gainTempoOpt > best.tempoOpt.gain) best.tempoOpt = { kwp, n, gain: gainTempoOpt, cost: totalCost, savings: annualTempoOpt, ratio };
    }
  }
  return best;
}
