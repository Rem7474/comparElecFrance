// src/state.js
// État centralisé de l'application comparElecFrance

export const appState = {
  // Données de consommation (records horaires)
  records: [],
  // Tarifs chargés dynamiquement (id -> config)
  tariffs: {},
  // Wrapper pour compatibilité (ex-DEFAULTS)
  defaults: {},
  // Carte des jours Tempo (date ISO -> couleur)
  tempoDayMap: {},
  // Source map pour diagnostics (date ISO -> 'api'|'store'|'gen')
  tempoSourceMap: {},
  // Indique si l'API Tempo a été utilisée
  tempoApiUsed: false,
  // Indique si des couleurs réelles sont présentes
  tempoRealUsed: false,
  // kVA détecté automatiquement
  detectedKva: null,
  // kVA sélectionné (manuel ou auto)
  currentKva: 6,
  // Cache session pour records parsés (clé: nom fichier)
  recordsCache: {},
  // Statut de chargement des tarifs
  tariffsLoaded: false,
  // Erreur de chargement tarifs (string ou null)
  tariffsError: null
};
