# comparatifElec — Guide simplifié (JSON uniquement)

Application front‑end (HTML/CSS/JS) d'analyse de la consommation électrique Enedis + comparaison tarifs (Base, HP/HC, Tempo) et simulation photovoltaïque (PV). Flux désormais 100 % JSON (Excel/XLSX déprécié).

## Fichiers clés
- `index.html` — interface (génération script console, import JSON, analyse, simulation).
- `script.js` — logique : génération script console, parsing JSON annuel, calculs statistiques, récupération des couleurs Tempo via API + cache, simulation PV & tarifs, graphiques.
- `style.css` — styles et mise en page.

## Fonctionnalités principales
1. Génération d'un script console pour récupérer automatiquement 52 semaines de données horaires et produire `consommation_annee.json` (tri + déduplication).
2. Import du fichier JSON annuel et analyse automatique (totaux, moyennes, min/max par heure, répartition HP/HC, calendrier Tempo réel).
3. Simulation tarifs Base / HP‑HC / Tempo (utilisant les vraies couleurs Tempo récupérées et cachées).
4. Simulation photovoltaïque : production annuelle (simplifiée par région), autoconsommation estimée (veille + profil horaire), économies vs offres, ventilation mensuelle avec économies par mois et par offre.
5. Graphiques : consommation horaire, comparaison de coûts, prix mensuel €/kWh vs production PV, répartition économies PV, calendrier Tempo couleur.
6. Export d'un rapport de synthèse JSON.

## Flux d'utilisation (Rapide)
1. Ouvrez `index.html` dans votre navigateur.
2. Entrez le PRM et choisissez la date de référence (point de départ des 52 semaines en remontant).
3. Cliquez sur « Générer le script console ». Le script est copié dans le presse‑papiers.
4. Connectez-vous à votre compte Enedis dans un autre onglet (ou le même).
5. Dans cet onglet Enedis (authentifié), ouvrez les Outils de développement (F12) → Console, collez le script et exécutez‑le. Un fichier `consommation_annee.json` est téléchargé (une seule année agrégée).
6. Revenez sur la page de l'application et importez ce fichier dans la section « Charger le fichier JSON » : l'analyse démarre automatiquement (chargement des jours Tempo, statistiques, graphiques, simulation PV et offres).
7. Explorez les résultats :
   - Log d'analyse
   - Graphique horaire (moyenne/min/max)
   - Répartition HP/HC
   - Calendrier Tempo (couleurs réelles si disponibles, sinon algorithme local)
   - Simulation PV & économies (annuelles et mensuelles)
   - Comparaison des offres avec et sans PV
   - Graphiques mensuels de prix et de production.

## Couleurs Tempo (API + cache)
Le script tente de récupérer les couleurs passées via l'API publique Tempo :
- Requête saison `/joursTempo?periode=YYYY-YYYY+1` (bulk) puis fallback granularité `/jourTempo/YYYY-MM-DD` pour les jours manquants.
- Stockage local (`localStorage`) des jours résolus pour accélérer les ré-analyses.
- Fallback algorithme local (génération pseudo‑réaliste) pour les jours futurs ou absents.
- Barre de progression affichée pendant le chargement ; coûts « Tempo » calculés uniquement après hydratation de la carte réelle.

## Simulation photovoltaïque
Entrées : puissance installée (kWp), région (rendement simplifié), taux d'autoconsommation (manuel) et consommation de veille (W). Le moteur :
- Répartit la production annuelle par mois via des pondérations saisonnières.
- Applique un profil horaire (pic midi) et une priorité veille.
- Calcule autoconsommation vs injection (revenu éventuel), coûts évités par offre et économies mensuelles/annuelles.

## Export rapport
Bouton « Exporter rapport (JSON) » : génère un fichier avec statistiques essentielles (total, séries horaires agrégées).

## Développement local
```powershell
python -m http.server 8000
# Ouvrir ensuite http://localhost:8000/index.html
```

## Limitations & sécurité
- Authentification non contournée : vous devez être connecté sur Enedis pour exécuter le script console.
- Le script console s'exécute localement, n'envoie pas les données à des tiers.
- Les couleurs Tempo futures sont estimées (algorithme) si non disponibles côté API.
- Excel/XLSX : SUPPRIMÉ (simplification du flux). Pour revenir à un support multi‑fichiers, réintroduire SheetJS et un parseur dédié.

## Idées d'amélioration
- Bouton « Vider cache Tempo » / « Forcer rafraîchissement ».
- Mode sombre (CSS variables).
- Export CSV des économies mensuelles.
- Ajustement interactif des tarifs en UI (actuellement constants dans `DEFAULTS`).

## Dépréciations
- Ouverture séquentielle des 52 liens / fusion XLSX : remplacées par le script console JSON unique.
- Modal de confirmation / multi‑onglets : retirés.

---

Pour toute suggestion (fonction, visualisation, format d'export), ouvrez une issue ou demandez une modification.
