// -----------------------------------------------------------------------------
// Point d'entrée de l'intégration Gladys « Calendrier Tempo EDF ».
//
// Ce fichier ne fait que brancher le SDK sur le cœur de l'intégration
// (src/integration.js) : gestionnaires enregistrés AVANT connect(), puis
// connexion. Le SDK lit lui-même les variables injectées par Gladys
// (GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { VERSION } from './src/constants.js';
import { createTempoIntegration } from './src/integration.js';
import { registerHandlers } from './src/handlers.js';

const gladys = new GladysIntegration();
const tempo = createTempoIntegration(gladys);

registerHandlers(gladys, tempo);

gladys.handleShutdown((signal) => {
  logger.info(`Signal ${signal} reçu, arrêt propre`);
  tempo.stop();
});

logger.info(`Démarrage de Calendrier Tempo EDF ${VERSION}`);
tempo.start().catch((err) => {
  logger.error('Démarrage du rythme de lecture impossible', err);
  process.exit(1);
});
gladys.connect().catch((err) => {
  logger.error('Connexion initiale à Gladys impossible', err);
  process.exit(1);
});
