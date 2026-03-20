/**
 * config.js - Application configuration and constants
 * Central source of truth for tariff defaults, constants, and KVA-dependent updates
 * @module config
 */

import { appState } from './state.js';
import { getPriceForPower } from './tariffEngine.js';

/** kVA power rating steps available */
export const KVA_STEPS = [3, 6, 9, 12, 15, 18, 24, 30, 36];

/** localStorage keys to persist across sessions */
export const SETTINGS_KEYS = [
  'pv-kwp', 'pv-region', 'pv-standby', 'pv-cost-base', 'pv-cost-panel',
  'param-hphc-hcRange', 'param-sub-base', 'param-sub-hphc', 'param-sub-tempo',
  'param-tch-hpRange', 'param-tch-hcRange', 'param-tch-hscRange', 'param-sub-tch'
];

const _rawWeights = [0.6, 0.7, 0.9, 1.1, 1.2, 1.3, 1.3, 1.2, 1.0, 0.8, 0.6, 0.5];
const _weightsSum = _rawWeights.reduce((a, b) => a + b, 0) || 1;

/** Default tariff configuration — mutable, updated by loadTariffs and updateSubscriptionDefault */
export const DEFAULTS = {
  priceBase: 0.194,
  subBase: 15.65,
  hp: { php: 0.2065, phc: 0.1579, hcRange: '22-06', sub: 15.65 },
  octopusEnergy: { php: 0.2132, phc: 0.1251, hcRange: '22-06', sub: 15.65 },
  tempo: {
    blue: { hp: 0.1612, hc: 0.1325 },
    white: { hp: 0.1871, hc: 0.1499 },
    red: { hp: 0.706, hc: 0.1575 },
    sub: 15.59,
    hcRange: '22-06',
    approxPct: { B: 0.8, W: 0.15, R: 0.05 }
  },
  totalChargeHeures: {
    php: 0.2305, phc: 0.1579, phsc: 0.1337, sub: 15.65,
    hpRange: '07-23', hcRange: '23-02;06-07', hscRange: '02-06'
  },
  injectionPrice: 0,
  monthlySolarWeightsRaw: _rawWeights,
  monthlySolarWeights: _rawWeights.map(v => v / _weightsSum),
  tempoApi: {
    enabled: true,
    baseUrl: 'https://www.api-couleur-tempo.fr/api',
    perDayThrottleMs: 120,
    concurrency: 6,
    storageKey: 'comparatifElec.tempoDayMap'
  }
};

// Backward compat: keep window.DEFAULTS for any legacy code paths
window.DEFAULTS = DEFAULTS;

/**
 * Update subscription prices in DEFAULTS based on detected/selected kVA.
 * Also updates the corresponding DOM inputs.
 * Note: does NOT call populateDefaultsDisplay — callers must do so if needed.
 * @param {number|string} kva - Power level in kVA
 */
export function updateSubscriptionDefault(kva) {
  if (!kva) return;
  const safeKva = Number(kva);
  if (Number.isNaN(safeKva)) return;

  const base = getPriceForPower('base', safeKva) || 15.47;
  const hp = getPriceForPower('hphc', safeKva) || 15.74;
  const tempo = getPriceForPower('tempo', safeKva) || 15.5;

  DEFAULTS.subBase = base;
  DEFAULTS.hp.sub = hp;
  DEFAULTS.tempo.sub = tempo;

  const tchTariff = (appState.getState().loadedTariffs || []).find(t => t.id === 'totalCharge');
  if (tchTariff && tchTariff.subscriptions) {
    const kvaStr = String(safeKva);
    DEFAULTS.totalChargeHeures.sub = Number(
      tchTariff.subscriptions[kvaStr] != null
        ? tchTariff.subscriptions[kvaStr]
        : Object.values(tchTariff.subscriptions)[0]
    ) || 15.65;
  }

  const inpBase = document.getElementById('param-sub-base');
  const inpHp = document.getElementById('param-sub-hphc');
  const inpTempo = document.getElementById('param-sub-tempo');
  if (inpBase) inpBase.value = base.toFixed(2);
  if (inpHp) inpHp.value = hp.toFixed(2);
  if (inpTempo) inpTempo.value = tempo.toFixed(2);

  appState.setState({ currentKva: safeKva }, 'POWER_UPDATED');
}
