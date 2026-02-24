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
