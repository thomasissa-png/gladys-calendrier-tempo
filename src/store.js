// -----------------------------------------------------------------------------
// État gardé dans /data (seul dossier inscriptible du bac à sable Gladys).
//
// Contenu : derniers déclencheurs émis (pour ne jamais redéclencher après un
// redémarrage), couleurs officielles vues (hier, aujourd'hui) et dernières
// réponses valides des endpoints facultatifs (24 h au plus), dernière grille de
// prix lue (sans limite de durée). Aucune donnée personnelle. Écriture atomique : fichier temporaire puis renommage.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const STATE_FILE = 'calendrier-tempo-state.json';
const STATE_VERSION = 1;

export function createStateStore(dir, { logger } = {}) {
  const file = join(dir, STATE_FILE);
  let warned = false;
  return {
    file,
    /** Dernier état enregistré, ou null (première installation, fichier illisible). */
    async load() {
      try {
        const data = JSON.parse(await readFile(file, 'utf8'));
        return data && data.version === STATE_VERSION ? data : null;
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger?.warn(`État illisible (${file}), repart de zéro : ${err.message}`);
        }
        return null;
      }
    },
    /** Enregistre l'état ; un échec est signalé une fois et n'arrête rien. */
    async save(state) {
      try {
        await mkdir(dir, { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify({ ...state, version: STATE_VERSION }));
        await rename(tmp, file);
        warned = false;
      } catch (err) {
        if (!warned) {
          warned = true;
          logger?.warn(`Impossible d'enregistrer l'état dans ${dir} : ${err.message}`);
        }
      }
    },
  };
}
