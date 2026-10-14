# Journal des modifications

Toutes les modifications notables de l'intégration sont décrites ici. Le format
suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet suit
le [versionnage sémantique](https://semver.org/lang/fr/).

Chaque modification est décrite sous `## [Unreleased]` au fil de l'eau. Le
workflow Release déplace cette section sous la version publiée, et elle devient
la note de la publication GitHub de cette version.

## [Unreleased]

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

[Unreleased]: https://github.com/thomasissa-png/gladys-calendrier-tempo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/thomasissa-png/gladys-calendrier-tempo/releases/tag/v0.1.0
