# ComparatifElec - Guide de Développement ES6

## 📋 Vue d'Ensemble

ComparatifElec est une application **100% côté client** (no backend) permettant d'analyser la consommation électrique et comparer les tarifs d'électricité en France. Elle a été entièrement refactorisée en **modules ES6** pour une meilleure maintenabilité.

### Points Clés
- **Aucun serveur requis** - tout tourne dans le navigateur
- **Modules ES6** - import/export standards JavaScript
- **localStorage** - persistance des paramètres
- **Chart.js** - visualisations en temps réel
- **Configuration externalisée** - tarifs en JSON

---

## 🏗️ Architecture Modulaire

```
src/
├── app.js                    (893 LOC) - Point d'entrée principal
├── state.js                  (30 LOC)  - État centralisé (appState)
├── utils.js                  (190 LOC) - Fonctions utilitaires
├── tariffEngine.js           (102 LOC) - 5 calculateurs tarifaires
├── pvSimulation.js           (185 LOC) - Simulation solaire
└── tempoCalendar.js          (515 LOC) - Calendrier Tempo + API

tariffs/
├── config.json              - Paramètres globaux (monthlySolarWeights, prix, API)
├── base.json                - Tarif Base (prix unique)
├── hphc.json                - Tarif HP/HC (heures pleines/creuses)
├── tempo.json               - Tarif Tempo (bleu/blanc/rouge)
├── tempoOptimized.json      - Tempo optimisé pour autoconsommation
└── totalCharge.json         - Tarif Total Charge (3 plages horaires)
```

### Flux d'Exécution Principal

```
index.html
    ↓
load <script type="module" src="src/app.js">
    ↓
DOMContentLoaded event
    ├─ loadPvSettings()              [localStorage restore]
    ├─ await loadTariffs()           [fetch *.json files]
    ├─ initializeAllUIEvents()       [wire 13 event listeners]
    └─ fileInput.addEventListener()  [ready for file import]
    
Utilisateur importe fichier
    ↓
triggerFullRecalculation()
    ├─ Parser JSON/CSV
    ├─ Compute hourly stats
    ├─ Render charts (hourly, pie, monthly)
    ├─ For each tariff: compute cost
    ├─ Display tariff comparison
    ├─ If PV enabled: simulate production
    ├─ Display PV results + savings
    └─ Render tempo calendar
```

---

## 📦 État Centralisé (appState)

### Structure Complète

```javascript
export const appState = {
  // === Données d'Entrée ===
  records: [],              // Données horaires importées [{dateDebut, dateFin, valeur}, ...]
  
  // === Configuration ===
  tariffs: {},              // 5 tariffs chargés (by id)
  defaults: {},             // Config externalisée (config.json)
  
  // === Tempo ===
  tempoDayMap: {},          // {2024-01-01: 'bleu', ...}
  tempoSourceMap: {},       // Debug: source de chaque jour
  tempoApiUsed: boolean,
  tempoRealUsed: boolean,
  
  // === Puissance Souscrite ===
  detectedKva: null,        // kVA auto-détecté
  currentKva: 6,            // kVA sélectionné
  
  // === Cache & Status ===
  recordsCache: {},         // Session cache (clé: filename:size:mtime)
  tariffsLoaded: boolean,
  tariffsError: string,
  
  // === Résultats Calculs ===
  tariffResults: {          // {base, hphc, tempo, tempoOptimized, totalCharge}
    base: {total: 1000, cost: 1000, ...},
    // ...
  },
  pvResult: {               // Résultats PV
    production: 3000,       // kWh/an
    selfConsumed: 1500,     // kWh/an
    savings: 450            // €/an
  },
  hourlyStats: {            // Stats calculs
    total: 10000,           // kWh total
    avg: [0.5, 0.6, ...],   // 24 valeurs horaires
    min: [...],
    max: [...]
  }
};
```

---

## 🔧 Modules d'Export

### app.js - Orchestration Principale

**Fonctions Publiques (export):**
```javascript
export async function loadTariffs()
// Charge config.json + 5 tariff files
// Sets: appState.tariffs, appState.defaults, appState.tariffsLoaded
// Returns: tariffs object

export async function triggerFullRecalculation()
// Orchestration complète : parse → stats → tarifs → PV → display
// Appelée via fileInput.addEventListener('change')
```

**Fonctions Privées (affichage):**
```javascript
function displayTariffComparison(results)
// Table + bar chart des 5 tarifs

function displayMonthlyBreakdown(records, tariffResults)
// Tableau détail mensuel

function displayPvResults(pvResult)
// Affichage résultats PV

function displaySavingsComparison(records, tariffResults, pvResult)
// Chart: coûts avec/sans PV

function displayMonthlySavingsChart(records, tariffResults)
// Line chart: coûts mensuels

function displayAnalysisSummary(records, tariffResults)
// KPI dashboard: puissance, conso, meilleure offre

function savePvSettings()
// localStorage.setItem('comparatifElec.pvSettings', JSON.stringify(...))

function loadPvSettings()
// localStorage.getItem + restore inputs
```

### state.js - État Centralisé

```javascript
export const appState = { /* ... */ }
```

Singulier, immutable en structure (mais mutable en valeurs).

### utils.js - Utilitaires

```javascript
export function isHourHC(hour, range)
// Check si heure dans plage creuses (ex: "22-06")

export function formatNumber(val)
// Format numérique français (. → ,)

export function computeHourlyStats(records)
// Calcule {total, avg[], min[], max[]} par heure
// Returns: {total: X, avg: [...], min: [...], max: [...]}
```

### tariffEngine.js - Calculateurs Tarifaires

```javascript
export function computeCostBase(records, tariff)
// Simple: (consumption × price) + subscriptions
// Returns: {cost: X, consumption: Y}

export function computeCostHpHc(records, tariff, hcRange)
// Sépare HP vs HC selon range (ex: "22-06")
// Returns: {cost: X, hp: Y, hc: Z}

export function computeCostTempo(records, tempoDayMap, tariff)
// Utilise color tempo (bleu/blanc/rouge) pour prix
// Returns: {cost: X, byColor: {blue: Y, ...}}

export function computeCostTempoOptimized(records, tempoDayMap, tariff)
// Idem Tempo mais optimisé pour autoconsommation PV

export function computeCostTotalCharge(records, tariff)
// 3 plages HP/HC/SC (ex: 07-23 / 23-02 / 02-06)
// Returns: {cost: X, byRange: {...}}
```

### pvSimulation.js - Simulation Solaire

```javascript
export async function simulateSolarProduction(records, config)
// config: {region: 'centre', puissance: 3, standbyW: 50}
// Produit estimation annuelle + autoconsommation
// Returns: {
//   production: kWh/an,
//   selfConsumed: kWh/an,
//   savings: €/an
// }
```

### tempoCalendar.js - Calendrier Tempo

```javascript
export async function ensureTempoDayMap(records)
// Récupère calendar Tempo via API RTE ou génère localement
// Stocke dans localStorage + appState.tempoDayMap
// Returns: void (modifie appState)

export function computeDailyTempoCostMap(records, tempoDayMap)
// Calcule coût daily selon couleur tempo
// Returns: {2024-01-01: 35.50, ...}

export function renderTempoCalendarGraph(tempoDayMap, dailyCostMap)
// Affiche grille visuelle du calendrier (7×5)
// Insère dans #tempo-calendar-graph
```

---

## 📊 Flux de Données Tarifaires

```
records (parsed)
    ↓
┌─────────────────────────────────────────┐
│  Pour chaque tarif (5 boucles):         │
│                                         │
│  records → computeCostXxx() → {cost}   │
│                              ↓          │
│                           + sub        │
│                              ↓          │
│                         {total: cost}  │
└─────────────────────────────────────────┘
    ↓
appState.tariffResults = {
  base: {total: 1050, cost: 1050},
  hphc: {total: 980, cost: 980, hp: 600, hc: 380},
  tempo: {total: 950, cost: 950, byColor: {blue: 400, ...}},
  tempoOptimized: {total: 920, cost: 920, ...},
  totalCharge: {total: 1020, cost: 1020, ...}
}
    ↓
displayTariffComparison(results)
    → table HTML + bar chart
```

---

## 🎯 Points d'Extension

### Ajouter un Nouveau Tarif

1. **Créer fichier** `tariffs/nouveauTarif.json`:
```json
{
  "id": "nouveauTarif",
  "name": "Nouveau Tarif",
  "type": "special",
  "price": 0.18,
  "subscriptions": {"6": 15.00, "9": 18.50, ...},
  "params": {"someParam": "value"}
}
```

2. **Ajouter calculateur** dans `src/tariffEngine.js`:
```javascript
export function computeCostNouveauTarif(records, tariff, ...params) {
  let totalCost = 0;
  // Logic here
  return {cost: totalCost, breakdown: {...}};
}
```

3. **Intégrer dans triggerFullRecalculation()** (app.js, ligne ~730):
```javascript
} else if (id === 'nouveauTarif') {
  res = tariffEngine.computeCostNouveauTarif(records, tariff);
  res.cost = (res.cost || 0) + sub;
}
```

4. **Ajouter mapping affichage** (app.js, displayTariffComparison):
```javascript
const name = { ..., nouveauTarif: 'Nouveau' }[id] || id;
```

---

## 💾 LocalStorage Schema

### Theme
```javascript
'theme' → 'light' | 'dark'
```

### PV Settings
```javascript
'comparatifElec.pvSettings' → {
  "pvKwp": "3",
  "pvRegion": "centre",
  "pvStandby": "50",
  "pvCostBase": "500",
  "pvCostPanel": "200",
  "pvRoiYears": "15"
}
```

### Tempo Calendar (généré)
```javascript
'comparatifElec.tempoDayMap' → {
  "2024-01-01": "bleu",
  "2024-01-02": "blanc",
  ...
}
```

---

## 🐛 Debugging Guide

### Enable Console Logging

Ajouter en début `src/app.js`:
```javascript
window.DEBUG = true; // Set to false to disable
const log = (msg, data) => {
  if (window.DEBUG) console.log(`[COMPARATIF] ${msg}`, data);
};
```

Puis utiliser:
```javascript
log('Tarifs chargés', appState.tariffs);
```

### Inspect appState

Console:
```javascript
// Voir l'état complet
console.table(window.appState);

// Inspecter un tarif
console.table(window.appState.tariffResults);

// Vérifier localStorage
console.log(JSON.parse(localStorage.getItem('comparatifElec.pvSettings')));
```

### Test avec Données Synthétiques

```javascript
// Générer 365 jours × 24 heures de donnees synthétiques
const records = [];
const start = new Date('2024-01-01');
for (let i = 0; i < 365*24; i++) {
  const d = new Date(start.getTime() + i*3600000);
  records.push({
    dateDebut: d.toISOString(),
    dateFin: new Date(d.getTime() + 3600000).toISOString(),
    valeur: 0.5 + Math.random()*1.5 // 0.5-2.0 kWh
  });
}
appState.records = records;
await triggerFullRecalculation();
```

---

## 📝 Procédure de Deploy

### Local Development
```bash
# Python 3.x
python -m http.server 8000

# Node.js
npx http-server

# Puis ouvrir: http://localhost:8000
```

### GitHub Pages (depuis gh-pages branch)
```bash
git checkout gh-pages
cp -r {src,tariffs,*.html,*.css,*.js} .
git add .
git commit -m "Deploy v0.2.0"
git push origin gh-pages
```

### Netlify
```bash
npm install -D netlify-cli
netlify deploy --prod --dir=.
```

---

## 📚 Références Externes

- **Chart.js**: https://www.chartjs.org/docs/3.9.1/
- **Enedis API**: https://www.enedis.fr/
- **Tempo Colors**: https://services-rte.com/cms/api_private/indicateurs
- **localStorage**: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- **ES6 Modules**: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules

---

## ✅ Prochaines Tâches

- [ ] Tester avec données réelles Enedis
- [ ] Valider Tempo API integration
- [ ] Implémenter offres grid cards (3-col layout)
- [ ] ROI profitability calculator hook
- [ ] PDF export via jsPDF
- [ ] Multi-langue (FR/EN/DE)
- [ ] Dark mode CSS completion
- [ ] Documentation utilisateur
- [ ] GitHub Release + versioning

---

**Version:** 0.2.0-RC1  
**Last Updated:** 2024.02.24  
**Maintainer:** [Your Name]  
**License:** MIT

