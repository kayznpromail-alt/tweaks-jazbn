# Build from the repository root: docker build -f server/Dockerfile .

# Stage 1: build the React dashboard SPA
FROM node:22-alpine AS dashboard-build
WORKDIR /build
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# Stage 2: build the Astro landing site
FROM node:22-alpine AS site-build
WORKDIR /build
COPY package.json package-lock.json ./
COPY shared/ ./shared/
RUN npm ci
COPY src/ ./src/
COPY public/ ./public/
COPY astro.config.mjs tsconfig.json ./
RUN npm run build

# Stage 3: production server
FROM node:22-alpine
WORKDIR /app
COPY shared/ ./shared/
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/src ./server/src
COPY server/panel ./server/panel
COPY --from=dashboard-build /build/dist ./server/dashboard/
COPY --from=site-build /build/dist ./server/site/
WORKDIR /app/server
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/data/edgey.db
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
