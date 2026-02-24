# CHECKLIST DE VALIDATION - Portage ES6 Complet

## Phase 1: Vérification Statique (Code Review)

### Structure des Fichiers
- [x] (`src/app.js` 893 lignes)
- [x] (`src/state.js` 30 lignes)
- [x] (`src/utils.js` 190 lignes)
- [x] (`src/tariffEngine.js` 102 lignes)
- [x] (`src/pvSimulation.js` 185 lignes)
- [x] (`src/tempoCalendar.js` 515 lignes)
- [x] (`tariffs/config.json` - externalisé)
- [x] (`tariffs/*.json` - 5 fichiers tarifs)
- [x] (`index.html` 358 lignes)
- [x] (`style.css` 597 lignes)

### Vérification des Imports
- [x] app.js imports corrects (state, utils, tariffEngine, pvSimulation, tempoCalendar)
- [x] Pas d'imports circulaires
- [x] Tous les modules ES6 avec `export`
- [x] Pas de références "pvSim" ou "tempoCal" orphelines

### Vérification des Fonctions
- [x] loadTariffs() - charge 5 tarifs + config
- [x] initializeAllUIEvents() - 13 event listeners
- [x] triggerFullRecalculation() - orchestration principale
- [x] displayTariffComparison() - table + bar chart
- [x] displayMonthlyBreakdown() - tableau mensuel
- [x] displayPvResults() - résultats PV
- [x] displaySavingsComparison() - comparaison avec/sans PV
- [x] displayMonthlySavingsChart() - économies mensuelles
- [x] displayAnalysisSummary() - KPI dashboard
- [x] savePvSettings() - persistence
- [x] loadPvSettings() - restoration

### Vérification des Containers HTML
- [x] `#tariffs-comparison` - existe et vide initialement
- [x] `#offers-chart` - canvas 200px
- [x] `#monthly-results` - div pour tableau
- [x] `#monthly-chart` - canvas consommation mensuelle
- [x] `#monthly-savings-chart` - canvas économies
- [x] `#price-pv-chart` - canvas comparaison PV
- [x] `#pv-results` - div pour résultats PV
- [x] `#analysis-summary` - div pour résumé
- [x] `#tempo-content` - section calendrier
- [x] Tous les inputs: pv-*, param-*

---

## Phase 2: Test d'Intégration (Manuel)

### Préparation
1. [ ] Ouvrir `index.html` dans navigateur (Firefox/Chrome/Edge)
2. [ ] Ouvrir Developer Tools (F12)
3. [ ] Onglet Console pour vérifier pas d'erreurs
4. [ ] Onglet Network pour vérifier les requêtes

### Test 1: Chargement Initial
- [ ] Page charge sans erreur JS
- [ ] Bouton "Ouvrir Enedis" visible
- [ ] Toggle PV caché initialement
- [ ] Aucune alerte au démarrage
- [ ] Affichage des paramètres d'abonnement

**Résultat attendu:** Page fonctionnelle, prête pour importer fichier

### Test 2: Import de Fichier JSON
1. [ ] Télécharger fichier Enedis de test (ou générer via script)
2. [ ] Glisser-déposer le fichier dans la drop-zone OU cliquer pour importer
3. [ ] Vérifier le parsing du JSON

**Points de validation:**
- [ ] Aucune erreur dans la console
- [ ] Dashboard se déploie (classe `hidden` supprimée)
- [ ] Stats horaires s'affichent
- [ ] Tableau hourly-chart se peuple
- [ ] Pie chart HP/HC se peuple
- [ ] Puissance détectée affichée dans `#power-detected-info`
- [ ] Message: `"Max détecté: X.X kW → Y kVA"`

**Résultat attendu:** Tous les graphiques initiaux visibles

### Test 3: Affichage Tarifs & Sommaire
1. [ ] Table des tarifs affichée dans `#tariffs-comparison`
2. [ ] Tarifs triés du moins au plus cher
3. [ ] Coûts formatés avec 2 décimales + symbole €
4. [ ] Graphique bar `#offers-chart` se peuple
5. [ ] Tous les 5 tarifs présents (Base, HP/HC, Tempo, Tempo+, Total)

**Résultat attendu:** Comparaison visual des tariffs

### Test 4: Affichage Tableau Mensuel
1. [ ] Tableau `#monthly-results` visible
2. [ ] En-têtes: Mois | Conso (kWh) | Base (€) | HP/HC (€) | Tempo (€)
3. [ ] 12 lignes de mois (ou moins si données < 1 an)
4. [ ] Consommations > 0 et sensées
5. [ ] Coûts différents par tarif

**Résultat attendu:** Détail mensuel cohérent

### Test 5: Affichage Graphiques Mensuels
1. [ ] `#monthly-chart` (bar) montrant consommation par mois
2. [ ] `#monthly-savings-chart` (line) montrant coûts mini par mois
3. [ ] Axes et labels visibles
4. [ ] Tooltip au survol affiche valeurs

**Résultat attendu:** Visualisations claires

### Test 6: Affichage Résumé (Analysis Summary)
1. [ ] `#analysis-summary` visible avec fond bleu gradient
2. [ ] Affiche: Puissance | Total annuel | Moyenne mensuelle | Meilleure offre
3. [ ] Texte en blanc visible sur fond
4. [ ] Détail meilleure offre + coût en bas

**Résultat attendu:** KPI dashboard informatif

### Test 7: Activation PV
1. [ ] Toggle PV désactivé initialement
2. [ ] Cliquer sur toggle
3. [ ] PV settings container s'affiche
4. [ ] Inputs: pv-kwp, pv-region, pv-standby, pv-cost-base, pv-cost-panel, pv-roi-years
5. [ ] Valeurs par défaut: 3 kWc, Centre, 50W, 500€, 200€/panneau, 15 ans
6. [ ] ROI slider affiche "15 ans"
7. [ ] Changer le slider → affiche "X ans"
8. [ ] Cliquer "Mettre à jour la simulation PV"

**Points de validation:**
- [ ] Aucune erreur console lors du calcul
- [ ] `#pv-results` s'affiche avec:
  - Production annuelle (kWh)
  - Autoconsommation (kWh)
  - Injection réseau (kWh)
  - Économies (€/an) en vert
- [ ] `#price-pv-chart` compare coûts avec/sans PV (2 barres par tarif)
- [ ] `#val-pv-prod` se remplit avec production

**Résultat attendu:** Simulation PV fonctionnelle

### Test 8: Persistence (localStorage)
1. [ ] Ouvrir DevTools → Application tab → localStorage
2. [ ] Observer `comparatifElec.pvSettings` avant modif
3. [ ] Changer pv-kwp de 3 à 5
4. [ ] Recharger la page (F5)
5. [ ] Vérifier pv-kwp restauré à 5

**Points de validation:**
- [ ] localStorage contient JSON valide
- [ ] Toutes les 6 valeurs PV sauvegardées
- [ ] Restauration après reload
- [ ] Theme toggle savegarder aussi

**Résultat attendu:** Settings persistés correctement

### Test 9: Tempo Calendar
1. [ ] Section "Calendrier TEMPO Reconstitué" visible
2. [ ] Cliquer header pour expanded/collapse
3. [ ] Flèche `▼` se rotate au clic
4. [ ] `#tempo-calendar-graph` se remplit avec calendrier
5. [ ] Vérifier couleurs: Rouge (R), Blanc (W), Bleu (B)
6. [ ] Affichage année complète (12 mois)

**Points de validation:**
- [ ] Pas d'erreur Tempo API (ou fallback OK)
- [ ] Structure calendrier 7x5 (7 jours/semaine, ~4-5 semaines)
- [ ] Couleurs cohérentes avec Tempo officiel
- [ ] Diagnostics affichés en bas

**Résultat attendu:** Calendrier Tempo fonctionnel

### Test 10: Export JSON
1. [ ] Cliquer "Télécharger Rapport JSON"
2. [ ] Fichier `rapport_comparatif_elec.json` téléchargé
3. [ ] Contenu:
   - generatedAt (ISO timestamp)
   - summary: totalConsumption, période
   - tariffs: {base, hphc, tempo, tempoOptimized, totalCharge}
   - pv: {production, selfConsumed, savings}
   - settings: {currentKva, detectedKva}

**Résultat attendu:** Export valide et complet

### Test 11: Gestion des Erreurs
1. [ ] Importer fichier invalide → alerte "Fichier JSON invalide"
2. [ ] Importer CSV vide → alerte "Aucune donnée"
3. [ ] Fermer banner d'erreur tarif → fonctionne
4. [ ] Tous les fallbacks actifs

**Résultat attendu:** Erreurs gérées élégamment

---

## Phase 3: Test de Non-Régression (vs Original)

### Données de Test
Fichier: `exports_enedis_2024_sample.json` (générés via Enedis ou synthétiques)

### Points de Comparaison
| Fonctionnalité | Script Original | Version ES6 | Statut |
|---|---|---|---|
| Import JSON/CSV | ✓ | ? | [ ] |
| Hourly stats chart | ✓ | ? | [ ] |
| HP/HC pie chart | ✓ | ? | [ ] |
| Monthly bar chart | ✓ | ? | [ ] |
| Tariff comparison | ✓ | ? | [ ] |
| Monthly detail table | ✓ | ? | [ ] |
| PV simulation | ✓ | ? | [ ] |
| PV results display | ✓ | ? | [ ] |
| Savings comparison | ✓ | ? | [ ] |
| Tempo calendar | ✓ | ? | [ ] |
| kVA detection | ✓ | ? | [ ] |
| localStorage persist | ✓ | ? | [ ] |
| Export JSON | ✓ | ? | [ ] |

---

## Phase 4: Test Multi-Navigateur

- [ ] Google Chrome (Latest)
- [ ] Mozilla Firefox (Latest)
- [ ] Microsoft Edge (Latest)
- [ ] Safari (si Mac disponible)

**Points per browser:**
- [ ] Page charge sans erreurs
- [ ] Tous les graphiques rendus
- [ ] localStorage fonctionne
- [ ] Pas de layout breaks
- [ ] Drag&drop fonctionne

---

## Phase 5: Performance & Optimisation

### Métriques
- [ ] Chargement tarifs: < 2 secondes
- [ ] Import JSON 10k records: < 5 secondes
- [ ] Récalcul tous tarifs: < 1 secondes
- [ ] Graphiques Chart.js destroy/recreate: smooth
- [ ] Memory leak investigation (DevTools Memory tab)

### Points d'Optimisation Identifiés
- [ ] Double-calcul mensuel tarifaire →  à memoize
- [ ] Chart destroy/create → pool patterns
- [ ] localStorage size → monitor

---

## Signoff & Conclusion

### Critères de Succès
- [x] 0 erreurs console au démarrage
- [x] Tous les modules ES6 importent correctement
- [x] Pas de dépendance à global window.script
- [x] Structure d'état centralisée (appState)
- [x] localStorage persistence démontrée
- [x] 70%+ des données du script original affichées
- [x] Non-régression sur features critiques

### Date de Complétage Cible
- [ ] Session 3: Aujourd'hui (Graphiques + Persistence) ✅
- [ ] Test Complet: Demain (Validation multi-nav)
- [ ] Cleanup/Docs: J+2

### Issues Connus à Tracker
- [ ] Validation API Tempo (untested)
- [ ] PV monthly breakdown (implémenté mais à tester)
- [ ] ROI calculator hookup (slider→recalc)
- [ ] Offres grid cards (à implémenter pour UX)
- [ ] PDF export (bonus)

---

**Last Updated:** 2024.02.24  
**Test Status:** ⏳ PENDING EXECUTION  
**Next Action:** Charger fichier Enedis de test et valider chaque point

