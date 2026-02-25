/**
 * calculationEngine.js - Optimized calculation cache and workflow
 * Handles caching, parallelization, and workflow optimization
 * Prevents redundant calculations across multiple analysis functions
 * @module calculationEngine
 */

/**
 * Cached results to avoid redundant calculations
 * Structure: { fileHash, pvParams, costs, breakdown, simulation }
 */
const calculationCache = {
  fileHash: null,
  pvParams: null,
  costs: null,
  breakdown: null,
  simulation: null,
  perHourAnnual: null,
  hourlyStats: null
};

/**
 * Generate hash of calculation parameters for cache validation
 * @param {Array} records - Data records
 * @param {Object} pvParams - PV parameters {kwp, region, standbyW}
 * @returns {string} Parameter hash
 */
function generateParamHash(records, pvParams) {
  const recordHash = records ? `${records.length}:${records[0]?.dateDebut || ''}` : '';
  const pvHash = pvParams ? `${pvParams.kwp}:${pvParams.region}:${pvParams.standbyW}` : '';
  return `${recordHash}|${pvHash}`;
}

/**
 * Invalidate cache based on what changed
 * @param {string} changeType - 'file', 'pv', 'tariff', 'all'
 */
export function invalidateCache(changeType = 'all') {
  switch (changeType) {
    case 'file':
      calculationCache.fileHash = null;
      calculationCache.hourlyStats = null;
      calculationCache.perHourAnnual = null;
      calculationCache.costs = null;
      calculationCache.breakdown = null;
      calculationCache.simulation = null;
      break;
    case 'pv':
      calculationCache.pvParams = null;
      calculationCache.simulation = null;
      calculationCache.costs = null;
      calculationCache.breakdown = null;
      break;
    case 'tariff':
      calculationCache.costs = null;
      calculationCache.breakdown = null;
      break;
    default:
      Object.keys(calculationCache).forEach(key => {
        calculationCache[key] = null;
      });
  }
}

/**
 * Extract PV parameters from DOM
 * @returns {Object} {kwp, region, standbyW, exportPrice}
 */
export function extractPvParams() {
  return {
    kwp: Number(document.getElementById('pv-kwp')?.value) || 0,
    region: document.getElementById('pv-region')?.value || 'centre',
    standbyW: Number(document.getElementById('pv-standby')?.value) || 0,
    exportPrice: 0 // Set by caller from DEFAULTS
  };
}


/**
 * Extract hourly aggregation from records (done once instead of repeated)
 * @param {Array} records - Data records
 * @returns {Array<number>} 24-element hourly totals
 */
export function extractPerHourAnnual(records) {
  const perHour = Array(24).fill(0);
  for (const rec of records) {
    const hour = new Date(rec.dateDebut).getHours();
    perHour[hour] += Number(rec.valeur) || 0;
  }
  return perHour;
}


/**
 * Calculate PV installation cost based on system size
 * @param {number} kwp - System size in kWp
 * @returns {number} Estimated install cost in €
 */
export function calculateInstallCost(kwp) {
  const costBase = Number(document.getElementById('pv-cost-base')?.value) || 500;
  const costPanel = Number(document.getElementById('pv-cost-panel')?.value) || 200;
  const numPanels = Math.round(kwp / 0.4);
  return costBase + numPanels * costPanel;
}

/**
 * Build records with PV reduction applied (avoid cloning all records)
 * Instead: calculate reduction once, apply on-the-fly in cost functions
 * @param {Array} records - Original records
 * @param {Object} pvSim - PV simulation result
 * @returns {Array} Records with PV applied
 */
export function applyPvToRecords(records, pvSim) {
  // Create lightweight shadow array with only necessary modifications
  return records.map((rec) => {
    const reduction = (pvSim.allocatedByTimestamp && pvSim.allocatedByTimestamp[String(rec.dateDebut)]) || 0;
    return {
      ...rec,
      valeur: Math.max(0, Number(rec.valeur || 0) - reduction)
    };
  });
}

/**
 * Deduplicate DOM reads for performance
 * Cache frequently accessed elements
 */
export const domElementCache = {
  isPvEnabled: null,
  pvKwp: null,
  pvRegion: null,
  standbyW: null,
  exportPrice: null,
  lastReadTime: 0
};

/**
 * Read DOM values once, cache for duration
 * @param {Object} DEFAULTS - Default values for fallback
 * @param {number} cacheDuration - Cache duration in ms (default 100ms)
 * @returns {Object} Cached DOM values
 */
export function readDomValuesOnce(DEFAULTS, cacheDuration = 100) {
  const now = Date.now();
  
  // Return cached if still fresh
  if (now - domElementCache.lastReadTime < cacheDuration && domElementCache.isPvEnabled !== null) {
    return {
      isPvEnabled: domElementCache.isPvEnabled,
      pvKwp: domElementCache.pvKwp,
      pvRegion: domElementCache.pvRegion,
      standbyW: domElementCache.standbyW,
      exportPrice: domElementCache.exportPrice
    };
  }

  // Read from DOM
  domElementCache.isPvEnabled = document.getElementById('toggle-pv')?.checked ?? true;
  domElementCache.pvKwp = Number(document.getElementById('pv-kwp')?.value) || 0;
  domElementCache.pvRegion = document.getElementById('pv-region')?.value || 'centre';
  domElementCache.standbyW = Number(document.getElementById('pv-standby')?.value) || 0;
  domElementCache.exportPrice = Number(DEFAULTS.injectionPrice) || 0;
  domElementCache.lastReadTime = now;

  return {
    isPvEnabled: domElementCache.isPvEnabled,
    pvKwp: domElementCache.pvKwp,
    pvRegion: domElementCache.pvRegion,
    standbyW: domElementCache.standbyW,
    exportPrice: domElementCache.exportPrice
  };
}

/**
 * Build DOM table efficiently using DocumentFragment instead of string concat
 * @param {Array} rows - Data rows
 * @param {boolean} isPvEnabled - Show PV columns
 * @returns {DocumentFragment} Built fragment ready to append
 */
export function buildTableFragmentEfficiently(rows, isPvEnabled) {
  const fragment = document.createDocumentFragment();
  
  // Build header
  const hdr = document.createElement('tr');
  const headerCells = isPvEnabled ? [
    'Mois', 'Consommation (kWh)',
    'Base (€)', 'Base+PV (€)', 'Éco. (€)',
    'HP/HC (€)', 'HP/HC+PV (€)', 'Éco. (€)',
    'Tempo (€)', 'Tempo+PV (€)', 'Éco. (€)',
    'Tempo Opt. (€)', 'Tempo Opt.+PV (€)', 'Éco. (€)',
    'TCH (€)', 'TCH+PV (€)', 'Éco. (€)',
    'Diff. HP/HC vs Meilleure (€)'
  ] : [
    'Mois', 'Consommation (kWh)',
    'Base (€)', 'HP/HC (€)', 'Tempo (€)', 'Tempo Opt. (€)', 'TCH (€)',
    'Diff. HP/HC vs Meilleure (€)'
  ];
  
  headerCells.forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    hdr.appendChild(th);
  });
  fragment.appendChild(hdr);

  // Build rows efficiently
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.className = 'row-divider';
    
    // Create cells one by one instead of innerHTML
    const monthCell = document.createElement('td');
    monthCell.textContent = row.month;
    tr.appendChild(monthCell);
    
    const consumptionCell = document.createElement('td');
    consumptionCell.textContent = row.consumption;
    tr.appendChild(consumptionCell);
    
    // Add tariff cells dynamically
    if (isPvEnabled) {
      addPvTableCells(tr, row);
    } else {
      addNoPvTableCells(tr, row);
    }
    
    fragment.appendChild(tr);
  }

  return fragment;
}

/**
 * Add table cells for PV scenario (extracted for clarity)
 */
function addPvTableCells(tr, row) {
  const cellsData = [
    row.base?.total, row.basePV?.total, Math.max(0, (row.base?.total || 0) - (row.basePV?.total || 0)),
    row.hphc?.total, row.hphcPV?.total, Math.max(0, (row.hphc?.total || 0) - (row.hphcPV?.total || 0)),
    row.tempo?.total, row.tempoPV?.total, Math.max(0, (row.tempo?.total || 0) - (row.tempoPV?.total || 0)),
    row.tempoOpt?.total, row.tempoOptPV?.total, Math.max(0, (row.tempoOpt?.total || 0) - (row.tempoOptPV?.total || 0)),
    row.tch?.total, row.tchPV?.total, Math.max(0, (row.tch?.total || 0) - (row.tchPV?.total || 0))
  ];
  
  cellsData.forEach(value => {
    const td = document.createElement('td');
    td.textContent = typeof value === 'number' ? value.toFixed(2) : value;
    if (cellsData.indexOf(value) % 3 === 2) td.className = 'text-success'; // Savings column
    tr.appendChild(td);
  });
  
  // Add diff cell
  const diffCell = document.createElement('td');
  diffCell.style.fontWeight = 'bold';
  tr.appendChild(diffCell);
}

/**
 * Add table cells for non-PV scenario
 */
function addNoPvTableCells(tr, row) {
  const cellsData = [
    row.base?.total,
    row.hphc?.total,
    row.tempo?.total,
    row.tempoOpt?.total,
    row.tch?.total
  ];
  
  cellsData.forEach(value => {
    const td = document.createElement('td');
    td.textContent = typeof value === 'number' ? value.toFixed(2) : value;
    tr.appendChild(td);
  });
  
  // Add diff cell
  const diffCell = document.createElement('td');
  diffCell.style.fontWeight = 'bold';
  tr.appendChild(diffCell);
}
