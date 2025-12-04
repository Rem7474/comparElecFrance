// script.js — logique d'analyse JSON (consommation horaire), génération du script console Enedis,
// récupération des couleurs Tempo (API + cache localStorage), simulation tarifs & photovoltaïque.
(function(){
  const prmInput = document.getElementById('input-prm');
  const dateInput = document.getElementById('input-date');
  const logEl = document.getElementById('download-log');

  const fileInput = document.getElementById('file-input');
  const btnGenerateCsv = document.getElementById('btn-generate-csv');

  // File Drop Zone UI Logic
  const dropZone = document.getElementById('drop-zone');
  const dropZoneText = document.getElementById('drop-zone-text');
  const dropZoneSub = document.getElementById('drop-zone-subtext');
  
  if(fileInput && dropZone){
    fileInput.addEventListener('change', ()=>{
      if(fileInput.files && fileInput.files.length > 0){
        dropZone.classList.add('has-file');
        dropZoneText.textContent = fileInput.files[0].name;
        dropZoneSub.textContent = 'Fichier prêt pour l\'analyse';
        const icon = dropZone.querySelector('.file-drop-zone-icon');
        if(icon) icon.textContent = '✅';
      } else {
        dropZone.classList.remove('has-file');
        dropZoneText.textContent = 'Cliquez ou glissez le fichier ici';
        dropZoneSub.textContent = 'Formats acceptés : .json (Enedis) ou .csv';
        const icon = dropZone.querySelector('.file-drop-zone-icon');
        if(icon) icon.textContent = '📂';
      }
    });

    // Drag and drop visual effects
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      }, false);
    });
  }

  // Theme handling
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  function applyTheme(isDark) {
    if (isDark) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }
  // Init theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    applyTheme(true);
  } else if (savedTheme === 'light') {
    applyTheme(false);
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    applyTheme(true); // default to system preference if no saved setting
  }
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      const isDark = document.body.classList.contains('dark-mode');
      applyTheme(!isDark);
    });
  }
  
  // Tempo loading UI
  const tempoLoading = { container: document.getElementById('tempo-loading'), fill: null, text: null, total: 0, done: 0 };
  try{ tempoLoading.fill = document.getElementById('tempo-loading-fill'); tempoLoading.text = document.getElementById('tempo-loading-text'); }catch(e){}

  // Default tariffs and settings (centralized here — these values are used for comparisons)
  const DEFAULTS = {
    priceBase: 0.1952,
    subBase: 19.39,
    hp: { php: 0.2081, phc: 0.1635, hcRange: '22-06', sub: 19.81 },
  tempo: {
      blue: { hp: 0.1494, hc: 0.1232 },
      white: { hp: 0.1730, hc: 0.1391 },
      red: { hp: 0.6468, hc: 0.1460 },
      sub: 19.49,
      hcRange: '22-06',
      approxPct: { B:0.80, W:0.15, R:0.05 }
    },
  injectionPrice: 0,
    // monthly weights for PV distribution (normalized internally)
    monthlySolarWeightsRaw: [0.6,0.7,0.9,1.1,1.2,1.3,1.3,1.2,1.0,0.8,0.6,0.5],
    tempoApi: {
      enabled: true,
      baseUrl: 'https://www.api-couleur-tempo.fr/api',
      perDayThrottleMs: 120,
      concurrency: 6,
      storageKey: 'comparatifElec.tempoDayMap'
    }
  };
  // normalized weights cached
  DEFAULTS.monthlySolarWeights = (function(){ const s = DEFAULTS.monthlySolarWeightsRaw.reduce((a,b)=>a+b,0); return DEFAULTS.monthlySolarWeightsRaw.map(v=> v / s); })();

  function log(msg){
    logEl.textContent = msg;
  }

  function appendLog(el, msg){
    el.textContent = (el.textContent ? el.textContent + '\n' : '') + msg;
  }

  function showTempoLoading(total){
    if(!tempoLoading || !tempoLoading.container) return;
    tempoLoading.total = total||0; tempoLoading.done = 0;
    tempoLoading.container.style.display = 'block';
    if(tempoLoading.fill) tempoLoading.fill.style.width = '0%';
    if(tempoLoading.text) tempoLoading.text.textContent = total>0 ? `Chargement des jours Tempo… 0/${total}` : 'Chargement des jours Tempo…';
  }
  function updateTempoLoading(done, total){
    if(!tempoLoading || !tempoLoading.container) return;
    tempoLoading.done = done; tempoLoading.total = total||tempoLoading.total;
    const pct = (tempoLoading.total>0) ? Math.min(100, Math.round((done/tempoLoading.total)*100)) : 0;
    if(tempoLoading.fill) tempoLoading.fill.style.width = pct + '%';
    if(tempoLoading.text) tempoLoading.text.textContent = `Chargement des jours Tempo… ${done}/${tempoLoading.total}`;
  }
  function hideTempoLoading(){
    if(!tempoLoading || !tempoLoading.container) return;
    tempoLoading.container.style.display = 'none';
  }



  // format date YYYY-MM-DD
  function fmt(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  // set default reference date to today on load if the input is present and empty
  try{
    if(typeof dateInput !== 'undefined' && dateInput && !dateInput.value){
      dateInput.value = fmt(new Date());
    }
  }catch(e){ /* no-op if dateInput missing */ }

  // New helper: generate a console script that obtains personId from the userinfos endpoint
  // and then fetches the JSON hourly endpoints for the provided PRM and week ranges.
  function generateConsoleSnippetForPrm(prm, dateRef){
    const code = [];
    code.push('(async function(){');
    code.push("  try{");
  code.push("    // retrieve personId from the authenticated session (mon-compte)");
  code.push("    const uiResp = await fetch('https://alex.microapplications.enedis.fr/mon-compte/api/private/v2/userinfos?espace=PARTICULIER', {credentials:'include'}); const ui = await uiResp.json();");
    code.push("    console.log('userinfos:', ui);");
    code.push("    const personId = (ui && ui.idPersonne) ? String(ui.idPersonne) : null; if(!personId) console.warn('idPersonne not found in /mon-compte userinfos response'); else console.log('idPersonne trouvé:', personId);");
    code.push("    const prm = '"+String(prm).replace(/'/g,"\\'")+"';");
    // Build weekly dateDebut strings inside the generated script to keep the snippet short
    code.push("    // build 52 weekly dateDebut values based on a reference date");
    code.push("    const dateRef = '"+String(dateRef).replace(/'/g,"\\'")+"';");
    code.push("    function _fmt(d){ return d.toISOString().slice(0,10); }");
    code.push("    const start = new Date(dateRef); start.setHours(0,0,0,0);");
    code.push("    const dateDebuts = []; for(let i=0;i<52;i++){ const sd = new Date(start); sd.setDate(start.getDate()-7*i); dateDebuts.push(_fmt(sd)); }");
    code.push("    const combined = []; let meta = null;");
    code.push("    console.log('Weeks to fetch: ' + dateDebuts.length);");
    code.push("    for(let i=0;i<dateDebuts.length;i++){");
    code.push("      const ds = dateDebuts[i];");
    code.push("      try{");
    code.push("        console.log(`Fetching ${i+1}/${dateDebuts.length} (dateDebut=${ds})`);");
    code.push("        const qs = `mesuresTypeCode=COURBE&mesuresCorrigees=false&typeDonnees=CONS&dateDebut=${ds}&segments=C5`;");
    code.push("        const url = personId ? `https://alex.microapplications.enedis.fr/mes-mesures-prm/api/private/v2/personnes/${personId}/prms/${prm}/donnees-energetiques?${qs}` : `https://alex.microapplications.enedis.fr/mes-mesures-prm/api/private/v2/prms/${prm}/donnees-energetiques?${qs}`;");
    code.push("        const r = await fetch(url, {credentials:'include'});");
    code.push("        let j = null; try{ j = await r.json(); }catch(e){ const t = await r.text(); try{ j = JSON.parse(t); }catch(e2){ j = null; } }");
    code.push("        if(j && j.cons && j.cons.aggregats && j.cons.aggregats.heure && Array.isArray(j.cons.aggregats.heure.donnees)){");
    code.push("          const arr = j.cons.aggregats.heure.donnees; console.log(`Success ${i+1}/${dateDebuts.length}: ${arr.length} records`); if(!meta){ meta = { unite: (j.cons.aggregats.heure.unite||null), grandeurMetier: j.grandeurMetier||null, grandeurPhysique: j.grandeurPhysique||null }; } for(const it of arr) combined.push(it); }");
    code.push("        else { console.warn(`No hourly data for ${i+1}/${dateDebuts.length} (dateDebut=${ds})`); }");
    code.push("      }catch(e){ console.error('fetch error at index ' + i, e); }");
    code.push("      await new Promise(r=>setTimeout(r,200));");
    code.push("    }");
  code.push("    combined.sort((a,b)=> new Date(a.dateDebut) - new Date(b.dateDebut));");
  code.push("    const dedup = []; const seen = new Set(); for(const r of combined){ if(r && r.dateDebut && !seen.has(r.dateDebut)){ dedup.push(r); seen.add(r.dateDebut); } }");
  code.push("    console.log('Preparing download with ' + dedup.length + ' records');");
  code.push("    const out = { cons: { aggregats: { heure: { donnees: dedup, unite: (meta && meta.unite) || 'kW' } } }, grandeurMetier: (meta && meta.grandeurMetier) || 'CONS', grandeurPhysique: (meta && meta.grandeurPhysique) || 'PA', dateDebut: (dedup.length? dedup[0].dateDebut.slice(0,10): null), dateFin: (dedup.length? dedup[dedup.length-1].dateFin.slice(0,10): null) };");
  code.push("    const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'consommation_annee.json'; document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();");
    code.push("  }catch(e){ console.error('Erreur globale', e); } })();");
    return code.join('\n');
  }

  // Generate JSON URLs and show console script — separate button
  if(btnGenerateCsv){
    btnGenerateCsv.addEventListener('click', ()=>{
      const prm = prmInput.value.trim();
      if(!prm){ alert('Veuillez saisir le PRM.'); return; }
      const dateRef = dateInput.value ? new Date(dateInput.value).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
      // generate and show a console script that will retrieve personId from /mon-compte and fetch the JSON weekly endpoints
      const scriptArea = document.getElementById('console-script');
      if(scriptArea){
        const scriptText = generateConsoleSnippetForPrm(prm, dateRef);
        scriptArea.value = scriptText;
        const scriptBlock = document.getElementById('script-area'); if(scriptBlock) scriptBlock.style.display = 'block';
        // try to copy to clipboard automatically
        (async ()=>{
          try{
            if(navigator.clipboard && navigator.clipboard.writeText){
              await navigator.clipboard.writeText(scriptText);
              appendLog(logEl, 'Script console généré et copié dans le presse-papiers. Collez-le dans la console d\'Enedis (F12 → Console).');
            } else {
              // fallback: select and execCommand
              scriptArea.select();
              const ok = document.execCommand && document.execCommand('copy');
              if(ok) appendLog(logEl, 'Script console copié (fallback). Collez-le dans la console d\'Enedis.');
              else appendLog(logEl, 'Script généré mais impossible de le copier automatiquement — copiez-le manuellement depuis la zone de script.');
            }
          }catch(e){
            appendLog(logEl, 'Échec copie automatique du script: ' + (e && e.message));
          }
        })();
      }
      else {
        appendLog(logEl, 'Script généré mais zone introuvable — copiez-le manuellement.');
      }
    });
  }

  // Analyze files (JSON only) and render hourly chart
  const analysisLog = document.getElementById('analysis-log');
  const summaryMetrics = document.getElementById('summary-metrics');
  const hourlyCanvas = document.getElementById('hourly-chart');
  let hourlyChart = null;

  function appendAnalysisLog(msg){ appendLog(analysisLog, msg); }

  // normalize uploaded files into records array: {dateDebut, dateFin, valeur: number}
  async function parseFilesToRecords(fileList){
    const records = [];
    for(const f of fileList){
      const name = (f.name||'').toLowerCase();
      appendAnalysisLog('Lecture: ' + f.name);
      try{
        if(name.endsWith('.json') || f.type.includes('json') || name.endsWith('.txt')){
          const txt = await f.text();
          let j = null; try{ j = JSON.parse(txt); }catch(e){ appendAnalysisLog(`${f.name} n'est pas un JSON valide — ignoré.`); continue; }
          const donnees = (((j||{}).cons||{}).aggregats||{}).heure && (((j||{}).cons||{}).aggregats||{}).heure.donnees;
          if(Array.isArray(donnees)){
            for(const rec of donnees){ const val = Number(rec.valeur); if(isNaN(val)) continue; records.push({dateDebut: rec.dateDebut, dateFin: rec.dateFin, valeur: val}); }
          } else { appendAnalysisLog(`Aucune donnée horaire trouvée dans ${f.name}`); }
        } else if(name.endsWith('.csv') || (f.type && f.type.toLowerCase().includes('csv'))){
          const txt = await f.text();
          try{
            if(typeof window.csvToEnedisJson !== 'function') throw new Error('convertisseur CSV indisponible');
            const j = window.csvToEnedisJson(txt);
            const donnees = (((j||{}).cons||{}).aggregats||{}).heure && (((j||{}).cons||{}).aggregats||{}).heure.donnees;
            if(Array.isArray(donnees)){
              for(const rec of donnees){ const val = Number(rec.valeur); if(isNaN(val)) continue; records.push({dateDebut: rec.dateDebut, dateFin: rec.dateFin, valeur: val}); }
              appendAnalysisLog(`Converti depuis CSV: ${donnees.length} enregistrements`);
            } else {
              appendAnalysisLog(`CSV non reconnu: aucune donnée horaire trouvée dans ${f.name}`);
            }
          }catch(e){ appendAnalysisLog(`Erreur conversion CSV (${f.name}): ${e && e.message ? e.message : e}`); }
        } else {
          appendAnalysisLog(`${f.name} ignoré (formats supportés: JSON/CSV).`);
        }
      }catch(err){ appendAnalysisLog('Erreur lecture ' + f.name + ': ' + err.message); }
    }
    // sort and dedupe by dateDebut
    records.sort((a,b)=> new Date(a.dateDebut) - new Date(b.dateDebut));
    const dedup = []; const seen = new Set();
    for(const r of records){ if(r && r.dateDebut && !seen.has(r.dateDebut)){ dedup.push(r); seen.add(r.dateDebut); } }
    appendAnalysisLog(`Total enregistrements valides: ${dedup.length}`);
    return dedup;
  }

  function computeHourlyStats(records){
    // records: [{dateDebut, dateFin, valeur}]
    const hours = Array.from({length:24}, ()=>[]);
    let total = 0;
    for(const r of records){ const v = Number(r.valeur); if(isNaN(v)) continue; total += v; const dt = new Date(r.dateDebut); if(isNaN(dt.getTime())) continue; const h = dt.getHours(); hours[h].push(v); }
    const avg = []; const min = []; const max = []; const count = [];
    for(let h=0;h<24;h++){ const arr = hours[h]; if(arr.length===0){ avg.push(0); min.push(0); max.push(0); count.push(0); } else { const s = arr.reduce((a,b)=>a+b,0); avg.push(s/arr.length); min.push(Math.min(...arr)); max.push(Math.max(...arr)); count.push(arr.length); } }
    return {total, avg, min, max, count};
  }

  function formatNumber(n){ return (Math.round(n*100)/100).toLocaleString('fr-FR'); }

  function renderHourlyChart(stats){
    const labels = Array.from({length:24}, (_,i)=> String(i).padStart(2,'0') + 'h');
    const ctx = hourlyCanvas.getContext('2d');
    if(hourlyChart){ hourlyChart.destroy(); hourlyChart = null; }
    hourlyChart = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Moyenne (kWh)', data: stats.avg, backgroundColor: 'rgba(54,162,235,0.6)', yAxisID: 'y' },
          { type: 'line', label: 'Min (kWh)', data: stats.min, borderColor: 'rgba(75,192,192,0.9)', borderWidth: 2, fill:false, yAxisID: 'y' },
          { type: 'line', label: 'Max (kWh)', data: stats.max, borderColor: 'rgba(255,99,132,0.9)', borderWidth: 2, fill:false, yAxisID: 'y' }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'kWh' } } }
      }
    });
  }

  // render a pie chart showing HP vs HC consumption share
  function renderHpHcPie(records){
    try{
      const hcRange = (DEFAULTS.hp && DEFAULTS.hp.hcRange) || '22-06';
      let hpTotal = 0, hcTotal = 0;
      for(const r of records){ const v = Number(r.valeur)||0; const h = new Date(r.dateDebut).getHours(); if(isHourHC(h, hcRange)) hcTotal += v; else hpTotal += v; }
      const canvas = document.getElementById('hp-hc-pie'); if(!canvas) return;
      const ctx = canvas.getContext('2d'); if(window.hpHcPieChart){ window.hpHcPieChart.destroy(); window.hpHcPieChart = null; }
      const total = hpTotal + hcTotal;
      const hpPct = total > 0 ? Math.round((hpTotal / total) * 1000) / 10 : 0; // one decimal
      const hcPct = total > 0 ? Math.round((hcTotal / total) * 1000) / 10 : 0;
      window.hpHcPieChart = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: [`HP (${hpPct}%)`, `HC (${hcPct}%)`],
          datasets: [{ data: [hpTotal, hcTotal], backgroundColor: ['#4e79a7','#f28e2b'] }]
        },
        options:{
          responsive:true,
          plugins:{
            tooltip:{
              callbacks:{
                label: (ctx)=>{
                  try{
                    const val = Number(ctx.parsed) || 0;
                    const tot = (ctx.dataset.data||[]).reduce((a,b)=> a + (Number(b)||0), 0);
                    const pct = tot > 0 ? (val / tot * 100) : 0;
                    const pctTxt = `${pct.toFixed(1)}%`;
                    return `${ctx.label}: ${formatNumber(val)} kWh (${pctTxt})`;
                  }catch(e){ return ctx.label; }
                }
              }
            }
          }
        }
      });
    }catch(e){ console.warn('Erreur rendu HP/HC pie', e); }
  }

  async function analyzeFilesNow(files){
    if(!files || files.length===0){ alert('Veuillez sélectionner un fichier JSON via le contrôle de fichiers.'); return; }
    
    // Show Dashboard
    const dashboard = document.getElementById('dashboard-section');
    if(dashboard) dashboard.classList.remove('hidden');

    appendAnalysisLog('Démarrage de l\'analyse...');
    try{
      const records = await parseFilesToRecords(files);
      if(!records || records.length===0){ appendAnalysisLog('Aucune donnée valide trouvée pour l\'analyse.'); return; }
      
      const stats = computeHourlyStats(records);
      
      // Update Dashboard Metric: Total Conso
      const totalConsoEl = document.getElementById('val-total-conso');
      if(totalConsoEl) totalConsoEl.textContent = formatNumber(stats.total) + ' kWh';

      renderHourlyChart(stats);
      try{ renderHpHcPie(records); }catch(e){}
      appendAnalysisLog('Analyse terminée.');
      try{
        const tempoMap = await ensureTempoDayMap(records);
        try{ const dailyCostMap = computeDailyTempoCostMap(records, tempoMap); renderTempoCalendarGraph(tempoMap, dailyCostMap); }catch(e){}
        // ... existing tempo diagnostics ...
      }catch(e){ console.warn('Erreur génération calendrier TEMPO automatique', e); }
      
      // Trigger offers comparison to populate cost
      setTimeout(()=>{ try{ const btn = document.getElementById('btn-compare-offers'); if(btn) btn.click(); }catch(e){} }, 100);

    }catch(err){ appendAnalysisLog('Erreur d\'analyse: ' + err.message); }
  }


  // Tariff functions now use DEFAULTS. The UI inputs for tariffs were removed — defaults live in the script.
  function isHourHC(h, rangeStr){
    // Support multiple ranges separated by ';' and optional minutes: HH or HH:MM
    if(!rangeStr) return false;
    const ranges = String(rangeStr).split(';').map(s=> s.trim()).filter(Boolean);
    // convert hour h to minutes since 00:00
    const hm = h * 60;
    function parseTime(tok){
      if(!tok) return null;
      const m = tok.match(/^([0-1]?\d|2[0-3])(?::([0-5]?\d))?$/);
      if(!m) return null;
      const hh = parseInt(m[1],10);
      const mm = m[2] != null ? parseInt(m[2],10) : 0;
      return hh*60 + mm;
    }
    for(const r of ranges){
      const [a,b] = r.split('-').map(s=> s.trim());
      const startM = parseTime(a);
      const endM = parseTime(b);
      if(startM == null || endM == null) continue;
      if(startM < endM){
        // simple interval [start, end)
        if(hm >= startM && hm < endM) return true;
      } else {
        // wraps midnight: [start, 24:00) or [00:00, end)
        if(hm >= startM || hm < endM) return true;
      }
    }
    return false;
  }

  // Generate a default full Tempo calendar map between two dates using approxPct
  function generateDefaultTempoCalendar(startDate, endDate, approxPct){
    // Build calendars for each TEMPO season that intersects the requested range.
    console.debug('generateDefaultTempoCalendar called', startDate, endDate);
    // Determine seasons to cover from startDate..endDate
    const startYear = (startDate.getMonth() >= 8) ? startDate.getFullYear() : (startDate.getFullYear() - 1);
    const endYear = (endDate.getMonth() >= 8) ? endDate.getFullYear() : (endDate.getFullYear() - 1);

    // helper functions
    function easterDate(year){
      const a = year % 19;
      const b = Math.floor(year / 100);
      const c = year % 100;
      const d = Math.floor(b / 4);
      const e = b % 4;
      const f = Math.floor((b + 8) / 25);
      const g = Math.floor((b - f + 1) / 3);
      const h = (19 * a + b - d - g + 15) % 30;
      const i = Math.floor(c / 4);
      const k = c % 4;
      const l = (32 + 2 * e + 2 * i - h - k) % 7;
      const m = Math.floor((a + 11 * h + 22 * l) / 451);
      const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
      const day = ((h + l - 7 * m + 114) % 31) + 1;
      return new Date(year, month, day);
    }
    function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate() + n); return r; }
    function formatYMD(d){ return d.toISOString().slice(0,10); }
    function isHoliday(d){
      const y = d.getFullYear();
      const fixed = [ `${y}-01-01`, `${y}-05-01`, `${y}-05-08`, `${y}-07-14`, `${y}-08-15`, `${y}-11-01`, `${y}-11-11`, `${y}-12-25` ];
      if(fixed.includes(formatYMD(d))) return true;
      const e = easterDate(y);
      const easterMon = addDays(e, 1);
      const asc = addDays(e, 39);
      const pent = addDays(e, 50);
      const movables = [formatYMD(easterMon), formatYMD(asc), formatYMD(pent)];
      return movables.includes(formatYMD(d));
    }

    const overallMap = {};
    // iterate seasons
    for(let sy = startYear; sy <= endYear; sy++){
      const seasonStart = new Date(sy,8,1); // Sept 1 sy
      const seasonEnd = new Date(sy+1,7,31); // Aug 31 sy+1
      const allDays = isoDateRange(seasonStart, seasonEnd);

      // red window Nov 1 sy -> Mar 31 sy+1 (primary candidates for red days)
      const redWindowStart = new Date(sy,10,1);
      const redWindowEnd = new Date(sy+1,2,31);
      const redCandidates = [];
      // build red window days and intersect with the season span (and global start/end bounds)
      const redWindowDays = isoDateRange(redWindowStart, redWindowEnd);
      for(const ds of redWindowDays){ const d = new Date(ds); if(d < startDate || d > endDate) return; const wd = d.getDay(); if(wd === 0 || wd === 6) continue; if(isHoliday(d)) continue; redCandidates.push(ds); }

      // white window Nov 1 -> Apr 30 (remaining candidates for white)
      const whiteWindowStart = new Date(sy,10,1); // Nov 1
      const whiteWindowEnd = new Date(sy+1,3,30); // Apr 30 next year
      const whiteWindowDays = isoDateRange(whiteWindowStart, whiteWindowEnd);
      const whiteCandidates = [];
      for(const ds of whiteWindowDays){ const d = new Date(ds); if(d < startDate || d > endDate) return; const wd = d.getDay(); if(wd === 0) continue; whiteCandidates.push(ds); }

      // Determine desired counts using approxPct (fallback to DEFAULTS if not provided)
      const approx = approxPct || (DEFAULTS && DEFAULTS.tempo && DEFAULTS.tempo.approxPct) || { B:0.8, W:0.15, R:0.05 };
      // For the red window, compute how many red days we should aim for
      const availableRed = redCandidates.length;
      let desiredReds = Math.max(0, Math.min(availableRed, Math.round(availableRed * (approx.R || 0))));
      // if approximate yields zero but there are some candidates, keep a small number (min 1) to avoid completely empty red set when approximate is very small
      if(desiredReds === 0 && availableRed > 0) desiredReds = Math.min(22, availableRed);

      // pick red days roughly spread across the redCandidates list
      const redDays = [];
      if(desiredReds > 0){
        const strideR = Math.max(1, Math.floor(redCandidates.length / desiredReds));
        for(let i=0; redDays.length < desiredReds && i < redCandidates.length; i += strideR){ redDays.push(redCandidates[i]); }
        // fill if still short
        let ii = 0; while(redDays.length < desiredReds && ii < redCandidates.length){ const c = redCandidates[ii++]; if(!redDays.includes(c)) redDays.push(c); }
      }

      const redSet = new Set(redDays);

      // For whites, exclude red days and weekends (Sunday)
      const whiteCandidatesFiltered = whiteCandidates.filter(ds => { const d = new Date(ds); const wd = d.getDay(); if(wd === 0 || wd === 6) return false; if(redSet.has(ds)) return false; return true; });
      const availableWhite = whiteCandidatesFiltered.length;
      let desiredWhites = Math.max(0, Math.round(availableWhite * (approx.W || 0)));
      if(desiredWhites === 0 && availableWhite > 0) desiredWhites = Math.min(43, availableWhite);
      const whites = [];
      if(availableWhite > 0 && desiredWhites > 0){
        const strideW = Math.max(1, Math.floor(availableWhite / desiredWhites));
        for(let i=0; whites.length < desiredWhites && i < whiteCandidatesFiltered.length; i += strideW){ whites.push(whiteCandidatesFiltered[i]); }
        let j = 0; while(whites.length < desiredWhites && j < whiteCandidatesFiltered.length){ const c = whiteCandidatesFiltered[j++]; if(!whites.includes(c)) whites.push(c); }
      }

      // assign to overall map
      for(const ds of allDays){ if(!(ds in overallMap)) overallMap[ds] = 'B'; }
      for(const r of redDays) overallMap[r] = 'R';
      for(const w of whites) overallMap[w] = 'W';
    }

    // finally, restrict map to the requested startDate..endDate range (inclusive)
    const fullRange = isoDateRange(startDate, endDate);
    const finalMap = {};
    for(const d of fullRange){ finalMap[d] = overallMap[d] || 'B'; }
    return finalMap;
  }

  // Tempo cost: use calendar if provided in textarea, otherwise use DEFAULTS.tempo.approxPct
  function calculateTariffCostTempo(records){
  // Génère un calendrier à la volée à partir des données si absent
  let dayMap = null;
    let cost = 0; let cb=0, cw=0, cr=0;

    function colorLetterToKey(letter){
      if(!letter) return 'blue';
      const L = String(letter).toUpperCase(); if(L === 'B') return 'blue'; if(L === 'W') return 'white'; if(L === 'R') return 'red'; return String(letter).toLowerCase();
    }

    function getRatesForColor(col, entry){
      // entry may include .rates = { hp, hc }
      if(entry && entry.rates && typeof entry.rates === 'object'){
        return { hp: Number(entry.rates.hp)||0, hc: Number(entry.rates.hc)||0 };
      }
      const key = colorLetterToKey(col);
      const def = DEFAULTS.tempo && DEFAULTS.tempo[key];
      if(def && typeof def === 'object'){ return { hp: Number(def.hp)||0, hc: Number(def.hc)||0 }; }
      // fallback: single price for color — use same for hp and hc
      const single = (DEFAULTS.tempo && DEFAULTS.tempo[key]) || 0;
      return { hp: Number(single)||0, hc: Number(single)||0 };
    }

    if(!dayMap){
      // use cached map if available (possibly hydrated from API), else fallback to local generator
      try{ if(__tempoDayMapCache && typeof __tempoDayMapCache === 'object'){ dayMap = __tempoDayMapCache; } else { dayMap = generateTempoCalendarAlgorithm(records); } }catch(e){ dayMap = null; }
    }

    // Helper: TEMPO day segmentation (starts at 06:00)
    function getTempoContextForHour(dateStr, hour){
      // Returns { bucketDateStr, colorLetter, isHC }
      const d = new Date(dateStr);
      function ymd(dt){ return dt.toISOString().slice(0,10); }
      if(hour < 6){
        const prev = new Date(d); prev.setDate(prev.getDate()-1);
        const bucket = ymd(prev);
        const entry = dayMap[bucket] || 'B';
        const col = (typeof entry === 'string') ? entry.toUpperCase() : ((entry && entry.color) ? String(entry.color).toUpperCase() : 'B');
        return { bucketDateStr: bucket, colorLetter: col, isHC: true };
      }
      if(hour >= 22){
        const bucket = dateStr;
        const entry = dayMap[bucket] || 'B';
        const col = (typeof entry === 'string') ? entry.toUpperCase() : ((entry && entry.color) ? String(entry.color).toUpperCase() : 'B');
        return { bucketDateStr: bucket, colorLetter: col, isHC: true };
      }
      // 06:00..21:59 => HP of current day
      const bucket = dateStr;
      const entry = dayMap[bucket] || 'B';
      const col = (typeof entry === 'string') ? entry.toUpperCase() : ((entry && entry.color) ? String(entry.color).toUpperCase() : 'B');
      return { bucketDateStr: bucket, colorLetter: col, isHC: false };
    }

    if(dayMap){
      // affichage automatique déjà géré lors de l'analyse

      for(const r of records){
        const dateStr = (r.dateDebut||'').slice(0,10);
        const h = new Date(r.dateDebut).getHours();
        const ctx = getTempoContextForHour(dateStr, h);
        const entryForBucket = dayMap[ctx.bucketDateStr] || 'B';
        const rates = getRatesForColor(ctx.colorLetter, entryForBucket);
        const applied = ctx.isHC ? rates.hc : rates.hp;
        const v = Number(r.valeur)||0;
        cost += v * applied;
        if(ctx.colorLetter === 'R') cr += v * applied;
        else if(ctx.colorLetter === 'W') cw += v * applied;
        else cb += v * applied;
      }

  return {mode:'tempo', cost, blue: cb, white: cw, red: cr, usedGeneratedCalendar: false};
    } else {
      // approximate by percentages — derive a representative price per color (average of hp/hc if structured)
      const pct = DEFAULTS.tempo.approxPct || {B:0.8,W:0.15,R:0.05};
      const totalCons = records.reduce((s,r)=> s + (Number(r.valeur)||0), 0);
      const consB = totalCons * (pct.B||0); const consW = totalCons * (pct.W||0); const consR = totalCons * (pct.R||0);
      const rBlue = (DEFAULTS.tempo.blue && typeof DEFAULTS.tempo.blue === 'object') ? DEFAULTS.tempo.blue : { hp: Number(DEFAULTS.tempo.blue)||0, hc: Number(DEFAULTS.tempo.blue)||0 };
      const rWhite = (DEFAULTS.tempo.white && typeof DEFAULTS.tempo.white === 'object') ? DEFAULTS.tempo.white : { hp: Number(DEFAULTS.tempo.white)||0, hc: Number(DEFAULTS.tempo.white)||0 };
      const rRed = (DEFAULTS.tempo.red && typeof DEFAULTS.tempo.red === 'object') ? DEFAULTS.tempo.red : { hp: Number(DEFAULTS.tempo.red)||0, hc: Number(DEFAULTS.tempo.red)||0 };
      const pBlue = (Number(rBlue.hp) + Number(rBlue.hc)) / 2; const pWhite = (Number(rWhite.hp) + Number(rWhite.hc)) / 2; const pRed = (Number(rRed.hp) + Number(rRed.hc)) / 2;
      cost = consB * pBlue + consW * pWhite + consR * pRed;
      cb = consB * pBlue; cw = consW * pWhite; cr = consR * pRed;
      return {mode:'tempo', cost, blue: cb, white: cw, red: cr, usedGeneratedCalendar: false};
    }
  }

  // --- PV simulation ---
  const pvResultsEl = document.getElementById('pv-results');
  function pvYieldPerKwp(region){
    // simplified yields (kWh/kWp/year)
    const map = { nord:700, centre:900, sud:1100 };
    return map[region] || 900;
  }
  document.getElementById('btn-calc-pv').addEventListener('click', async ()=>{
    const files = fileInput.files;
    if(!files || files.length===0){ alert('Sélectionnez d\'abord un fichier JSON via le sélecteur de fichiers.'); return; }
    
    const isPvEnabled = document.getElementById('toggle-pv') ? document.getElementById('toggle-pv').checked : true;
    
    if (!isPvEnabled) {
        // Just trigger offers update
        setTimeout(()=>{ try{ const co = document.getElementById('btn-compare-offers'); if(co) co.click(); }catch(e){} }, 100);
        setTimeout(()=>{ try{ renderMonthlyBreakdown(); }catch(e){} }, 200);
        return;
    }

    appendAnalysisLog('Estimation PV en cours...');
    const records = await parseFilesToRecords(files);
    // Ensure real Tempo colors for avoided cost calculation
    try{ await ensureTempoDayMap(records); }catch(e){ console.warn('Tempo map fetch failed in PV estimation; using fallback.', e); }
    try{ await ensureTempoDayMap(records); }catch(e){}
    if(!records || records.length===0){ appendAnalysisLog('Aucune donnée pour l\'estimation PV.'); return; }
    const stats = computeHourlyStats(records);
    const pvKwp = Number((document.getElementById('pv-kwp')||{}).value) || 0;
    const region = (document.getElementById('pv-region')||{}).value || 'centre';
    const standbyW = Number((document.getElementById('pv-standby')||{}).value) || 0;
    const yield = pvYieldPerKwp(region);
    const annualProduction = pvKwp * yield; // kWh
    const exportPrice = Number(DEFAULTS.injectionPrice) || 0;

    // simulate PV with standby-aware allocation
    const pvSim = simulatePVEffect(records, annualProduction, exportPrice, standbyW);
    const estimatedPct = annualProduction > 0 ? (pvSim.selfConsumed / annualProduction * 100) : 0;

    // Update Dashboard Metric
    const pvProdEl = document.getElementById('val-pv-prod');
    if(pvProdEl) pvProdEl.textContent = formatNumber(annualProduction) + ' kWh';

    // Render injected vs consumed (monthly) chart in PV results
    try{
      const container = document.getElementById('pv-chart-container');
      if(container) {
          container.innerHTML = '<canvas id="pv-power-chart" style="max-width:100%; max-height:300px;"></canvas>';
          const pc = document.getElementById('pv-power-chart');
          
          // use monthly breakdown to compute exported (injected) per month and consumption
          const monthly = computeMonthlyBreakdown(records);
          const mlabels = monthly.map(m=> m.month);
          const productionSeries = monthly.map(m=> Number(m.monthPV || 0));
          const autoconsumedSeries = monthly.map(m=> Number(m.monthSelf || 0));
          const injectedSeries = monthly.map(m=> Math.max(0, Number((m.monthPV || 0) - (m.monthSelf || 0))));
          
          if(window.pvPowerChart){ window.pvPowerChart.destroy(); window.pvPowerChart = null; }
          const ctxp = pc.getContext('2d');
          window.pvPowerChart = new Chart(ctxp, {
            type: 'bar',
            data: { labels: mlabels, datasets: [
              { label: 'Production PV (kWh)', data: productionSeries, backgroundColor: '#f1c40f' },
              { label: 'Autoconsommation (kWh)', data: autoconsumedSeries, backgroundColor: '#4e79a7' },
              { label: 'Injection (kWh)', data: injectedSeries, backgroundColor: '#ff9f43' }
            ] },
            options: { responsive:true, scales: { y: { beginAtZero:true, title: { display:true, text: 'kWh' } } } }
          });
      }
    }catch(e){ console.warn('Erreur rendu graphique PV puissance', e); }

    // Trigger update of comparison charts (offers & monthly breakdown) to reflect new PV settings
    setTimeout(()=>{ try{ const co = document.getElementById('btn-compare-offers'); if(co) co.click(); }catch(e){} }, 100);
    setTimeout(()=>{ try{ renderMonthlyBreakdown(); }catch(e){} }, 200);
  });

  // Export computed report (JSON)
  document.getElementById('btn-export-report').addEventListener('click', async ()=>{
    const files = fileInput.files;
  if(!files || files.length===0){ alert('Sélectionnez d\'abord un fichier JSON via le sélecteur de fichiers.'); return; }
    appendAnalysisLog('Génération du rapport...');
    const records = await parseFilesToRecords(files);
    const stats = computeHourlyStats(records);
    const report = { generatedAt: new Date().toISOString(), summary: { totalConsumption: stats.total }, hourly: { avg: stats.avg, min: stats.min, max: stats.max } };
    const blob = new Blob([JSON.stringify(report, null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'rapport_conso.json'; document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();
    appendAnalysisLog('Rapport téléchargé.');
  });

  // --- Compare offers (Base vs HP/HC) and PV effect ---
  const offersResultsEl = document.getElementById('offers-results');
  const offersCanvas = document.getElementById('offers-chart');
  let offersChart = null;

  // simple PV hourly profile (normalized) — peak at midday
  const pvProfile = [0,0,0,0,0.005,0.02,0.05,0.09,0.12,0.14,0.15,0.13,0.1,0.06,0.04,0.02,0.01,0,0,0,0,0,0,0];
  const pvNorm = (function(){ const s = pvProfile.reduce((a,b)=>a+b,0); return pvProfile.map(v=> v/s); })();
  const monthlySolarWeights = DEFAULTS.monthlySolarWeights;

  // ----- Monthly breakdown and localStorage persistence -----
  function monthKeyFromDateStr(dateStr){ // dateStr like 2024-01-01T... or 2024-01-01
    const d = new Date(dateStr);
    if(isNaN(d)){
      // try simple prefix
      const p = (dateStr||'').slice(0,7);
      return p;
    }
    const y = d.getFullYear(); const m = (d.getMonth()+1).toString().padStart(2,'0');
    return `${y}-${m}`;
  }

  function computeCostBaseForRecords(records){ const p = Number(DEFAULTS.priceBase)||0; return records.reduce((s,r)=> s + (Number(r.valeur)||0) * p, 0); }
  function computeCostHPHCForRecords(records){ const php = Number(DEFAULTS.hp.php)||0; const phc = Number(DEFAULTS.hp.phc)||0; const hcRange = (DEFAULTS.hp.hcRange||'22-06'); let hp=0,hc=0; for(const r of records){ const v = Number(r.valeur)||0; const h = new Date(r.dateDebut).getHours(); if(isHourHC(h,hcRange)){ hc += v * phc; } else { hp += v * php; } } return { cost: hp+hc, hp, hc } }
  function computeCostTempoForRecords(records){ const res = calculateTariffCostTempo(records); return res; }

  // build reduced copy of records with consumption reduced by 'reduction' kWh distributed proportionally across records in the month
  function applyMonthlyReduction(records, reduction){ const total = records.reduce((s,r)=> s + (Number(r.valeur)||0), 0); if(total<=0) return records.map(r=> ({...r})); const factor = Math.max(0, (total - reduction)) / total; return records.map(r=> ({ ...r, valeur: (Number(r.valeur)||0) * factor })); }

  function computeMonthlyBreakdown(records){
    // group by month
    const months = {};
    for(const r of records){ const k = monthKeyFromDateStr(r.dateDebut); if(!months[k]) months[k]=[]; months[k].push(r); }
    const keys = Object.keys(months).sort();
    const annualProduction = (Number(document.getElementById('pv-kwp').value)||0) * pvYieldPerKwp((document.getElementById('pv-region')||{}).value||'centre');
    const selfPct = Math.min(100, Math.max(0, Number((document.getElementById('pv-self')||{}).value)||0));
  const exportPrice = Number(DEFAULTS.injectionPrice) || 0.06;
    const results = [];
    // for mapping month index to weight, compute months present and map to month index (1-12)
    for(const k of keys){
      const recs = months[k];
      const totalKwh = recs.reduce((s,r)=> s + (Number(r.valeur)||0), 0);
      // determine month index
      const parts = k.split('-'); const monthIdx = (parts.length>1)? (Number(parts[1]) - 1) : 0;
        const monthPV = annualProduction * (monthlySolarWeights[monthIdx] || (1/12));
      // estimate month self-consumption either from manual percent or from standby-based simulation
  const standbyW = Number((document.getElementById('pv-standby')||{}).value) || 0;
  const monthSim = simulatePVEffect(recs, monthPV, exportPrice, standbyW);
      const estimatedMonthSelf = Math.min(monthSim.selfConsumed, totalKwh, monthPV);
      const manualMonthSelf = Math.min(monthPV * (selfPct/100), totalKwh, monthPV);
      const monthSelf = Math.max(estimatedMonthSelf, manualMonthSelf); // capped by totalKwh and monthPV

      // costs without PV
  const baseEnergy = computeCostBaseForRecords(recs);
  const subBase = Number(DEFAULTS.subBase)||0;
  const baseTotal = baseEnergy + subBase;

      const hphcEnergyObj = computeCostHPHCForRecords(recs);
  const subHphc = Number(DEFAULTS.hp.sub)||0;
  const hphcTotal = hphcEnergyObj.cost + subHphc;

      const tempoEnergyObj = computeCostTempoForRecords(recs);
  const subTempo = Number(DEFAULTS.tempo.sub)||0;
  const tempoTotal = (tempoEnergyObj && tempoEnergyObj.cost) ? tempoEnergyObj.cost + subTempo : 0;

      // with PV: reduce consumption by monthSelf proportionally across records
      const recsWithPV = applyMonthlyReduction(recs, monthSelf);
      const baseEnergyPV = computeCostBaseForRecords(recsWithPV);
      const baseTotalPV = baseEnergyPV + subBase - ( (monthPV - monthSelf) * exportPrice ); // include export income as negative cost

      const hphcEnergyObjPV = computeCostHPHCForRecords(recsWithPV);
      const hphcTotalPV = hphcEnergyObjPV.cost + subHphc - ( (monthPV - monthSelf) * exportPrice );

      const tempoEnergyObjPV = computeCostTempoForRecords(recsWithPV);
      const tempoTotalPV = (tempoEnergyObjPV && tempoEnergyObjPV.cost) ? tempoEnergyObjPV.cost + subTempo - ( (monthPV - monthSelf) * exportPrice ) : 0;

      results.push({ month: k, consumption: totalKwh, monthPV, monthSelf, base:{ energy: baseEnergy, total: baseTotal }, basePV:{ energy: baseEnergyPV, total: baseTotalPV }, hphc:{ energy: hphcEnergyObj.cost, hp: hphcEnergyObj.hp, hc: hphcEnergyObj.hc, total: hphcTotal }, hphcPV:{ energy: hphcEnergyObjPV.cost, total: hphcTotalPV }, tempo:{ energy: tempoEnergyObj.cost||0, total: tempoTotal }, tempoPV:{ energy: (tempoEnergyObjPV && tempoEnergyObjPV.cost)||0, total: tempoTotalPV } });
    }
    return results;
  }

  // Render monthly results into DOM and chart
  async function renderMonthlyBreakdown(){
    const files = fileInput.files;
    if(!files || files.length===0){ alert('Sélectionnez d\'abord un fichier JSON via le sélecteur de fichiers.'); return; }
    appendAnalysisLog('Calcul ventilation mensuelle...');
    const records = await parseFilesToRecords(files);
    // Assurer la disponibilité des vraies couleurs Tempo avant calculs
    try{ await ensureTempoDayMap(records); }catch(e){}
    if(!records || records.length===0){ appendAnalysisLog('Aucune donnée pour la ventilation.'); return; }
    
    const isPvEnabled = document.getElementById('toggle-pv') ? document.getElementById('toggle-pv').checked : true;
    const data = computeMonthlyBreakdown(records);
    const container = document.getElementById('monthly-results'); 
    if(!container) return;
    container.innerHTML = '';
    // build table
    const table = document.createElement('table'); table.style.width='100%'; table.style.borderCollapse='collapse';
    const hdr = document.createElement('tr');
    
    let headerHTML = '<th>Mois</th><th>Consommation (kWh)</th>';
    if (isPvEnabled) {
        headerHTML += '<th>Base (€)</th><th>Base (avec PV) (€)</th><th>Éco. PV Base (€)</th>'+
                      '<th>HP/HC (€)</th><th>HP/HC (avec PV) (€)</th><th>Éco. PV HP/HC (€)</th>'+
                      '<th>Tempo (€)</th><th>Tempo (avec PV) (€)</th><th>Éco. PV Tempo (€)</th>';
    } else {
        headerHTML += '<th>Base (€)</th><th>HP/HC (€)</th><th>Tempo (€)</th>';
    }
    hdr.innerHTML = headerHTML;
    table.appendChild(hdr);

    // compute per-month savings per offer and totals
    const monthlySavings = data.map(row=>({
      month: row.month,
      base: Math.max(0, (row.base.total||0) - (row.basePV.total||0)),
      hphc: Math.max(0, (row.hphc.total||0) - (row.hphcPV.total||0)),
      tempo: Math.max(0, (row.tempo.total||0) - (row.tempoPV.total||0))
    }));
    for(const [i,row] of data.entries()){
      const sv = monthlySavings[i];
      const tr = document.createElement('tr'); tr.style.borderTop='1px solid #ddd';
      
      let rowHTML = `<td>${row.month}</td><td>${formatNumber(row.consumption)}</td>`;
      if (isPvEnabled) {
          rowHTML += `<td>${formatNumber(row.base.total)}</td>`+
                     `<td>${formatNumber(row.basePV.total)}</td>`+
                     `<td style="color:#2e7d32">${formatNumber(sv.base)}</td>`+
                     `<td>${formatNumber(row.hphc.total)}</td>`+
                     `<td>${formatNumber(row.hphcPV.total)}</td>`+
                     `<td style="color:#2e7d32">${formatNumber(sv.hphc)}</td>`+
                     `<td>${formatNumber(row.tempo.total)}</td>`+
                     `<td>${formatNumber(row.tempoPV.total)}</td>`+
                     `<td style="color:#2e7d32">${formatNumber(sv.tempo)}</td>`;
      } else {
          rowHTML += `<td>${formatNumber(row.base.total)}</td>`+
                     `<td>${formatNumber(row.hphc.total)}</td>`+
                     `<td>${formatNumber(row.tempo.total)}</td>`;
      }
      tr.innerHTML = rowHTML;
      table.appendChild(tr);
    }
    container.appendChild(table);

    // annual savings summary per offer
    if (isPvEnabled) {
        const totalSavings = monthlySavings.reduce((acc,m)=>({
        base: acc.base + (m.base||0),
        hphc: acc.hphc + (m.hphc||0),
        tempo: acc.tempo + (m.tempo||0)
        }), {base:0,hphc:0,tempo:0});
        const totalsBox = document.createElement('div');
        totalsBox.id = 'pv-savings-totals';
        totalsBox.className = 'log';
        totalsBox.style.marginTop = '8px';
        totalsBox.innerHTML = `<strong>Économies annuelles (par offre)</strong> — `+
                            `Base: ${formatNumber(totalSavings.base)} € &nbsp; | &nbsp; `+
                            `HP/HC: ${formatNumber(totalSavings.hphc)} € &nbsp; | &nbsp; `+
                            `Tempo: ${formatNumber(totalSavings.tempo)} €`;
        container.appendChild(totalsBox);
    }

    // chart: one dataset per offer (base, basePV, hphc, hphcPV, tempo, tempoPV)
    const labels = data.map(d=> d.month);
    let ds = [];
    if (isPvEnabled) {
        ds = [ {label:'Base', data: data.map(d=> d.base.total), backgroundColor:'#4e79a7'}, {label:'Base (avec PV)', data: data.map(d=> d.basePV.total), backgroundColor:'#a0cbe8'}, {label:'HP/HC', data: data.map(d=> d.hphc.total), backgroundColor:'#f28e2b'}, {label:'HP/HC (avec PV)', data: data.map(d=> d.hphcPV.total), backgroundColor:'#ffbe7d'}, {label:'Tempo', data: data.map(d=> d.tempo.total), backgroundColor:'#59a14f'}, {label:'Tempo (avec PV)', data: data.map(d=> d.tempoPV.total), backgroundColor:'#bfe5b9'} ];
    } else {
        ds = [ {label:'Base', data: data.map(d=> d.base.total), backgroundColor:'#4e79a7'}, {label:'HP/HC', data: data.map(d=> d.hphc.total), backgroundColor:'#f28e2b'}, {label:'Tempo', data: data.map(d=> d.tempo.total), backgroundColor:'#59a14f'} ];
    }
    
    const ctx = document.getElementById('monthly-chart').getContext('2d'); if(window.monthlyChart){ window.monthlyChart.destroy(); window.monthlyChart = null; }
    window.monthlyChart = new Chart(ctx, { type:'bar', data:{ labels, datasets: ds }, options:{ responsive:true, scales:{ y:{ beginAtZero:true } }, interaction:{ mode:'index' } } });

    // render monthly PV savings chart (€/mois) per offer
    try{
      const sc = document.getElementById('monthly-savings-chart');
      if(sc){
        if (isPvEnabled) {
            sc.style.display = 'block';
          try{ if(sc.parentElement) sc.parentElement.style.display = ''; }catch(e){}
            const ctxs = sc.getContext('2d');
            if(window.monthlySavingsChart){ window.monthlySavingsChart.destroy(); window.monthlySavingsChart = null; }
            window.monthlySavingsChart = new Chart(ctxs, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                { label:'Éco. Base (€)', data: monthlySavings.map(m=> m.base), backgroundColor:'#2e7d3233', borderColor:'#2e7d32', borderWidth:1 },
                { label:'Éco. HP/HC (€)', data: monthlySavings.map(m=> m.hphc), backgroundColor:'#00838f33', borderColor:'#00838f', borderWidth:1 },
                { label:'Éco. Tempo (€)', data: monthlySavings.map(m=> m.tempo), backgroundColor:'#8e24aa33', borderColor:'#8e24aa', borderWidth:1 }
                ]
            },
            options: { responsive:true, scales:{ y:{ beginAtZero:true, title:{ display:true, text:'€ / mois économisés' } } }, interaction:{ mode:'index' } }
            });
        } else {
            sc.style.display = 'none';
          try{ if(sc.parentElement) sc.parentElement.style.display = 'none'; }catch(e){}
        }
      }
    }catch(e){ console.warn('Erreur rendu graphique économies PV mensuelles', e); }
    appendAnalysisLog('Ventilation mensuelle terminée.');
  }
  const btnMonthly = document.getElementById('btn-monthly-breakdown');
  if(btnMonthly) btnMonthly.addEventListener('click', renderMonthlyBreakdown);

  // --- localStorage persistence for UI settings ---
  const SETTINGS_KEYS = ['pv-kwp','pv-region','pv-standby','pv-cost-base','pv-cost-panel','param-hphc-hcRange'];
  function storageKey(k){ return 'comparatifElec.' + k; }
  function saveSetting(id){ try{ const el = document.getElementById(id); if(!el) return; const val = (el.type==='checkbox') ? el.checked : el.value; localStorage.setItem(storageKey(id), JSON.stringify(val)); }catch(e){} }
  function loadSetting(id){ try{ const v = localStorage.getItem(storageKey(id)); if(v===null) return; const parsed = JSON.parse(v); const el = document.getElementById(id); if(!el) return; if(el.type==='checkbox'){ el.checked = parsed; } else { el.value = parsed; } }catch(e){} }
  // load at startup
  for(const k of SETTINGS_KEYS) loadSetting(k);
  // save on change
  for(const k of SETTINGS_KEYS){ const el = document.getElementById(k); if(!el) continue; el.addEventListener('change', ()=> saveSetting(k)); el.addEventListener('input', ()=> saveSetting(k)); }

  // Normalize and apply HP/HC HC range setting
  function normalizeHcRange(str){
    // Accept formats like: "22-06" or "12:30-16;03-08"; return normalized "HH[:MM]-HH[:MM];..."
    const raw = String(str||'').trim();
    if(!raw) return null;
    const parts = raw.split(';').map(s=> s.trim()).filter(Boolean);
    const out = [];
    for(const p of parts){
      const m = p.match(/^\s*([0-1]?\d|2[0-3])(?::([0-5]?\d))?\s*-\s*([0-1]?\d|2[0-3])(?::([0-5]?\d))?\s*$/);
      if(!m) return null;
      const sh = String(m[1]).padStart(2,'0');
      const sm = m[2] != null ? String(m[2]).padStart(2,'0') : null;
      const eh = String(m[3]).padStart(2,'0');
      const em = m[4] != null ? String(m[4]).padStart(2,'0') : null;
      const startToken = sm != null ? `${sh}:${sm}` : `${sh}`;
      const endToken = em != null ? `${eh}:${em}` : `${eh}`;
      out.push(`${startToken}-${endToken}`);
    }
    return out.join(';');
  }
  function applyHcRangeFromInput(){
    const el = document.getElementById('param-hphc-hcRange');
    if(!el) return;
    const norm = normalizeHcRange(el.value);
    if(!norm) return; // ignore invalid input silently
    if(!DEFAULTS.hp) DEFAULTS.hp = {};
    DEFAULTS.hp.hcRange = norm;
    el.value = norm; // reflect normalization
    populateDefaultsDisplay();
  }
  // Initial apply if present
  try{ applyHcRangeFromInput(); }catch(e){}
  // React to user changes with recalculation
  (function(){
    const el = document.getElementById('param-hphc-hcRange');
    if(!el) return;
    el.addEventListener('change', async ()=>{
      const before = DEFAULTS.hp && DEFAULTS.hp.hcRange;
      applyHcRangeFromInput();
      const after = DEFAULTS.hp && DEFAULTS.hp.hcRange;
      if(before === after) return;
      // Recompute charts depending on HP/HC split
      try{
        const files = fileInput && fileInput.files;
        if(files && files.length){
          const records = await parseFilesToRecords(files);
          try{ renderHpHcPie(records); }catch(e){}
          // Trigger offers and monthly recompute
          try{ const co = document.getElementById('btn-compare-offers'); if(co) co.click(); }catch(e){}
          try{ renderMonthlyBreakdown(); }catch(e){}
        }
      }catch(e){ console.warn('Recalc after HC range change failed', e); }
    });
  })();

  // Populate read-only display of defaults in the UI
  function populateDefaultsDisplay(){
    const el = document.getElementById('defaults-display');
    if(el){
      function tempoDisplay(c){
        const v = DEFAULTS.tempo[c];
        if(!v) return '-';
        if(typeof v === 'object') return `HP ${v.hp} €/kWh — HC ${v.hc} €/kWh`;
        return `${v} €/kWh`;
      }
      const txt = `Base: ${DEFAULTS.priceBase} €/kWh (abonnement ${DEFAULTS.subBase} €/mois)\n` +
                  `HP/HC: HP ${DEFAULTS.hp.php} €/kWh — HC ${DEFAULTS.hp.phc} €/kWh (HC range ${DEFAULTS.hp.hcRange}, abonnement ${DEFAULTS.hp.sub} €/mois)\n` +
                  `Tempo (par défaut): Bleu ${tempoDisplay('blue')} — Blanc ${tempoDisplay('white')} — Rouge ${tempoDisplay('red')} (abonnement ${DEFAULTS.tempo.sub} €/mois)\n` +
                  `Prix injection (revenu export): ${DEFAULTS.injectionPrice} €/kWh`;
      el.textContent = txt;
    }
    const inj = document.getElementById('injection-value'); if(inj) inj.textContent = String(DEFAULTS.injectionPrice);
  }
  populateDefaultsDisplay();
  // Auto-run analysis when files are selected: analyze, monthly breakdown, PV estimate, compare offers
  if(fileInput){
    fileInput.addEventListener('change', ()=>{
      const files = fileInput.files;
      if(!files || files.length === 0) return;
      appendAnalysisLog('Fichiers détectés — récupération des jours Tempo puis analyses...');

      // Dynamic UI: Show Analysis
      const dashboard = document.getElementById('dashboard-section');
      if(dashboard) dashboard.classList.remove('hidden');

      // hide manual buttons (no longer necessary)
      try{ const b1 = document.getElementById('btn-analyze'); if(b1) b1.style.display = 'none'; const b2 = document.getElementById('btn-monthly-breakdown'); if(b2) b2.style.display = 'none'; const b3 = document.getElementById('btn-compare-offers'); if(b3) b3.style.display = 'none'; }catch(e){}
      (async ()=>{
        try{
          const records = await parseFilesToRecords(files);
          
          // Auto-estimate standby power
          try {
             const estimatedW = calculateStandbyFromRecords(records);
             const sbInput = document.getElementById('pv-standby');
             if(sbInput && estimatedW > 0) {
                 sbInput.value = estimatedW;
                 // Update button text if exists
                 const btnEst = document.getElementById('btn-estimate-standby');
                 if(btnEst) btnEst.textContent = '✅ ' + estimatedW + 'W';
                 // Save setting
                 if(typeof saveSetting === 'function') saveSetting('pv-standby');
             }
          } catch(e) { console.warn('Auto-standby failed', e); }

          await ensureTempoDayMap(records);
          await analyzeFilesNow(files);
        }catch(e){ console.warn('Auto-run analysis failed', e); }
        // trigger other handlers after analysis
        setTimeout(()=>{ try{ renderMonthlyBreakdown(); }catch(e){} }, 150);
        setTimeout(()=>{ try{ const pv = document.getElementById('btn-calc-pv'); if(pv) pv.click(); }catch(e){} }, 300);
        setTimeout(()=>{ try{ const co = document.getElementById('btn-compare-offers'); if(co) co.click(); }catch(e){} }, 450);
      })();
    });
  }
  function simulatePVEffect(records, annualProduction, exportPrice, standbyW = 0){
    // Simulation saisonnière et horaire
    // - répartit `annualProduction` entre les mois via `monthlySolarWeights`
    // - calcule la production disponible pour chaque occurrence horaire (ex: 2024-06-01 12:00) en divisant la production mensuelle par le nombre de jours observés
    // - alloue d'abord la production à la consommation de veille (standbyW en W converti en kWh par heure), puis au reste de la demande
    // records : tableau d'instances horaires {dateDebut, dateFin, valeur}

    const perHourAnnual = Array.from({length:24}, ()=>0);
    // grouper les enregistrements par mois et compter les jours distincts
    const months = {};
    for(const r of records){
      const d = new Date(r.dateDebut); if(isNaN(d)) continue;
      const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const key = `${y}-${m}`;
      if(!months[key]) months[key] = { days: new Set(), records: [] };
      months[key].days.add(d.getDate()); months[key].records.push(r);
      const h = d.getHours(); perHourAnnual[h] += Number(r.valeur)||0;
    }

    const monthKeys = Object.keys(months).sort();
    const monthPV = {};
    if(monthKeys.length === 1){
      // caller likely passed a month-level production (monthPV) — treat annualProduction as month production
      monthPV[monthKeys[0]] = annualProduction;
    } else {
      for(const k of monthKeys){ const parts = k.split('-'); const mi = (parts.length>1) ? (Number(parts[1]) - 1) : 0; monthPV[k] = annualProduction * (monthlySolarWeights[mi] || (1/12)); }
    }

    const standbyPerHourKwh = (Number(standbyW)||0) / 1000; // kWh consommé par heure par la veille
  let selfConsumed = 0; let exported = 0;
  const consumedByHour = Array.from({length:24}, ()=>0);
  const allocatedByTimestamp = {}; // map dateDebut -> allocated kWh (self-consumed)

    // parcourir chaque occurrence horaire et allouer la production
    for(const k of monthKeys){
      const info = months[k]; const daysCount = Math.max(1, info.days.size); const mpv = monthPV[k] || 0; // kWh produit dans le mois
      for(const rec of info.records){
        const d = new Date(rec.dateDebut); const h = d.getHours(); const demand = Number(rec.valeur) || 0;
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
  if(rec && rec.dateDebut){ const key = String(rec.dateDebut); allocatedByTimestamp[key] = (allocatedByTimestamp[key] || 0) + allocated; }
      }
    }

    // build aggregated pvPerHour (kWh apportés par heure-of-day sur l'année)
    const pvPerHour = Array.from({length:24}, ()=>0);
    for(const k of monthKeys){ const mpv = monthPV[k] || 0; for(let h=0; h<24; h++){ pvPerHour[h] += (pvNorm[h] * mpv); } }

    const estimatedAutoPct = annualProduction > 0 ? (selfConsumed / (annualProduction || 1) * 100) : 0;
    return { perHourAnnual, pvPerHour, selfConsumed, exported, consumedByHour, estimatedAutoPct, allocatedByTimestamp };
  }

  function computeCostWithProfile(perHourAnnual, priceBase, hpParams){
    // hpParams: {mode:'base'|'hp-hc', php, phc, hcRange}
    let cost = 0; let hpCost=0, hcCost=0;
    if(hpParams.mode === 'base'){
      const p = priceBase; for(let h=0;h<24;h++) cost += perHourAnnual[h] * p;
      return {cost, hpCost:0, hcCost:0};
    }
    for(let h=0;h<24;h++){
      const q = perHourAnnual[h] || 0; if(isHourHC(h, hpParams.hcRange)){ hcCost += q * hpParams.phc; } else { hpCost += q * hpParams.php; } }
    cost = hpCost + hcCost; return {cost, hpCost, hcCost};
  }

  // --- Helper: Find Optimal PV Configuration ---
  function findBestPVConfig(records, talon, roiYears, costBase, costPanel, region, exportPrice){
      const yieldVal = pvYieldPerKwp(region);
      const panelPower = 0.4; // 400Wc per panel

      // Pre-compute tariffs
      const tariffs = [];
      const pBase = Number(DEFAULTS.priceBase) || 0.20;
      const pHp = Number(DEFAULTS.hp.php)||0.22;
      const pHc = Number(DEFAULTS.hp.phc)||0.16;
      const hcRange = (DEFAULTS.hp.hcRange||'22-06');

      let tempoMap = null;
      try{ if(typeof __tempoDayMapCache !== 'undefined') tempoMap = __tempoDayMapCache; }catch(e){}
      if(!tempoMap) tempoMap = generateTempoCalendarAlgorithm(records);

      function getTempoPrice(dateStr, h, map){
         const dKey = dateStr.slice(0,10);
         const entry = map[dKey] || map[dKey.replace(/\//g,'-')] || 'B';
         let color = 'blue';
         if(typeof entry === 'string') color = (entry.toLowerCase() === 'b' ? 'blue' : (entry.toLowerCase() === 'w' ? 'white' : 'red'));
         else if(entry.color) color = (entry.color.toLowerCase() === 'b' ? 'blue' : (entry.color.toLowerCase() === 'w' ? 'white' : 'red'));
         let isHC = isHourHC(h, '22-06');
         if(entry && typeof entry === 'object'){
            if(entry.hours && entry.hours.length===24) isHC = Boolean(entry.hours[h]);
            else if(entry.hcRange) isHC = isHourHC(h, entry.hcRange);
         }
         const tColor = DEFAULTS.tempo[color];
         if(!tColor) return 0.15;
         return isHC ? tColor.hc : tColor.hp;
      }

      for(const r of records){
          const h = new Date(r.dateDebut).getHours();
          const isHcStandard = isHourHC(h, hcRange);
          tariffs.push({
              base: pBase,
              hphc: isHcStandard ? pHc : pHp,
              tempo: getTempoPrice(r.dateDebut, h, tempoMap)
          });
      }

      const best = {
          base: { kwp:0, n:0, gain: -Infinity, cost:0, savings:0, ratio:0 },
          hphc: { kwp:0, n:0, gain: -Infinity, cost:0, savings:0, ratio:0 },
          tempo: { kwp:0, n:0, gain: -Infinity, cost:0, savings:0, ratio:0 }
      };

      for(let n=1; n<=24; n++){
        const kwp = n * panelPower;
        const annualProd = kwp * yieldVal;
        const sim = simulatePVEffect(records, annualProd, exportPrice, talon);
        
        const totalCost = costBase + (n * costPanel);
        const exportIncome = sim.exported * exportPrice;

        let savedBase = 0, savedHphc = 0, savedTempo = 0;
        for(let i=0; i<records.length; i++){
            const rec = records[i];
            const selfConsumed = sim.allocatedByTimestamp[rec.dateDebut] || 0;
            if(selfConsumed > 0){
                savedBase += selfConsumed * tariffs[i].base;
                savedHphc += selfConsumed * tariffs[i].hphc;
                savedTempo += selfConsumed * tariffs[i].tempo;
            }
        }

        const annualBase = savedBase + exportIncome;
        const annualHphc = savedHphc + exportIncome;
        const annualTempo = savedTempo + exportIncome;

        const gainBase = (annualBase * roiYears) - totalCost;
        const gainHphc = (annualHphc * roiYears) - totalCost;
        const gainTempo = (annualTempo * roiYears) - totalCost;

        const ratio = (annualProd > 0) ? (sim.selfConsumed / annualProd) : 0;
        if(ratio > 0.50){
            if(gainBase > best.base.gain) best.base = { kwp, n, gain: gainBase, cost: totalCost, savings: annualBase, ratio };
            if(gainHphc > best.hphc.gain) best.hphc = { kwp, n, gain: gainHphc, cost: totalCost, savings: annualHphc, ratio };
            if(gainTempo > best.tempo.gain) best.tempo = { kwp, n, gain: gainTempo, cost: totalCost, savings: annualTempo, ratio };
        }
      }
      return best;
  }

  document.getElementById('btn-compare-offers').addEventListener('click', async ()=>{
    const files = fileInput.files;
    if(!files || files.length===0){ alert('Sélectionnez d\'abord un fichier JSON via le sélecteur de fichiers.'); return; }
    
    const grid = document.getElementById('offers-results-grid');
    if(grid) grid.innerHTML = '';

    appendAnalysisLog('Comparaison des offres en cours...');
    const records = await parseFilesToRecords(files);
    // Always ensure real Tempo map before any tariff computations
    try{ await ensureTempoDayMap(records); }catch(e){ console.warn('Tempo map async fetch failed, fallback generator used.', e); }
    if(!records || records.length===0){ appendAnalysisLog('Aucune donnée pour la comparaison.'); return; }
    const stats = computeHourlyStats(records);
    
    const isPvEnabled = document.getElementById('toggle-pv') ? document.getElementById('toggle-pv').checked : true;
    const annualProduction = isPvEnabled ? (Number(document.getElementById('pv-kwp').value)||0) * pvYieldPerKwp((document.getElementById('pv-region')||{}).value||'centre') : 0;
    const exportPrice = Number(DEFAULTS.injectionPrice) || 0;

    // baseline: perHourAnnual from records
    const perHourAnnual = Array.from({length:24}, ()=>0);
    for(const r of records){ const v = Number(r.valeur)||0; const h = new Date(r.dateDebut).getHours(); perHourAnnual[h] += v; }

    // offers parameters (use current UI prices as defaults)
    const priceBase = Number(DEFAULTS.priceBase) || 0.18;
    const hpParams = { mode: 'hp-hc', php: Number(DEFAULTS.hp.php)||0.2, phc: Number(DEFAULTS.hp.phc)||0.12, hcRange: (DEFAULTS.hp.hcRange||'22-06') };

    // cost without PV
    const baseCostNoPV = computeCostWithProfile(perHourAnnual, priceBase, {mode:'base'}).cost;
    const hpCostNoPV = computeCostWithProfile(perHourAnnual, priceBase, hpParams).cost;
    // Tempo cost without PV
    const tempoResNoPV = calculateTariffCostTempo(records);

    // simulate PV (take into account standby consumption if provided)
    const standbyW = Number((document.getElementById('pv-standby')||{}).value) || 0;
    const pvSim = simulatePVEffect(records, annualProduction, exportPrice, standbyW);
    // reduce perHourAnnual by self-consumed amount to get grid consumption with PV
    const perHourWithPV = perHourAnnual.map((v,h)=> Math.max(0, v - (pvSim.consumedByHour[h]||0)));

    const baseCostWithPV = computeCostWithProfile(perHourWithPV, priceBase, {mode:'base'}).cost;
    const hpCostWithPV = computeCostWithProfile(perHourWithPV, priceBase, hpParams).cost;
  
    // build records adjusted by self-consumed PV per hour (use precise allocation from simulation)
    const recordsWithPV = records.map(r=> ({ ...r }));
    for(const rec of recordsWithPV){
      const key = String(rec.dateDebut);
      const reduction = (pvSim.allocatedByTimestamp && pvSim.allocatedByTimestamp[key]) || 0;
      rec.valeur = Math.max(0, Number(rec.valeur||0) - reduction);
    }
    const tempoResWithPV = calculateTariffCostTempo(recordsWithPV);

    // export income
    const exportIncome = pvSim.exported * exportPrice;

    // Calculate Installation Cost
    const kwpVal = Number(document.getElementById('pv-kwp').value)||0;
    const costBase = Number((document.getElementById('pv-cost-base')||{}).value) || 500;
    const costPanel = Number((document.getElementById('pv-cost-panel')||{}).value) || 200;
    const numPanels = Math.round(kwpVal / 0.4);
    const installCost = costBase + (numPanels * costPanel);

    // Update Dashboard Metrics
    const totalCostEl = document.getElementById('val-total-cost');
    const minCost = Math.min(baseCostWithPV, hpCostWithPV, (tempoResWithPV && tempoResWithPV.cost ? tempoResWithPV.cost : Infinity));
    if(totalCostEl) totalCostEl.textContent = formatNumber(minCost) + ' €';
    
    const pvProdEl = document.getElementById('val-pv-prod');
    if(pvProdEl) pvProdEl.textContent = isPvEnabled ? (formatNumber(annualProduction) + ' kWh') : 'Désactivé';

    const pvInfoEl = document.getElementById('val-pv-info');
    if(pvInfoEl) {
        if(isPvEnabled) pvInfoEl.innerHTML = `Coût install. ~<strong>${formatNumber(installCost)} €</strong>`;
        else pvInfoEl.textContent = 'Production estimée';
    }

    // Determine best and worst offer
    const offerDetails = [
        { id: 'base', name: 'Base', val: baseCostWithPV },
        { id: 'hphc', name: 'HP/HC', val: hpCostWithPV },
        { id: 'tempo', name: 'Tempo', val: tempoResWithPV.cost || Infinity }
    ];
    offerDetails.sort((a,b) => a.val - b.val);
    const bestId = offerDetails[0].id;
    const worstOffer = offerDetails[offerDetails.length - 1];

    // Generate Cards
    const createCard = (title, costNoPV, costPV, isBest) => {
        const div = document.createElement('div');
        div.className = 'card result-card' + (isBest ? ' best-offer' : '');
        const savings = (costNoPV - costPV) + exportIncome;
        
        let pvRows = '';
        if (isPvEnabled) {
            const roi = savings > 0 ? (installCost / savings) : 999;
            const roiDisplay = roi < 100 ? roi.toFixed(1) + ' ans' : '> 20 ans';

            pvRows = `
            <div class="savings-row">
                <span class="label">Sans PV:</span>
                <span class="value">${formatNumber(costNoPV)} €</span>
            </div>
            <div class="savings-row highlight">
                <span class="label">Gain Total (PV):</span>
                <span class="value text-success">-${formatNumber(savings)} €</span>
            </div>
            <div class="savings-row">
                <span class="label">Dont Export:</span>
                <span class="value">+${formatNumber(exportIncome)} €</span>
            </div>
            <div class="savings-row" style="margin-top:8px; border-top:1px dashed #eee; padding-top:4px;">
                <span class="label">Retour Inv.:</span>
                <span class="value" style="font-weight:bold;">${roiDisplay}</span>
            </div>`;
        }

        let bestOfferExtras = '';
        if (isBest && worstOffer && worstOffer.val > costPV && worstOffer.val !== Infinity) {
             const diff = worstOffer.val - costPV;
             bestOfferExtras = `<div style="margin-top:8px; font-size:0.85rem; color:#155724; background-color:#d4edda; border:1px solid #c3e6cb; padding: 4px 8px; border-radius: 6px; text-align:center;">
                Économie vs ${worstOffer.name} : <strong>${formatNumber(diff)} €</strong>
             </div>`;
        }

        div.innerHTML = `
            <div class="card-header-row">
                <h3 class="offer-title">${title}</h3>
                ${isBest ? '<span class="badge-best">Meilleure Offre</span>' : ''}
            </div>
            <div class="cost-display">
                <span class="cost-main">${formatNumber(costPV)} €</span>
                <span class="cost-sub">/ an</span>
            </div>
            ${bestOfferExtras}
            ${pvRows}
        `;
        return div;
    };

    if(grid) {
        grid.appendChild(createCard('Base', baseCostNoPV, baseCostWithPV, bestId === 'base'));
        grid.appendChild(createCard('Heures Pleines / Creuses', hpCostNoPV, hpCostWithPV, bestId === 'hphc'));
        grid.appendChild(createCard('Tempo', tempoResNoPV.cost, tempoResWithPV.cost, bestId === 'tempo'));
    }

    // render small bar chart (include Tempo)
    let labels, values, bgColors;
    if (isPvEnabled) {
        labels = ['Base (sans PV)','Base (avec PV)','HP/HC (sans PV)','HP/HC (avec PV)','Tempo (sans PV)','Tempo (avec PV)'];
        values = [baseCostNoPV, baseCostWithPV, hpCostNoPV, hpCostWithPV, tempoResNoPV.cost, tempoResWithPV.cost];
        bgColors = ['#4e79a7','#a0cbe8','#f28e2b','#ffbe7d','#59a14f','#bfe5b9'];
    } else {
        labels = ['Base','HP/HC','Tempo'];
        values = [baseCostNoPV, hpCostNoPV, tempoResNoPV.cost];
        bgColors = ['#4e79a7','#f28e2b','#59a14f'];
    }

    const ctx = offersCanvas.getContext('2d');
    if(offersChart){ offersChart.destroy(); offersChart = null; }
   

    offersChart = new Chart(ctx, { type: 'bar', data: { labels, datasets:[{ label: 'Coût annuel (€)', data: values, backgroundColor: bgColors }] }, options:{ responsive:true, scales:{ y:{ beginAtZero:true } } } });

    appendAnalysisLog('Comparaison terminée.');

    // --- Populate PV Report Section ---
    const pvReportSec = document.getElementById('pv-report-section');
    const pvReportContent = document.getElementById('pv-report-content');
    if(pvReportSec && pvReportContent){
        if(isPvEnabled){
            pvReportSec.classList.remove('hidden');
            pvReportContent.innerHTML = '';
            
            const roiYearsTarget = Number((document.getElementById('pv-roi-years')||{}).value) || 15;
            const titleEl = document.getElementById('pv-report-title');
            if(titleEl) titleEl.textContent = `Rapport de Rentabilité Photovoltaïque (${roiYearsTarget} ans)`;

            // --- Calculate Optimal Config for Comparison ---
            const region = (document.getElementById('pv-region')||{}).value || 'centre';
            const costBase = Number((document.getElementById('pv-cost-base')||{}).value) || 500;
            const costPanel = Number((document.getElementById('pv-cost-panel')||{}).value) || 200;
            const talon = Number((document.getElementById('pv-standby')||{}).value) || 50;
            
            const bestConfig = findBestPVConfig(records, talon, roiYearsTarget, costBase, costPanel, region, exportPrice);
            
            // Add Recommendation Block
            const recDiv = document.createElement('div');
            recDiv.style.gridColumn = '1 / -1';
            recDiv.className = 'alert alert-info';
            recDiv.style.marginBottom = '15px';
            recDiv.style.fontSize = '0.95rem';
            recDiv.innerHTML = `💡 <strong>Analyse Optimisée :</strong> Ci-dessous, la configuration idéale (nombre de panneaux) calculée spécifiquement pour chaque offre afin de maximiser le gain net sur ${roiYearsTarget} ans.`;
            // pvReportContent.appendChild(recDiv); // Removed as per user request to clean UI

            // Helper for report card
            const createReportCard = (title, bestCfg) => {
                const div = document.createElement('div');
                div.className = 'result-card';
                div.style.textAlign = 'left';
                div.style.position = 'relative';
                
                div.innerHTML = `
                    <h4 style="margin-bottom:10px; color:var(--primary);">${title}</h4>
                    <div style="font-size:0.9rem; margin-bottom:8px; color:#555;">
                        Config idéale: <strong>${bestCfg.kwp.toFixed(1)} kWc</strong> (${bestCfg.n} panneaux)<br>
                        <small>Coût install: ${formatNumber(bestCfg.cost)} €</small>
                    </div>
                    <div style="font-size:0.9rem; margin-bottom:4px;">Économie/an: <strong>${formatNumber(bestCfg.savings)} €</strong></div>
                    <div style="font-size:0.9rem; margin-bottom:4px;">Retour Inv.: <strong>${(bestCfg.cost/bestCfg.savings).toFixed(1)} ans</strong></div>
                    <div style="font-size:0.9rem; margin-top:8px; padding-top:8px; border-top:1px solid #eee;">
                        Gain Net (${roiYearsTarget} ans):<br>
                        <span style="font-size:1.1rem; font-weight:bold; color:${bestCfg.gain > 0 ? 'var(--success)' : 'var(--danger)'}">${formatNumber(bestCfg.gain)} €</span>
                    </div>
                    <button class="btn-apply-config">
                        <span>⚡</span> Appliquer cette config
                    </button>
                `;
                
                const btn = div.querySelector('.btn-apply-config');
                btn.addEventListener('click', () => {
                    const elKwp = document.getElementById('pv-kwp');
                    if(elKwp) {
                        elKwp.value = bestCfg.kwp.toFixed(1);
                        // Trigger change event to update simulation automatically
                        elKwp.dispatchEvent(new Event('change'));
                    }
                    
                    // Visual feedback
                    btn.innerHTML = '<span>✅</span> Config appliquée !';
                    btn.classList.add('applied');
                    
                    setTimeout(() => { 
                        btn.innerHTML = '<span>⚡</span> Appliquer cette config'; 
                        btn.classList.remove('applied');
                    }, 2000);
                });

                return div;
            };

            // Base
            pvReportContent.appendChild(createReportCard('Option Base', bestConfig.base));

            // HP/HC
            pvReportContent.appendChild(createReportCard('Option HP/HC', bestConfig.hphc));

            // Tempo
            pvReportContent.appendChild(createReportCard('Option Tempo', bestConfig.tempo));

        } else {
            pvReportSec.classList.add('hidden');
        }
    }

    // Also render monthly price (€/kWh) per offer and PV production (kWh) on a dual-axis chart
    try{
      const monthly = computeMonthlyBreakdown(records);
      const mlabels = monthly.map(m=> m.month);
      // price per kWh = energy cost / consumption
      const basePriceSeries = monthly.map(m=> m.consumption>0 ? (m.base.energy / m.consumption) : null);
      const basePricePVSeries = monthly.map(m=> m.consumption>0 ? (m.basePV.energy / m.consumption) : null);
      const hphcPriceSeries = monthly.map(m=> m.consumption>0 ? (m.hphc.energy / m.consumption) : null);
      const hphcPricePVSeries = monthly.map(m=> m.consumption>0 ? (m.hphcPV.energy / m.consumption) : null);
      const tempoPriceSeries = monthly.map(m=> m.consumption>0 ? (m.tempo.energy / m.consumption) : null);
      const tempoPricePVSeries = monthly.map(m=> m.consumption>0 ? (m.tempoPV.energy / m.consumption) : null);
      const pvProdSeries = monthly.map(m=> m.monthPV || 0);
      const pc = document.getElementById('price-pv-chart');
      if(pc){
        const ctx2 = pc.getContext('2d');
        if(window.pricePvChart){ window.pricePvChart.destroy(); window.pricePvChart = null; }
        
        const datasets = [];
        // Base
        datasets.push({ type:'line', yAxisID:'yPrice', label:'Prix Base (€/kWh)', data: basePriceSeries, borderColor:'#4e79a7', backgroundColor:'#4e79a760', fill:false, tension:0.1 });
        if(isPvEnabled) datasets.push({ type:'line', yAxisID:'yPrice', label:'Prix Base (avec PV)', data: basePricePVSeries, borderColor:'#a0cbe8', backgroundColor:'#a0cbe860', fill:false, tension:0.1 });
        
        // HP/HC
        datasets.push({ type:'line', yAxisID:'yPrice', label:'Prix HP/HC (€/kWh)', data: hphcPriceSeries, borderColor:'#f28e2b', backgroundColor:'#f28e2b33', fill:false, tension:0.1 });
        if(isPvEnabled) datasets.push({ type:'line', yAxisID:'yPrice', label:'Prix HP/HC (avec PV)', data: hphcPricePVSeries, borderColor:'#ffbe7d', backgroundColor:'#ffbe7d33', fill:false, tension:0.1 });
        
        // Tempo
        datasets.push({ type:'line', yAxisID:'yPrice', label:'Prix Tempo (€/kWh)', data: tempoPriceSeries, borderColor:'#59a14f', backgroundColor:'#59a14f33', fill:false, tension:0.1 });
        if(isPvEnabled) datasets.push({ type:'line', yAxisID:'yPrice', label:'Prix Tempo (avec PV)', data: tempoPricePVSeries, borderColor:'#bfe5b9', backgroundColor:'#bfe5b933', fill:false, tension:0.1 });
        
        // PV Bar
        if(isPvEnabled) datasets.push({ type:'bar', yAxisID:'yKwh', label:'Production PV (kWh)', data: pvProdSeries, backgroundColor:'#f1c40f55' });

        const chartCfg = {
          type: 'bar',
          data: {
            labels: mlabels,
            datasets: datasets
          },
          options: {
            responsive:true,
            interaction:{ mode:'index' },
            scales:{
              yPrice:{ type:'linear', position:'left', title:{ display:true, text:'€/kWh' } },
              yKwh:{ type:'linear', position:'right', title:{ display:true, text:'kWh (PV mensuel)' }, grid:{ drawOnChartArea:false }, display: isPvEnabled }
            }
          }
        };
        window.pricePvChart = new Chart(ctx2, chartCfg);
      }
    }catch(e){ console.warn('Erreur rendu prix/PV', e); }
  });
  
  // ------- Tempo calendar helpers -------
  function isoDateRange(startDate, endDate){ const out = []; let d = new Date(startDate); while(d <= endDate){ out.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); } return out; }

  // Session cache for Tempo day map
  let __tempoDayMapCache = null;
  // Source map for diagnostics: 'api' | 'store' | 'gen'
  let __tempoSourceMap = null;
  let __tempoApiUsed = false;
  let __tempoRealUsed = false; // true if either API or stored real colors are present

  // ---- Local storage helpers for persisting Tempo colors ----
  function tempoStorageKey(){ return (DEFAULTS.tempoApi && DEFAULTS.tempoApi.storageKey) || 'comparatifElec.tempoDayMap'; }
  function loadStoredTempoMap(){
    try{
      const raw = localStorage.getItem(tempoStorageKey());
      if(!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    }catch(e){ return {}; }
  }
  function saveStoredTempoMap(map){
    try{
      const clean = {};
      for(const k of Object.keys(map||{})){
        if(/^\d{4}-\d{2}-\d{2}$/.test(k)){ const v = map[k]; if(v==='B'||v==='W'||v==='R') clean[k]=v; }
      }
      localStorage.setItem(tempoStorageKey(), JSON.stringify(clean));
    }catch(e){ /* ignore storage errors */ }
  }
  function upsertStoredTempoColors(entries){
    if(!entries || typeof entries !== 'object') return;
    const cur = loadStoredTempoMap();
    let changed = false;
    for(const [d,c] of Object.entries(entries)){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const cc = (c||'').toUpperCase();
      if(cc==='B' || cc==='W' || cc==='R'){
        if(cur[d] !== cc){ cur[d] = cc; changed = true; }
      }
    }
    if(changed) saveStoredTempoMap(cur);
    return cur;
  }

  // Try to fetch real Tempo colors from the public API for past days, with robust fallbacks.
  async function fetchTempoFromApiRange(startDate, endDate, onProgress){
    // Bulk season fetch first: /api/joursTempo?periode=YYYY-YYYY+1
    const out = {};
    if(!DEFAULTS.tempoApi || !DEFAULTS.tempoApi.enabled) return out;
    const base = DEFAULTS.tempoApi.baseUrl.replace(/\/$/,'');

    function normColor(v){
      if(v==null) return null;
      const s = String(v).toLowerCase();
      if(s.includes('bleu') || s === 'b' || s === 'blue' || s === '0') return 'B';
      if(s.includes('blanc') || s === 'w' || s === 'white' || s === '1') return 'W';
      if(s.includes('rouge') || s === 'r' || s === 'red' || s === '2') return 'R';
      return null;
    }
    function ymd(d){ return d.toISOString().slice(0,10); }
    function seasonYearFor(d){ return (d.getMonth()>=8) ? d.getFullYear() : d.getFullYear()-1; }

    async function tryFetch(url){
      try{
        const r = await fetch(url, { credentials:'omit' });
        if(!r.ok) return null;
        return await r.json();
      }catch(e){ return null; }
    }

    const stored = loadStoredTempoMap();
    // Determine seasons covering range
    const startSy = seasonYearFor(startDate);
    const endSy = seasonYearFor(endDate);
    let bulkCount = 0;
    for(let sy=startSy; sy<=endSy; sy++){
      const periodParam = `${sy}-${sy+1}`;
      const url = `${base}/joursTempo?periode=${periodParam}`;
      const data = await tryFetch(url);
      if(Array.isArray(data)){
        for(const it of data){
          const ds = it && it.dateJour;
          if(!ds || stored[ds]) continue; // keep stored if already present
          const c = normColor(it.libCouleur || it.couleur || it.color || it.codeJour);
          if(c){ out[ds] = c; bulkCount++; if(onProgress) try{ onProgress(1); }catch(e){} }
        }
      }
    }

    // Identify missing days (inside range) still not resolved after bulk
    const missing = [];
    for(let d=new Date(startDate); d<=endDate; d.setDate(d.getDate()+1)){
      const ds = ymd(d);
      if(out[ds] || stored[ds]) continue;
      missing.push(ds);
    }

    // Fallback per-day fetch only for missing subset
    if(missing.length){
      const concurrency = Math.max(1, Number((DEFAULTS.tempoApi||{}).concurrency) || 4);
      let index = 0;
      async function worker(){
        while(true){
          const i = index; index++; if(i >= missing.length) break;
          const ds = missing[i];
          const url = `${base}/jourTempo/${ds}`;
          const j = await tryFetch(url);
          if(j && !(j.title && j.detail)){
            const c = normColor(j.libCouleur || j.couleur || j.couleurTempo || j.color || j.code || j[ds]);
            if(c){ out[ds] = c; if(onProgress) try{ onProgress(1); }catch(e){} }
          }
        }
      }
      const workers = Array.from({length: concurrency}, ()=> worker());
      await Promise.all(workers);
    }
    return out;
  }

  // Nouvelle génération TEMPO locale (fallback) basée sur les données, conforme aux règles RTE (simplifiées)
  function generateTempoCalendarAlgorithm(records){
    // 1) Déterminer l'intervalle couvert par les données
    let minD=null, maxD=null;
    if(records && records.length){
      for(const r of records){ const d = new Date((r.dateDebut||'').slice(0,10)); if(isNaN(d)) continue; if(!minD||d<minD) minD=d; if(!maxD||d>maxD) maxD=d; }
    }
    if(!minD){ const y=new Date().getFullYear(); minD=new Date(y,0,1); maxD=new Date(y,11,31); }

    function ymd(d){ return d.toISOString().slice(0,10); }
    function isSunday(d){ return d.getDay()===0; }
    function isSaturday(d){ return d.getDay()===6; }

    // 2) Construire la carte complète (bleu par défaut) sur min..max
    const dayMap = {}; const allDays = isoDateRange(minD, maxD); for(const ds of allDays){ dayMap[ds] = 'B'; }

    // 3) Itérer par saisons Tempo (1 sept → 31 août)
    function seasonYearFor(d){ return (d.getMonth()>=8) ? d.getFullYear() : d.getFullYear()-1; }
    const startSy = seasonYearFor(minD); const endSy = seasonYearFor(maxD);

    for(let sy=startSy; sy<=endSy; sy++){
      const seasonStart = new Date(sy,8,1); const seasonEnd = new Date(sy+1,7,31);

      // Limiter au sous-intervalle effectivement couvert par les données
      const clipStart = (seasonStart < minD) ? minD : seasonStart;
      const clipEnd = (seasonEnd > maxD) ? maxD : seasonEnd;
      if(clipStart > clipEnd) continue;

      // 3a) Jours rouges: tirage entre 1 nov (sy) et 31 mar (sy+1), sans week-end, max 5 consécutifs, total 22 par saison
      const redStart = new Date(sy,10,1); const redEnd = new Date(sy+1,2,31);
      const redWindow = isoDateRange(redStart, redEnd);
      // Restreindre aux jours réellement présents dans dayMap (min..max)
      const redCandidates = redWindow.filter(ds=> dayMap.hasOwnProperty(ds)).filter(ds=>{ const d=new Date(ds); return !isSaturday(d) && !isSunday(d); });
      const selectedRed = [];
      if(redCandidates.length){
        // Sélection régulière sur la fenêtre
        const need = 22;
        const step = redCandidates.length / need;
        const pickedIdx = new Set();
        function isConsecutiveWithinMap(dateStr, offset){ const d=new Date(dateStr); d.setDate(d.getDate()+offset); return dayMap[ymd(d)]==='R'; }
        for(let i=0;i<need && i<redCandidates.length;i++){
          const target = Math.floor(i*step + step/2);
          // Chercher autour du target un candidat qui ne crée pas >5 consécutifs
          let found = -1; const radius = 5;
          for(let r=0;r<=radius && found<0;r++){
            for(const sign of [-1,1]){
              const idx = target + sign*r; if(idx<0||idx>=redCandidates.length) continue; if(pickedIdx.has(idx)) continue; found = idx; break;
            }
          }
          if(found>=0){ pickedIdx.add(found); selectedRed.push(redCandidates[found]); }
        }
        // Si pas assez, compléter en balayage simple en respectant la contrainte
        for(let idx=0; selectedRed.length<need && idx<redCandidates.length; idx++){
          if(pickedIdx.has(idx)) continue; const ds=redCandidates[idx];
          let runLeft=0,runRight=0; let cur=new Date(ds);
          for(let k=1;k<=5;k++){ cur.setDate(cur.getDate()-1); const s=ymd(cur); if(selectedRed.includes(s)) runLeft++; else break; }
          cur=new Date(ds);
          for(let k=1;k<=5;k++){ cur.setDate(cur.getDate()+1); const s=ymd(cur); if(selectedRed.includes(s)) runRight++; else break; }
          if(runLeft + 1 + runRight <= 5) selectedRed.push(ds);
        }
        for(const ds of selectedRed){ dayMap[ds]='R'; }
      }

      // 3b) Jours blancs: 43 par saison, tirables sur toute la saison sauf dimanches, hors jours rouges
      // Prioriser la période novembre → mars, puis compléter sur le reste de la saison
      const seasonDays = isoDateRange(seasonStart, seasonEnd);
      const allWhiteCandidates = seasonDays.filter(ds=> dayMap.hasOwnProperty(ds)).filter(ds=>{ const d=new Date(ds); return !isSunday(d) && dayMap[ds] !== 'R'; });
      const winterStart = new Date(sy,10,1); // 1 nov sy
      const winterEnd = new Date(sy+1,2,31); // 31 mar sy+1
      const winterWhiteCandidates = allWhiteCandidates.filter(ds=>{ const d=new Date(ds); return d>=winterStart && d<=winterEnd; });
      const otherWhiteCandidates = allWhiteCandidates.filter(ds=>{ const d=new Date(ds); return d<winterStart || d>winterEnd; });
      const needW = 43; const whites=[];
      function pickDistributedFrom(list, count, radius=5){
        const picked=[]; if(!list.length||count<=0) return picked;
        const step = list.length / count; const used=new Set();
        for(let i=0;i<count && i<list.length;i++){
          const idx = Math.floor(i*step + step/2); const clamp = Math.max(0, Math.min(list.length-1, idx));
          let found=-1; for(let r=0;r<=radius && found<0;r++){
            for(const sign of [-1,1]){ const j = clamp + sign*r; if(j<0||j>=list.length) continue; if(used.has(j)) continue; found=j; break;
            }
          }
          if(found>=0){ used.add(found); picked.push(list[found]); }
        }
        for(let j=0; picked.length<count && j<list.length; j++){ if(used.has(j)) continue; picked.push(list[j]); }
        return picked.slice(0, count);
      }
      if(allWhiteCandidates.length){
        const takeWinter = Math.min(needW, winterWhiteCandidates.length);
        const pickW = pickDistributedFrom(winterWhiteCandidates, takeWinter);
        whites.push(...pickW);
        const remaining = needW - whites.length;
        if(remaining > 0){
          const pickOther = pickDistributedFrom(otherWhiteCandidates, Math.min(remaining, otherWhiteCandidates.length));
          whites.push(...pickOther);
        }
        for(const ds of whites.slice(0, needW)){ dayMap[ds]='W'; }
      }
    }

    return dayMap;
  }

  // Build final Tempo day map for the data range by combining API (past) with local generator (future/unknown)
  async function ensureTempoDayMap(records){
    // Determine range from records
    let minD=null, maxD=null;
    if(records && records.length){ for(const r of records){ const d=new Date((r.dateDebut||'').slice(0,10)); if(isNaN(d)) continue; if(!minD||d<minD) minD=d; if(!maxD||d>maxD) maxD=d; } }
    if(!minD){ const y=new Date().getFullYear(); minD=new Date(y,0,1); maxD=new Date(y,11,31); }
    // Start with local generator for whole range (ensures future/missing days available)
    const genMap = generateTempoCalendarAlgorithm(records);
    // Merge any stored persisted colors first (these override generator)
    const stored = loadStoredTempoMap();
    const initial = { ...genMap, ...stored };

    // Try API for past days up to today; leave future to generator
    const today = new Date(); today.setHours(0,0,0,0);
    const apiEnd = (maxD < today) ? maxD : today;
    // Compute how many dates actually need fetching (not already in storage)
    let totalToFetch = 0; const storedForCount = loadStoredTempoMap();
    for(let d=new Date(minD); d<=apiEnd; d.setDate(d.getDate()+1)){ const ds=d.toISOString().slice(0,10); if(!storedForCount[ds]) totalToFetch++; }
    let done = 0;
    let apiMap = {};
    try{
      if(DEFAULTS.tempoApi && DEFAULTS.tempoApi.enabled && totalToFetch>0){
        showTempoLoading(totalToFetch);
      }
      apiMap = await fetchTempoFromApiRange(minD, apiEnd, (inc)=>{ done += (Number(inc)||0); updateTempoLoading(done, totalToFetch); });
    }catch(e){ apiMap = {}; }
    finally{ try{ hideTempoLoading(); }catch(e){} }
    // Persist fetched colors and build final map (generator -> stored -> api)
  const apiCount = (apiMap && Object.keys(apiMap).length) ? Object.keys(apiMap).length : 0;
    if(apiCount){ upsertStoredTempoColors(apiMap); }
    const afterApi = { ...initial, ...apiMap };
    const finalMap = afterApi;
    // Build source map for diagnostics
    const src = {};
    for(const k of Object.keys(genMap)) src[k] = 'gen';
    for(const k of Object.keys(stored||{})) src[k] = 'store';
    for(const k of Object.keys(apiMap||{})) src[k] = 'api';
    __tempoSourceMap = src;
  __tempoApiUsed = apiCount > 0;
  const storedCount = Object.keys(stored||{}).length;
  __tempoRealUsed = (__tempoApiUsed || storedCount > 0);
    __tempoDayMapCache = finalMap;
    // Re-rendre le calendrier s'il est affiché (permet de refléter les vraies couleurs après récupération API)
    try{
      const cont = document.getElementById('tempo-calendar-graph');
      if(cont){
        try{ const dailyCostMap = computeDailyTempoCostMap(records, finalMap); renderTempoCalendarGraph(finalMap, dailyCostMap); }
        catch(err){ renderTempoCalendarGraph(finalMap); }
      }
    }catch(e){}
    return finalMap;
  }

  // Render a TEMPO calendar visualization: month by month grid with colored bubbles and tooltip showing date + representative price + daily cost
  function mapColorToHex(col){
    if(!col) return '#dddddd';
    const c = String(col).toUpperCase();
    if(c === 'R') return '#e15759';
    if(c === 'W') return '#59a14f';
    if(c === 'B') return '#4e79a7';
    return '#999999';
  }

  function getRepresentativePriceForEntry(entry){
    // entry may be 'B'|'W'|'R' or an object with .rates {hp,hc}
    let rates = null;
    if(!entry) return Number(DEFAULTS.priceBase || 0);
    if(typeof entry === 'string'){
      const letter = entry.toUpperCase(); const key = (letter === 'B') ? 'blue' : (letter === 'W') ? 'white' : (letter === 'R') ? 'red' : entry.toLowerCase(); const def = DEFAULTS.tempo && DEFAULTS.tempo[key]; if(def && typeof def === 'object') rates = { hp: Number(def.hp)||0, hc: Number(def.hc)||0 }; else rates = { hp: Number(def)||0, hc: Number(def)||0 };
    } else if(entry && typeof entry === 'object'){
      if(entry.rates) rates = { hp: Number(entry.rates.hp)||0, hc: Number(entry.rates.hc)||0 };
      else if(entry.color){ const letter = String(entry.color||'').toUpperCase(); const key = (letter === 'B') ? 'blue' : (letter === 'W') ? 'white' : (letter === 'R') ? 'red' : (entry.color||'').toLowerCase(); const def = DEFAULTS.tempo && DEFAULTS.tempo[key]; if(def) rates = { hp: Number(def.hp)||0, hc: Number(def.hc)||0 }; }
    }
    if(!rates) return Number(DEFAULTS.priceBase || 0);
    // representative price: simple average of hp and hc
    return (Number(rates.hp) + Number(rates.hc)) / 2;
  }

  // Build per-day cost map (€/jour) for TEMPO with segmentation (0-6 prev day color, 6-22 HP, 22-24 HC)
  function computeDailyTempoCostMap(records, dayMap){
    const out = {};
    function colorLetterToKey(letter){
      if(!letter) return 'blue';
      const L = String(letter).toUpperCase(); if(L === 'B') return 'blue'; if(L === 'W') return 'white'; if(L === 'R') return 'red'; return String(letter).toLowerCase();
    }
    function getRates(entryOrColor, color){
      const entry = typeof entryOrColor === 'object' ? entryOrColor : null;
      if(entry && entry.rates && typeof entry.rates === 'object'){
        return { hp: Number(entry.rates.hp)||0, hc: Number(entry.rates.hc)||0 };
      }
      const key = colorLetterToKey(color);
      const def = DEFAULTS.tempo && DEFAULTS.tempo[key];
      if(def && typeof def === 'object'){ return { hp: Number(def.hp)||0, hc: Number(def.hc)||0 }; }
      const single = (DEFAULTS.tempo && DEFAULTS.tempo[key]) || 0;
      return { hp: Number(single)||0, hc: Number(single)||0 };
    }
    function ymd(d){ return d.toISOString().slice(0,10); }
    for(const r of records){
      const dt = new Date(r.dateDebut);
      const h = dt.getHours();
      const dateStr = ymd(dt);
      // Determine bucket day and color with TEMPO segmentation
      let bucketDateStr, colorLetter, isHC;
      if(h < 6){
        const prev = new Date(dt); prev.setDate(prev.getDate()-1);
        bucketDateStr = ymd(prev);
        const entryPrev = dayMap[bucketDateStr] || 'B';
        colorLetter = (typeof entryPrev === 'string') ? entryPrev.toUpperCase() : ((entryPrev && entryPrev.color) ? String(entryPrev.color).toUpperCase() : 'B');
        isHC = true;
      } else if(h >= 22){
        bucketDateStr = dateStr;
        const entryCur = dayMap[bucketDateStr] || 'B';
        colorLetter = (typeof entryCur === 'string') ? entryCur.toUpperCase() : ((entryCur && entryCur.color) ? String(entryCur.color).toUpperCase() : 'B');
        isHC = true;
      } else {
        bucketDateStr = dateStr;
        const entryCur = dayMap[bucketDateStr] || 'B';
        colorLetter = (typeof entryCur === 'string') ? entryCur.toUpperCase() : ((entryCur && entryCur.color) ? String(entryCur.color).toUpperCase() : 'B');
        isHC = false; // HP 6-22
      }
      const entryForBucket = dayMap[bucketDateStr] || 'B';
      const rates = getRates(entryForBucket, colorLetter);
      const applied = isHC ? rates.hc : rates.hp;
      const v = Number(r.valeur)||0;
      if(!out[bucketDateStr]) out[bucketDateStr] = { energy: 0, cost: 0, hpCost: 0, hcCost: 0, hpEnergy: 0, hcEnergy: 0, color: colorLetter };
      out[bucketDateStr].energy += v;
      out[bucketDateStr].cost += v * applied;
      if(isHC){ out[bucketDateStr].hcCost += v * applied; out[bucketDateStr].hcEnergy += v; }
      else { out[bucketDateStr].hpCost += v * applied; out[bucketDateStr].hpEnergy += v; }
      out[bucketDateStr].color = colorLetter;
    }
    return out;
  }

  function createTooltip(){
    let t = document.getElementById('tempo-tooltip');
    if(t) return t;
    t = document.createElement('div'); t.id = 'tempo-tooltip'; t.className = 'tempo-tooltip'; document.body.appendChild(t); return t;
  }

  function renderTempoCalendarGraph(dayMap, dailyCostMap){
    const container = document.getElementById('tempo-calendar-graph'); if(!container){ console.warn('tempo-calendar-graph container not found'); return; }
    container.innerHTML = '';
    function showError(msg){ container.innerHTML = `<div style="color:#b00020;background:#fff0f0;padding:8px;border-radius:6px;border:1px solid #f3c2c2">Erreur affichage calendrier: ${String(msg)}</div>`; }
    // compute min/max from dayMap keys
    try{
      const keys = Object.keys(dayMap).filter(k=> /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
      if(keys.length === 0){ container.textContent = 'Aucun jour dans le calendrier.'; return; }
    const start = new Date(keys[0]); const end = new Date(keys[keys.length-1]);
    const tooltip = createTooltip();

    // iterate months from start to end
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while(cur <= end){
      const monthStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
      const monthEnd = new Date(cur.getFullYear(), cur.getMonth()+1, 0);
      const monthLabel = monthStart.toLocaleString('fr-FR', { month:'long', year:'numeric' });
      const monthBox = document.createElement('div'); monthBox.className = 'tempo-month';
      const h = document.createElement('h5'); h.textContent = monthLabel; monthBox.appendChild(h);
      // weekday labels (Mon..Sun)
      const weekdays = ['L','M','M','J','V','S','D'];
      const wk = document.createElement('div'); wk.className = 'tempo-weekdays'; for(const w of weekdays){ const el = document.createElement('div'); el.style.textAlign='center'; el.textContent = w; wk.appendChild(el); } monthBox.appendChild(wk);
      const grid = document.createElement('div'); grid.className = 'tempo-grid';
      // for layout, find first day of week (Monday=0)
      const firstDow = (new Date(monthStart).getDay() + 6) % 7; // Monday-based index
      // add empty placeholders to align first day
      for(let i=0;i<firstDow;i++){ const e = document.createElement('div'); e.className = 'tempo-day empty'; grid.appendChild(e); }

      // iterate days
      const mDays = isoDateRange(monthStart, monthEnd);
      for(const dStr of mDays){ const dateObj = new Date(dStr); if(dateObj < start || dateObj > end){ const e = document.createElement('div'); e.className='tempo-day dim'; e.textContent = dateObj.getDate(); grid.appendChild(e); continue; }
        const entry = dayMap[dStr] || 'B'; let colorKey = 'B'; if(typeof entry === 'string') colorKey = entry.toUpperCase(); else if(entry && typeof entry === 'object') colorKey = (entry.color||'B').toUpperCase(); const hex = mapColorToHex(colorKey);
        const dayEl = document.createElement('div'); dayEl.className = 'tempo-day'; dayEl.style.background = hex; dayEl.textContent = String(dateObj.getDate());
        // compute representative price
        const price = getRepresentativePriceForEntry(entry);
        // tooltip handlers
        dayEl.addEventListener('mouseenter', (ev)=>{
          tooltip.style.display = 'block';
          const info = dailyCostMap && dailyCostMap[dStr];
          const costTxt = info && typeof info.cost === 'number' ? `${info.cost.toFixed(2)} €` : '-';
          const energyTxt = info && typeof info.energy === 'number' ? `${info.energy.toFixed(2)} kWh` : '-';
          const hpCostTxt = info && typeof info.hpCost === 'number' ? `${info.hpCost.toFixed(2)} €` : '-';
          const hcCostTxt = info && typeof info.hcCost === 'number' ? `${info.hcCost.toFixed(2)} €` : '-';
          const hpEnergyTxt = info && typeof info.hpEnergy === 'number' ? `${info.hpEnergy.toFixed(2)} kWh` : '-';
          const hcEnergyTxt = info && typeof info.hcEnergy === 'number' ? `${info.hcEnergy.toFixed(2)} kWh` : '-';
          tooltip.innerHTML = `
            <strong>${dStr}</strong><br/>
            Couleur: ${colorKey}<br/>
            Prix rep.: ${price.toFixed(4)} €/kWh<br/>
            Coût jour: ${costTxt} — Conso jour: ${energyTxt}<br/>
            HP: ${hpCostTxt} / ${hpEnergyTxt} &nbsp;|&nbsp; HC: ${hcCostTxt} / ${hcEnergyTxt}
          `;
        });
        dayEl.addEventListener('mousemove', (ev)=>{ const pad=12; tooltip.style.left = (ev.clientX + pad) + 'px'; tooltip.style.top = (ev.clientY + pad) + 'px'; });
        dayEl.addEventListener('mouseleave', ()=>{ tooltip.style.display = 'none'; });
        grid.appendChild(dayEl);
      }
      monthBox.appendChild(grid);
      container.appendChild(monthBox);
      // next month
      cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
    }
    }catch(err){ console.error('renderTempoCalendarGraph failed', err); showError(err && err.message || err); }
  }

  // Hook up Generate/Download buttons
  // manual generation UI removed — tempo calendar is generated automatically from files/analyze

  // tempo diagnostic removed — calendar is generated and rendered automatically during analysis

  // PV Toggle Logic
  const togglePv = document.getElementById('toggle-pv');
  const pvSettingsContainer = document.getElementById('pv-settings-container');
  const metricPv = document.getElementById('metric-pv');

  function updatePVVisibility() {
    const isEnabled = togglePv ? togglePv.checked : true;
    
    // Toggle Settings
    if (pvSettingsContainer) {
      pvSettingsContainer.style.display = isEnabled ? 'block' : 'none';
    }
    
    // Toggle Metric Card
    if (metricPv) {
      metricPv.style.display = isEnabled ? 'flex' : 'none'; // .result-card is flex
    }

    // Toggle Update Button
    const btnCalcPv = document.getElementById('btn-calc-pv');
    if (btnCalcPv) {
        btnCalcPv.style.display = isEnabled ? '' : 'none';
    }

    // Trigger re-calculation if we have data loaded (check if dashboard is visible)
    const dashboard = document.getElementById('dashboard-section');
    if (dashboard && !dashboard.classList.contains('hidden')) {
        // If we just toggled, we might want to refresh the offers comparison
        // But only if we are not in the middle of an analysis
        try {
            const btnCompare = document.getElementById('btn-compare-offers');
            if (btnCompare) btnCompare.click();
            // Also update monthly breakdown to reflect PV toggle state
            if (typeof renderMonthlyBreakdown === 'function') renderMonthlyBreakdown();
        } catch(e) {}
    }
  }

  if (togglePv) {
    togglePv.addEventListener('change', updatePVVisibility);
    // Init state
    updatePVVisibility();
  }

  // --- Auto-Update on Input Change ---
  const pvInputs = ['pv-kwp', 'pv-region', 'pv-standby', 'pv-cost-base', 'pv-cost-panel'];
  pvInputs.forEach(id => {
      const el = document.getElementById(id);
      if(el){
          el.addEventListener('change', ()=>{
              const btnCalc = document.getElementById('btn-calc-pv');
              if(btnCalc) btnCalc.click();
          });
      }
  });

  // ROI Slider Listener
  const roiSlider = document.getElementById('pv-roi-years');
  const roiDisplay = document.getElementById('pv-roi-display');
  if(roiSlider && roiDisplay){
      roiSlider.addEventListener('input', (e)=>{
          roiDisplay.textContent = e.target.value + ' ans';
      });
      roiSlider.addEventListener('change', ()=>{
          // Trigger re-calculation
          const btnCalc = document.getElementById('btn-calc-pv');
          if(btnCalc) btnCalc.click();
      });
  }

  // Estimate Standby Power Logic
  function calculateStandbyFromRecords(records) {
    // Filter for daytime hours (e.g. 10am - 4pm) to estimate standby during PV production
    const dayRecords = records.filter(r => {
        const h = new Date(r.dateDebut).getHours();
        return h >= 10 && h < 16;
    });
    
    if(dayRecords.length === 0) throw new Error('Pas de données de jour');
    
    // Calculate power in Watts for each record
    const powers = dayRecords.map(r => {
        const durationMs = new Date(r.dateFin) - new Date(r.dateDebut);
        const durationHours = durationMs / (1000 * 60 * 60);
        if(durationHours <= 0) return 0;
        const kw = Number(r.valeur) / durationHours;
        return kw * 1000;
    }).filter(p => p > 0).sort((a,b) => a - b);
    
    // Take 35th percentile to find a representative base load
    // (Using 35th instead of 10th avoids being too pessimistic about fridge cycles, while still excluding cooking peaks)
    const idx = Math.floor(powers.length * 0.35);
    return Math.round(powers[idx]);
  }

  const btnEstimateStandby = document.getElementById('btn-estimate-standby');
  if(btnEstimateStandby){
    btnEstimateStandby.addEventListener('click', async ()=>{
      const files = fileInput.files;
      if(!files || files.length===0){ alert('Veuillez d\'abord charger un fichier de consommation.'); return; }
      
      const originalText = btnEstimateStandby.textContent;
      btnEstimateStandby.textContent = '...';
      
      try {
        const records = await parseFilesToRecords(files);
        if(!records || records.length===0) throw new Error('Aucune donnée');
        
        const estimatedW = calculateStandbyFromRecords(records);
        
        const input = document.getElementById('pv-standby');
        if(input) {
            input.value = estimatedW;
            // Trigger auto-update
            input.dispatchEvent(new Event('change'));
        }
        
        btnEstimateStandby.textContent = '✅ ' + estimatedW + 'W';
        setTimeout(() => btnEstimateStandby.textContent = originalText, 2000);
        
      } catch(e) {
        console.warn('Estimation talon échouée', e);
        alert('Impossible d\'estimer le talon : ' + e.message);
        btnEstimateStandby.textContent = originalText;
      }
    });
  }
  
  // Expose for auto-run
  window.calculateStandbyFromRecords = calculateStandbyFromRecords;
})();
