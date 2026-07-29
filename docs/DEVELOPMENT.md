# Développement

## Prérequis & lancement local

Aucune dépendance, aucun build : uniquement du HTML/CSS/JS natif (modules
ES6) et quelques librairies chargées via CDN (Chart.js, jsPDF, XLSX).

```bash
git clone https://github.com/Rem7474/comparElecFrance.git
cd comparElecFrance
npx serve .        # ou: python3 -m http.server 8080
```

⚠️ Ouvrir `index.html` directement via `file://` ne fonctionne pas : les
modules ES6 et le chargement dynamique des tarifs
(`fetch('tariffs/index.json')`) nécessitent un serveur HTTP local minimal.

## Architecture

```
ComparatifElec/
├── index.html                       # Structure HTML
├── favicon.ico
├── src/
│   ├── app.js                       # Point d'entrée principal
│   ├── state.js                     # Gestion état (AppStateManager)
│   ├── analysisEngine.js            # Calculs statistiques (hourly, monthly)
│   ├── calculationEngine.js         # Cache & optimisations DOM
│   ├── tariffEngine.js              # Moteur calcul tarifs (type-based dispatcher)
│   ├── tariffManager.js             # Chargement dynamique tarifs JSON
│   ├── tariffDisplay.js             # Rendu cards tarifaires
│   ├── chartRenderer.js             # Graphiques Chart.js
│   ├── fileHandler.js               # Parsing JSON/CSV/XLSX
│   ├── uiManager.js                 # Gestion UI & événements
│   ├── pvManager.js                 # Contrôles PV (inputs)
│   ├── pvSimulation.js              # Calcul production solaire
│   ├── tempoCalendar.js             # Calendrier Tempo + API
│   ├── workflowEngine.js            # Orchestration recalculs
│   ├── utils.js                     # Utilities & localStorage
│   ├── exportManager.js             # Export PDF/Excel/Historique
│   ├── csvToEnedisJson.js           # Conversion CSV → JSON Enedis
│   └── styles/
│       ├── style.css                # Styles globaux
│       ├── style-improvements.css   # Ajustements UI
│       └── style-tariffs.css        # Styles cartes tarifaires
├── tariffs/
│   ├── index.json                   # Source-of-truth tarifaires
│   ├── base.json                    # Tarif simple
│   ├── hphc.json                    # HP/HC standard
│   ├── tempo.json                   # Tarif Tempo
│   ├── octopusEnergy.json           # OctopusEnergy (custom)
│   ├── injection.json               # Prix injection réseau
│   └── ... (custom tariffs)
└── .github/
    ├── workflows/
    │   ├── deploy.yml               # Déploiement GitHub Pages
    │   └── ci.yml                   # Validation HTML/JS sur PR
    └── copilot-instructions.md
```

### Modularité

- **14 modules** indépendants (chacun responsabilité unique)
- **AppStateManager** centralisé (source de vérité de la data), singleton
  accédé partout via `appState.getState()`
- **Imports/exports ES6** natifs, zéro dépendance npm — juste des CDN
  (Chart.js, jsPDF, XLSX) pour les fonctionnalités lourdes
- Clés `localStorage` préfixées `elec-`

### Data flow

```
Fichier (JSON/CSV)
    ↓ parseFile
Records Array
    ↓ analyzeFilesNow
Stats + Charts
    ↓ compareOffers
Offers Array [dynamique]
    ↓ chartRenderer
Visualisations
    ↓ exportManager
PDF/Excel/History
```

### Performance

- Parsing en une seule passe (O(n))
- Chart.js chargé à la demande (lazy)
- Cache des valeurs DOM (`readDomValuesOnce()`) et cache de calcul avec
  invalidation ciblée
- ~100 ms de latence pour l'analyse d'un fichier de 8760 records (1 an
  horaire)

### Sécurité

- Zéro envoi serveur, tout tourne dans le navigateur
- `localStorage` uniquement, les données ne quittent jamais l'appareil
- CSP-friendly : pas d'`eval`, pas de script inline
- L'authentification Enedis (le cas échéant) reste entièrement côté
  navigateur

## Ajouter un tarif personnalisé

**1. Créer le fichier** → `tariffs/monTarif.json`

```json
{
  "id": "monTarif",
  "name": "Mon Tarif Custom",
  "type": "two-tier",
  "color": "#FF6B6B",
  "php": 0.2500,
  "phc": 0.1800,
  "hcRange": "22-06",
  "sub": 120,
  "injectionPrice": 0.08
}
```

**2. Le référencer** → `tariffs/index.json`

```json
{
  "tariffs": [
    { "id": "monTarif", "file": "monTarif.json" }
  ]
}
```

**3. Redémarrer l'app** → le tarif est découvert automatiquement, aucune
modification de code nécessaire.

Types supportés :

- `flat` — prix unique (Base)
- `two-tier` — HP/HC
- `three-tier` — HP/HC/HSC (spécial TCH)
- `tempo` — jours R/B/W variables
- `tempo-optimized` — variante optimisée

## Technos

**Frontend :** HTML5/CSS3 (Flexbox, Grid, CSS Variables), JavaScript ES6+
(modules, async/await), Chart.js, jsPDF, html2canvas, XLSX.js (tous via
CDN) — pas de framework (React/Vue/Angular).

**Data :** fichiers JSON (tarifs, config), `localStorage` (historique
d'analyses), API Tempo (couleur du jour, optionnelle).

## Notes dev

- Des imports `script.js` legacy existent mais ne sont plus utilisés
- `DEFAULTS` est l'objet global de config par défaut (voir `utils.js`)

## Contribution

1. Forkez le repo et créez une branche depuis `main`
2. Ouvrez `index.html` via un serveur local (voir ci-dessus)
3. Le workflow CI (`.github/workflows/ci.yml`) valide le HTML et la
   syntaxe JS sur chaque PR
4. Ouvrez une Pull Request avec une description claire du changement
