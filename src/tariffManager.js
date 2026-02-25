/**
 * tariffManager.js - Tariff loading, mapping, and management
 * Handles loading tariff JSON files, mapping to DEFAULTS, and error display
 * @module tariffManager
 */

/**
 * Display an error message in the tariff errors banner
 * @param {string} message - Error message to display
 */
export function showTariffErrorBanner(message) {
  const container = document.getElementById('tariff-errors');
  if (!container) return;
  container.classList.remove('hidden');
  const item = document.createElement('div');
  item.className = 'alert alert-warning';
  item.textContent = message;
  container.appendChild(item);
}

/**
 * Recursively merge tariff object into target
 * Used to apply tariff JSON structure to DEFAULTS
 * @param {Object} target - Target object to merge into
 * @param {Object} source - Source object to merge from
 * @returns {Object} Merged target object
 */
export function mergeTariffs(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      mergeTariffs(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/**
 * Map common tariff JSON file shapes into the DEFAULTS structure
 * Recognizes base, hphc, tempo, totalCharge, and injection tariff formats
 * @param {Object} tariffJson - Tariff JSON object to map
 * @param {Object} DEFAULTS - DEFAULTS object to update
 * @returns {boolean} True if mapping succeeded, false if generic merge was used
 */
export function mapTariffToDefaults(tariffJson, DEFAULTS) {
  if (!tariffJson || typeof tariffJson !== 'object') return false;
  const id = tariffJson.id || tariffJson.name || null;
  try {
    if (id === 'base' || tariffJson.type === 'flat') {
      if (tariffJson.price != null) DEFAULTS.priceBase = tariffJson.price;
      if (tariffJson.subscriptions) DEFAULTS.subBase = Number(Object.values(tariffJson.subscriptions)[0]) || DEFAULTS.subBase;
      return true;
    }
    if (id === 'hphc' || tariffJson.type === 'two-tier') {
      if (tariffJson.php != null) DEFAULTS.hp.php = tariffJson.php;
      if (tariffJson.phc != null) DEFAULTS.hp.phc = tariffJson.phc;
      if (tariffJson.hcRange) DEFAULTS.hp.hcRange = tariffJson.hcRange;
      if (tariffJson.subscriptions) DEFAULTS.hp.sub = Number(Object.values(tariffJson.subscriptions)[0]) || DEFAULTS.hp.sub;
      return true;
    }
    if (id === 'tempo' || tariffJson.type === 'tempo') {
      if (tariffJson.blue) DEFAULTS.tempo.blue = tariffJson.blue;
      if (tariffJson.white) DEFAULTS.tempo.white = tariffJson.white;
      if (tariffJson.red) DEFAULTS.tempo.red = tariffJson.red;
      if (tariffJson.hcRange) DEFAULTS.tempo.hcRange = tariffJson.hcRange;
      if (tariffJson.approxPct) DEFAULTS.tempo.approxPct = tariffJson.approxPct;
      if (tariffJson.subscriptions) DEFAULTS.tempo.sub = Number(Object.values(tariffJson.subscriptions)[0]) || DEFAULTS.tempo.sub;
      return true;
    }
    if (id === 'totalCharge' || tariffJson.type === 'three-tier') {
      if (tariffJson.php != null) DEFAULTS.totalChargeHeures.php = tariffJson.php;
      if (tariffJson.phc != null) DEFAULTS.totalChargeHeures.phc = tariffJson.phc;
      if (tariffJson.phsc != null) DEFAULTS.totalChargeHeures.phsc = tariffJson.phsc;
      if (tariffJson.hpRange) DEFAULTS.totalChargeHeures.hpRange = tariffJson.hpRange;
      if (tariffJson.hcRange) DEFAULTS.totalChargeHeures.hcRange = tariffJson.hcRange;
      if (tariffJson.hscRange) DEFAULTS.totalChargeHeures.hscRange = tariffJson.hscRange;
      if (tariffJson.subscriptions) DEFAULTS.totalChargeHeures.sub = Number(Object.values(tariffJson.subscriptions)[0]) || DEFAULTS.totalChargeHeures.sub;
      return true;
    }
    if (id === 'injection' || tariffJson.injectionPrice != null) {
      if (tariffJson.injectionPrice != null) DEFAULTS.injectionPrice = tariffJson.injectionPrice;
      return true;
    }
  } catch (e) {
    // ignore mapping errors and fallback to generic merge
  }
  return false;
}

/**
 * Discover tariff files from the tariffs folder
 * Tries multiple strategies: index.json, directory listing, or hardcoded list
 * @param {Function} log - Optional logging function
 * @returns {Promise<string[]>} Array of tariff file paths
 */
async function discoverTariffFiles(log) {
  // 1) Prefer an explicit index file if present
  try {
    const idxResp = await fetch('tariffs/index.json', { cache: 'no-cache' });
    if (idxResp.ok) {
      const idx = await idxResp.json();
      let list = null;
      if (Array.isArray(idx)) list = idx.map((n) => (n.startsWith('tariffs/') ? n : `tariffs/${n}`));
      else if (typeof idx === 'object' && idx.files && Array.isArray(idx.files)) list = idx.files.map((n) => (n.startsWith('tariffs/') ? n : `tariffs/${n}`));
      if (list && list.length) {
        if (log) {
          try {
            log(`tariffs/index.json trouvé — chargement de ${list.length} fichiers tarifaires`);
          } catch (e) {
            // ignore logging errors
          }
        }
        return list;
      }
    }
  } catch (err) {
    // fallthrough
  }

  // 2) Try to fetch directory listing HTML (works on simple static servers)
  try {
    const resp = await fetch('tariffs/', { cache: 'no-cache' });
    if (resp.ok) {
      const txt = await resp.text();
      const regex = /href=["']([^"']+\.json)["']/gi;
      const found = new Set();
      let m;
      while ((m = regex.exec(txt))) {
        let p = m[1];
        if (!p.startsWith('tariffs/')) p = `tariffs/${p}`;
        found.add(p);
      }
      if (found.size) return Array.from(found);
    }
  } catch (err) {
    // ignore
  }

  // 3) Fallback to conservative builtin list
  return ['tariffs/base.json', 'tariffs/hphc.json', 'tariffs/tempo.json', 'tariffs/total-charge-heures.json', 'tariffs/injection.json'];
}

/**
 * Load all tariff files and apply to DEFAULTS
 * @param {Object} DEFAULTS - Tariff configuration to update
 * @param {Function} log - Logging function
 * @param {Function} setAppState - App state setter
 * @param {Function} displayDefaults - Display update function
 * @returns {Promise<void>}
 */
export async function loadTariffs(DEFAULTS, log, setAppState, displayDefaults) {
  const files = await discoverTariffFiles(log);
  for (const name of files) {
    try {
      const resp = await fetch(name, { cache: 'no-cache' });
      if (!resp.ok) {
        showTariffErrorBanner(`Tarif introuvable: ${name} — valeurs par défaut utilisées.`);
        console.error('Tariff fetch failed', name, resp.status);
        continue;
      }
      const json = await resp.json();
      // Try mapping known tariff file formats into DEFAULTS first
      const mapped = mapTariffToDefaults(json, DEFAULTS);
      if (!mapped) mergeTariffs(DEFAULTS, json);
    } catch (err) {
      showTariffErrorBanner(`Erreur de chargement du tarif ${name} — valeurs par défaut utilisées.`);
      console.error('Tariff parse failed', name, err);
    }
  }
  setAppState({ tariffs: DEFAULTS }, 'TARIFFS_LOADED');
  displayDefaults();
}
