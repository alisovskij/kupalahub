FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.* ./
COPY web ./web
COPY public ./public
COPY shared ./shared
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DB_PATH=/app/data/kupala.sqlite
COPY package*.json ./
RUN npm ci --omit=dev && mkdir data && chown node:node data
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]
