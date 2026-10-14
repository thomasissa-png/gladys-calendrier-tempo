// -----------------------------------------------------------------------------
// Déclencheurs de scène (Gladys 5.1+), absents du service Tempo natif de Gladys.
//
//   - couleur_demain_annoncee : EDF vient d'annoncer la couleur de demain ;
//   - jour_rouge_prevu        : une date de J+2 à J+15 passe à « rouge prévu » ;
//   - journee_tempo_commencee : 6 h, une nouvelle journée Tempo commence.
//
// Un événement par transition, jamais deux fois le même : le dernier état émis
// est gardé dans /data. À la toute première lecture de chaque déclencheur,
// l'état est seulement mémorisé (une installation ne déclenche rien).
// Les clés sont définitives : une scène enregistre la clé, ne jamais la renommer.
// -----------------------------------------------------------------------------

import { TEMPO_DAY_START_HOUR } from './constants.js';
import { COLOR_ROUGE, officialColor, probability, tempoDay } from './tempo.js';
import { addDays, parisParts } from './time.js';

export const TRIGGERS = Object.freeze({
  TOMORROW_ANNOUNCED: 'couleur_demain_annoncee',
  RED_FORECAST: 'jour_rouge_prevu',
  TEMPO_DAY_STARTED: 'journee_tempo_commencee',
});

export const SCENE_TRIGGER_KEYS = Object.values(TRIGGERS);

// Prévisions surveillées par « jour rouge prévu » : J+2 à J+15 (J+1 est annoncé par EDF).
const RED_FORECAST_MIN_OFFSET = 2;
const RED_FORECAST_MAX_OFFSET = 15;

/** Mémoire vide : chaque champ à null signifie « pas encore de référence ». */
export function emptyTriggerMemory() {
  return { announced: null, redForecasts: null, tempoDayStarted: null };
}

function percent(value) {
  return value === null ? null : Math.round(value * 100);
}

/**
 * Événements à émettre pour ces données, et la nouvelle mémoire.
 * Fonction pure : aucune émission ici (voir integration.js).
 * @param {object} memory - mémoire précédente (emptyTriggerMemory() au départ)
 * @param {object} data - TempoData de la dernière lecture réussie
 * @param {number} now - instant (ms)
 * @returns {{ events: Array<{ key: string, data: object }>, memory: object }}
 */
export function computeSceneEvents(memory, data, now) {
  const events = [];
  const next = { ...emptyTriggerMemory(), ...memory };
  const paris = parisParts(now);
  const yesterday = addDays(paris.date, -1);

  // 1. Couleur de demain annoncée par EDF (une fois par date ; une correction
  //    d'EDF vers une autre couleur est une nouvelle annonce).
  const { date: tomorrow, color: tomorrowColor } = data.tomorrow;
  if (tomorrow && tomorrowColor) {
    const announced = { ...(next.announced ?? {}) };
    if (next.announced !== null && announced[tomorrow] !== tomorrowColor) {
      events.push({
        key: TRIGGERS.TOMORROW_ANNOUNCED,
        data: { couleur: tomorrowColor, date: tomorrow },
      });
    }
    announced[tomorrow] = tomorrowColor;
    next.announced = Object.fromEntries(
      Object.entries(announced).filter(([date]) => date >= yesterday),
    );
  }

  // 2. Jour rouge prévu de J+2 à J+15. Sans prévision au-delà de demain
  //    (prévisions indisponibles), la mémoire est gardée telle quelle : rien ne
  //    redéclenche au retour.
  if (data.days.some((d) => d.offset >= RED_FORECAST_MIN_OFFSET)) {
    const reds = data.days.filter(
      (d) =>
        !d.official &&
        d.color === COLOR_ROUGE &&
        d.offset >= RED_FORECAST_MIN_OFFSET &&
        d.offset <= RED_FORECAST_MAX_OFFSET,
    );
    if (next.redForecasts !== null) {
      const known = new Set(next.redForecasts);
      for (const day of reds.filter((d) => !known.has(d.date))) {
        events.push({
          key: TRIGGERS.RED_FORECAST,
          data: {
            date: day.date,
            jours_avant: day.offset,
            probabilite_rouge: percent(probability(day, COLOR_ROUGE)),
            fiabilite: day.fiabilite,
          },
        });
      }
    }
    next.redForecasts = reds.map((d) => d.date);
  }

  // 3. Début de la journée Tempo (6 h). Émis entre 6 h et 7 h seulement (une
  //    relance ou un redémarrage dans l'heure rattrape l'événement, jamais plus
  //    tard) ; sans couleur connue, nouvel essai à la lecture suivante de l'heure.
  const currentDay = tempoDay(paris.date, paris.hour);
  if (next.tempoDayStarted !== currentDay) {
    const color = officialColor(data, currentDay);
    const inWindow = paris.hour === TEMPO_DAY_START_HOUR;
    if (next.tempoDayStarted === null || !inWindow) {
      next.tempoDayStarted = currentDay;
    } else if (color) {
      events.push({
        key: TRIGGERS.TEMPO_DAY_STARTED,
        data: { couleur: color, date: currentDay },
      });
      next.tempoDayStarted = currentDay;
    }
  }

  return { events, memory: next };
}
