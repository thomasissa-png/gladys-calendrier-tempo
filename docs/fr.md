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
| Prix actuel du kWh                           | en euros TTC, couleur et période en cours (veille jusqu'à 6 h)        |
| Prix HP du jour, prix HC du jour             | en euros TTC, pour la journée Tempo en cours                          |
| Demain (officielle)                          | `inconnue` tant qu'EDF n'a pas annoncé la couleur (vers 11 h)         |
| Prévision J+2 à J+5                          | couleur prévue, zone la plus fiable                                   |
| Jours rouges sur 15 jours                    | jours rouges officiels ou prévus d'aujourd'hui à J+15                 |
| Prochain jour rouge, prochain jour blanc     | date (AAAA-MM-JJ), ou `aucun` sur l'horizon                           |
| Jours rouges restants, jours blancs restants | dans la saison en cours                                               |

Pour piloter un chauffage, utilisez **Couleur actuelle** : la journée Tempo va de 6 h à 6 h.

Les prix viennent de la grille publiée par l'API de calendrier-tempo.fr, jamais d'un tarif écrit dans l'intégration : si une réponse ne la contient pas, la dernière grille lue sert 24 h au plus, puis le prix reste inconnu. Gladys les affiche avec 3 chiffres significatifs et un point décimal (« 0.165 € »), la valeur utilisable dans les scènes est exacte (0.1654).

## Le widget

Le widget **Prévisions Tempo** montre aujourd'hui, demain, les jours restants, le prix actuel (« Prix actuel : 0,1654 €/kWh (HP, bleu) »), la probabilité de jour rouge sur 15 jours (de 0 à 100 %) et la liste des prochains jours. Quand aucun jour des 15 prochains ne peut être rouge (du 1er novembre au 31 mars seulement, hors week-ends et jours fériés), le graphique laisse la place au message « Pas de jour rouge possible avant le 1er novembre. ». Les graduations du graphique s'affichent sans « % » (rendu de Gladys) ; sur un téléphone, la barre flottante de Gladys peut masquer les dernières lignes du widget : faites défiler la page.

## Configuration

Une seule option : **Publier aussi les prévisions J+6 à J+15** (désactivée par défaut). Elle ajoute une fonctionnalité par jour ; ces prévisions sont une tendance indicative. Après l'avoir changée, mettez à jour l'appareil depuis l'onglet Découverte. Les 15 jours restent toujours visibles dans le widget.

## Déclencheurs de scène

- **Couleur Tempo de demain annoncée** : EDF vient de publier la couleur de demain. Filtre par couleur ; variables `couleur` et `date`.
- **Jour rouge prévu** : une date de J+2 à J+15 passe en rouge prévu. Filtre par fiabilité ; variables `date`, `jours_avant`, `probabilite_rouge` (en %) et `fiabilite`.
- **Journée Tempo commencée** : à 6 h, avec la couleur de la journée. Filtre par couleur.

Chaque événement n'est envoyé qu'une fois, même après un redémarrage. L'installation de l'intégration ne déclenche rien.

Pour une scène sur une fonctionnalité de l'appareil, préférez les déclencheurs de l'intégration, ou cochez l'option de seuil de Gladys.

## Fiabilité

Seule la couleur publiée par EDF fait foi. De J+2 à J+5, la prévision est dans la zone où le site mesure sa performance, la plus fiable ; de J+6 à J+15, c'est une tendance. Les taux de réussite sont publiés sur la page [méthodologie](https://www.calendrier-tempo.fr/methodologie), pas dans l'intégration.

## Dépannage

- **Pas d'appareil dans Gladys** : créez-le depuis l'onglet Découverte, l'intégration ne le crée jamais seule.
- **Statut « déconnecté »** dans l'écran Configuration : calendrier-tempo.fr ne répond pas. L'intégration réessaie 5 minutes plus tard, puis toutes les 30 minutes. Les couleurs officielles déjà lues restent affichées pour leur date, même après un redémarrage ; prévisions et jours restants sont gardés 24 h au plus. Les prix gardent leur dernière valeur (Gladys n'a pas d'état « inconnu » pour une valeur en euros) : dans une scène sur un prix, ajoutez la condition « Couleur actuelle différente de `inconnue` ».
- **Pas de prix du kWh** : l'API n'a pas encore publié sa grille de prix, ou la couleur de la journée Tempo en cours n'est pas connue. Le prix revient seul à la lecture suivante. Après la mise à jour en 0.2.0, mettez à jour l'appareil depuis l'onglet Découverte pour voir les trois fonctionnalités de prix.
- **Couleur demain à `inconnue` le matin** : normal, EDF annonce la couleur vers 11 h. L'intégration relit l'API à 11 h 35.
- Les journaux de l'intégration (Configuration, puis journaux) indiquent chaque lecture en échec.

Contact : jean-pierre@calendrier-tempo.fr. Service gratuit et indépendant, sans garantie de disponibilité, non affilié à EDF ni à RTE.
