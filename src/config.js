// -----------------------------------------------------------------------------
// Configuration de l'intégration (écran « Configuration » de Gladys, généré à
// partir du `config_schema` du manifeste).
//
// Une seule option : publier aussi les prévisions J+6 à J+15, une
// fonctionnalité par jour. Désactivée par défaut, comme les capteurs J+6 à J+15
// du composant Home Assistant : tout l'horizon reste visible dans le widget et
// dans « Jours rouges sur 15 jours ».
// -----------------------------------------------------------------------------

// Valeurs par défaut : DOIVENT rester identiques aux `default` du manifeste.
export const DEFAULT_CONFIG = {
  previsions_indicatives: false,
};

/**
 * Fusionne la configuration reçue avec les valeurs par défaut.
 * @param {Record<string, unknown>} raw configuration renvoyée par le SDK
 */
export function normalizeConfig(raw = {}) {
  const value = raw?.previsions_indicatives;
  return {
    // Un formulaire peut renvoyer une chaîne : seul « vrai » explicite active l'option.
    previsions_indicatives: value === true || value === 'true',
  };
}
