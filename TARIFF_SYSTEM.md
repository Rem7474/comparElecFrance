# Système de tarifs modulaires - Documentation

## Vue d'ensemble

Le système de tarifs a été refactorisé pour fonctionner de manière modulaire. Les définitions de tarifs sont maintenant stockées dans des fichiers JSON séparés dans le dossier `/tariffs/`, au lieu d'être codées en dur dans `script.js`.

## Architecture

### Dossier `/tariffs/`

Contient les définitions JSON de tous les tarifs disponibles :

- `base.json` - Tarif Base (tarif simple, prix unique)
- `hphc.json` - Tarif Heures Pleines/Creuses (2 tiers)
- `tempo.json` - Tarif Tempo (3 couleurs)
- `tempoOptimized.json` - Tarif Tempo optimisé (variante)
- `totalCharge.json` - Tarif Total Charge / Charge Fixe (3 tiers HP/HC/HSC)

### Structure de chaque fichier JSON

```json
{
  "id": "base",
  "name": "Base",
  "type": "flat",
  "description": "Description du tarif",
  "price": 0.1940,
  "subscriptions": {
    "3": 12.03,
    "6": 15.65,
    ...
  },
  "color": "#4e79a7",
  "colorWithPV": "#a0cbe8"
}
```

#### Champs obligatoires

- **id** : identifiant unique du tarif (utilisé comme clé dans TARIFFS)
- **name** : nom d'affichage du tarif
- **type** : type de tarif ("flat", "two-tier", "tempo", "three-tier")
- **subscriptions** : grille d'abonnement par puissance (€/mois par kVA)

#### Champs optionnels

- **description** : description du tarif
- **color** : couleur d'affichage en graphique (sans PV)
- **colorWithPV** : couleur en cas d'installation PV
- **rates** ou prix spécifiques (price, php, phc, phsc, blue, white, red, etc.)

## Chargement dynamique

### Initialisation

Lors du démarrage de l'application, la fonction `loadTariffs()` est appelée :

```javascript
// Initialize tariff system at startup
(async () => {
  const success = await loadTariffs();
  if (!success) {
    console.error('Failed to load tariff files.');
  }
})();
```

### Processus de chargement

1. La fonction `loadTariffs()` charge tous les fichiers JSON du dossier `/tariffs/`
2. Chaque tarif est stocké dans l'objet global `TARIFFS`
3. Un wrapper de compatibilité `DEFAULTS` est créé pour les fonctions existantes
4. Les poids solaires mensuels sont normalisés

### Accès aux tarifs

```javascript
// Accès via TARIFFS (nouveau)
const tariff = TARIFFS.base;

// Accès via DEFAULTS (compatible - déprécié)
const tariff = DEFAULTS.base;

// Obtenir les identifiants actifs
const ids = getActiveTariffIds(); // ['base', 'hphc', 'tempo', ...]

// Obtenir un tarif spécifique
const tariff = getTariff('base');
```

## Ajouter un nouveau tarif

Pour ajouter un nouveau tarif :

### 1. Créer le fichier JSON

Créez `/tariffs/myoffer.json` avec la structure appropriée :

```json
{
  "id": "myoffer",
  "name": "Mon Offre",
  "type": "flat",
  "description": "Une nouvelle offre tarifaire",
  "price": 0.1850,
  "subscriptions": {
    "3": 11.50,
    "6": 15.00,
    "9": 18.50,
    "12": 22.00,
    "15": 25.50,
    "18": 29.00,
    "24": 36.50,
    "30": 43.50,
    "36": 50.50
  },
  "color": "#ff6b6b",
  "colorWithPV": "#ffc0cb"
}
```

### 2. Ajouter à la liste de chargement

Modifiez `script.js` et ajoutez le fichier à `TARIFF_FILES` :

```javascript
const TARIFF_FILES = [
  'tariffs/base.json',
  'tariffs/hphc.json',
  'tariffs/tempo.json',
  'tariffs/tempoOptimized.json',
  'tariffs/totalCharge.json',
  'tariffs/myoffer.json'  // ← Ajouter ici
];
```

### 3. Mettre à jour les fonctions de calcul (si besoin)

Si le type de tarif est nouveau (au-delà de flat/two-tier/tempo/three-tier), vous devrez modifier :

- `computeCostWithProfile()`
- Autres fonctions de calcul de coûts
- Mises à jour UI

## Migration depuis le système ancien

L'ancien système utilisait un objet `DEFAULTS` codé en dur. Le système a maintenant :

**Avantages :**
- Modularité : ajouter des tarifs sans modifier script.js
- Maintenabilité : chaque tarif est isolé dans son propre fichier
- Scalabilité : support illimité de nouveaux tarifs
- Testabilité : tarifs peuvent être testés indépendamment

**Rétrocompatibilité :**
- `DEFAULTS` fonctionne toujours grâce au wrapper
- Les fonctions de calcul existantes ne changent pas
- Aucune modification requise du code existant

## Gestion des erreurs

Si un fichier JSON ne peut pas être chargé :

1. Un avertissement est loggé dans la console
2. Le chargement continue avec les tarifs restants
3. L'application fonctionne avec les tarifs chargés
4. Les calculs de coûts sont disponibles pour les tarifs valides

Vérifiez la console du navigateur (F12) pour les erreurs de chargement :

```
Failed to load tariff: tariffs/myoffer.json (status 404)
```

## Tests et débogage

Pour vérifier que les tarifs sont chargés correctement, ouvrez la console du navigateur (F12) et exécutez :

```javascript
console.log('Loaded tariffs:', Object.keys(TARIFFS));
console.log('DEFAULTS:', DEFAULTS);
console.log('Get tariff:', getTariff('base'));
```

## Performance

- Les tarifs sont chargés **une seule fois** au démarrage
- Les requêtes fetch utilisent le cache navigateur
- L'initialisation est asynchrone et non-bloquante
- Aucun impact sur la performance des calculs

---

*Dernière mise à jour : Réfactorisation du système de tarifs pour modularité*
