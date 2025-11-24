# GitHub Copilot Project Instructions

## Contexte du projet
Développer une application web en HTML, CSS et JavaScript permettant à un utilisateur d’importer et d’analyser ses données de consommation électrique (JSON/XLSX exporté depuis Enedis).  
L’application propose aussi une simulation des coûts selon différents abonnements et une estimation des économies réalisables via une installation photovoltaïque.  

Ce projet est 100 % front-end (aucun serveur). Les artefacts fournis sont une interface d'analyse et, récemment, un utilitaire client pour récupérer les exports hebdomadaires Enedis lorsque l'export horaire annuel n'est plus disponible.

---

## Objectifs principaux
- Importer un fichier de consommation (JSON / Excel/XLSX) et l'analyser (totaux, moyennes, pics horaires, répartitions temporelles).
- Comparer les coûts selon différents abonnements (Base, HP/HC, Tempo, ...).
- Simuler la production photovoltaïque selon région / orientation / inclinaison et estimer les économies.
- Fournir une UI indépendante côté client pour reconstituer une année de consommation à partir d'exports hebdomadaires Enedis (voir section Enedis).

---

## Structure canonique
- `index.html` — page principale (prototype / outil d'import et d'analyse).  
- `style.css` — styles globaux.  
- `script.js` — logique applicative (parsing, calculs, visualisations).  
- `assets/` — images et ressources, si présentes.  
- `.github/copilot-instructions.md` — ce fichier.

---

## Ajout important : outil de récupération Enedis (52 semaines)

Motivation : l'export horaire sur 1 an n'est plus accessible directement via l'API publique. Nous contournons ce blocage côté client en téléchargeant 52 exports hebdomadaires (un lien par semaine) puis en fusionnant localement les fichiers Excel.

Fichiers concernés :
- `index.html` — interface pour saisir `PRM`, `personId` (facultatif) et déclencher l'ouverture des 52 URLs.
-- `script.js` — construit les 52 URL hebdos, propose deux modes pour lancer les téléchargements : *onglet réutilisable* (ouvre un seul onglet helper et le recharge séquentiellement) ou *générer la liste d'URLs* (copier dans un gestionnaire de téléchargements). Propose aussi la fusion locale via SheetJS.
- `style.css` — styles.

Résumé d'utilisation :
1. Ouvrir `index.html` dans un navigateur où vous êtes connecté au site Enedis.
2. Entrer le `PRM` (obligatoire). Si vous connaissez le `personId`, le renseigner. Sinon cocher "Essayer sans personId" pour tenter la variante sans le segment `/personnes/{id}`.
3. Choisir la date de référence (par défaut : aujourd'hui). Cliquer sur "Ouvrir les 52 liens".
4. Après téléchargement des 52 fichiers, utiliser l'input de fichiers pour sélectionner tous les fichiers téléchargés et cliquer sur "Fusionner et télécharger".

Points techniques importants :
- Les requêtes fetch/AJAX sont normalement bloquées par CORS sur l'API Enedis. L'outil propose deux stratégies côté client pour déclencher les téléchargements via la session du navigateur :
	- *Onglet réutilisable* : ouvre un seul onglet helper et le recharge séquentiellement sur chaque URL.
	- *Générer la liste d'URLs* : produit une liste d'URLs pour copie vers un gestionnaire de téléchargements ou ouverture manuelle.
- Les navigateurs peuvent bloquer les téléchargements multiples ; l'outil ouvre les liens séquentiellement (~900ms entre chaque) pour réduire les blocages. Si nécessaire, autoriser explicitement les téléchargements multiples pour le domaine.
- Si l'endpoint exige le `personId`, la variante sans `personId` échouera. Dans ce cas l'utilisateur doit récupérer le `personId` via l'inspecteur réseau (voir ci-dessous).
- NE PAS essayer de deviner ou bruteforcer des `personId` — respect de la vie privée et des règles d'accès.

### CSP / frame-ancestors — comportement attendu et repli
Certaines pages Enedis définissent une politique CSP `frame-ancestors` qui empêche qu'elles soient affichées en iframe depuis des origines externes. Si vous obtenez une erreur du type "Refused to frame ... frame-ancestors ...", suivez ces recommandations :

- Utiliser le mode "Ouvrir dans de nouveaux onglets" de l'interface : ouvrir chaque URL directement dans un onglet permettra d'utiliser la session du navigateur sans enfreindre la CSP.
- Si l'ouverture de nombreux onglets est gênante, utiliser le mode "Générer la liste d'URLs" et copier-coller la liste dans un gestionnaire de téléchargements (ou ouvrir manuellement les liens).
- Nouveau mode disponible : "Onglet réutilisable" — ouvre un seul onglet helper et le recharge séquentiellement sur chaque URL. Ce mode évite d'ouvrir 52 onglets et limite les blocages liés aux popups/background-tabs.
- Éviter toute tentative de contourner la CSP côté client (par ex. iframe sandbox hacks) — préférer un proxy serveur seulement avec autorisation explicite et conformité aux règles d'accès.

Documentez le choix de repli (onglets / liste) quand vous modifiez `script.js` et expliquez le risque d'être bloqué par les bloqueurs de popups/déclencheurs automatiques.

## Comment extraire le `personId` depuis l'interface Enedis (guide pas-à-pas)
1. Se connecter au site Enedis sur le navigateur que vous utiliserez pour l'outil.
2. Ouvrir les Outils de développement (F12) → onglet "Network" / "Réseau".
3. Filtrer sur les requêtes XHR / Fetch et naviguer vers la page d'export ou courbe de consommation.
4. Recherchez une requête contenant `/personnes/` ou `/prms/` dans l'URL.
5. Exemple d'URL : `https://.../api/private/v2/personnes/1234567890/prms/12345678901234/donnees-energetiques/file?...` → `personId = 1234567890`, `PRM = 12345678901234`.
6. Copier la valeur `personId` et la coller dans le champ correspondant de `index.html`.

---

# GitHub Copilot Project Instructions

## Contexte du projet
Développer une application web en HTML, CSS et JavaScript permettant à un utilisateur d’importer et d’analyser ses données de consommation électrique (JSON / XLSX exporté depuis Enedis).  
L’application doit proposer une simulation des coûts selon différents abonnements d’électricité et estimer les économies réalisables via une installation photovoltaïque selon la région et l’orientation des panneaux en France.  

Ce projet est 100 % front-end (aucun serveur).  

---

## Objectifs principaux
- Importer un fichier JSON (format Enedis) ou Excel/XLSX de consommation (dates, heures, kWh).  
- Analyser la consommation : totaux, moyennes, pics horaires, répartitions temporelles.  
- Comparer les coûts selon différents abonnements : Base, Heures Pleines/Creuses, Tempo, etc.  
- Simuler la production solaire estimée selon la région, l’orientation et l’inclinaison.  
- Calculer les économies potentielles annuelles (autoconsommation + injection réseau).  
- Présenter les résultats sous forme de graphiques et tableaux interactifs.  

---

## Stack technique
- HTML pour la structure de l’interface.  
- CSS pour le style et le design responsive.  
- JavaScript pur (vanilla JS) pour le traitement, les calculs et les graphiques.  
- Librairies recommandées : SheetJS (`xlsx`) pour lire/écrire XLSX et manipuler des feuilles Excel ; Chart.js ou D3.js pour les graphiques. Papaparse reste une option uniquement si vous devez prendre en charge des CSV externes.  
- Stockage local autorisé via `localStorage`.  

---

## Structure recommandée du projet
- `/index.html` : structure principale et intégration JS/CSS.  
- `/style.css` : design clair et adaptatif.  
- `/script.js` : logique applicative et graphique.  
- `/assets/` : icônes, images et ressources externes.  

---

## Fonctionnalités à implémenter

### Importation JSON / XLSX
- Lecture du fichier local via un input (JSON ou Excel/XLSX).
- Parsing du JSON attendu (structure Enedis : `cons.aggregats.heure.donnees`) ou conversion des feuilles Excel via SheetJS.
- Affichage d’un aperçu et validation du format.

### Analyse et calculs
- Moyenne, max, min, répartition journalière et horaire.  
- Estimation de la consommation annuelle.  

### Simulation des tarifs
- Choix du mode tarifaire : Base / HP-HC / Tempo.  
- Paramètres modifiables : puissance souscrite, prix des kWh, heures creuses/heures pleines.  
- Calcul du coût total par formule.  

### Simulation photovoltaïque
- Saisie ou sélection d’une région (France métropolitaine).  
- Orientation et inclinaison modifiables.  
- Estimation de la production solaire annuelle moyenne selon région.  
- Calcul des économies possibles selon l’autoconsommation estimée.  

### Visualisation des données
- Tableaux récapitulatifs des résultats clés.  
- Graphiques comparatifs de consommation et coûts via Chart.js.  
- Indicateurs : consommation annuelle, coût total, économie photovoltaïque, taux d’autoconsommation.  

---

## Bonnes pratiques pour Copilot
- Créer des fonctions nommées et commentées (ex. `parseJsonData()`, `calculateBill()`, `simulateSolarProduction()`).  
- Séparer la logique métier, la gestion d’événements et l’affichage graphique.  
- Écrire du code modulaire et compréhensible.  
- Favoriser des noms de variables explicites et cohérents.  
- Prévoir la possibilité d’intégrer ultérieurement une API (tarifs ou météo).  

---

## Fonctionnalités optionnelles
- Export du rapport (PDF ou XLSX/CSV).  
- Thème clair/sombre.  
- LocalStorage pour mémoriser les choix de l’utilisateur.  
- Interface multilingue (FR/EN).  

---

# Fin du fichier
Copilot doit se baser sur ces instructions pour générer un code structuré, fonctionnel et compréhensible, adapté à une application web éducative, interactive et locale.
- Paramètres modifiables : puissance souscrite, prix des kWh, heures creuses/heures pleines.  
- Calcul du coût total par formule.  

### Simulation photovoltaïque
- Saisie ou sélection d’une région (France métropolitaine).  
- Orientation et inclinaison modifiables.  
- Estimation de la production solaire annuelle moyenne selon région.  
- Calcul des économies possibles selon l’autoconsommation estimée.  

### Visualisation des données
- Tableaux récapitulatifs des résultats clés.  
- Graphiques comparatifs de consommation et coûts via Chart.js.  
- Indicateurs : consommation annuelle, coût total, économie photovoltaïque, taux d’autoconsommation.  

---

## Bonnes pratiques pour Copilot
- Créer des fonctions nommées et commentées (ex. `parseJsonData()`, `calculateBill()`, `simulateSolarProduction()`).  
- Séparer la logique métier, la gestion d’événements et l’affichage graphique.  
- Écrire du code modulaire et compréhensible.  
- Favoriser des noms de variables explicites et cohérents.  
- Prévoir la possibilité d’intégrer ultérieurement une API (tarifs ou météo).  

---

## Fonctionnalités optionnelles
- Export du rapport (PDF ou XLSX/CSV).  
- Thème clair/sombre.  
- LocalStorage pour mémoriser les choix de l’utilisateur.  
- Interface multilingue (FR/EN).  

---

# Fin du fichier
Copilot doit se baser sur ces instructions pour générer un code structuré, fonctionnel et compréhensible, adapté à une application web éducative, interactive et locale.
