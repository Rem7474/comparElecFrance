# Checkup Refactoring - ComparatifElec

## 🔍 Analyse Complète du Code

Date: 24 février 2026

### 📊 Résumé Exécutif

Le refactoring vers une architecture modulaire ES6 est **partiellement fonctionnel** mais présente de **nombreuses fonctionnalités manquantes** ou non branchées. Environ **60-70% des fonctionnalités de script.js** ne sont pas encore portées dans les modules src/.

---

## ❌ PROBLÈMES CRITIQUES IDENTIFIÉS

### 1. Événements UI Non Branchés

#### Boutons Sans événements dans app.js:
- **`btn-generate-csv`** - Script génération console Enedis (présent dans script.js ligne 19)
- **`btn-theme-toggle`** - Basculer thème clair/sombre
- **`btn-estimate-standby`** - Estimation talon consommation
- **`btn-export-report`** - Export rapport JSON (présent dans script.js ligne 534)
- **`btn-monthly-breakdown`** - Ventilation mensuelle (présent dans script.js ligne 870)
- **`btn-compare-offers`** - Comparaison offres (présent dans script.js ligne 1374, mais existe dans app.js non branché)

#### Contrôles Sans Gestionnaires:
- **`toggle-pv`** - Switch Photovoltaïque (présent dans script.js ligne 2379)
- **`param-power-kva`** - Sélection puissance (gestion dans script.js ligne 918)
- **`pv-roi-years`** - Slider ROI (présent dans script.js ligne 2400)
- **`param-hphc-hcRange`** - Plages HC (présent dans script.js ligne 918)
- **Zone drag & drop** - Non branchée dans app.js

---

### 2. Fonctions Non Exportées des Modules

#### Dans `src/utils.js`:
✅ Exportées:
- `formatNumber`
- `fmt`
- `isoDateRange`
- `isHourHC`
- `normalizeHcRange`
- `monthKeyFromDateStr`

❌ MANQUANTES (utilisées dans script.js):
- `computeHourlyStats` (ligne 100)
- `parseFilesToRecords` (ligne 68)
- `analyzeFilesNow` (ligne 158)

#### Dans `src/tariffEngine.js`:
✅ Exportées:
- `computeCostBase`
- `computeCostHpHc`
- `computeCostTotalCharge`
- `computeCostTempo`
- `computeCostTempoOptimized`
- `applyPvReduction`

❌ Utilisées dans script.js mais pas dans modules:
- `calculateTariffCostTempo` (script.js ~ligne 317)
- `getRatesForColor` (~ligne 333)
- `getTempoContextForHour` (~ligne 319)

#### Dans `src/pvSimulation.js`:
✅ Exportées:
- `simulateSolarProduction`
- `pvYieldPerKwp`
- `simulatePVEffect`
- `PV_HOURLY_PROFILE`

❌ MANQUANTES:
- `findBestPVConfig` (script.js ligne ~1490)
- `computeCostWithProfile` (script.js ligne ~1227)

#### Dans `src/tempoCalendar.js`:
✅ Exportées:
- `generateTempoCalendar`

❌ MANQUANTES:
- `fetchTempoFromApiRange` (script.js ligne ~1950)
- `ensureTempoDayMap` (script.js ligne ~2061)
- `generateTempoCalendarAlgorithm` (script.js ligne ~218)
- `computeDailyTempoCostMap` (script.js ligne ~2265)
- `renderTempoCalendarGraph` (script.js ligne ~2298)
- `loadStoredTempoMap` / `saveStoredTempoMap` (script.js ~ligne 1938)

---

### 3. Logique Métier Manquante dans app.js

#### Initialisation:
- ❌ Pas de chargement tarifs au démarrage (DEFAULTS)
- ❌ Pas de restauration localStorage
- ❌ Pas de gestion cache records
- ❌ Pas d'initialisation Tempo API

#### Gestion des Données:
- ❌ Pas de parsing CSV (window.csvToEnedisJson appelé mais non chargé comme module)
- ❌ Pas de déduplication records
- ❌ Pas de tri chronologique

#### Calculs:
- ❌ Pas de calcul kVA détecté
- ❌ Pas de mise à jour abonnement selon kVA
- ❌ Pas de calcul prix injection
- ❌ Pas de ventilation mensuelle détaillée

#### Visualisations:
- ❌ Pas de graphique mensuel
- ❌ Pas de graphique prix/kWh
- ❌ Pas de calendrier Tempo
- ❌ Pas de graphique économies mensuelles PV

---

### 4. Fonctions Appelées Mais Non Définies dans app.js

```javascript
// Ligne 195 dans app.js - app.js tente d'importer depuis utils.js mais utilise ensuite:
const { isHourHC, formatNumber } = await import('./utils.js');

// Mais dans triggerFullRecalculation, on appelle :
tariffEngine.computeCostBase(...)  // ✅ existe
tariffEngine.computeCostHpHc(...)  // ✅ existe
tariffEngine.computeCostTotalCharge(...)  // ✅ existe
tariffEngine.computeCostTempo(...)  // ✅ existe mais BESOIN de tempoDayMap !
tariffEngine.computeCostTempoOptimized(...)  // ✅ existe mais BESOIN de tempoDayMap !

// APPELS MANQUANTS :
pvSim.simulateSolarProduction(...)  // ligne 271 - ✅ défini MAIS config incomplète
tempoCal.getOrGenerateTempoCalendar(...)  // ligne 318 - ❌ NON EXPORTÉ !
```

---

### 5. Objets Globaux Manquants

Dans script.js, plusieurs objets globaux sont utilisés:
- `DEFAULTS` → Devrait être dans appState.defaults
- `__tempoDayMapCache` → Devrait être dans appState.tempoDayMap
- `__tempoSourceMap` → Devrait être dans appState.tempoSourceMap
- `__tempoApiUsed` → Devrait être dans appState.tempoApiUsed
- `window.currentKva` → Devrait être dans appState.currentKva
- `window.detectedKva` → Devrait être dans appState.detectedKva

Actuellement dans `src/state.js`, certains sont présents mais pas tous initialisés/utilisés.

---

## ✅ CE QUI FONCTIONNE

### Architecture:
- ✅ Structure modulaire ES6 créée
- ✅ État centralisé dans `state.js`
- ✅ Chargement dynamique tarifs JSON
- ✅ Modules séparés logiquement

### Fonctionnalités de Base:
- ✅ Import fichier JSON
- ✅ Affichage consommation totale
- ✅ Graphique horaire moyen
- ✅ Graphique HP/HC (pie chart)
- ✅ Calculs tarifaires de base (sans Tempo ni PV)

---

## 🔧 FONCTIONNALITÉS À RÉPARER/PORTER

### Haute Priorité (Bloquant):
1. **Branchement événements UI** - Tous les boutons/contrôles doivent avoir leurs handlers
2. **Initialisation DEFAULTS** - Charger structure tarifaire complète au démarrage  
3. **Calendrier Tempo** - Porter toute la logique API + génération + rendu
4. **Calculs Tempo** - Intégrer tempoDayMap dans computeCostTempo/Optimized
5. **Simulation PV complète** - findBestPVConfig, rapport rentabilité
6. **Ventilation mensuelle** - computeMonthlyBreakdown + graphiques

### Priorité Moyenne:
1. **LocalStorage** - Restauration/sauvegarde settings + Tempo
2. **Détection kVA** - Calcul automatique depuis puissance max
3. **CSV Parser** - Intégrer csvToEnedisJson comme module
4. **Drag & Drop** - Zone de dépôt fichiers
5. **Export rapport** - Génération JSON complet

### Basse Priorité (Nice-to-have):
1. **Thème sombre** - Toggle UI
2. **Graphiques avancés** - Prix/kWh mensuel, économies PV
3. **Optimisations** - Cache intelligent, debounce
4. **Standby estimation** - Calcul automatique talon

---

## 📝 PLAN DE CORRECTION SUGGÉRÉ

### Phase 1 - Événements UI (Urgent)
Créer `src/uiEvents.js` pour centraliser tous les addEventListener:
```javascript
export function initializeUIEvents() {
  // btn-generate-csv
  // btn-theme-toggle
  // btn-estimate-standby
  // btn-compare-offers
  // btn-export-report
  // btn-calc-pv
  // toggle-pv
  // param-power-kva
  // pv-roi-years
  // drop-zone
  // etc.
}
```

Appeler depuis app.js:
```javascript
import { initializeUIEvents } from './uiEvents.js';
document.addEventListener('DOMContentLoaded', () => {
  loadTariffs().then(() => {
    initializeUIEvents();
  });
});
```

### Phase 2 - Logique Tempo (Critique)
Compléter `src/tempoCalendar.js` avec:
- `fetchTempoFromApiRange` (API Enedis)
- `ensureTempoDayMap` (fusion API + storage + algo)
- `loadStoredTempoMap` / `saveStoredTempoMap` (localStorage)
- `renderTempoCalendarGraph` (visualisation) → déplacer vers src/charts.js
- `computeDailyTempoCostMap` (calculs journaliers)

Mettre à jour `appState.tempoDayMap` et l'utiliser dans `tariffEngine.computeCostTempo`.

### Phase 3 - Graphiques & Ventilation
Créer `src/charts.js` pour:
- `renderHourlyChart`
- `renderHpHcPie`
- `renderMonthlyChart`
- `renderOffersChart`
- `renderPricePerKwhChart`
- `renderPVSavingsChart`
- `renderTempoCalendarGraph`

Créer `src/calculations.js` pour:
- `computeMonthlyBreakdown`
- `computeHourlyStats`
- `parseFilesToRecords`
- `detectMaxPower`

### Phase 4 - Optimisations PV
Porter dans `src/pvSimulation.js`:
- `findBestPVConfig` (recherche config optimale)
- `computeCostWithProfile` (calcul sur profil horaire)
- Rapport rentabilité complet

### Phase 5 - Persistence & Settings
Créer `src/storage.js`:
- `loadSettings` / `saveSettings` (tous les paramètres UI)
- `loadTempoMap` / `saveTempoMap`
- `getCachedRecords` / `setCachedRecords`

---

## 🎯 MÉTHODE DE VALIDATION

### Tests Manuels à Faire:
1. ✓ Charger un fichier JSON → dashboard s'affiche
2. ✗ Générer script console Enedis → copie dans clipboard
3. ✗ Activer/désactiver PV → graphiques s'adaptent
4. ✗ Changer kVA → coûts se recalculent
5. ✗ Modifier plage HC → HP/HC se recalcule
6. ✗ Changer région PV → production se recalcule
7. ✗ Cliquer "Comparer Offres" → graphique barres + grille comparatif
8. ✗ Voir calendrier Tempo → couleurs réelles si API dispo
9. ✗ Cliquer "Ventilation Mensuelle" → tableau + graphique détaillé
10. ✗ Exporter rapport → JSON téléchargé
11. ✗ Toggle thème → UI change
12. ✗ Estimer standby → valeur auto-remplie
13. ✗ Glisser-déposer fichier → analyse se lance

---

## 📦 FICHIERS À CRÉER/MODIFIER

### À Créer:
- `src/uiEvents.js` - Gestion centralisée événements UI
- `src/charts.js` - Tous les rendus graphiques
- `src/calculations.js` - Fonctions de calcul statistiques
- `src/storage.js` - Persistence localStorage

### À Compléter:
- `src/app.js` - Ajouter appels initializeUIEvents, gestion DEFAULTS
- `src/tempoCalendar.js` - Ajouter fetch API, storage, rendering
- `src/pvSimulation.js` - Ajouter findBestPVConfig, rapport détaillé
- `src/tariffEngine.js` - Intégrer dépendance tempoDayMap
- `src/utils.js` - Ajouter parseFilesToRecords, computeHourlyStats

### À Supprimer/Archiver:
- `script.js` - À terme, une fois tout porté (actuellement 2481 lignes)
- Garder temporairement pour référence, mais ne pas charger dans index.html

---

## 🔴 BUGS CONFIRMÉS

1. **Tempo sans couleurs réelles**: computeCostTempo appelé sans tempoDayMap → utilise fallback (approx%)
2. **PV rapport manquant**: Section #pv-report-section jamais remplie
3. **Ventilation mensuelle invisible**: Tableau et graphiques jamais affichés
4. **Comparaison offres incomplète**: Tempo Optimisé absent, grille vide
5. **Settings non persistés**: Aucun localStorage sauvegarde actif
6. **kVA ignoré**: Toujours 6 kVA même si détecté différent
7. **CSV non supporté**: csvToEnedisJson.js chargé mais appel échoue
8. **Drop zone inactive**: Pas d'événements sur #drop-zone

---

## 💡 RECOMMANDATIONS

1. **Adopter approche incrémentale**: Porter fonctionnalité par fonctionnalité de script.js vers modules
2. **Tests automatisés**: Ajouter tests unitaires pour chaque module
3. **Documentation**: Documenter chaque fonction exportée (JSDoc)
4. **Séparation concerns**: Ne pas mélanger logique métier et DOM dans même fichier
5. **État centralisé**: Toujours passer par appState, éviter variables globales
6. **Gestion erreurs**: Ajouter try/catch et retours d'erreur appropriés
7. **Performance**: Utiliser debounce pour recalculs auto, cache intelligent
8. **Accessibilité**: Ajouter aria-labels, focus management

---

## 📈 ÉTAT D'AVANCEMENT ESTIMÉ

| Composant | Script.js | Modules | Status |
|-----------|-----------|---------|--------|
| Import JSON | ✅ 100% | ✅ 80% | Basique OK, manque CSV/cache |
| Calculs tarifs Base/HP/HC | ✅ 100% | ✅ 90% | Quasi complet |
| Calculs Tempo | ✅ 100% | ⚠️ 30% | Besoin tempoDayMap |
| Calendrier Tempo | ✅ 100% | ❌ 10% | Quasi tout à porter |
| Simulation PV | ✅ 100% | ⚠️ 50% | Base OK, manque optim/rapport |
| Graphiques | ✅ 100% | ⚠️ 40% | 2/8 graphiques portés |
| Ventilation mensuelle | ✅ 100% | ❌ 5% | Quasi rien porté |
| Settings/Storage | ✅ 100% | ❌ 0% | Rien porté |
| UI Events | ✅ 100% | ⚠️ 15% | 2/13 boutons branchés |
| Export/Rapport | ✅ 100% | ❌ 0% | Rien porté |

**TOTAL ESTIMÉ: ~35% des fonctionnalités portées**

---

## ⏱️ ESTIMATION TEMPS DE CORRECTION

- Phase 1 (UI Events): **2-3 heures**
- Phase 2 (Tempo): **4-5 heures**
- Phase 3 (Graphiques): **3-4 heures**
- Phase 4 (PV Optim): **2-3 heures**
- Phase 5 (Storage): **1-2 heures**
- Tests & Debug: **3-4 heures**

**TOTAL: ~15-21 heures de développement**

---

## 🚀 PRIORITÉS IMMÉDIATES (Quick Wins)

Pour restaurer fonctionnalités de base rapidement:

1. **Brancher btn-compare-offers** (~30 min)
2. **Activer toggle-pv** (~20 min)
3. **Brancher param-power-kva** (~30 min)
4. **Port computeMonthlyBreakdown basique** (~1h)
5. **Initialiser DEFAULTS depuis tariffs chargés** (~30 min)

→ **En ~3h, vous pouvez récupérer ~50% des fonctionnalités**

---

## 📞 CONTACT & SUPPORT

Pour questions/aide:
- Référez-vous à script.js (lignes indiquées) pour logique exacte
- DEFAULTS structure: voir tariffs/*.json
- Documentation API Tempo: voir TARIFF_SYSTEM.md

---

**Fin du rapport**
_Généré automatiquement le 24/02/2026_
