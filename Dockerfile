FROM node:22

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci

COPY server ./server
COPY client ./client

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]