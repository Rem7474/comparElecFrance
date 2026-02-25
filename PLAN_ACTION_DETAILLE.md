# 🔧 PLAN D'ACTION DÉTAILLÉ & CODE EXAMPLES

## Phase 1: Nettoyage Architecture (Semaine 1)

### 1.1 Supprimer script.js Legacy

```bash
# AVANT
src/
  ├── app.js (2186 LOC)
  ├── pvSimulation.js
  ├── state.js
  ├── tariffEngine.js
  ├── tempoCalendar.js
  └── utils.js
script.js (2645 LOC, DEPRECATED, avec erreur)

# APRÈS
src/
  ├── app.js (orchestrator, 300 LOC)
  ├── uiManager.js (400 LOC) - Nouvelle
  ├── fileHandler.js (200 LOC) - Nouvelle
  ├── chartRenderer.js (300 LOC) - Nouvelle
  ├── analysisEngine.js (200 LOC) - Nouvelle
  ├── pvSimulation.js (inchangé)
  ├── state.js (amélioré, Observer pattern)
  ├── tariffEngine.js (inchangé)
  ├── tempoCalendar.js (inchangé)
  └── utils.js (inchangé)
# script.js SUPPRIMÉ ✓
```

**Steps:**
```bash
cd src
# Créer nouveaux fichiers (voir exemples ci-dessous)
touch uiManager.js fileHandler.js chartRenderer.js analysisEngine.js

# Refactorer app.js (extraire code, importer depuis nouveaux modules)
# Tester après chaque extraction

# Supprimer script.js
rm ../script.js
```

### 1.2 Refactor state.js (Observer Pattern)

```javascript
// state.js - NOUVEAU (Observer pattern)

class AppStateManager {
  constructor() {
    this.state = {
      records: [],
      recordsCacheKey: null,
      tariffs: {},
      tempoDayMap: null,
      tempoSourceMap: null,
      detectedKva: null,
      currentKva: 6,
      uiState: {
        showPV: false,
        activePage: 'import', // import | analyze | config | results
        loading: false,
        error: null
      }
    };
    
    this.listeners = [];
    this.history = []; // Pour undo/redo futur
  }
  
  /**
   * Update state immutably and notify listeners
   * @param {Object} updates - Partial state updates
   * @param {string} [reason] - Optional action name for history
   */
  setState(updates, reason = '') {
    const previous = JSON.parse(JSON.stringify(this.state));
    this.state = { ...this.state, ...updates };
    
    // Enregistrer pour history
    if (reason) {
      this.history.push({ 
        reason, 
        timestamp: Date.now(), 
        previous, 
        current: this.state 
      });
      // Garder seulement dernier 20 changes
      if (this.history.length > 20) {
        this.history.shift();
      }
    }
    
    this.notifyListeners();
  }
  
  /**
   * Subscribe to state changes
   * @param {Function} listener - Callback (state) => void
   * @returns {Function} unsubscribe function
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }
    this.listeners.push(listener);
    
    // Immediately call with current state
    listener(this.state);
    
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  
  /**
   * Notify all listeners
   */
  notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('Listener error:', err);
      }
    }
  }
  
  /**
   * Get immutable state copy
   */
  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }
  
  /**
   * Undo to previous state
   */
  undo() {
    if (this.history.length > 0) {
      const previous = this.history.pop();
      this.state = previous.previous;
      this.notifyListeners();
      return true;
    }
    return false;
  }
}

export const appState = new AppStateManager();
```

**Usage:**
```javascript
// AVANT
appState.records = records;
appState.currentKva = 6;

// APRÈS
appState.setState({ records, currentKva: 6 }, 'Load file records');

// Subscribe to changes
const unsubscribe = appState.subscribe((state) => {
  console.log('State changed:', state);
  updateUI(state);
});

// Puis unsubscribe quand pas besoin
unsubscribe();
```

### 1.3 Créer fileHandler.js

```javascript
// src/fileHandler.js

import { appState } from './state.js';

const CACHE_CONFIG = {
  maxSize: 1_000_000, // 1MB max
  storageKey: 'comparatifElec.recordsCache'
};

/**
 * @typedef {Object} ParsedFile
 * @property {Array<EnergyRecord>} records
 * @property {string} cacheKey
 * @property {number} recordCount
 * @property {Error|null} error
 */

/**
 * Parse file (JSON or CSV) to records
 * @param {File} file
 * @param {Function} [onProgress]
 * @returns {Promise<ParsedFile>}
 */
async function parseFile(file, onProgress) {
  const name = (file.name || '').toLowerCase();
  
  try {
    const text = await file.text();
    
    if (name.endsWith('.json') || file.type.includes('json')) {
      return parseJSON(text);
    } else if (name.endsWith('.csv') || file.type.includes('csv')) {
      return parseCSV(text);
    } else {
      return { 
        records: [], 
        error: new Error(`Unsupported format: ${name}`) 
      };
    }
  } catch (err) {
    return { records: [], error: err };
  }
}

/**
 * Parse JSON Enedis format
 * @private
 */
function parseJSON(text) {
  const json = JSON.parse(text);
  const donnees = json?.cons?.aggregats?.heure?.donnees;
  
  if (!Array.isArray(donnees)) {
    throw new Error('Invalid Enedis JSON: missing cons.aggregats.heure.donnees');
  }
  
  const records = [];
  for (const rec of donnees) {
    const val = Number(rec.valeur);
    if (!Number.isNaN(val) && rec.dateDebut) {
      records.push({
        dateDebut: rec.dateDebut,
        dateFin: rec.dateFin,
        valeur: val
      });
    }
  }
  
  return {
    records: deduplicateRecords(records),
    cacheKey: generateCacheKey({ records }),
    recordCount: records.length,
    error: null
  };
}

/**
 * Parse CSV using converter
 * @private
 */
function parseCSV(text) {
  if (typeof window.csvToEnedisJson !== 'function') {
    throw new Error('CSV converter not available');
  }
  
  const json = window.csvToEnedisJson(text);
  return parseJSON(JSON.stringify(json));
}

/**
 * Deduplicate records by dateDebut
 * @private
 */
function deduplicateRecords(records) {
  const seen = new Set();
  const dedup = [];
  
  for (const rec of records) {
    if (!rec.dateDebut || seen.has(rec.dateDebut)) continue;
    seen.add(rec.dateDebut);
    dedup.push(rec);
  }
  
  return dedup.sort((a, b) => 
    new Date(a.dateDebut) - new Date(b.dateDebut)
  );
}

/**
 * Generate cache key for fileList
 * @private
 */
function generateCacheKey(data) {
  return `cache:${JSON.stringify(data).length}:${Date.now()}`;
}

/**
 * Load records from cache or parse
 * @param {FileList|File[]} fileList
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<Array>}
 */
export async function loadRecords(fileList, onProgress) {
  const files = Array.from(fileList || []);
  
  if (files.length === 0) {
    throw new Error('No files provided');
  }
  
  // Try cache first (if single file & unchanged)
  const currentKey = generateFileListKey(files);
  const { records, cacheKey } = appState.getState();
  
  if (records.length > 0 && cacheKey === currentKey) {
    onProgress?.(100, 'Loaded from cache');
    return records;
  }
  
  // Parse files
  const allRecords = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.((i / files.length) * 100, `Parsing ${file.name}`);
    
    const result = await parseFile(file);
    if (result.error) {
      console.warn(`Error parsing ${file.name}:`, result.error);
      continue;
    }
    
    allRecords.push(...result.records);
  }
  
  if (allRecords.length === 0) {
    throw new Error('No valid records found in any file');
  }
  
  // Deduplicate & sort
  const final = deduplicateRecords(allRecords);
  
  // Cache
  appState.setState({
    records: final,
    recordsCacheKey: currentKey
  }, 'Load records from files');
  
  onProgress?.(100, 'Done');
  return final;
}

/**
 * Generate key from file metadata
 * @private
 */
function generateFileListKey(files) {
  return Array.from(files)
    .map(f => `${f.name}:${f.size}:${f.lastModified}`)
    .join('|');
}
```

### 1.4 Créer uiManager.js

```javascript
// src/uiManager.js

import { appState } from './state.js';

class UIManager {
  constructor() {
    this.elements = new Map(); // Cache DOM references
    this.eventListeners = new Map();
  }
  
  /**
   * Initialize UI and attach event listeners
   */
  init() {
    this.cacheElements();
    this.attachListeners();
    this.attachStateListener();
  }
  
  /**
   * Cache DOM elements to avoid repeated queries
   * @private
   */
  cacheElements() {
    const selectors = {
      // File upload
      fileInput: '#file-input',
      dropZone: '#drop-zone',
      dropZoneText: '#drop-zone-text',
      dropZoneSub: '#drop-zone-subtext',
      
      // Theme
      btnThemeToggle: '#btn-theme-toggle',
      
      // PV
      togglePV: '#toggle-pv',
      pvSettings: '#pv-settings-container',
      
      // Results
      offersGrid: '#offers-results-grid',
      dashboardSection: '#dashboard-section',
      
      // Buttons
      btnCalcPV: '#btn-calc-pv',
      btnExportReport: '#btn-export-report'
    };
    
    for (const [key, selector] of Object.entries(selectors)) {
      const el = document.querySelector(selector);
      if (el) {
        this.elements.set(key, el);
      }
    }
  }
  
  /**
   * Attach UI event listeners
   * @private
   */
  attachListeners() {
    // File input
    const fileInput = this.elements.get('fileInput');
    const dropZone = this.elements.get('dropZone');
    
    if (fileInput && dropZone) {
      fileInput.addEventListener('change', (e) => {
        this.handleFileSelect(e.target.files);
      });
      
      this.setupDragAndDrop(dropZone, fileInput);
    }
    
    // Theme toggle
    const btnTheme = this.elements.get('btnThemeToggle');
    if (btnTheme) {
      btnTheme.addEventListener('click', () => this.toggleTheme());
    }
    
    // PV toggle
    const togglePV = this.elements.get('togglePV');
    if (togglePV) {
      togglePV.addEventListener('change', () => this.handlePVToggle());
    }
  }
  
  /**
   * React to state changes
   * @private
   */
  attachStateListener() {
    appState.subscribe((state) => {
      // Update UI based on state
      if (state.uiState.showPV) {
        this.showPVSettings();
      } else {
        this.hidePVSettings();
      }
      
      if (state.uiState.loading) {
        this.showLoading();
      } else {
        this.hideLoading();
      }
      
      if (state.records.length > 0) {
        this.showDashboard();
      } else {
        this.hideDashboard();
      }
    });
  }
  
  /**
   * Handle file selection
   */
  handleFileSelect(files) {
    const dropZoneText = this.elements.get('dropZoneText');
    const dropZoneSub = this.elements.get('dropZoneSub');
    const dropZone = this.elements.get('dropZone');
    
    if (files?.length > 0) {
      dropZone?.classList.add('has-file');
      dropZoneText.textContent = Array.from(files)
        .map(f => f.name)
        .join(', ');
      dropZoneSub.textContent = 'Fichiers prêts pour analyse';
      
      const icon = dropZone?.querySelector('.file-drop-zone-icon');
      if (icon) icon.textContent = '✅';
      
      // Trigger file loading
      this.dispatchEvent('filesSelected', { files });
    }
  }
  
  /**
   * Setup drag and drop
   * @private
   */
  setupDragAndDrop(dropZone, fileInput) {
    ['dragenter', 'dragover'].forEach(event => {
      dropZone.addEventListener(event, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });
    });
    
    ['dragleave', 'drop'].forEach(event => {
      dropZone.addEventListener(event, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });
    });
    
    dropZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files) {
        fileInput.files = files;
        this.handleFileSelect(files);
      }
    });
  }
  
  /**
   * Toggle theme between light/dark
   */
  toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    this.dispatchEvent('themeChanged', { isDark });
  }
  
  /**
   * Handle PV toggle
   */
  handlePVToggle() {
    const togglePV = this.elements.get('togglePV');
    const enabled = togglePV?.checked || false;
    appState.setState({ 
      uiState: { showPV: enabled } 
    }, 'Toggle PV');
  }
  
  /**
   * Show/hide PV settings
   */
  showPVSettings() {
    const container = this.elements.get('pvSettings');
    if (container) {
      container.classList.remove('hidden');
    }
  }
  
  hidePVSettings() {
    const container = this.elements.get('pvSettings');
    if (container) {
      container.classList.add('hidden');
    }
  }
  
  /**
   * Show/hide dashboard
   */
  showDashboard() {
    const dashboard = this.elements.get('dashboardSection');
    if (dashboard) {
      dashboard.classList.remove('hidden');
    }
  }
  
  hideDashboard() {
    const dashboard = this.elements.get('dashboardSection');
    if (dashboard) {
      dashboard.classList.add('hidden');
    }
  }
  
  /**
   * Show loading indicator
   */
  showLoading() {
    // TODO: Add spinner CSS + HTML
  }
  
  /**
   * Hide loading indicator
   */
  hideLoading() {
    // TODO: Hide spinner
  }
  
  /**
   * Dispatch custom event
   * @private
   */
  dispatchEvent(eventName, detail) {
    document.dispatchEvent(
      new CustomEvent('ui:' + eventName, { detail })
    );
  }
  
  /**
   * Listen to UI events
   * @public
   */
  on(eventName, handler) {
    const listener = (e) => handler(e.detail);
    document.addEventListener('ui:' + eventName, listener);
    
    // Return cleanup function
    return () => {
      document.removeEventListener('ui:' + eventName, listener);
    };
  }
}

export const uiManager = new UIManager();
```

---

## Phase 2: Performance Optimizations (Semaine 2)

### 2.1 Optimize Date Parsing

```javascript
// src/utils.js - UPDATE

/**
 * Parse record with cached date
 * @param {EnergyRecord} record
 * @returns {Object} record with date object
 */
export function withParsedDate(record) {
  if (record._date) return record;
  
  const date = new Date(record.dateDebut);
  return {
    ...record,
    _date: date,
    _hour: date.getHours(),
    _month: date.getMonth() + 1,
    _year: date.getFullYear()
  };
}

/**
 * Parse all records with dates
 */
export function parseRecordDates(records) {
  return records.map(withParsedDate);
}
```

**Usage:**
```javascript
// AVANT: new Date() called 8760 times
for (const rec of records) {
  const dt = new Date(rec.dateDebut);
  const hour = dt.getHours();
  // ...
}

// APRÈS: Parsed once
const parsed = parseRecordDates(records);
for (const rec of parsed) {
  const hour = rec._hour; // Cached
  // ...
}
```

### 2.2 Update Charts Instead of Recreating

```javascript
// src/chartRenderer.js

export class ChartManager {
  constructor() {
    this.instances = new Map();
  }
  
  /**
   * Get or create chart instance
   */
  getOrCreate(canvasId, chartType, options) {
    if (!this.instances.has(canvasId)) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) throw new Error(`Canvas #${canvasId} not found`);
      
      const ctx = canvas.getContext('2d');
      const chart = new Chart(ctx, {
        type: chartType,
        data: options.data,
        options: options.options
      });
      
      this.instances.set(canvasId, chart);
    }
    
    return this.instances.get(canvasId);
  }
  
  /**
   * Update chart data
   */
  update(canvasId, newData, animate = false) {
    const chart = this.instances.get(canvasId);
    if (!chart) return;
    
    chart.data.datasets = newData.datasets || chart.data.datasets;
    chart.data.labels = newData.labels || chart.data.labels;
    
    chart.update(animate ? 'active' : 'none');
  }
  
  /**
   * Destroy all charts
   */
  destroyAll() {
    for (const chart of this.instances.values()) {
      chart.destroy();
    }
    this.instances.clear();
  }
}

export const chartManager = new ChartManager();
```

**Usage:**
```javascript
// BEFORE: Destroy + recreate every time
if (hourlyChart) hourlyChart.destroy();
hourlyChart = new Chart(ctx, { ... }); // Expensive!

// AFTER: Update data
chartManager.update('hourly-chart', {
  labels: newLabels,
  datasets: [{ data: stats.avg, ... }]
});
```

---

## Phase 3: UI/UX Improvements (Semaine 3)

### 3.1 Implement Progress Stepper

```html
<!-- index.html - ADD AT TOP OF DASHBOARD -->

<div class="progress-stepper mb-4">
  <div class="step step-active" data-step="import">
    <div class="step-number">1</div>
    <div class="step-label">Importer</div>
  </div>
  <div class="step-connector active"></div>
  
  <div class="step" data-step="analyze">
    <div class="step-number">2</div>
    <div class="step-label">Analyser</div>
  </div>
  <div class="step-connector"></div>
  
  <div class="step" data-step="config">
    <div class="step-number">3</div>
    <div class="step-label">Configurer</div>
  </div>
  <div class="step-connector"></div>
  
  <div class="step" data-step="results">
    <div class="step-number">4</div>
    <div class="step-label">Résultats</div>
  </div>
</div>
```

```css
/* style.css - ADD */

.progress-stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-xl);
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 auto;
  position: relative;
  z-index: 1;
}

.step-number {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 2px solid var(--border-color);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  transition: all 0.3s;
}

.step.step-active .step-number {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.step.step-completed .step-number {
  background: var(--success);
  color: white;
  border-color: var(--success);
}

.step-label {
  font-size: 0.85rem;
  margin-top: 8px;
  color: var(--text-secondary);
  text-align: center;
}

.step.step-active .step-label {
  color: var(--primary);
  font-weight: 600;
}

.step-connector {
  flex: 1;
  height: 2px;
  background: var(--border-color);
  margin: 0 var(--spacing-md);
  transition: background 0.3s;
}

.step-connector.active {
  background: var(--success);
}
```

```javascript
// app.js - ADD

class StepperManager {
  constructor() {
    this.currentStep = 'import';
    this.completedSteps = new Set();
  }
  
  markStepComplete(stepName) {
    this.completedSteps.add(stepName);
    this.updateUI();
  }
  
  setCurrentStep(stepName) {
    this.currentStep = stepName;
    this.updateUI();
  }
  
  updateUI() {
    const steps = document.querySelectorAll('.step');
    const connectors = document.querySelectorAll('.step-connector');
    
    steps.forEach((step, index) => {
      const stepName = step.dataset.step;
      step.classList.remove('step-active', 'step-completed');
      
      if (stepName === this.currentStep) {
        step.classList.add('step-active');
      } else if (this.completedSteps.has(stepName)) {
        step.classList.add('step-completed');
      }
      
      // Update connector
      if (connectors[index]) {
        connectors[index].classList.toggle(
          'active',
          this.completedSteps.has(stepName)
        );
      }
    });
  }
}

const stepper = new StepperManager();

// Usage:
// stepper.markStepComplete('import');
// stepper.setCurrentStep('analyze');
```

### 3.2 Reorganize Results Cards

```html
<!-- index.html - REPLACE results section -->

<section class="card mb-4">
  <div class="card-header">
    <h2 class="card-title">💰 Comparaison des Offres</h2>
  </div>

  <!-- BEST OFFER HIGHLIGHT -->
  <div id="best-offer-container" class="mb-4"></div>

  <!-- OTHER OFFERS -->
  <div id="offers-grid" class="grid-3 mb-4"></div>

  <!-- CHARTS -->
  <div class="grid-2 mb-4">
    <div><h4 class="mb-4">Coût Annuel</h4><canvas id="cost-chart"></canvas></div>
    <div><h4 class="mb-4">€/kWh Moyen</h4><canvas id="price-chart"></canvas></div>
  </div>
</section>

<!-- IF PV ENABLED -->
<section class="card mb-4" id="pv-results-section">
  <div class="card-header">
    <h2 class="card-title">☀️ Simulation Photovoltaïque</h2>
  </div>

  <div id="pv-best-config" class="result-card card-optimized mb-4"></div>

  <div class="grid-2">
    <div><h4 class="mb-4">Économies Annuelles</h4><canvas id="pv-savings-chart"></canvas></div>
    <div><h4 class="mb-4">Production vs Consommation</h4><canvas id="pv-production-chart"></canvas></div>
  </div>
</section>
```

```javascript
// analysisEngine.js - NEW

/**
 * Find best of 4 offers
 */
export function findBestOffer(results) {
  let best = null;
  let bestCost = Infinity;
  
  for (const [name, data] of Object.entries(results)) {
    if (data.cost < bestCost) {
      best = name;
      bestCost = data.cost;
    }
  }
  
  return best;
}

/**
 * Rank offers by cost
 */
export function rankOffers(results) {
  return Object.entries(results)
    .sort(([, a], [, b]) => a.cost - b.cost)
    .map(([name, data]) => ({ name, ...data }));
}
```

---

## Phase 4: Testing Setup

### 4.1 Jest Configuration

```bash
# Install dependencies
npm init -y
npm install --save-dev jest @babel/preset-env babel-jest

# Create jest.config.js
```

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.js', '!src/app.js']
};
```

### 4.2 Sample Unit Tests

```javascript
// __tests__/tariffEngine.test.js

import { computeCostBase, computeCostHpHc } from '../src/tariffEngine.js';

describe('tariffEngine', () => {
  const mockRecords = [
    { dateDebut: '2024-01-01T00:00:00', valeur: 0.5 },
    { dateDebut: '2024-01-01T01:00:00', valeur: 0.4 },
    { dateDebut: '2024-01-01T22:00:00', valeur: 0.3 }
  ];
  
  describe('computeCostBase', () => {
    test('should calculate cost correctly', () => {
      const tariff = { priceBase: 0.2 };
      const result = computeCostBase(mockRecords, tariff);
      
      const expected = (0.5 + 0.4 + 0.3) * 0.2;
      expect(result.cost).toBeCloseTo(expected);
    });
    
    test('should handle empty records', () => {
      const tariff = { priceBase: 0.2 };
      const result = computeCostBase([], tariff);
      
      expect(result.cost).toBe(0);
    });
    
    test('should throw on invalid tariff', () => {
      expect(() => {
        computeCostBase(mockRecords, null);
      }).toThrow();
    });
  });
  
  describe('computeCostHpHc', () => {
    test('should separate HP/HC costs', () => {
      const tariff = {
        php: 0.2,
        phc: 0.1,
        hcRange: '22-06'
      };
      const result = computeCostHpHc(mockRecords, tariff);
      
      // Hours 22-23 are HC
      const hcCost = (0.3) * 0.1; // 22h
      const hpCost = (0.5 + 0.4) * 0.2; // 0-1h (but 0h & 1h not HC)
      
      expect(result.hc).toBeCloseTo(hcCost);
      expect(result.hp).toBeCloseTo(hpCost);
    });
  });
});
```

---

## Checklist d'Implémentation

### Week 1: Architecture
- [ ] Créer fileHandler.js
- [ ] Créer uiManager.js
- [ ] Refactor state.js
- [ ] Extraire logique app.js
- [ ] Supprimer script.js
- [ ] Tests: state.js

### Week 2: Performance
- [ ] Optimize date parsing
- [ ] Update charts (no destroy)
- [ ] Parallelize Tempo API
- [ ] Optimize DOM manipulation
- [ ] Benchmarks avant/après

### Week 3: UI/UX
- [ ] Stepper progress
- [ ] Reorganize results
- [ ] Loading states
- [ ] ARIA labels
- [ ] Mobile responsive

### Week 4: Testing & Docs
- [ ] Jest setup
- [ ] Unit tests (tariffs, PV)
- [ ] JSDoc generation
- [ ] README update

---

**Estimated Effort:** 4-6 semaines
**Complexity:** Moyenne
**Risk:** Faible (migration incrémentale)
