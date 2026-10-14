import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, TempoApiError } from '../src/api.js';
import { fixture } from './helpers.js';

function recordingFetch(respond) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { fetch, calls };
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('User-Agent CalendrierTempo-Gladys/<version>, JSON demandé, délai de 15 s', async () => {
  const { fetch, calls } = recordingFetch(() => jsonResponse(fixture('today')));
  const api = createApiClient({ fetch });
  assert.deepEqual(await api.get('today'), fixture('today'));
  assert.equal(calls[0].url, 'https://www.calendrier-tempo.fr/api/today');
  assert.match(calls[0].init.headers['User-Agent'], /^CalendrierTempo-Gladys\/\d+\.\d+\.\d+$/);
  assert.equal(calls[0].init.headers.Accept, 'application/json');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('HTTP autre que 200, JSON invalide, réseau, délai : TempoApiError', async () => {
  const cases = [
    () => jsonResponse({}, 503),
    () => new Response('<html>', { status: 200 }),
    () => {
      throw new TypeError('fetch failed');
    },
  ];
  for (const respond of cases) {
    const api = createApiClient({ fetch: recordingFetch(respond).fetch });
    await assert.rejects(api.get('today'), TempoApiError);
  }
  const slow = createApiClient({
    timeoutMs: 20,
    // Le minuteur d'AbortSignal.timeout ne retient pas Node : un minuteur actif
    // garde le test vivant jusqu'à l'abandon de la requête.
    fetch: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => {}, 5_000);
        signal.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          reject(signal.reason);
        });
      }),
  });
  await assert.rejects(slow.get('predictions'), /délai de 0.02 s dépassé/);
});
