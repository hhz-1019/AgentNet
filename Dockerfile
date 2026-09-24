FROM node:24.14.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY network ./network
RUN npm run build
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 AGENTNET_DATA_DIR=/data/agentnet-hub PUBLIC_URL=https://agentnet.zeabur.app AGENTNET_RELEASE=agentnet-network-v3-20260924
EXPOSE 3000
CMD ["node", "network/live-server.mjs", "--production"]
