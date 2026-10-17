# Journal des modifications

Toutes les modifications notables de l'intégration sont décrites ici. Le format
suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet suit
le [versionnage sémantique](https://semver.org/lang/fr/).

Chaque modification est décrite sous `## [Unreleased]` au fil de l'eau. Le
workflow Release déplace cette section sous la version publiée, et elle devient
la note de la publication GitHub de cette version.

## [Unreleased]

Demandes d'utilisateurs du forum Gladys.

### Ajouts

- Prix du kWh, lu dans la grille publiée par l'API de calendrier-tempo.fr
  (`/api/today`, champ `tarifs`) : heures pleines de 6 h à 22 h, heures creuses
  de 22 h à 6 h, couleur de la journée Tempo en cours (celle de la veille entre
  0 h et 6 h). Trois fonctionnalités de l'appareil, en euros (catégorie
  « Devise » de Gladys) : « Prix actuel du kWh », « Prix HP du jour », « Prix HC
  du jour ». Après la mise à jour, mettez à jour l'appareil depuis l'onglet
  Découverte pour les voir.
- Widget : ligne « Prix actuel : 0,1654 €/kWh (HP, bleu) » en tête de la liste
  (J+2 à J+10 ensuite), mise à jour à 6 h et à 22 h.
- Aucun prix n'est écrit dans l'intégration : une réponse sans grille (copie
  de secours ancienne, retour arrière du site) garde la dernière grille lue,
  sans limite de durée, y compris pendant une panne (la grille ne change qu'à
  sa date d'effet), jusqu'à la lecture d'une nouvelle grille. Sans grille
  jamais lue, ou sans couleur connue pour la journée Tempo en cours, le prix
  est inconnu (rien d'affiché dans le widget, rien de publié). Gladys n'ayant
  pas d'état « inconnu » pour une valeur en euros, l'appareil garde alors son
  dernier prix, daté : dans une scène sur un prix, ajoutez la condition
  « Couleur actuelle différente de `inconnue` ».

### Corrections

- Widget : le graphique « Probabilité de jour rouge » affichait une échelle de
  0 à 2 (toutes les valeurs à 0 en octobre) ou de 0 à 150. Les valeurs étaient
  bien en %, mais Gladys calait l'axe sur les données. Le graphique montre
  désormais deux aires, « Bleu ou blanc » et « Rouge » (en rouge), sur un axe de
  0 à 100 % (« % » dans le titre : Gladys affiche les graduations sans unité).
- Widget : quand aucun jour de l'horizon ne peut être rouge (un rouge n'est
  possible que du 1er novembre au 31 mars, hors week-ends et jours fériés
  français, Pâques comprise ; le 1er novembre, Toussaint, n'est donc jamais
  rouge), le graphique vide laisse la place au message « Pas de jour rouge
  possible avant le 1er novembre. » (sans coupure entre « 1er » et
  « novembre ») ; sans aucune prévision, « Aucune prévision disponible pour le
  moment. ».
- Widget : une seule marque sur le graphique, sur demain quand EDF l'a annoncé
  rouge ou blanc. Les marques « Rouge prévu » se chevauchaient sur un téléphone
  dès que deux rouges prévus étaient proches, et celle d'aujourd'hui mordait sur
  les graduations ; les jours prévus restent lisibles sur la courbe et la liste.
- Documentation : Gladys affiche les prix avec un point décimal (« 0.165 € »).
  Limites du rendu de Gladys notées : graduations sans « % », barre flottante
  qui peut masquer le bas du widget sur un téléphone.

## [0.1.0] - 2026-10-14

### Ajouts

- Appareil « Calendrier Tempo EDF », proposé dans l'onglet Découverte : couleur
  officielle d'aujourd'hui et de demain, couleur actuelle (journée Tempo de 6 h
  à 6 h), période tarifaire (`hp` ou `hc`), prévisions J+2 à J+5, jours rouges
  sur 15 jours, prochain jour rouge et blanc, jours rouges et blancs restants.
- Option « Publier aussi les prévisions J+6 à J+15 » (désactivée par défaut).
- Widget « Prévisions Tempo » : aujourd'hui, demain, jours restants,
  probabilité de jour rouge sur 15 jours et liste J+2 à J+11.
- Déclencheurs de scène : couleur de demain annoncée, jour rouge prévu,
  journée Tempo commencée. Le dernier état émis est gardé dans `/data` : rien
  ne se déclenche deux fois, même après un redémarrage.
- Lecture de l'API publique de calendrier-tempo.fr toutes les 30 minutes, à
  0 h 05 et à 11 h 35 (heure de Paris), avec un décalage aléatoire de 0 à
  120 secondes propre à chaque installation et une seule relance 5 minutes
  après un échec.

### Corrections avant publication (recette du 2026-10-14)

- Au redémarrage, rien n'est publié avant la première lecture : les couleurs
  ne passent plus par `inconnue`, et les scènes ne se déclenchent plus à tort.
- Si l'API ne répond pas au redémarrage ou au changement de jour, les couleurs
  officielles déjà lues (gardées dans `/data`) restent publiées pour leur date.
- Une panne de la source officielle (`source_indisponible`) n'efface plus la
  couleur de demain déjà connue et déclenche la relance à 5 minutes.
- À minuit, « Aujourd'hui » et « Demain » sont recalés sans appel à l'API (ils
  gardaient les couleurs de la veille jusqu'à la lecture de 0 h 05).
- Une couleur n'est envoyée à Gladys que si elle change ; seuls les compteurs
  sont republiés toutes les 30 minutes.
- Widget : tuiles « Rouges » et « Blancs », lisibles à toutes les largeurs.
- Une réponse facultative qui n'est pas un objet JSON n'invalide plus toute la
  lecture.

[Unreleased]: https://github.com/thomasissa-png/gladys-calendrier-tempo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/thomasissa-png/gladys-calendrier-tempo/releases/tag/v0.1.0
