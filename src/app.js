// src/app.js
// Point d'entrée principal de comparElecFrance (SPA)
import { appState } from './state.js';
import * as utils from './utils.js';
import * as tariffEngine from './tariffEngine.js';
import * as pvSim from './pvSimulation.js';
import * as tempoCal from './tempoCalendar.js';

// TODO: Orchestration, gestion du cache records, gestion d'erreur UI, triggerFullRecalculation, etc.

/**
 * Orchestration du recalcul complet de l'application
 * (Import, analyse, simulation PV, calculs tarifs, calendrier Tempo)
 */
export async function triggerFullRecalculation() {
  // 1. Charger les fichiers et parser les records (à brancher sur l'UI)
  // 2. Générer ou charger le calendrier Tempo
  // 3. Calculer les coûts pour chaque offre
  // 4. Simuler la production PV et l'autoconsommation
  // 5. Mettre à jour l'état global et rafraîchir l'affichage
  // (À compléter selon l'intégration UI)
}
