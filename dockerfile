FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node main.js LICENSE ./
COPY --chown=node:node libs ./libs

USER node
EXPOSE 8080
CMD ["node", "main.js"]
