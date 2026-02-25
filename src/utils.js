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
