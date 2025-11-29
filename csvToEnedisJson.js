// csvToEnedisJson.js — Convertisseur CSV (Énergie;Date;Consommation) vers JSON Enedis compatible
(function(){
  function trimQuotes(s){
    const t = String(s == null ? '' : s);
    if(t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))){
      return t.slice(1, -1);
    }
    return t;
  }

  function stripBOM(text){
    if(text && text.charCodeAt(0) === 0xFEFF) return text.slice(1);
    return text;
  }

  function parseCsvLines(text, delimiter){
    const D = delimiter || ';';
    const out = [];
    let cur = [];
    let field = '';
    let inQuotes = false;
    const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for(let i=0;i<s.length;i++){
      const ch = s[i];
      if(inQuotes){
        if(ch === '"'){
          const peek = s[i+1];
          if(peek === '"'){ field += '"'; i++; }
          else { inQuotes = false; }
        } else { field += ch; }
      } else {
        if(ch === '"'){ inQuotes = true; }
        else if(ch === D){ cur.push(field); field = ''; }
        else if(ch === '\n'){ cur.push(field); out.push(cur); cur = []; field = ''; }
        else { field += ch; }
      }
    }
    if(field.length>0 || cur.length>0){ cur.push(field); out.push(cur); }
    return out;
  }

  function pad2(n){ return String(n).padStart(2,'0'); }

  function toLocalIso(d){
    const y = d.getFullYear();
    const m = pad2(d.getMonth()+1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    const tzMin = -d.getTimezoneOffset();
    const sign = tzMin >= 0 ? '+' : '-';
    const abs = Math.abs(tzMin);
    const tzh = pad2(Math.floor(abs/60));
    const tzm = pad2(abs%60);
    return `${y}-${m}-${day}T${hh}:${mm}:${ss}${sign}${tzh}:${tzm}`;
  }

  function parseFrDatetime(str){
    // Expect: DD/MM/YYYY HH:mm:ss
    const m = String(str).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if(!m) return null;
    const dd = parseInt(m[1],10); const MM = parseInt(m[2],10)-1; const yyyy = parseInt(m[3],10);
    const hh = parseInt(m[4],10); const mm = parseInt(m[5],10); const ss = parseInt(m[6],10);
    const d = new Date(yyyy, MM, dd, hh, mm, ss);
    return isNaN(d.getTime()) ? null : d;
  }

  function parseConsumptionValue(s){
    // Examples: "0.991 kWh", "1,045 kWh", "991 Wh"
    const raw = String(s||'').replace(/\s+/g,' ').trim();
    const m = raw.match(/^([0-9]+[\.,]?[0-9]*)\s*(kWh|Wh)?$/i);
    if(!m){
      // try to strip trailing unit words
      const cleaned = raw.replace(/kWh|Wh|kW|W/gi,'').replace(',', '.').trim();
      const v = parseFloat(cleaned);
      return isNaN(v) ? null : v;
    }
    const num = parseFloat(m[1].replace(',', '.'));
    const unit = (m[2]||'kWh').toLowerCase();
    if(isNaN(num)) return null;
    if(unit === 'wh') return num / 1000;
    return num; // kWh by default
  }

  function detectStepMinutes(dateList){
    if(dateList.length < 2) return 60;
    const diffs = [];
    for(let i=1;i<Math.min(dateList.length, 10);i++){ diffs.push((dateList[i] - dateList[i-1]) / (1000*60)); }
    diffs.sort((a,b)=>a-b);
    const med = diffs[Math.floor(diffs.length/2)] || 60;
    if(med <= 45) return 30;
    if(med <= 90) return 60;
    return Math.round(med);
  }

  function isSupportedConsoCsv(text){
    const s = stripBOM(String(text||''));
    const firstLine = s.split(/\r?\n/)[0] || '';
    const h = firstLine.replace(/"/g,'').trim().toLowerCase();
    return h.includes('énergie') && h.includes('date') && h.includes('consommation');
  }

  function csvToEnedisJson(text){
    const raw = stripBOM(String(text||''));
    const rows = parseCsvLines(raw, ';');
    if(!rows.length) throw new Error('CSV vide');
    const header = rows[0].map(c=> trimQuotes(c).trim());
    const lower = header.map(h=> h.toLowerCase());
    const idxE = lower.findIndex(h=> h.includes('énergie') || h.includes('energie'));
    const idxD = lower.findIndex(h=> h.includes('date'));
    const idxC = lower.findIndex(h=> h.includes('consommation'));
    if(idxD < 0 || idxC < 0) throw new Error('Entêtes manquantes (Date; Consommation)');

    const items = [];
    const dates = [];
    for(let i=1;i<rows.length;i++){
      const r = rows[i]; if(!r || r.length === 0) continue;
      const dateStr = trimQuotes(r[idxD] || '').trim().replace(/^"|"$/g,'');
      const consoStr = trimQuotes(r[idxC] || '').trim();
      if(!dateStr) continue;
      const d = parseFrDatetime(dateStr);
      if(!d) continue;
      const v = parseConsumptionValue(consoStr);
      if(v == null) continue;
      dates.push(d);
      items.push({ d, valeur: v });
    }
    if(items.length === 0) throw new Error('Aucune ligne de consommation valide');

    items.sort((a,b)=> a.d - b.d);
    dates.sort((a,b)=> a - b);
    const stepMin = detectStepMinutes(dates);

    const donnees = items.map(it => {
      const start = it.d;
      const end = new Date(start.getTime() + stepMin*60*1000);
      return { dateDebut: toLocalIso(start), dateFin: toLocalIso(end), valeur: it.valeur };
    });

    const out = {
      cons: { aggregats: { heure: { unite: 'kWh', donnees } } },
      grandeurMetier: 'CONS',
      grandeurPhysique: 'PA',
      dateDebut: toLocalIso(dates[0]).slice(0,10),
      dateFin: toLocalIso(dates[dates.length-1]).slice(0,10)
    };
    return out;
  }

  window.csvToEnedisJson = csvToEnedisJson;
  window.isSupportedConsoCsv = isSupportedConsoCsv;
})();
