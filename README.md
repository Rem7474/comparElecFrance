# ⚡ ComparatifElec

**Analyse complète de consommation électrique & Simulation PV tout-en-un**

Application web 100% front-end pour analyser vos données Enedis, comparer les tarifs (Base, HP/HC, Tempo, TCH, + custom), simuler le photovoltaïque et exporter les résultats en PDF/Excel.

🌍 **En ligne:** [https://elec.remcorp.fr](https://elec.remcorp.fr)  
📅 **Mise à jour:** 5 mars 2026 - Phase 3.1 ✅ (Export PDF/Excel)

---

## 🚀 Fonctionnalités

### 📊 Analyse de Consommation
- ✅ Import JSON/CSV/Excel (fichiers Enedis)
- ✅ Statistiques horaires (profil moyens, min/max)
- ✅ Répartition HP/HC en graphique
- ✅ Détection talon de consommation (standby power)

### 💰 Comparaison Tarifaire (100% Dynamique)
- ✅ **Base** - Tarif fixe simple
- ✅ **HP/HC** - Heures pleines/creuses (TarifBleu, OctopusEnergy, Alpiq, custom)
- ✅ **TCH** - Total Charge Heures (3 périodes distinctes)
- ✅ **Tempo** - Tarif français dynamique (Jours Rouge/Blanc/Bleu)
- ✅ **Tempo Optimisé** - Variante optimisée
- ✅ **Custom Tarifaires** - Ajoutez illimité de tarifs (JSON seulement)

**Architecture dynamique:** Ajouter un tarif = `index.json` + fichier JSON (zéro modification code)

### ☀️ Simulation Photovoltaïque
- ✅ Puissance variable (0.5 - 10 kWc)
- ✅ Régions France (Nord 700, Centre 900, Sud 1100 kWh/kWc)
- ✅ Autoconsommation + injection réseau
- ✅ Estimation annuelle + mensuelle
- ✅ Calcul ROI (années pour rentabilité)
- ✅ Coûts installation modifiables

### 📤 Export & Partage
- ✅ **Export PDF** - Rapport complet avec résumé + tableaux
- ✅ **Export Excel** - 4 feuilles (Résumé, Offres, Mensuel, Données brutes)
- ✅ **Historique** - Sauvegarde localStorage (max 20 analyses)
- ✅ **Lien Partageable** - URL encodée (base64) pour partage

### 📈 Visualisations
- Profil horaire moyens (Bar chart)
- Répartition HP/HC (Pie chart)
- Coût mensuel par offre (Bar chart dynamique)
- Prix moyen €/kWh (Line chart avec PV)
- Économies mensuelles grâce PV (Stacked bar)
- Calendrier Tempo (Vue détaillée jours R/B/W)

---

## 🧭 Utilisation Rapide

### 1️⃣ Importer les données
```
📂 Glissez votre fichier JSON/CSV ou cliquez
   (Fichier Enedis ou export TotalEnergies)
```

### 2️⃣ Analyser
- Consommation annuelle affichée
- Graphiques générés automatiquement
- Comparaison 5+ offres (tous les tarifs chargés)

### 3️⃣ Simuler PV (optionnel)
```
☀️ Activer Photovoltaïque
├─ Puissance (3.0 kWc défaut)
├─ Région (Centre défaut)
└─ Talon consommation (W)
```

### 4️⃣ Exporter
```
📄 Export PDF     → Rapport complet
📊 Export Excel   → Données détaillées 
💾 Sauvegarder    → Historique local
```

---

## 📁 Architecture

```
ComparatifElec/
├── 📄 index.html                    # Structure HTML
├── 🎨 style.css / style-*.css      # Styles (flexbox, responsive)
├── 🎯 src/
│   ├── app.js                       # Point d'entrée principal (1728 lignes)
│   ├── state.js                     # Gestion état (AppStateManager)
│   ├── analysisEngine.js            # Calculs statistiques (hourly, monthly)
│   ├── calculationEngine.js         # Cache & optimisations DOM
│   ├── tariffEngine.js              # Moteur calcul tarifs (type-based dispatcher)
│   ├── tariffManager.js             # Chargement dynamique tarifs JSON
│   ├── tariffDisplay.js             # Rendu cards tarifaires
│   ├── chartRenderer.js             # Graphiques Chart.js (1400+ lignes)
│   ├── fileHandler.js               # Parsing JSON/CSV/XLSX
│   ├── uiManager.js                 # Gestion UI & événements
│   ├── pvManager.js                 # Contrôles PV (inputs)
│   ├── pvSimulation.js              # Calcul production solaire
│   ├── tempoCalendar.js             # Calendrier Tempo + API
│   ├── workflowEngine.js            # Orchestration recalculs
│   ├── utils.js                     # Utilities & localStorage
│   └── exportManager.js             # ✨ NEW: Export PDF/Excel/Historique
├── 💾 tariffs/
│   ├── index.json                   # Source-of-truth tarifaires
│   ├── base.json                    # Tarif simple
│   ├── hphc.json                    # HP/HC standard
│   ├── tempo.json                   # Tarif Tempo
│   ├── octopusEnergy.json           # OctopusEnergy (custom)
│   ├── injection.json               # Prix injection réseau
│   └── ... (custom tariffs)
└── README.md                         # Ce fichier
```

---

## 🏗️ Architecture Technique

### 🧩 Modularité
- **14 modules** indépendants (chacun responsabilité unique)
- **AppStateManager** centralisé (source vérité data)
- **Imports/exports ES6** (modules natifs)
- **Zero-dependency** (pas npm, juste CDN pour Chart.js, jsPDF, XLSX)

### 🔄 Data Flow
```
Fichier (JSON/CSV)
    ↓ (parseFile)
Records Array
    ↓ (analyzeFilesNow)
Stats + Charts
    ↓ (compareOffers)
Offers Array [dynamique]
    ↓ (chartRenderer)
Visualisations [5+ graphs]
    ↓ (exportManager)
PDF/Excel/History
```

### ⚡ Performance
- **O(n) parsing** - Single pass JIT compilation
- **Chart.js lazy loading** - Créé au besoin
- **DOM caching** - readDomValuesOnce() 
- **Calculation cache** - Invalidation intelligente
- **100+ ms latency** pour 8760 records d'analyse

### 🔐 Sécurité
- ✅ **Zéro envoi serveur** - Tout local navigateur
- ✅ **localStorage** - Données jamais quittent device
- ✅ **CSP-friendly** - Pas eval, no inline scripts
- ✅ **Auth Enedis** - Dans navigateur utilisateur uniquement

---

## 🔧 Configuration Tarifaire (Custom)

### Ajouter un Nouveau Tarif

**1. Créer fichier JSON** → `tariffs/monTarif.json`
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

**2. Ajouter à** → `tariffs/index.json`
```json
{
  "tariffs": [
    { "id": "monTarif", "file": "monTarif.json" }
  ]
}
```

**3. Redémarrer app** → Tarif découvert automatiquement ✨

**Types supportés:**
- `flat` - Prix unique (Base)
- `two-tier` - HP/HC (heures creuses)
- `three-tier` - HP/HC/HSC (special TCH)
- `tempo` - Jours R/B/W variables
- `tempo-optimized` - Variante optimisée

---

## 📊 Phases Complétées

| Phase | Statut | Date | Description |
|-------|--------|------|-------------|
| **Phase 1** | ✅ | Jan 2026 | Architecture de base + Analyse |
| **Phase 2.5** | ✅ | Mar 5 2026 | Architecture 100% dynamique tarifaire |
| **Phase 3.1** | ✅ | Mar 5 2026 | Export PDF/Excel + Historique |
| **Phase 2** | ✅ Auto | Mar 5 2026 | Code cleanup (aucun code mort) |
| **Phase 3.2** | 📋 Prochain | TBD | Comparateur Multi-Fournisseurs |
| **Phase 3.3** | 📋 TBD | TBD | Alertes Tempo + Optimisation consommation |

---

## 💡 Exemplaires d'Utilisation

### Analyser une Année Complète
```
1. Télécharger export Enedis (JSON horaire)
2. Importer dans app
3. Voir comparaison 5+ offres instantanément
4. Exporter PDF pour partage conjoint
```

### Simuler Installation PV
```
1. Importer données
2. Activer PV → 3.0 kWc, Centre, 50W standby
3. Consulter "Économies Mensuelles" chart
4. Voir ROI 15-20 ans
5. Exporter Excel pour devis installateur
```

### Comparer Tarifs Personnalisés
```
1. Créer 2-3 tarifs custom (fichiers JSON)
2. Ajouter à index.json
3. Exporter pour voir comparaison côte à côte
```

---

## 🔗 Technos

**Frontend:**
- HTML5 / CSS3 (Flexbox, Grid, CSS Variables)
- JavaScript ES6+ (Modules, Async/Await)
- Chart.js (Visualisations - CDN)
- jsPDF (Export PDF - CDN)
- html2canvas (Capture graphiques - CDN)
- XLSX.js (Export Excel - CDN)

**Data:**
- JSON files (tariffs, config)
- localStorage (historia analyses)
- API Tempo (jour couleur - optionnelle)

**No-Framework:** Aucun React/Vue/Angular - JS pur optimisé

---

## 📝 Notes Dev

- **Legacy code:** Des imports `script.js` existent mais non utilisés
- **Storage key:** Clés localStorage préfixées `elec-`
- **DEFAULTS:** Objet global contenant config (voir utils.js)
- **AppState:** Singleton - `appState.getState()` partout

---

## 🤝 Support

Questions ou bugs ?
- Consultez `AUDIT_REPORT.md` pour architecture détaillée
- Modifiez `tariffs/*.json` pour custom tarifaires
- Vérifiez console (F12) pour logs détaillés

**Last Updated:** 5 mars 2026 (Phase 3.1 export complete)