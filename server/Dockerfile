# Build from the repository root: docker build -f server/Dockerfile .
FROM node:22-alpine
WORKDIR /app
COPY shared/ ./shared/
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/src ./server/src
WORKDIR /app/server
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/data/edgey.db
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
