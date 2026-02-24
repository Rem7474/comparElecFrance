# Quick Fixes - Corrections Prioritaires

## 🎯 Objectif
Restaurer rapidement les fonctionnalités de base en < 3 heures

---

## Fix #1: Brancher les événements UI manquants ⏱️ 1h

### Fichier: `src/app.js`

#### À ajouter après le chargement des tarifs (ligne 77+):

```javascript
document.addEventListener('DOMContentLoaded', () => {
  loadTariffs().then(() => {
    hideTariffErrorBanner();
    initializeAllUIEvents(); // ← NOUVEAU
  }).catch(() => {
    // Bannière déjà affichée par loadTariffs
  });

  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (!appState.tariffsLoaded) {
        showTariffErrorBanner('Les tarifs n'ont pas pu être chargés. Analyse impossible.');
        return;
      }
      triggerFullRecalculation();
    });
  }
  
  // NOUVEAU: Initialisation complète
  initializeAllUIEvents();
});

// NOUVELLE FONCTION: Initialiser tous les événements UI
function initializeAllUIEvents() {
  // Toggle PV
  const togglePv = document.getElementById('toggle-pv');
  if (togglePv) {
    togglePv.addEventListener('change', () => {
      const pvSettingsContainer = document.getElementById('pv-settings-container');
      const metricPv = document.getElementById('metric-pv');
      const isEnabled = togglePv.checked;
      
      if (pvSettingsContainer) pvSettingsContainer.style.display = isEnabled ? 'block' : 'none';
      if (metricPv) metricPv.style.display = isEnabled ? 'flex' : 'none';
      
      // Recalculer si données chargées
      const btnCalc = document.getElementById('btn-calc-pv');
      if (btnCalc && isEnabled) btnCalc.click();
    });
    // Init state
    togglePv.dispatchEvent(new Event('change'));
  }
  
  // Bouton Comparer Offres
  const btnCompare = document.getElementById('btn-compare-offers');
  if (btnCompare) {
    btnCompare.addEventListener('click', async () => {
      const fileInput = document.getElementById('file-input');
      if (!fileInput || !fileInput.files || !fileInput.files.length) {
        alert('Veuillez d\'abord charger un fichier');
        return;
      }
      // Déclencher le recalcul complet
      await triggerFullRecalculation();
    });
  }
  
  // Slider ROI
  const roiSlider = document.getElementById('pv-roi-years');
  const roiDisplay = document.getElementById('pv-roi-display');
  if (roiSlider && roiDisplay) {
    roiSlider.addEventListener('input', (e) => {
      roiDisplay.textContent = e.target.value + ' ans';
    });
    roiSlider.addEventListener('change', () => {
      // Recalcul rapport PV si données chargées
      const btnCalc = document.getElementById('btn-calc-pv');
      if (btnCalc) btnCalc.click();
    });
  }
  
  // Paramètre power kVA
  const kvaSelect = document.getElementById('param-power-kva');
  if (kvaSelect) {
    kvaSelect.addEventListener('change', () => {
      const val = kvaSelect.value;
      if (val === 'auto') {
        appState.currentKva = appState.detectedKva || 6;
      } else {
        appState.currentKva = Number(val);
      }
      // Recalculer coûts
      const btnCompare = document.getElementById('btn-compare-offers');
      if (btnCompare) btnCompare.click();
    });
  }
  
  // Inputs PV auto-update
  const pvInputs = ['pv-kwp', 'pv-region', 'pv-standby', 'pv-cost-base', 'pv-cost-panel'];
  pvInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        const btnCalc = document.getElementById('btn-calc-pv');
        if (btnCalc) btnCalc.click();
      });
    }
  });
  
  // Drag & Drop zone
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });
  }
  
  // Export rapport
  const btnExport = document.getElementById('btn-export-report');
  if (btnExport) {
    btnExport.addEventListener('click', async () => {
      const fileInput = document.getElementById('file-input');
      if (!fileInput || !fileInput.files || !fileInput.files.length) {
        alert('Veuillez d\'abord charger un fichier');
        return;
      }
      
      const report = {
        generatedAt: new Date().toISOString(),
        summary: {
          totalConsumption: appState.records.reduce((s, r) => s + (Number(r.valeur) || 0), 0),
          period: {
            start: appState.records[0]?.dateDebut,
            end: appState.records[appState.records.length - 1]?.dateFin
          }
        },
        tariffs: appState.tariffResults || {},
        pv: appState.pvResult || {},
        settings: {
          currentKva: appState.currentKva,
          detectedKva: appState.detectedKva
        }
      };
      
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'rapport_comparatif_elec.json';
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    });
  }
  
  // Bouton thème (bonus)
  const btnTheme = document.getElementById('btn-theme-toggle');
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      localStorage.setItem('theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
    });
    // Restaurer thème
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') document.body.classList.add('dark-theme');
  }
}
```

---

## Fix #2: Initialiser DEFAULTS depuis tariffs ⏱️ 30min

### Fichier: `src/app.js`

#### Après le chargement des tarifs (ligne 50+):

```javascript
export async function loadTariffs() {
  // ... code existant jusqu'à: appState.tariffs = tariffs;
  
  // NOUVEAU: Construire DEFAULTS pour rétrocompatibilité
  appState.defaults = buildDefaultsFromTariffs(tariffs);
  
  appState.tariffsLoaded = true;
  appState.tariffsError = null;
  hideTariffErrorBanner();
  return tariffs;
  // ...
}

// NOUVELLE FONCTION
function buildDefaultsFromTariffs(tariffs) {
  const defaults = {
    monthlySolarWeights: [0.03, 0.05, 0.09, 0.11, 0.13, 0.14, 0.15, 0.13, 0.10, 0.07, 0.04, 0.03],
    injectionPrice: 0.10,
    base: tariffs.base || {},
    hphc: tariffs.hphc || {},
    tempo: tariffs.tempo || {},
    tempoOptimized: tariffs.tempoOptimized || {},
    totalCharge: tariffs.totalCharge || {}
  };
  
  // Mapping pour compatibilité avec ancien code
  if (tariffs.hphc) {
    defaults.hp = {
      php: tariffs.hphc.php,
      phc: tariffs.hphc.phc,
      hcRange: tariffs.hphc.hcRange,
      sub: tariffs.hphc.subscriptions?.[6] || 0
    };
  }
  
  return defaults;
}
```

---

## Fix #3: Activer bouton "Calculer PV" ⏱️ 20min

### Fichier: `src/app.js`

#### Ajouter dans initializeAllUIEvents():

```javascript
// Bouton Calculer PV
const btnCalcPv = document.getElementById('btn-calc-pv');
if (btnCalcPv) {
  btnCalcPv.classList.remove('hidden'); // Rendre visible
  
  btnCalcPv.addEventListener('click', async () => {
    const fileInput = document.getElementById('file-input');
    if (!fileInput || !fileInput.files || !fileInput.files.length) {
      alert('Veuillez d\'abord charger un fichier');
      return;
    }
    
    const togglePv = document.getElementById('toggle-pv');
    if (!togglePv || !togglePv.checked) return;
    
    // Config PV depuis les inputs
    const pvConfig = {
      region: document.getElementById('pv-region')?.value || 'centre',
      puissance: Number(document.getElementById('pv-kwp')?.value) || 3,
      standbyW: Number(document.getElementById('pv-standby')?.value) || 0
    };
    
    // Simulation
    const pvResult = await pvSim.simulateSolarProduction(appState.records, pvConfig);
    appState.pvResult = pvResult;
    
    // Affichage
    const pvEl = document.getElementById('val-pv-prod');
    if (pvEl) {
      pvEl.textContent = `${pvResult.production.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh`;
    }
    
    // Recalculer les offres avec PV
    const btnCompare = document.getElementById('btn-compare-offers');
    if (btnCompare) btnCompare.click();
  });
}
```

---

## Fix #4: Rendre visible le bouton "Comparer Offres" ⏱️ 5min

### Fichier: `src/app.js`

#### Dans triggerFullRecalculation(), ligne ~142:

```javascript
// 3. Afficher le dashboard
const dashboard = document.getElementById('dashboard-section');
if (dashboard) dashboard.classList.remove('hidden');

// NOUVEAU: Rendre visibles les boutons d'action
const btnCalcPv = document.getElementById('btn-calc-pv');
if (btnCalcPv) btnCalcPv.classList.remove('hidden');

const btnCompare = document.getElementById('btn-compare-offers');
if (btnCompare) btnCompare.classList.remove('hidden');
```

---

## Fix #5: Ajouter détection kVA automatique ⏱️ 30min

### Fichier: `src/app.js`

#### Ajouter dans triggerFullRecalculation(), après ligne ~157:

```javascript
// 5. Afficher la consommation totale
const totalConsoEl = document.getElementById('val-total-conso');
if (totalConsoEl) totalConsoEl.textContent = total.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' kWh';

// NOUVEAU: Détection automatique kVA
let stepDurationHours = 0.5; // 30 min par défaut Enedis
if (records.length > 2) {
  const t1 = new Date(records[0].dateDebut).getTime();
  const t2 = new Date(records[1].dateDebut).getTime();
  const diff = Math.abs(t2 - t1);
  if (diff > 0 && diff < 86400000) stepDurationHours = diff / 3600000;
}

const maxValEnergy = Math.max(...stats.max);
const maxPowerKw = (stepDurationHours > 0) ? (maxValEnergy / stepDurationHours) : maxValEnergy;

const kvaSteps = [3, 6, 9, 12, 15, 18, 24, 30, 36];
let recommendedKva = 36;
for (const s of kvaSteps) {
  if (s >= maxPowerKw) {
    recommendedKva = s;
    break;
  }
}

appState.detectedKva = recommendedKva;

// Afficher info détection
const kvaInfo = document.getElementById('power-detected-info');
if (kvaInfo) {
  kvaInfo.textContent = `Max détecté: ${maxPowerKw.toFixed(1)} kW → ${recommendedKva} kVA recommandé`;
}

// Appliquer si mode auto
const kvaSel = document.getElementById('param-power-kva');
if (kvaSel && kvaSel.value === 'auto') {
  appState.currentKva = recommendedKva;
} else if (!appState.currentKva) {
  appState.currentKva = 6; // Défaut
}
```

---

## Fix #6: Ajouter fonction computeHourlyStats ⏱️ 15min

### Fichier: `src/utils.js`

#### Ajouter à la fin du fichier:

```javascript
/**
 * Calcule les statistiques horaires à partir des records
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
```

---

## Fix #7: Utiliser computeHourlyStats dans app.js ⏱️ 10min

### Fichier: `src/app.js`

#### Ligne ~143, remplacer le calcul manuel par:

```javascript
import { isHourHC, formatNumber, computeHourlyStats } from './utils.js'; // ← Ajouter import

// ... dans triggerFullRecalculation()

// 4. Calculs statistiques
const stats = computeHourlyStats(records); // ← Utiliser la fonction utils

// 5. Afficher la consommation totale
const totalConsoEl = document.getElementById('val-total-conso');
if (totalConsoEl) totalConsoEl.textContent = stats.total.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' kWh';
```

---

## ✅ Vérification Rapide

Après ces corrections, vous devriez avoir:

1. ✅ Toggle PV fonctionnel
2. ✅ Bouton "Comparer Offres" visible et cliquable
3. ✅ Bouton "Calculer PV" visible et fonctionnel
4. ✅ Sélection kVA fonctionnelle
5. ✅ Détection automatique kVA
6. ✅ Drag & Drop fonctionnel
7. ✅ Export rapport JSON fonctionnel
8. ✅ Auto-recalcul sur changement inputs PV
9. ✅ DEFAULTS initialisé depuis tariffs

---

## 🧪 Test Rapide

```javascript
// Dans la console du navigateur après chargement d'un fichier:

// Vérifier appState
console.log(appState);
// Devrait afficher: records, tariffs, defaults, detectedKva, currentKva

// Vérifier DEFAULTS
console.log(appState.defaults);
// Devrait afficher: base, hphc, tempo, etc.

// Vérifier détection kVA
console.log(appState.detectedKva, appState.currentKva);
// Ex: 9, 9

// Test toggle PV
document.getElementById('toggle-pv').checked = true;
document.getElementById('toggle-pv').dispatchEvent(new Event('change'));
// Les settings PV doivent s'afficher

// Test bouton Compare
document.getElementById('btn-compare-offers').click();
// Les coûts doivent s'afficher dans offers-results-grid
```

---

## 📝 Prochaines Étapes (Phase 2)

Voir fichier complet: **CHECKUP_REFACTORING.md**

- Phase 2: Intégration Tempo complète (4-5h)
- Phase 3: Graphiques avancés (3-4h)
- Phase 4: Optimisation PV (2-3h)

**Total restant estimé: ~10-12h**

---

## ⚠️ Points d'Attention

- Ne pas oublier d'importer les fonctions ajoutées
- Tester chaque modification dans le navigateur
- Vérifier la console pour les erreurs
- Utiliser `appState` plutôt que variables globales
- Toujours vérifier que les éléments DOM existent avant utilisation

---

**Fin du guide Quick Fixes**
