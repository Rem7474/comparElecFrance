export function formatNumber(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '0';
  return (Math.round(num * 100) / 100).toLocaleString('fr-FR');
}

export function fmt(date) {
  return date.toISOString().slice(0, 10);
}

export function isoDateRange(startDate, endDate) {
  const out = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function isHourHC(hour, rangeStr) {
  if (!rangeStr) return false;
  const ranges = String(rangeStr)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const hm = Number(hour) * 60;

  const parseTime = (token) => {
    if (!token) return null;
    const match = token.match(/^([0-1]?\d|2[0-3])(?::([0-5]?\d))?$/);
    if (!match) return null;
    const hh = Number.parseInt(match[1], 10);
    const mm = match[2] != null ? Number.parseInt(match[2], 10) : 0;
    return hh * 60 + mm;
  };

  for (const range of ranges) {
    const [startRaw, endRaw] = range.split('-').map((s) => s.trim());
    const startM = parseTime(startRaw);
    const endM = parseTime(endRaw);
    if (startM == null || endM == null) continue;
    if (startM < endM) {
      if (hm >= startM && hm < endM) return true;
    } else {
      if (hm >= startM || hm < endM) return true;
    }
  }

  return false;
}

/**
 * Extract month key from date string (YYYY-MM)
 * @param {string} dateStr - ISO date string
 * @returns {string} Month key (YYYY-MM)
 */
export function monthKeyFromDateStr(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return (dateStr || '').slice(0, 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Normalize HC range string format
 * @param {string} str - Raw HC range string
 * @returns {string|null} Normalized HC range or null if invalid
 */
export function normalizeHcRange(str) {
  const raw = String(str || '').trim();
  if (!raw) return null;
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const match = part.match(/^\s*([0-1]?\d|2[0-3])(?::([0-5]?\d))?\s*-\s*([0-1]?\d|2[0-3])(?::([0-5]?\d))?\s*$/);
    if (!match) return null;
    const sh = String(match[1]).padStart(2, '0');
    const sm = match[2] != null ? String(match[2]).padStart(2, '0') : null;
    const eh = String(match[3]).padStart(2, '0');
    const em = match[4] != null ? String(match[4]).padStart(2, '0') : null;
    const startToken = sm != null ? `${sh}:${sm}` : `${sh}`;
    const endToken = em != null ? `${eh}:${em}` : `${eh}`;
    out.push(`${startToken}-${endToken}`);
  }
  return out.join(';');
}

/**
 * Get localStorage key with app prefix
 * @param {string} key - Base key name
 * @returns {string} Prefixed storage key
 */
export function storageKey(key) {
  return `comparatifElec.${key}`;
}

/**
 * Save a form element value to localStorage
 * @param {string} id - Element ID
 */
export function saveSetting(id) {
  try {
    const el = document.getElementById(id);
    if (!el) return;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    localStorage.setItem(storageKey(id), JSON.stringify(val));
  } catch (err) {
    // ignore
  }
}

/**
 * Load a form element value from localStorage
 * @param {string} id - Element ID
 */
export function loadSetting(id) {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (raw === null) return;
    const parsed = JSON.parse(raw);
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = parsed;
    else el.value = parsed;
  } catch (err) {
    // ignore
  }
}

/**
 * Apply subscription input values to DEFAULTS configuration
 * Reads from DOM and updates DEFAULTS.subBase, DEFAULTS.hp.sub, DEFAULTS.tempo.sub
 * @param {Object} DEFAULTS - Tariff defaults to update
 * @returns {boolean} Whether any values changed
 */
export function applySubscriptionInputs(DEFAULTS) {
  const sb = document.getElementById('param-sub-base');
  const sh = document.getElementById('param-sub-hphc');
  const st = document.getElementById('param-sub-tempo');

  if (!DEFAULTS) return false;
  let changed = false;

  if (sb && sb.value) {
    const v = Number(sb.value);
    if (!Number.isNaN(v) && v >= 0 && DEFAULTS.subBase !== v) {
      DEFAULTS.subBase = v;
      changed = true;
    }
  }
  if (sh && sh.value) {
    const v = Number(sh.value);
    if (!Number.isNaN(v) && v >= 0 && (DEFAULTS.hp || {}).sub !== v) {
      if (!DEFAULTS.hp) DEFAULTS.hp = {};
      DEFAULTS.hp.sub = v;
      changed = true;
    }
  }
  if (st && st.value) {
    const v = Number(st.value);
    if (!Number.isNaN(v) && v >= 0 && (DEFAULTS.tempo || {}).sub !== v) {
      if (!DEFAULTS.tempo) DEFAULTS.tempo = {};
      DEFAULTS.tempo.sub = v;
      changed = true;
    }
  }

  return changed;
}

/**
 * Apply HC range input value to DEFAULTS configuration
 * Reads from DOM and updates DEFAULTS.hp.hcRange
 * @param {Object} DEFAULTS - Tariff defaults to update
 * @returns {boolean} Whether the value changed
 */
export function applyHcRangeInput(DEFAULTS) {
  const el = document.getElementById('param-hphc-hcRange');
  if (!el || !DEFAULTS) return false;

  const norm = normalizeHcRange(el.value);
  if (!norm) return false;

  if (!DEFAULTS.hp) DEFAULTS.hp = {};
  const before = DEFAULTS.hp.hcRange;
  DEFAULTS.hp.hcRange = norm;
  el.value = norm;

  return before !== norm;
}

/**
 * Apply Total Charge Heures input values to DEFAULTS configuration
 * Reads from DOM and updates DEFAULTS.totalChargeHeures
 * @param {Object} DEFAULTS - Tariff defaults to update
 * @returns {boolean} Whether any values changed
 */
export function applyTotalChargeHeuresInputs(DEFAULTS) {
  const hpr = document.getElementById('param-tch-hpRange');
  const hcr = document.getElementById('param-tch-hcRange');
  const hsr = document.getElementById('param-tch-hscRange');
  const sub = document.getElementById('param-sub-tch');

  if (!DEFAULTS) return false;
  let changed = false;

  if (hpr && hpr.value) {
    const v = normalizeHcRange(hpr.value);
    if (v && (DEFAULTS.totalChargeHeures || {}).hpRange !== v) {
      if (!DEFAULTS.totalChargeHeures) DEFAULTS.totalChargeHeures = {};
      DEFAULTS.totalChargeHeures.hpRange = v;
      changed = true;
    }
  }
  if (hcr && hcr.value) {
    const v = normalizeHcRange(hcr.value);
    if (v && (DEFAULTS.totalChargeHeures || {}).hcRange !== v) {
      if (!DEFAULTS.totalChargeHeures) DEFAULTS.totalChargeHeures = {};
      DEFAULTS.totalChargeHeures.hcRange = v;
      changed = true;
    }
  }
  if (hsr && hsr.value) {
    const v = normalizeHcRange(hsr.value);
    if (v && (DEFAULTS.totalChargeHeures || {}).hscRange !== v) {
      if (!DEFAULTS.totalChargeHeures) DEFAULTS.totalChargeHeures = {};
      DEFAULTS.totalChargeHeures.hscRange = v;
      changed = true;
    }
  }
  if (sub && sub.value) {
    const v = Number(sub.value);
    if (!Number.isNaN(v) && v >= 0 && (DEFAULTS.totalChargeHeures || {}).sub !== v) {
      if (!DEFAULTS.totalChargeHeures) DEFAULTS.totalChargeHeures = {};
      DEFAULTS.totalChargeHeures.sub = v;
      changed = true;
    }
  }

  return changed;
}
