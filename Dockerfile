# -----------------------------------------------------------------------------
# Image de l'intégration Calendrier Tempo EDF (reprise du modèle officiel).
#
# Contraintes du bac à sable Gladys :
#   - système de fichiers en LECTURE SEULE -> rien n'est écrit hors de /data ;
#   - un seul volume inscriptible : /data (état des déclencheurs de scène) ;
#   - utilisateur non root ;
#   - image multi-architecture (linux/amd64 + linux/arm64), voir build.yml.
# -----------------------------------------------------------------------------

FROM node:24-alpine

# dumb-init : transmet SIGTERM pour un arrêt propre.
RUN apk add --no-cache dumb-init

WORKDIR /app

# Dépendances de production d'abord (meilleur cache de construction).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Puis le code de l'intégration.
COPY index.js ./
COPY src ./src
COPY gladys-assistant-integration.json ./

# Seul emplacement inscriptible à l'exécution. Docker crée un nouveau volume
# avec le propriétaire du /data de l'image : il doit appartenir à `node`, et
# avant VOLUME (les changements faits après sont perdus).
ENV NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# Utilisateur sans privilège (fourni par l'image node).
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
