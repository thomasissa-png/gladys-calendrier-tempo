// -----------------------------------------------------------------------------
// Gestionnaires d'événements Gladys, séparés de index.js pour être testés avec
// le faux Gladys du SDK (`createFakeGladys`).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { calendrierTempo } from './devices/calendrierTempo.js';

const logger = createLogger({ name: 'calendrier-tempo' });

/**
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {ReturnType<import('./integration.js').createTempoIntegration>} tempo
 */
export function registerHandlers(gladys, tempo) {
  // Découverte : l'unique appareil, que l'utilisateur crée en un clic.
  gladys.onScanRequest(async () => {
    await gladys.publishDiscoveredDevices([calendrierTempo.buildDevice(gladys, tempo.config)]);
  });

  // Appareil créé ou modifié : ses valeurs sont publiées tout de suite (Gladys
  // ignore les états d'une fonctionnalité qui n'existe pas encore).
  const republish = async () => tempo.publishStates({ force: true });
  gladys.onDeviceCreated(republish);
  gladys.onDeviceUpdated(republish);

  // Toutes les fonctionnalités sont en lecture seule.
  gladys.onSetValue(async () => {
    throw new Error('Calendrier Tempo EDF : fonctionnalités en lecture seule');
  });

  gladys.onConfigUpdated((config) => tempo.onConfigUpdated(config));

  for (const [key, widget] of Object.entries(tempo.widgets)) {
    gladys.onWidgetGet(key, (request) => widget.get(gladys, request));
  }

  gladys.on('connected', async () => {
    try {
      await tempo.onConnected();
    } catch (err) {
      logger.error('Initialisation après connexion en échec', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
        })
        .catch(() => {});
    }
  });
}
