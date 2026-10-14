# Calendrier Tempo EDF

Cette intégration ajoute à Gladys la **couleur Tempo EDF** du jour et de demain, les **prévisions jusqu'à 15 jours**, les jours rouges et blancs restants dans la saison, un widget « Prévisions Tempo » et trois déclencheurs de scène.

Les données viennent de l'[API publique et gratuite de calendrier-tempo.fr](https://www.calendrier-tempo.fr/api-tempo) : aucun compte, aucune clé, rien à saisir.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Un accès à Internet depuis votre Gladys.

## Mise en route

1. Installez l'intégration depuis le catalogue de Gladys.
2. Ouvrez l'onglet **Découverte** de l'intégration et créez l'appareil **Calendrier Tempo EDF** (un clic).
3. Ajoutez le widget **Prévisions Tempo** à votre tableau de bord, si vous le souhaitez.

## Ce que fait l'appareil

| Fonctionnalité                               | Valeur                                                                |
| -------------------------------------------- | --------------------------------------------------------------------- |
| Aujourd'hui (officielle)                     | `bleu`, `blanc` ou `rouge`                                            |
| Couleur actuelle                             | la couleur qui s'applique maintenant : celle de la veille jusqu'à 6 h |
| Période tarifaire                            | `hp` (heures pleines, 6 h à 22 h) ou `hc` (heures creuses)            |
| Demain (officielle)                          | `inconnue` tant qu'EDF n'a pas annoncé la couleur (vers 11 h)         |
| Prévision J+2 à J+5                          | couleur prévue, zone la plus fiable                                   |
| Jours rouges sur 15 jours                    | jours rouges officiels ou prévus d'aujourd'hui à J+15                 |
| Prochain jour rouge, prochain jour blanc     | date (AAAA-MM-JJ), ou `aucun` sur l'horizon                           |
| Jours rouges restants, jours blancs restants | dans la saison en cours                                               |

Pour piloter un chauffage, utilisez **Couleur actuelle** : la journée Tempo va de 6 h à 6 h.

## Configuration

Une seule option : **Publier aussi les prévisions J+6 à J+15** (désactivée par défaut). Elle ajoute une fonctionnalité par jour ; ces prévisions sont une tendance indicative. Après l'avoir changée, mettez à jour l'appareil depuis l'onglet Découverte. Les 15 jours restent toujours visibles dans le widget.

## Déclencheurs de scène

- **Couleur Tempo de demain annoncée** : EDF vient de publier la couleur de demain. Filtre par couleur ; variables `couleur` et `date`.
- **Jour rouge prévu** : une date de J+2 à J+15 passe en rouge prévu. Filtre par fiabilité ; variables `date`, `jours_avant`, `probabilite_rouge` (en %) et `fiabilite`.
- **Journée Tempo commencée** : à 6 h, avec la couleur de la journée. Filtre par couleur.

Chaque événement n'est envoyé qu'une fois, même après un redémarrage. L'installation de l'intégration ne déclenche rien.

## Fiabilité

Seule la couleur publiée par EDF fait foi. De J+2 à J+5, la prévision est dans la zone où le site mesure sa performance, la plus fiable ; de J+6 à J+15, c'est une tendance. Les taux de réussite sont publiés sur la page [méthodologie](https://www.calendrier-tempo.fr/methodologie), pas dans l'intégration.

## Dépannage

- **Pas d'appareil dans Gladys** : créez-le depuis l'onglet Découverte, l'intégration ne le crée jamais seule.
- **Statut « déconnecté »** dans l'écran Configuration : calendrier-tempo.fr ne répond pas. L'intégration réessaie 5 minutes plus tard, puis toutes les 30 minutes. Les dernières valeurs du jour restent affichées ; prévisions et jours restants sont gardés 24 h au plus.
- **Couleur demain à `inconnue` le matin** : normal, EDF annonce la couleur vers 11 h. L'intégration relit l'API à 11 h 35.
- Les journaux de l'intégration (Configuration, puis journaux) indiquent chaque lecture en échec.

Contact : jean-pierre@calendrier-tempo.fr. Service gratuit et indépendant, sans garantie de disponibilité, non affilié à EDF ni à RTE.
