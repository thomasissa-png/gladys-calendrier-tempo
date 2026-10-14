# Réponses réelles de l'API

Chaque fichier est une réponse réelle de `https://www.calendrier-tempo.fr/api/...`,
enregistrée telle quelle (aucune modification), avec le User-Agent
`CalendrierTempo-Gladys/0.1.0`. Le nom donne l'heure du relevé (UTC) et l'endpoint.

| Fichier                                 | Requête                   | Relevé                  |
| --------------------------------------- | ------------------------- | ----------------------- |
| `2026-10-14T12-43Z_today.json`          | `GET /api/today`          | 2026-10-14 12:43:40 UTC |
| `2026-10-14T12-43Z_tomorrow.json`       | `GET /api/tomorrow`       | 2026-10-14 12:43:40 UTC |
| `2026-10-14T12-43Z_remaining.json`      | `GET /api/remaining`      | 2026-10-14 12:43:41 UTC |
| `2026-10-14T12-43Z_predictions.json`    | `GET /api/predictions`    | 2026-10-14 12:43:41 UTC |
| `2026-10-14T12-43Z_history-days-2.json` | `GET /api/history?days=2` | 2026-10-14 12:43:42 UTC |

Mi-octobre, tous les jours sont bleus (pas de jour rouge avant le 1er novembre).
Les tests des jours blancs et rouges partent de ces réponses et changent
explicitement une couleur dans le test lui-même : ce sont des scénarios, jamais
présentés comme des données réelles.
