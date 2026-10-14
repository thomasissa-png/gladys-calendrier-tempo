// -----------------------------------------------------------------------------
// Client HTTP minimal de l'API publique calendrier-tempo.fr (fetch natif).
// -----------------------------------------------------------------------------

import { API_BASE_URL, REQUEST_TIMEOUT_MS, USER_AGENT } from './constants.js';

export class TempoApiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TempoApiError';
  }
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch] - injectable pour les tests
 * @param {string} [options.baseUrl]
 * @param {number} [options.timeoutMs]
 */
export function createApiClient({
  fetch: fetchImpl = globalThis.fetch,
  baseUrl = API_BASE_URL,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  return {
    /** GET /api/<endpoint> et renvoie le JSON décodé ; TempoApiError sinon. */
    async get(endpoint) {
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/${endpoint}`, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const reason =
          err?.name === 'TimeoutError' ? `délai de ${timeoutMs / 1000} s dépassé` : err;
        throw new TempoApiError(`/api/${endpoint} : ${reason}`);
      }
      if (response.status !== 200) {
        throw new TempoApiError(`/api/${endpoint} : HTTP ${response.status}`);
      }
      try {
        return JSON.parse(await response.text());
      } catch {
        throw new TempoApiError(`/api/${endpoint} : JSON invalide`);
      }
    },
  };
}
