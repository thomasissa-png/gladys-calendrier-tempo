// -----------------------------------------------------------------------------
// Heure de Paris, sans dépendance : Intl fait les changements d'heure.
//
// Les dates de calendrier circulent en texte ISO « AAAA-MM-JJ » (format de
// l'API) ; l'arithmétique se fait en UTC à midi, sans effet d'heure d'été.
// -----------------------------------------------------------------------------

import { TIMEZONE } from './constants.js';

const PARTS_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Date et heure murale de Paris pour un instant donné.
 * @param {Date|number} instant
 * @returns {{ date: string, hour: number, minute: number, second: number }}
 */
export function parisParts(instant) {
  const parts = Object.fromEntries(
    PARTS_FORMAT.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Lit une date ISO « AAAA-MM-JJ » (10 premiers caractères), null si invalide. */
export function parseIsoDate(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = ISO_DATE.exec(value.slice(0, 10));
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, 12));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return match[0];
}

function toUtcNoon(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day, 12);
}

/** isoDate + n jours. */
export function addDays(isoDate, days) {
  return new Date(toUtcNoon(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Nombre de jours de `from` à `to` (positif si `to` est après). */
export function daysBetween(from, to) {
  return Math.round((toUtcNoon(to) - toUtcNoon(from)) / DAY_MS);
}

/** Jour de la semaine d'une date ISO (0 = dimanche). */
export function weekday(isoDate) {
  return new Date(toUtcNoon(isoDate)).getUTCDay();
}

// Écart (ms) entre l'heure murale de Paris et l'UTC à cet instant.
function parisOffsetMs(instant) {
  const p = parisParts(instant);
  const [year, month, day] = p.date.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day, p.hour, p.minute, p.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

/** Instant UTC (ms) d'une heure murale de Paris donnée. */
export function parisWallTimeToInstant(isoDate, hour, minute = 0, second = 0) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess = wall - parisOffsetMs(wall);
  return wall - parisOffsetMs(guess);
}

/**
 * Prochain passage à hh:mm:ss heure de Paris strictement après `now`
 * (changements d'heure compris), en millisecondes UTC.
 */
export function nextParisTime(now, hour, minute = 0, second = 0) {
  let day = parisParts(now).date;
  for (;;) {
    const target = parisWallTimeToInstant(day, hour, minute, second);
    if (target > now) {
      return target;
    }
    day = addDays(day, 1);
  }
}
