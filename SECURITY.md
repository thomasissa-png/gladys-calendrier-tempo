# Politique de sécurité

## Signaler une vulnérabilité

Merci de **ne pas** signaler un problème de sécurité dans un ticket public, une
pull request ou un message de forum.

Signalez-le en privé :

- depuis GitHub : onglet **Security** de ce dépôt, puis **Report a
  vulnerability** ;
- ou par courriel : jean-pierre@calendrier-tempo.fr.

Indiquez si possible :

- la version de l'intégration et celle de Gladys ;
- ce qu'un attaquant peut faire, et comment le reproduire ;
- les lignes de journal utiles (retirez d'abord jetons, mots de passe et
  adresses).

Nous répondons sous 48 heures. La correction est publiée dans une nouvelle
version de l'intégration, et l'avis de sécurité une fois la mise à jour
disponible.

## Versions maintenues

Seule la dernière version reçoit les correctifs de sécurité : mettez
l'intégration à jour depuis Gladys avant de signaler un problème.

## Périmètre

Dans le périmètre : le code de ce dépôt et l'image Docker qu'il publie.

Hors périmètre : Gladys Assistant lui-même (voir sa
[politique de sécurité](https://github.com/GladysAssistant/Gladys/security/policy))
et l'API de calendrier-tempo.fr (signalement à la même adresse,
jean-pierre@calendrier-tempo.fr).
