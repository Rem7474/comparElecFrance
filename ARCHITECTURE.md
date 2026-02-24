# Architecture Diagram - Modular Tariff System

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     WEB APPLICATION                              │
│                    (index.html + CSS)                            │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    script.js IIFE                                │
│              (Main Application Logic)                            │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Global Objects:                                           │  │
│  │  • TARIFFS: { base, hphc, tempo, totalCharge }            │  │
│  │  • DEFAULTS: wrapper for backward compatibility           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Core Functions:                                           │  │
│  │  • loadTariffs(): async load all JSON files               │  │
│  │  • updateDEFAULTSWrapper(): populate DEFAULTS             │  │
│  │  • getActiveTariffIds(): get list of IDs                  │  │
│  │  • getTariff(id): get tariff by ID                        │  │
│  │  • getPriceForPower(type, kva): lookup subscription       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Cost Calculation:                                         │  │
│  │  • computeCostWithProfile()                               │  │
│  │  • computeCostTotalChargeForRecords()                      │  │
│  │  • computeMonthlyBreakdown()                              │  │
│  │  All use DEFAULTS[type]                                   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  UI/Visualization:                                         │  │
│  │  • Display results for each tariff                         │  │
│  │  • Chart.js graphs (all offers)                           │  │
│  │  • Monthly breakdown table                                │  │
│  │  • Paramètres section                                     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Initialization (at startup):                              │  │
│  │  1. (async () => { await loadTariffs(); })()              │  │
│  │  2. For each tariff file: fetch() + JSON.parse()          │  │
│  │  3. Store in TARIFFS object                               │  │
│  │  4. updateDEFAULTSWrapper() called                         │  │
│  │  5. Application ready                                      │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
┌──────────────────────┐    ┌──────────────────────┐
│   /tariffs/ DIR      │    │  Browser Cache      │
├──────────────────────┤    ├──────────────────────┤
│  base.json           │    │ Stores JSON files   │
│  hphc.json           │    │ for faster loading  │
│  tempo.json          │    │ on next visits      │
│  tempoOptimized.json │    │                     │
│  totalCharge.json    │    │                     │
└──────────────────────┘    └──────────────────────┘
```

---

## Data Flow: Adding New Tariff

```
┌─────────────────┐
│  Create JSON    │ → /tariffs/newoffer.json
│  File           │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Add to TARIFF_FILES array          │
│  in script.js (line ~90)            │
└────────┬────────────────────────────┘
         │
         ▼
    [Reload page]
         │
         ▼
┌─────────────────────────────────────┐
│  loadTariffs() automatically         │
│  fetches new file                   │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  TARIFFS.newoffer = { ... }         │
│  DEFAULTS.newoffer = { ... }        │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  getPriceForPower() finds tariff    │
│  Cost calculations work             │
│  UI displays new offer              │
└─────────────────────────────────────┘
         │
         ▼
     ✅ Done!
```

---

## Data Structure: Tariff Object

### Flat Tariff (Base)
```
base.json
├── id: "base"
├── name: "Base"
├── type: "flat"
├── price: 0.1940 ← Single rate
├── subscriptions: {
│   "3": 12.03,
│   "6": 15.65,
│   ...
│   "36": 52.54
├── color: "#4e79a7"
└── colorWithPV: "#a0cbe8"
```

### Two-Tier Tariff (HP/HC)
```
hphc.json
├── id: "hphc"
├── name: "Heures Pleines / Creuses"
├── type: "two-tier"
├── php: 0.2065 ← Peak rate
├── phc: 0.1579 ← Off-peak rate
├── hcRange: "22-06" ← Off-peak hours
├── subscriptions: { ... }
├── color: "#ff7f0e"
└── colorWithPV: "#ffbb78"
```

### Three-Color Tariff (Tempo)
```
tempo.json
├── id: "tempo"
├── name: "Tempo"
├── type: "tempo"
├── blue: {hp: 0.1612, hc: 0.1325} ← Cheapest
├── white: {hp: 0.1871, hc: 0.1499} ← Medium
├── red: {hp: 0.7060, hc: 0.1575} ← Most expensive
├── hcRange: "22-06"
├── approxPct: {B: 0.80, W: 0.15, R: 0.05}
├── subscriptions: { ... }
├── color: "#1f77b4"
└── colorWithPV: "#aec7e8"
```

### Three-Tier Tariff (HP/HC/HSC)
```
totalCharge.json
├── id: "totalCharge"
├── name: "Total Charge"
├── type: "three-tier"
├── php: 0.2305 ← Peak hours
├── phc: 0.1579 ← Off-peak hours
├── phsc: 0.1337 ← Super off-peak hours
├── hpRange: "07-23"
├── hcRange: "23-02;06-07"
├── hscRange: "02-06"
├── subscriptions: { ... }
├── color: "#d62728"
└── colorWithPV: "#ff9896"
```

---

## Function Call Hierarchy

```
┌─────────────────────────────────────┐
│   Page Load (DOMContentLoaded)      │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   IIFE at end of script.js          │
│   loadTariffs() async called        │
└────────────┬────────────────────────┘
             │
       ┌─────┴─────────────────────────────┐
       ▼                                   ▼
   fetch() × 5                     updateDEFAULTSWrapper()
   (JSON files)                    │
       │                           ├─ Copy TARIFFS → DEFAULTS
       ▼                           ├─ Add injectionPrice
   JSON.parse()                    ├─ Add monthlySolarWeights
       │                           ├─ Add tempoApi
       ▼                           └─ Normalize weights
   TARIFFS[id] = tariff
       │
       ▼
   Application Ready
       │
       ▼
┌─────────────────────────────────────┐
│   User imports file                 │
│   parseFilesToRecords()             │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   ensureTempoDayMap()               │
│   (Fetch Tempo colors if needed)    │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   computeMonthlyBreakdown()         │
│   For each tariff: compute costs    │
│   Uses: getPriceForPower(type, kva) │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   Display Results                   │
│   • Monthly table                   │
│   • Charts                          │
│   • PV simulation                   │
└─────────────────────────────────────┘
```

---

## File Dependency Graph

```
index.html
    ↓
    ├─→ style.css
    └─→ script.js (IIFE)
            ├─→ fetch('tariffs/base.json')
            ├─→ fetch('tariffs/hphc.json')
            ├─→ fetch('tariffs/tempo.json')
            ├─→ fetch('tariffs/tempoOptimized.json')
            └─→ fetch('tariffs/totalCharge.json')

Script Objects:
    TARIFFS
        ├─ base
        ├─ hphc
        ├─ tempo
        ├─ tempoOptimized
        └─ totalCharge
    
    DEFAULTS (wrapper)
        ├─ base ───────┐
        ├─ hphc ───────┤ same as TARIFFS
        ├─ tempo ──────┤
        └─ totalCharge─┘

Global Functions:
    loadTariffs()
    updateDEFAULTSWrapper()
    getActiveTariffIds()
    getTariff(id)
    getPriceForPower(type, kva)
    computeCostWithProfile()
    computeCostTotalChargeForRecords()
    computeMonthlyBreakdown()
```

---

## Execution Timeline

```
T0: Page loads
    │
T1: script.js executes (IIFE begins)
    ├─ DOM elements initialized
    ├─ Event listeners attached
    │
T2: IIFE ends, async loadTariffs() called
    │
T3-T7: fetch() requests start (parallel)
    ├─ GET /tariffs/base.json
    ├─ GET /tariffs/hphc.json
    ├─ GET /tariffs/tempo.json
    ├─ GET /tariffs/tempoOptimized.json
    └─ GET /tariffs/totalCharge.json
    │
T8: All JSON files loaded and parsed
    │
T9: updateDEFAULTSWrapper() executed
    │
T10: Application fully ready
     └─ User can interact
     └─ File import ready
     └─ All comparisons available

⏱️ Total startup time: ~100-500ms (depending on connection)
```

---

## Memory Structure

```
TARIFFS Object (in memory)
{
  "base": { id, name, type, price, subscriptions, color, colorWithPV },
  "hphc": { id, name, type, php, phc, hcRange, subscriptions, color, ... },
  "tempo": { id, name, type, blue, white, red, hcRange, approxPct, ... },
  "tempoOptimized": { ... },
  "totalCharge": { id, name, type, php, phc, phsc, hpRange, hcRange, ... }
}

DEFAULTS Object (references TARIFFS)
{
  "base": TARIFFS.base,
  "hphc": TARIFFS.hphc,
  "tempo": TARIFFS.tempo,
  "totalCharge": TARIFFS.totalCharge,
  "injectionPrice": 0,
  "monthlySolarWeightsRaw": [0.6, 0.7, ...],
  "monthlySolarWeights": [0.046, 0.054, ...],
  "tempoApi": { enabled: true, baseUrl: "...", ... }
}

Total memory footprint: ~50-100 KB (minimal)
```

---

## API Contract

### Global Functions Available

```javascript
// Get all tariff IDs
const ids = getActiveTariffIds();
// Returns: ['base', 'hphc', 'tempo', 'tempoOptimized', 'totalCharge']

// Get specific tariff
const tariff = getTariff('base');
// Returns: { id: 'base', name: 'Base', type: 'flat', price: 0.1940, ... }

// Get subscription price for power
const price = getPriceForPower('hphc', 9);
// Returns: 19.56 (€/month for 9 kVA)

// Access via DEFAULTS (backward compat)
const subscription_grid = DEFAULTS.base.subscriptions;
// Returns: { "3": 12.03, "6": 15.65, ... }
```

---

This diagram serves as a reference for understanding how the modular tariff system works at every level.
