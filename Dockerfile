FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=80 \
    DATA_DIR=/app/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY public ./public

# Dateirechte vereinheitlichen: Quelldateien vom Mac kommen teils mit Modus 600 (nur Besitzer)
# und gehören im Image root – der Container läuft aber als „node“ und muss sie lesen können.
RUN chmod -R a+rX /app/server.js /app/lib /app/public /app/package.json \
 && mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "server.js"]
