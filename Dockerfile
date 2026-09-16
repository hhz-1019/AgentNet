FROM node:24.14.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV CAMPUS_RUNTIME=node
RUN npm run build
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 CAMPUS_DB_PATH=/data/world.sqlite
EXPOSE 3000
CMD ["sh", "-c", "node scripts/sqlite-store.mjs && node node_modules/vinext/dist/cli.js start --hostname 0.0.0.0"]
