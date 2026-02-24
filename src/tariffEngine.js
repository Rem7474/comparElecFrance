// src/tariffEngine.js
// Moteur de calcul tarifaire unifié pour comparElecFrance
import { isHourHC } from './utils.js';

// --- Base ---
export function computeCostBase(records, tariff) {
  const price = tariff.price;
  const sub = tariff.subscriptions?.[6] || 0;
  let cost = 0;
  for (const r of records) cost += (Number(r.valeur) || 0) * price;
  return { cost: cost + sub };
}

// --- HP/HC ---
export function computeCostHpHc(records, tariff, hcRange) {
  const php = tariff.php, phc = tariff.phc;
  const sub = tariff.subscriptions?.[6] || 0;
  let hp = 0, hc = 0;
  for (const r of records) {
    const h = new Date(r.dateDebut).getHours();
    if (isHourHC(h, hcRange || tariff.hcRange)) hc += (Number(r.valeur) || 0) * phc;
    else hp += (Number(r.valeur) || 0) * php;
  }
  return { cost: hp + hc + sub, hp, hc };
}

// --- Total Charge ---
export function computeCostTotalCharge(records, tariff) {
  const php = tariff.php, phc = tariff.phc, phsc = tariff.phsc;
  const sub = tariff.subscriptions?.[6] || 0;
  let hp = 0, hc = 0, hsc = 0;
  for (const r of records) {
    const h = new Date(r.dateDebut).getHours();
    if (isHourHC(h, tariff.hcRange)) hc += (Number(r.valeur) || 0) * phc;
    else if (isHourHC(h, tariff.hscRange)) hsc += (Number(r.valeur) || 0) * phsc;
    else hp += (Number(r.valeur) || 0) * php;
  }
  return { cost: hp + hc + hsc + sub, hp, hc, hsc };
}

// --- Tempo ---
export function computeCostTempo(records, dayMap, tariff) {
  const sub = tariff.subscriptions?.[6] || 0;
  let blue = 0, white = 0, red = 0;
  for (const r of records) {
    const d = r.dateDebut.slice(0, 10);
    const color = dayMap?.[d] || 'B';
    const h = new Date(r.dateDebut).getHours();
    let price = 0;
    if (color === 'B') price = isHourHC(h, tariff.hcRange) ? tariff.blue.hc : tariff.blue.hp;
    else if (color === 'W') price = isHourHC(h, tariff.hcRange) ? tariff.white.hc : tariff.white.hp;
    else if (color === 'R') price = isHourHC(h, tariff.hcRange) ? tariff.red.hc : tariff.red.hp;
    if (color === 'B') blue += (Number(r.valeur) || 0) * price;
    else if (color === 'W') white += (Number(r.valeur) || 0) * price;
    else if (color === 'R') red += (Number(r.valeur) || 0) * price;
  }
  return { cost: blue + white + red + sub, blue, white, red };
}

// --- Tempo Optimisé ---
export function computeCostTempoOptimized(records, dayMap, tariff) {
  // 50% des HP rouges sont reportés en HP blancs
  let total = 0;
  let redHp = 0, whiteHp = 0;
  for (const r of records) {
    const d = r.dateDebut.slice(0, 10);
    const color = dayMap?.[d] || 'B';
    const h = new Date(r.dateDebut).getHours();
    if (color === 'R' && !isHourHC(h, tariff.hcRange)) redHp += (Number(r.valeur) || 0);
    if (color === 'W' && !isHourHC(h, tariff.hcRange)) whiteHp += (Number(r.valeur) || 0);
  }
  // On reporte 50% des HP rouges en HP blancs
  const shifted = redHp * 0.5;
  whiteHp += shifted;
  redHp -= shifted;
  // Recalcule le coût total avec les nouveaux volumes
  let cost = 0;
  for (const r of records) {
    const d = r.dateDebut.slice(0, 10);
    const color = dayMap?.[d] || 'B';
    const h = new Date(r.dateDebut).getHours();
    let price = 0;
    if (color === 'B') price = isHourHC(h, tariff.hcRange) ? tariff.blue.hc : tariff.blue.hp;
    else if (color === 'W') price = isHourHC(h, tariff.hcRange) ? tariff.white.hc : tariff.white.hp;
    else if (color === 'R') price = isHourHC(h, tariff.hcRange) ? tariff.red.hc : tariff.red.hp;
    let val = Number(r.valeur) || 0;
    if (color === 'R' && !isHourHC(h, tariff.hcRange)) val *= 0.5;
    if (color === 'W' && !isHourHC(h, tariff.hcRange)) val += shifted / whiteHp * val;
    cost += val * price;
  }
  const sub = tariff.subscriptions?.[6] || 0;
  return { cost: cost + sub };
}

// --- PV ---
export function applyPvReduction(records, selfConsumedKwh) {
  const total = records.reduce((s, r) => s + (Number(r.valeur) || 0), 0);
  if (total <= 0) return records.map(r => ({ ...r }));
  const factor = Math.max(0, (total - selfConsumedKwh)) / total;
  return records.map(r => ({ ...r, valeur: (Number(r.valeur) || 0) * factor }));
}
