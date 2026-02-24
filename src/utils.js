
// =========================
// Utils — fonctions pures (fusion script.js + existant)
// =========================

/**
 * Formate un nombre en chaîne localisée (fr-FR, 2 décimales)
 */
export function formatNumber(n) {
  return (Math.round(n * 100) / 100).toLocaleString('fr-FR');
}

/**
 * Formate une date en YYYY-MM-DD
 */
export function fmt(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Génère un tableau de dates ISO (YYYY-MM-DD) entre deux bornes incluses
 */
export function isoDateRange(startDate, endDate) {
  const out = [];
  let d = new Date(startDate);
  while (d <= endDate) {
    out.push(fmt(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Détermine si une heure (entier 0-23) est en Heures Creuses selon une chaîne de ranges (ex: "22-06;12:30-16")
 */
export function isHourHC(h, rangeStr) {
  if (!rangeStr) return false;
  const ranges = String(rangeStr).split(';').map(s => s.trim()).filter(Boolean);
  const hm = h * 60;
  function parseTime(tok) {
    if (!tok) return null;
    const m = tok.match(/^([0-1]?\d|2[0-3])(?::([0-5]?\d))?$/);
    if (!m) return null;
    const hh = parseInt(m[1], 10);
    const mm = m[2] != null ? parseInt(m[2], 10) : 0;
    return hh * 60 + mm;
  }
  for (const r of ranges) {
    const [a, b] = r.split('-').map(s => s.trim());
    const startM = parseTime(a);
    const endM = parseTime(b);
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
 * Normalise une chaîne de ranges HC (ex: "22-06" ou "12:30-16;03-08")
 * Retourne une chaîne normalisée ou null si invalide
 */
export function normalizeHcRange(str) {
  const raw = String(str || '').trim();
  if (!raw) return null;
  const parts = raw.split(';').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const m = p.match(/^\s*([0-1]?\d|2[0-3])(?::([0-5]?\d))?\s*-\s*([0-1]?\d|2[0-3])(?::([0-5]?\d))?\s*$/);
    if (!m) return null;
    const sh = String(m[1]).padStart(2, '0');
    const sm = m[2] != null ? String(m[2]).padStart(2, '0') : null;
    const eh = String(m[3]).padStart(2, '0');
    const em = m[4] != null ? String(m[4]).padStart(2, '0') : null;
    const startToken = sm != null ? `${sh}:${sm}` : `${sh}`;
    const endToken = em != null ? `${eh}:${em}` : `${eh}`;
    out.push(`${startToken}-${endToken}`);
  }
  return out.join(';');
}

/**
 * Extrait la clé mois (YYYY-MM) d'une date ISO ou Date
 */
export function monthKeyFromDateStr(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) {
    const p = (dateStr || '').slice(0, 7);
    return p;
  }
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Calcule les statistiques horaires à partir des records
 * Retourne: { total, avg[], min[], max[], count[] }
 */
export function computeHourlyStats(records) {
  const hours = Array.from({ length: 24 }, () => []);
  let total = 0;
  
  for (const r of records) {
    const v = Number(r.valeur);
    if (isNaN(v)) continue;
    total += v;
    
    const dt = new Date(r.dateDebut);
    if (isNaN(dt.getTime())) continue;
    
    const h = dt.getHours();
    hours[h].push(v);
  }
  
  const avg = [], min = [], max = [], count = [];
  for (let h = 0; h < 24; h++) {
    const arr = hours[h];
    if (arr.length === 0) {
      avg.push(0);
      min.push(0);
      max.push(0);
      count.push(0);
    } else {
      const s = arr.reduce((a, b) => a + b, 0);
      avg.push(s / arr.length);
      min.push(Math.min(...arr));
      max.push(Math.max(...arr));
      count.push(arr.length);
    }
  }
  
  return { total, avg, min, max, count };
}

/**
 * Génère une clé de stockage local pour un paramètre
 */
export function storageKey(k) {
  return 'comparatifElec.' + k;
}

/**
 * Sauvegarde une valeur dans localStorage (checkbox ou value)
 */
export function saveSetting(id) {
  try {
    const el = document.getElementById(id);
    if (!el) return;
    const val = (el.type === 'checkbox') ? el.checked : el.value;
    localStorage.setItem(storageKey(id), JSON.stringify(val));
  } catch (e) {}
}

/**
 * Charge une valeur depuis localStorage et l'applique à l'élément DOM
 */
export function loadSetting(id) {
  try {
    const v = localStorage.getItem(storageKey(id));
    if (v === null) return;
    const parsed = JSON.parse(v);
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = parsed;
    } else {
      el.value = parsed;
    }
  } catch (e) {}
}
